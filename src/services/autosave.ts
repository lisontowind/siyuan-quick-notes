import type { Draft, DraftStore, Geometry, NoteRecord, SavePhase } from '../types';
import { ConflictError, UncertainWriteError, type NoteRepository } from './repository';
import { SerialQueue } from '../core/serial';
import { migrateNoteTitle } from '../core/identity';

export class AutoSaveService {
  phase: SavePhase;
  error?: string;
  localRevision = -1;
  private timer?: ReturnType<typeof setTimeout>;
  private saves = new SerialQueue();
  private localWrites = new SerialQueue();
  private disposed = false;
  private paused = false;
  private deleting = false;
  private targetResolution?: Promise<void>;
  private pendingDraft?: { draft: Draft; generation: number };
  private writePump?: Promise<void>;
  private generation = 0;
  private durableGeneration = 0;
  private waiters: Array<{ generation: number; resolve: (safe: boolean) => void }> = [];
  constructor(public note: NoteRecord, private repo: NoteRepository, private drafts: DraftStore,
    private delay: () => number, private notify: () => void, private geometry: () => Geometry,
    private saved: (note: NoteRecord) => void = () => {}) {
    this.note = migrateNoteTitle(note);
    this.phase = note.revision > note.savedRevision ? 'dirty' : note.docId ? 'saved' : 'empty';
  }
  edit(text: string, revision: number, schedule = true, title = this.note.title ?? ''): Promise<void> {
    if (this.disposed || this.deleting || !Number.isSafeInteger(revision) || revision <= this.note.revision) return Promise.resolve();
    this.note = migrateNoteTitle({ ...this.note, text, title, revision, updatedAt: Date.now() });
    if (schedule && this.note.text.trim() && !this.note.target && !this.targetResolution) {
      this.targetResolution = this.repo.resolveTarget(structuredClone(this.note)).then(async target => {
        if (this.disposed) return;
        this.note.target = target;
        await this.persist();
      }).catch(error => {
        if (this.disposed || this.phase === 'conflict') return;
        this.phase = 'error'; this.error = message(error); this.notify();
      }).finally(() => { this.targetResolution = undefined; });
    }
    if (this.phase !== 'conflict') { this.phase = 'dirty'; this.error = undefined; }
    this.notify();
    // Schedule from input time, not from completion of a slow disk write.
    this.pauseTimer();
    if (schedule && !this.paused && this.phase !== 'conflict') {
      this.timer = setTimeout(() => { void this.flush(); }, this.delay());
    }
    return this.persist().then(() => {});
  }
  persist(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const generation = ++this.generation;
    // One active write and one latest snapshot; metadata changes count at the same revision.
    this.pendingDraft = { draft: { note: structuredClone(this.note), geometry: this.geometry() }, generation };
    const result = new Promise<boolean>(resolve => this.waiters.push({ generation, resolve }));
    this.startPump();
    return result;
  }
  private startPump(): void {
    if (this.writePump) return;
    this.writePump = this.localWrites.run(this.note.id, async () => {
      while (this.pendingDraft) {
        const work = this.pendingDraft; this.pendingDraft = undefined;
        let safe = false;
        try {
          await this.drafts.write(work.draft);
          this.durableGeneration = work.generation;
          this.localRevision = Math.max(this.localRevision, work.draft.note.revision);
          safe = true;
        } catch (error) {
          this.error = `本机草稿保存失败：${message(error)}`;
          if (this.phase !== 'conflict') this.phase = 'error';
        }
        const settled = this.waiters.filter(waiter => waiter.generation <= work.generation);
        this.waiters = this.waiters.filter(waiter => waiter.generation > work.generation);
        for (const waiter of settled) waiter.resolve(safe);
        if (!this.disposed) this.notify();
      }
    }).finally(() => {
      this.writePump = undefined;
      if (this.pendingDraft) this.startPump();
    });
  }
  async flush(): Promise<boolean> {
    this.pauseTimer();
    return this.saves.run(this.note.id, async () => {
      if (this.phase === 'conflict' || this.disposed || this.deleting) return false;
      if (this.note.revision <= this.note.savedRevision) { await this.removeDraft(); return true; }
      if (!this.note.docId && !this.note.text.trim()) {
        this.note.savedRevision = this.note.revision; this.phase = 'empty';
        await this.removeDraft(); this.notify(); return true;
      }
      const snapshot = structuredClone(this.note);
      this.phase = 'saving'; this.error = undefined; this.notify();
      try {
        await this.targetResolution;
        snapshot.target ??= this.note.target;
        await this.repo.save(snapshot, async () => {
          if (this.disposed) throw new Error('插件已停止，未完成内容保留为恢复草稿');
          this.note.target = snapshot.target; this.note.docId = snapshot.docId; this.note.blockId = snapshot.blockId;
          this.note.storage = snapshot.storage; this.note.baseline = snapshot.baseline; this.note.docPath = snapshot.docPath; this.note.docTitle = snapshot.docTitle;
          if (!await this.persist()) throw new Error('恢复草稿未落盘，已停止内核写入');
          if (this.disposed) throw new Error('插件已停止，未完成内容保留为恢复草稿');
        });
        // A late kernel response must not remove or rewrite the shutdown recovery snapshot.
        if (this.disposed) return false;
        this.note.target = snapshot.target; this.note.docId = snapshot.docId; this.note.docPath = snapshot.docPath; this.note.docTitle = snapshot.docTitle; this.note.baseline = snapshot.baseline;
        this.note.savedRevision = snapshot.revision;
        snapshot.savedRevision = snapshot.revision; this.saved(snapshot);
        if (this.note.revision === snapshot.revision) {
          this.phase = 'saved'; await this.removeDraft();
        } else { this.phase = 'dirty'; await this.persist(); }
        this.notify(); return this.note.revision === snapshot.revision;
      } catch (error) {
        if (this.disposed) return false;
        this.phase = error instanceof ConflictError || error instanceof UncertainWriteError ? 'conflict' : 'error';
        this.error = message(error);
        await this.persist(); this.notify(); return false;
      }
    });
  }
  private async removeDraft(): Promise<void> {
    await this.localWrites.run(this.note.id, async () => {
      if (!this.disposed && !this.pendingDraft && this.note.revision <= this.note.savedRevision) {
        try { await this.drafts.remove(this.note.id); }
        catch (error) { this.error = `本机草稿清理失败：${message(error)}`; this.notify(); return; }
        this.localRevision = -1;
        if (this.error?.startsWith('本机草稿清理失败：')) { this.error = undefined; this.notify(); }
      }
    });
  }
  async reload(): Promise<void> {
    this.pauseTimer();
    await this.saves.run(this.note.id, async () => {
      await this.targetResolution;
      await this.writePump;
      if (this.disposed) return;
      const original = this.note;
      const reloaded = await this.repo.reload(original);
      if (this.disposed) return;
      if (this.note.revision !== original.revision) throw new ConflictError('重新载入期间有新输入，请重试');
      // Replace the recovery snapshot before acknowledging a discard. If unlink
      // later fails, recovery must contain the reloaded text, never the old edit.
      const applied = await this.localWrites.run(this.note.id, async () => {
        if (this.disposed) return false;
        if (this.note.revision !== original.revision) throw new ConflictError('重新载入期间有新输入，请重试');
        try { await this.drafts.write({ note: structuredClone(reloaded), geometry: this.geometry() }); }
        catch (error) { throw new Error(`重新载入未完成，恢复草稿更新失败，已保留当前修改：${message(error)}`); }
        if (this.disposed) return false;
        if (this.note.revision !== original.revision) throw new ConflictError('重新载入期间有新输入，请重试');
        this.note = reloaded; this.phase = 'saved'; this.error = undefined; this.localRevision = reloaded.revision;
        if (this.pendingDraft && this.pendingDraft.draft.note.revision <= original.revision) {
          this.pendingDraft.draft.note = structuredClone(reloaded);
        }
        return true;
      });
      if (!applied) return;
      await this.removeDraft(); this.notify(); this.saved(this.note);
    });
  }
  async closeToDraft(): Promise<boolean> {
    this.pauseTimer();
    const revision = this.note.revision;
    const safe = await this.persist();
    if (safe && this.note.revision === revision && this.localRevision >= revision && this.durableGeneration === this.generation) {
      if (this.note.revision > this.note.savedRevision && this.phase !== 'conflict') this.phase = 'local';
      this.notify(); return true;
    }
    return false;
  }
  private pauseTimer(): void { clearTimeout(this.timer); }
  pause(): void { this.paused = true; this.pauseTimer(); }
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.disposed && !this.deleting && this.phase !== 'conflict' && this.note.revision > this.note.savedRevision) {
      this.pauseTimer();
      this.timer = setTimeout(() => { void this.flush(); }, this.delay());
    }
  }
  cleanSavedDraft(): Promise<void> { return this.removeDraft(); }
  async delete(): Promise<void> {
    this.pause(); this.deleting = true;
    try {
      await this.saves.run(this.note.id, async () => {
        await this.targetResolution;
        await this.writePump;
        await this.localWrites.run(this.note.id, () => this.drafts.remove(this.note.id));
        this.dispose();
      });
    } catch (error) {
      this.deleting = false; this.phase = 'error'; this.error = `删除失败：${message(error)}`;
      this.notify(); throw error;
    }
  }
  dispose(): void { this.disposed = true; this.pauseTimer(); }
}
export function message(error: unknown): string { return error instanceof Error ? error.message : error && typeof error === 'object' && 'msg' in error ? String(error.msg) : String(error); }
