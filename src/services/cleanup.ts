import type { Draft, NoteRecord, NoteReference, Settings } from '../types';
import type { HistoryRecord } from '../core/windows';
import { isSavedToSiYuan, noteLabel } from '../core/identity';
import type { LocalDraftStore } from '../platform/drafts';
import type { SharedNoteStore } from '../platform/shared-notes';
import type { NoteRepository } from './repository';
import { AutoSaveService, message } from './autosave';
import { SerialQueue } from '../core/serial';
import { mergeClocks, draftStamp } from '../platform/shared-drafts';

export const dayMs = 86400000;
export interface CleanupItem {
  id: string; version: string; summary: string; path: string; updatedAt: number;
  unsaved: boolean; open: boolean; busy: boolean; eligible: boolean; removed: boolean; conflict?: boolean;
}
export interface CleanupSelection { id: string; version: string }
export interface CleanupProgress {
  jobId: string; mode: 'archive' | 'clear'; running: boolean; cancelled: boolean; total: number;
  completed: number; succeeded: number; skipped: number; failures: Array<{ id: string; error: string }>;
}
export interface CleanupSnapshot { items: CleanupItem[]; total: number; unsaved: number; eligible: number; reminderActive?: boolean; progress?: CleanupProgress }
interface Entry { ref: HistoryRecord; local?: Draft; backup?: Draft; active?: NoteRecord; removed: boolean; signature: string }
interface PendingCleanup { id: string; draft?: string; backup?: string }
interface Reminder { lastDay?: string; snoozeUntil?: number }
interface CleanupHost {
  active(): NoteRecord[]; busy(id: string): boolean; stopped(): boolean;
  removed(id: string): void; forget(id: string): Promise<void>; changed(): void;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const signature = (note?: NoteReference) => note ? JSON.stringify(note) : undefined;
const dirty = (note: NoteRecord) => !isSavedToSiYuan(note) || note.revision > note.savedRevision;

/** One host owns tasks. UI sends opaque preview versions, never bodies or deletion decisions. */
export class CleanupService {
  readonly locks = new Set<string>();
  private previews = new Map<string, { signature: string; version: string }>();
  private progress?: CleanupProgress;
  private work?: Promise<void>;
  private cancelRequested = false;
  private maintenance = new SerialQueue();
  constructor(private store: LocalDraftStore, private shared: SharedNoteStore, private repo: NoteRepository,
    private settings: () => Settings, private host: CleanupHost) {}

