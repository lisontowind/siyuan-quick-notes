import type { Draft, DraftStore, Geometry, NoteRecord, SavePhase } from '../types';
import { ConflictError, UncertainWriteError, type NoteRepository } from './repository';
import { validCalloutType } from '../core/callout';
import { SerialQueue } from '../core/serial';
import { isSavedToSiYuan, migrateNoteTitle, validNoteTitle } from '../core/identity';

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
  removed = false;
  markRemoved(): void {
    this.removed = true; this.pause(); this.phase = 'conflict';
    this.error = '这条速记已从插件移除，当前内容已保留，可复制或另存为新速记。'; this.notify();
  }
  private pendingDraft?: { draft: Draft; generation: number };
  private writePump?: Promise<void>;
  private generation = 0;
  private durableGeneration = 0;
  private backedUpRevision = -1;
  private syncActor = crypto.randomUUID();
  private waiters: Array<{ generation: number; resolve: (safe: boolean) => void }> = [];
  constructor(public note: NoteRecord, private repo: NoteRepository, private drafts: DraftStore,
    private delay: () => number, private notify: () => void, private geometry: () => Geometry,
    private saved: (note: NoteRecord) => void = () => {}) {
    this.note = { ...migrateNoteTitle(note), calloutType: note.calloutType ?? 'NOTE', siyuanSaved: isSavedToSiYuan(note) };
    this.phase = isSavedToSiYuan(note) ? note.revision > note.savedRevision ? 'dirty' : 'saved' : note.revision ? 'local' : 'empty';
  }
  edit(text: string, revision: number, schedule = true, title = this.note.title ?? '', caption = this.note.caption ?? '', calloutType = this.note.calloutType ?? 'NOTE'): Promise<void> {
    if (this.disposed || this.deleting || !Number.isSafeInteger(revision) || revision <= this.note.revision) return Promise.resolve();
    if (!validNoteTitle(caption)) return Promise.reject(new Error('便签标题须为不超过 200 字符的单行文本'));
    if (!validCalloutType(calloutType)) return Promise.reject(new Error('无效的提示块类别'));
    const changed = calloutType !== (this.note.calloutType ?? 'NOTE') || text !== this.note.text || title !== (this.note.title ?? '') || caption !== (this.note.caption ?? '');
    this.note = migrateNoteTitle({ ...this.note, text, title, calloutType, caption: caption || undefined, revision, updatedAt: changed ? Date.now() : this.note.updatedAt });
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
    this.pendingDraft = { draft: { note: structuredClone(this.note), geometry: this.geometry(), syncActor: this.syncActor }, generation };
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
          if (work.draft.note.draftSync) this.note.draftSync = structuredClone(work.draft.note.draftSync);
          this.durableGeneration = work.generation;
          this.localRevision = Math.max(this.localRevision, work.draft.note.revision);
          if (this.error?.startsWith('本机草稿保存失败：')) this.error = undefined;
          if (!this.error && !isSavedToSiYuan(this.note) && this.phase !== 'saving' && this.phase !== 'conflict' && work.draft.note.revision === this.note.revision) this.phase = 'local';
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
    return this.save(false);
  }
  async saveToSiYuan(): Promise<boolean> {
    return this.save(true);
  }
  async restoreToSiYuan(): Promise<boolean> {
    return this.save(true, true);
  }
  async assertSource(): Promise<void> { await this.repo.assertSource(this.note); }
  private async save(toSiYuan: boolean, restore = false): Promise<boolean> {
    this.pauseTimer();
    return this.saves.run(this.note.id, async () => {
      if (this.phase === 'conflict' && !restore || this.disposed || this.deleting || this.removed) return false;
      const linked = isSavedToSiYuan(this.note);
      if (!linked && !toSiYuan) return this.persist();
      if (!restore && linked && this.note.revision <= this.note.savedRevision && (!toSiYuan || this.note.storage === 'callout')) { await this.removeDraft(); return true; }
      if (!linked && !this.note.text.trim() && !this.note.caption?.trim()) {
        this.error = '速记内容为空，请输入内容后保存到思源'; this.phase = 'error'; this.notify(); return false;
      }
      const snapshot = structuredClone(this.note);
      this.phase = 'saving'; this.error = undefined; this.notify();
      try {
        const write = restore ? this.repo.restore.bind(this.repo) : this.repo.save.bind(this.repo);
        await write(snapshot, async () => {
          if (this.removed) throw new ConflictError('这条速记已从插件移除，当前内容已保留，可复制或另存为新速记。');
          if (this.disposed) throw new Error('插件已停止，未完成内容保留为恢复草稿');
          this.note.target = snapshot.target; this.note.docId = snapshot.docId; this.note.blockId = snapshot.blockId;
          this.note.storage = snapshot.storage; this.note.baseline = snapshot.baseline; this.note.docPath = snapshot.docPath; this.note.docTitle = snapshot.docTitle;
          this.note.siyuanSaved = snapshot.siyuanSaved;
          if (!await this.persist()) throw new Error('恢复草稿未落盘，已停止内核写入');
          await this.drafts.assertWritable?.(this.note);
          snapshot.draftSync = this.note.draftSync;
          if (this.removed) throw new ConflictError(this.error);
          if (this.disposed) throw new Error('插件已停止，未完成内容保留为恢复草稿');
        });
        // A late kernel response must not remove or rewrite the shutdown recovery snapshot.
        if (this.disposed) return false;
        if (this.removed) { this.markRemoved(); await this.persist(); return false; }
        this.note.target = snapshot.target; this.note.docId = snapshot.docId; this.note.docPath = snapshot.docPath; this.note.docTitle = snapshot.docTitle; this.note.baseline = snapshot.baseline;
        const previousSavedRevision = this.note.savedRevision;
        this.note.savedRevision = snapshot.revision;
        this.note.siyuanSaved = snapshot.siyuanSaved = true;
        snapshot.savedRevision = snapshot.revision;
        if (!await this.persist()) { this.note.savedRevision = previousSavedRevision; this.notify(); return false; }
        snapshot.draftSync = this.note.draftSync;
        try { await this.drafts.backup?.({ note: structuredClone(snapshot), geometry: this.geometry() }); }
        catch (error) {
          this.note.savedRevision = previousSavedRevision;
          if (restore) this.note.siyuanSaved = false;
          throw new Error(`插件副本保存失败：${message(error)}`);
        }
        this.backedUpRevision = snapshot.revision;
        if (this.disposed) return false;
        if (this.removed) { this.markRemoved(); await this.persist(); return false; }
        this.saved(snapshot);
        if (this.note.revision === snapshot.revision) {
          this.phase = 'saved'; await this.removeDraft();
        } else {
          this.phase = 'dirty';
          if (!this.paused) this.timer = setTimeout(() => { void this.flush(); }, this.delay());
        }
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
      if (!this.disposed && !this.pendingDraft && isSavedToSiYuan(this.note) && this.note.revision <= this.note.savedRevision) {
        if (this.backedUpRevision < this.note.revision) {
          try { await this.drafts.backup?.({ note: structuredClone(this.note), geometry: this.geometry() }); this.backedUpRevision = this.note.revision; }
          catch (error) { this.error = `插件副本保存失败：${message(error)}`; this.notify(); return; }
          if (this.disposed || this.pendingDraft || this.note.revision > this.note.savedRevision) return;
        }
        try { await this.drafts.remove(this.note.id); }
        catch (error) { this.error = `本机草稿清理失败：${message(error)}`; this.notify(); return; }
        this.localRevision = -1;
        if (this.error?.startsWith('本机草稿清理失败：')) { this.error = undefined; this.notify(); }
      }
    });
  }
  async reload(): Promise<void> {
    if (this.removed) throw new ConflictError(this.error);
    this.pauseTimer();
    await this.saves.run(this.note.id, async () => {
      await this.writePump;
      if (this.disposed) return;
      const original = this.note;
      const reloaded = await this.repo.reload(original);
      if (this.disposed) return;
      if (this.note.revision !== original.revision) throw new ConflictError('重新载入期间有新输入，请重试');
      await this.drafts.backup?.({ note: structuredClone(reloaded), geometry: this.geometry() });
      this.backedUpRevision = reloaded.revision;
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
        await this.writePump;
        await this.localWrites.run(this.note.id, () => this.drafts.remove(this.note.id));
        await this.drafts.removeBackup?.(this.note.id);
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