  private async entries(): Promise<Entry[]> {
    const registry = await this.shared.load();
    const drafts = await this.store.list(), backups = await this.store.listBackups();
    const values = new Map<string, { ref: HistoryRecord; local?: Draft; backup?: Draft; active?: NoteRecord }>();
    for (const ref of registry.records) values.set(ref.id, { ref });
    for (const backup of backups) {
      const prior = values.get(backup.note.id);
      values.set(backup.note.id, { ref: prior?.ref ?? backup.note, ...prior, backup });
    }
    for (const local of drafts) {
      const prior = values.get(local.note.id);
      values.set(local.note.id, { ...prior, ref: local.note, local });
    }
    for (const active of this.host.active()) values.set(active.id, { ...values.get(active.id), ref: active, active });
    return [...values.values()].filter(value => {
      if (registry.deleted.has(value.ref.id)) return !!value.active || !!value.local && (dirty(value.local.note) || value.local.variants?.some(variant => dirty(variant.note)));
      return value.active ? !!value.active.text.trim() || isSavedToSiYuan(value.active) : true;
    }).map(value => ({ ...value, removed: registry.deleted.has(value.ref.id),
      signature: JSON.stringify([value.ref, value.local?.note, value.local?.variants, value.backup?.note, value.active, registry.deleted.has(value.ref.id)]) }));
  }
  async snapshot(now = Date.now()): Promise<CleanupSnapshot> {
    const entries = await this.entries(), ids = new Set(entries.map(entry => entry.ref.id));
    for (const id of this.previews.keys()) if (!ids.has(id)) this.previews.delete(id);
    const items = entries.map(entry => {
      let preview = this.previews.get(entry.ref.id);
      if (!preview || preview.signature !== entry.signature) {
        preview = { signature: entry.signature, version: crypto.randomUUID() }; this.previews.set(entry.ref.id, preview);
      }
      const body = entry.active ?? entry.local?.note ?? entry.backup?.note;
      const unsaved = !!entry.local?.variants?.some(value => dirty(value.note)) || (body ? dirty(body) : !isSavedToSiYuan(entry.ref));
      const open = !!entry.active, busy = this.locks.has(entry.ref.id) || this.host.busy(entry.ref.id);
      const updatedAt = Math.max(entry.ref.updatedAt, body?.updatedAt ?? 0);
      const conflict = (entry.local?.variants?.length ?? 0) > 1;
      return { id: entry.ref.id, version: preview.version, summary: body ? noteLabel(body, 80) : entry.ref.caption || entry.ref.summary || entry.ref.docTitle || '速记',
        path: entry.ref.docPath || entry.ref.target?.path || '', updatedAt, unsaved, open, busy,
        removed: entry.removed, conflict, eligible: !entry.removed && !conflict && !open && !busy && now - updatedAt > this.settings().archiveDays * dayMs };
    }).sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
    const unarchived = items.filter(item => !item.removed);
    const reminderActive = this.settings().cleanupReminder && unarchived.length >= this.settings().cleanupThreshold
      && ((await this.reminder()).snoozeUntil ?? 0) <= now;
    return { items, total: unarchived.length, unsaved: unarchived.filter(item => item.unsaved).length,
      eligible: items.filter(item => item.eligible).length, reminderActive, progress: this.currentProgress() };
  }
  currentProgress(): CleanupProgress | undefined { return this.progress ? structuredClone(this.progress) : undefined; }
  start(mode: 'archive' | 'clear', selections: CleanupSelection[], discard: boolean): CleanupProgress {
    if (this.host.stopped()) throw new Error('插件已停用');
    if (this.work) throw new Error('整理任务正在进行');
    if (!selections.length || selections.length > 100000 || selections.some(value => !uuid.test(value.id) || !uuid.test(value.version))) throw new Error('整理选择无效');
    const unique = [...new Map(selections.map(value => [value.id, value])).values()];
    // Capture previews before any async refresh can update them.
    const selected = unique.map(value => ({ ...value, signature: this.previews.get(value.id)?.version === value.version ? this.previews.get(value.id)!.signature : undefined }));
    this.cancelRequested = false;
    this.progress = { jobId: crypto.randomUUID(), mode, running: true, cancelled: false, total: selected.length, completed: 0, succeeded: 0, skipped: 0, failures: [] };
    const progress = this.progress;
    this.work = this.run(mode, selected, discard, progress).finally(() => {
      progress.running = false; progress.cancelled = this.cancelRequested || this.host.stopped(); this.work = undefined; this.host.changed();
    });
    return structuredClone(progress);
  }
  cancel(): void { this.cancelRequested = true; }
  async stop(): Promise<void> { this.cancel(); await this.work; await this.maintenance.run('cleanup', async () => {}); }
  private async run(mode: 'archive' | 'clear', selected: Array<CleanupSelection & { signature?: string }>, discard: boolean, progress: CleanupProgress): Promise<void> {
    for (const selection of selected) {
      if (this.cancelRequested || this.host.stopped()) break;
      const id = selection.id;
      try {
        if (!selection.signature || this.host.busy(id) || this.host.active().some(note => note.id === id)) { progress.skipped++; continue; }
        this.locks.add(id);
        let entry = (await this.entries()).find(value => value.ref.id === id);
        if (!entry || entry.signature !== selection.signature || entry.active) { progress.skipped++; continue; }
        if (mode === 'archive') {
          if ((entry.local?.variants?.length ?? 0) > 1) throw new Error('草稿存在多个版本，请从速记列表选择版本或另存');
          if (entry.removed) throw new Error('速记已从插件移除，请复制或另存本机修改');
          const body = entry.local?.note ?? entry.backup?.note;
          if (body && dirty(body)) {
            const service = new AutoSaveService(structuredClone(body), this.repo, this.store, () => this.settings().debounceMs,
              () => {}, () => entry!.local?.geometry ?? { width: this.settings().width, height: this.settings().height, pinned: false },
              note => { entry!.ref = note; });
            try {
              if (!await service.saveToSiYuan()) throw new Error(service.error || '保存未确认');
              // Persist the new reference before removing the only local recovery entry.
              await this.shared.publish(service.note);
              const current = (await this.entries()).find(value => value.ref.id === id);
              if (!current || current.active || current.local && dirty(current.local.note) || current.backup?.note.text !== service.note.text) throw new Error('正文已变化，请刷新后重试');
              entry = current;
            } finally { service.dispose(); }
          } else {
            // Read-only verification preserves newer edits made directly in SiYuan.
            await this.repo.reload({ ...entry.ref, text: body?.text ?? '', baseline: body?.baseline, revision: 0, savedRevision: 0 });
          }
        } else {
          const body = entry.local?.note ?? entry.backup?.note;
          if ((entry.local?.variants?.some(value => dirty(value.note)) || (body ? dirty(body) : !isSavedToSiYuan(entry.ref))) && !discard) throw new Error('请确认丢弃未保存的本机内容');
        }
        if (this.host.stopped() || this.host.active().some(note => note.id === id)) { progress.skipped++; continue; }
        const latest = (await this.entries()).find(value => value.ref.id === id);
        if (!latest || latest.signature !== entry.signature) { progress.skipped++; continue; }
        await this.remove(latest);
        progress.succeeded++;
      } catch (error) { progress.failures.push({ id, error: message(error) }); }
      finally { this.locks.delete(id); progress.completed++; this.host.changed(); }
    }
  }
  private async remove(entry: Entry): Promise<void> {
    await this.maintenance.run('cleanup', async () => {
      const journal = await this.journal();
      const physical = (await this.store.listLocal()).find(value => value.note.id === entry.ref.id);
      const approved = [entry.local?.note, ...(entry.local?.variants ?? []).map(value => value.note)].filter(Boolean);
      const pending: PendingCleanup = { id: entry.ref.id,
        draft: physical && approved.some(note => draftStamp(note!) === draftStamp(physical.note)) ? signature(physical.note) : undefined,
        backup: signature(entry.backup?.note) };
      journal.push(pending); await this.store.writeMaintenance('cleanup', journal);
      const clock = mergeClocks(entry.local?.note.draftSync?.clock ?? {}, entry.backup?.note.draftSync?.clock ?? {},
        (await this.store.savedContext?.(entry.ref.id))?.clock ?? {}, ...(entry.local?.variants ?? []).map(value => value.note.draftSync?.clock ?? {}));
      await this.shared.remove(entry.ref.id, clock); this.host.removed(entry.ref.id);
      await this.finish(pending);
      await this.shared.compact();
      await this.store.writeMaintenance('cleanup', journal.filter(value => value !== pending));
    });
  }
  private async journal(): Promise<PendingCleanup[]> {
    const value = await this.store.readMaintenance<unknown>('cleanup', []);
    if (!Array.isArray(value) || value.some(item => !item || !uuid.test(item.id) || item.draft !== undefined && typeof item.draft !== 'string' || item.backup !== undefined && typeof item.backup !== 'string')) throw new Error('清理记录损坏，原文件已保留');
    return value;
  }
  private async finish(pending: PendingCleanup): Promise<void> {
    if (this.host.active().some(note => note.id === pending.id) || this.host.busy(pending.id)) return;
    const draft = (await this.store.listLocal()).find(value => value.note.id === pending.id);
    const backup = await this.store.readBackup(pending.id);
    if (draft && signature(draft.note) === pending.draft) await this.store.remove(pending.id);
    if (backup && signature(backup.note) === pending.backup) await this.store.removeBackup(pending.id);
    await this.host.forget(pending.id);
  }
  async reconcile(): Promise<void> {
    await this.maintenance.run('cleanup', async () => {
      const registry = await this.shared.load(), journal = await this.journal();
      const remaining: PendingCleanup[] = [];
      for (const pending of journal) {
        if (!registry.deleted.has(pending.id)) continue;
        if (this.host.active().some(note => note.id === pending.id) || this.host.busy(pending.id) || this.locks.has(pending.id)) { remaining.push(pending); continue; }
        await this.finish(pending);
      }
      if (journal.length) await this.store.writeMaintenance('cleanup', remaining);
      const drafts = await this.store.listLocal(), backups = await this.store.listBackups(), windows = await this.store.loadWindowState();
      for (const id of new Set([...drafts.map(value => value.note.id), ...backups.map(value => value.note.id), ...Object.keys(windows)])) {
        if (!registry.deleted.has(id) || this.locks.has(id) || this.host.busy(id) || this.host.active().some(note => note.id === id)) continue;
        const draft = drafts.find(value => value.note.id === id);
        if (draft && dirty(draft.note)) continue;
        if (draft) await this.store.remove(id);
        await this.store.removeBackup(id); await this.host.forget(id);
      }
      await this.shared.compact();
    });
  }
  async reminderDue(now = Date.now()): Promise<boolean> {
    return this.maintenance.run('cleanup', async () => {
      if (!this.settings().cleanupReminder || this.host.stopped()) return false;
      const state = await this.reminder(), today = new Date(now).toLocaleDateString('en-CA');
      if (state.lastDay === today || (state.snoozeUntil ?? 0) > now) return false;
      if ((await this.snapshot(now)).total < this.settings().cleanupThreshold) return false;
      await this.store.writeMaintenance('reminder', { ...state, lastDay: today }); return true;
    });
  }
  private async reminder(): Promise<Reminder> {
    const state = await this.store.readMaintenance<Reminder>('reminder', {});
    if (!state || typeof state !== 'object' || state.lastDay !== undefined && typeof state.lastDay !== 'string' || state.snoozeUntil !== undefined && !Number.isFinite(state.snoozeUntil)) throw new Error('提醒记录损坏，原文件已保留');
    return state;
  }
  async snooze(now = Date.now()): Promise<void> {
    await this.maintenance.run('cleanup', async () => this.store.writeMaintenance('reminder', { ...await this.reminder(), snoozeUntil: now + 7 * dayMs }));
    this.host.changed();
  }
}
