import type { Draft, DraftVersion, DraftStore, NoteReference, WindowRecoveryState } from '../types';
import type * as Fs from 'node:fs/promises';
import type * as Path from 'node:path';
import { validCalloutType } from '../core/callout';
import { SerialQueue } from '../core/serial';
import { validBlockId } from '../services/repository';
import { validNoteTitle, isSavedToSiYuan } from '../core/identity';
import { draftStamp, covers, type SharedDraftStore } from './shared-drafts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validNoteReference(value: unknown): value is NoteReference {
  if (!value || typeof value !== 'object') return false;
  const note = value as NoteReference;
  return typeof note.id === 'string' && uuid.test(note.id) && typeof note.blockId === 'string' && validBlockId(note.blockId)
    && typeof note.docId === 'string' && validBlockId(note.docId)
    && Number.isFinite(note.createdAt) && Number.isFinite(note.updatedAt)
    && (note.calloutType === undefined || validCalloutType(note.calloutType)) && validNoteTitle(note.caption) && validNoteTitle(note.title) && (note.docTitle === undefined || typeof note.docTitle === 'string') && (note.docPath === undefined || typeof note.docPath === 'string')
    && (note.siyuanSaved === undefined || typeof note.siyuanSaved === 'boolean')
    && (note.storage === undefined || note.storage === 'document' || note.storage === 'superblock' || note.storage === 'callout')
    && (note.storage !== 'document' || note.docId === note.blockId)
    && (note.target === undefined || (!!note.target && typeof note.target.notebook === 'string' && validBlockId(note.target.notebook)
      && typeof note.target.path === 'string' && note.target.path.startsWith('/')));
}
export function validGeometry(value: unknown): value is import('../types').Geometry {
  if (!value || typeof value !== 'object') return false;
  const x = value as import('../types').Geometry;
  return Number.isFinite(x.width) && x.width >= 300 && x.width <= 32768 && Number.isFinite(x.height) && x.height >= 220 && x.height <= 32768
    && typeof x.pinned === 'boolean' && (x.x === undefined || Number.isFinite(x.x)) && (x.y === undefined || Number.isFinite(x.y))
    && (x.open === undefined || typeof x.open === 'boolean');
}
export function validDraft(value: unknown): value is Draft {
  const note = (value as Draft | undefined)?.note;
  return !!note && uuid.test(note.id) && validBlockId(note.blockId) && typeof note.text === 'string'
    && (note.calloutType === undefined || validCalloutType(note.calloutType)) && validNoteTitle(note.caption) && validNoteTitle(note.title) && (note.docTitle === undefined || typeof note.docTitle === 'string') && (note.docPath === undefined || typeof note.docPath === 'string')
    && (note.siyuanSaved === undefined || typeof note.siyuanSaved === 'boolean')
    && (note.storage === undefined || note.storage === 'document' || note.storage === 'superblock' || note.storage === 'callout')
    && (note.storage !== 'document' || !note.docId || note.docId === note.blockId)
    && Number.isSafeInteger(note.revision) && note.revision >= 0 && Number.isSafeInteger(note.savedRevision) && note.savedRevision >= 0 && note.savedRevision <= note.revision
    && Number.isFinite(note.createdAt) && Number.isFinite(note.updatedAt)
    && (!note.target || (validBlockId(note.target.notebook) && typeof note.target.path === 'string' && note.target.path.startsWith('/')))
    && (!note.docId || validBlockId(note.docId)) && (note.baseline === undefined || typeof note.baseline === 'string')
    && (note.draftSync === undefined || !!note.draftSync && uuid.test(note.draftSync.version) && !!note.draftSync.clock
      && typeof note.draftSync.clock === 'object' && !Array.isArray(note.draftSync.clock)
      && Object.entries(note.draftSync.clock).every(([id, count]) => uuid.test(id) && Number.isSafeInteger(count) && count > 0))
    && ((value as Draft).geometry === undefined || validGeometry((value as Draft).geometry));
}
export class LocalDraftStore implements DraftStore {
  private queue = new SerialQueue();
  readonly warnings: string[] = [];
  constructor(private fs: typeof Fs, private path: typeof Path, readonly directory: string, readonly shared?: SharedDraftStore) {}
  async loadRecentGeometry(): Promise<import('../types').Geometry | undefined> {
    try {
      const value: unknown = JSON.parse(await this.fs.readFile(this.path.join(this.directory, 'recent-window.json'), 'utf8'));
      if (!validGeometry(value)) throw new Error('最近列表窗口状态格式错误');
      const { x, y, width, height, pinned } = value;
      return { x, y, width, height, pinned };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  async saveRecentGeometry(value: import('../types').Geometry): Promise<void> {
    if (!validGeometry(value)) throw new Error('最近列表窗口状态格式错误');
    await this.queue.run('recent-window', async () => {
      await this.fs.mkdir(this.directory, { recursive: true });
      const file = this.path.join(this.directory, 'recent-window.json'), temp = `${file}.${crypto.randomUUID()}.tmp`;
      const handle = await this.fs.open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      try { await this.fs.rename(temp, file); } catch (error) { await this.fs.unlink(temp).catch(() => {}); throw error; }
    });
  }
  async loadWindowState(): Promise<Record<string, WindowRecoveryState>> {
    try {
      const data: unknown = JSON.parse(await this.fs.readFile(this.path.join(this.directory, 'windows.json'), 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('窗口状态格式错误');
      return Object.fromEntries(Object.entries(data).filter(([id, value]) => uuid.test(id) && validGeometry(value))
        .map(([id, value]) => {
          const state = value as WindowRecoveryState;
          const { note, ...geometry } = state;
          return [id, validNoteReference(note) && note.id === id ? { ...geometry, note } : geometry];
        }));
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
  async saveWindowState(value: Record<string, WindowRecoveryState>): Promise<void> {
    await this.queue.run('windows', async () => {
      await this.fs.mkdir(this.directory, { recursive: true });
      const file = this.path.join(this.directory, 'windows.json');
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      const handle = await this.fs.open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      try { await this.fs.rename(temp, file); } catch (error) { await this.fs.unlink(temp).catch(() => {}); throw error; }
    });
  }
  private file(id: string): string {
    if (!uuid.test(id)) throw new Error('无效草稿 ID');
    return this.path.join(this.directory, `${id}.json`);
  }
  private async writeLocal(draft: Draft): Promise<void> {
    if (!validDraft(draft)) throw new Error('无效草稿内容');
    await this.queue.run(draft.note.id, async () => {
      await this.fs.mkdir(this.directory, { recursive: true });
      const file = this.file(draft.note.id);
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      const handle = await this.fs.open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify(draft), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      try { await this.fs.rename(temp, file); }
      catch (error) { await this.fs.unlink(temp).catch(() => {}); throw error; }
    });
  }
  async write(draft: Draft): Promise<void> {
    // Each device owns its recovery files. Foreign drafts are read-only sources.
    await this.writeLocal({ note: draft.note, geometry: draft.geometry });
  }
  async savedContext(_id: string): Promise<import('../types').NoteRecord['draftSync']> { return undefined; }
  async remove(id: string): Promise<void> {
    await this.queue.run(id, async () => {
      await this.fs.unlink(this.file(id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    });
  }
  async backup(draft: Draft): Promise<void> {
    await new LocalDraftStore(this.fs, this.path, this.path.join(this.directory, 'saved')).write(draft);
  }
  async readBackup(id: string): Promise<Draft | undefined> {
    const store = new LocalDraftStore(this.fs, this.path, this.path.join(this.directory, 'saved'));
    try {
      const value: unknown = JSON.parse(await this.fs.readFile(store.file(id), 'utf8'));
      if (!validDraft(value) || value.note.id !== id) throw new Error('插件正文副本损坏，原文件已保留');
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  async removeBackup(id: string): Promise<void> {
    await new LocalDraftStore(this.fs, this.path, this.path.join(this.directory, 'saved')).remove(id);
  }
  async listBackups(): Promise<Draft[]> {
    const store = new LocalDraftStore(this.fs, this.path, this.path.join(this.directory, 'saved'));
    const result = await store.list(); this.warnings.push(...store.warnings); return result;
  }
  async readMaintenance<T>(name: 'reminder' | 'cleanup', fallback: T): Promise<T> {
    try { return JSON.parse(await this.fs.readFile(this.path.join(this.directory, `${name}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
  }
  async writeMaintenance(name: 'reminder' | 'cleanup', value: unknown): Promise<void> {
    await this.queue.run(name, async () => {
      await this.fs.mkdir(this.directory, { recursive: true });
      const file = this.path.join(this.directory, `${name}.json`), temp = `${file}.${crypto.randomUUID()}.tmp`;
      const handle = await this.fs.open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); } finally { await handle.close(); }
      try { await this.fs.rename(temp, file); } finally { await this.fs.unlink(temp).catch(() => {}); }
    });
  }
  async listLocal(): Promise<Draft[]> {
    this.warnings.length = 0;
    let files: string[];
    try { files = await this.fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const drafts: Draft[] = [];
    for (const file of files.filter(name => uuid.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))) {
      try {
        const value: unknown = JSON.parse(await this.fs.readFile(this.path.join(this.directory, file), 'utf8'));
        if (!validDraft(value) || value.note.id + '.json' !== file) throw new Error('草稿格式错误');
        drafts.push(value);
      } catch { this.warnings.push(`草稿 ${file} 无法读取，原文件已保留`); }
    }
    return drafts.sort((a, b) => b.note.updatedAt - a.note.updatedAt);
  }
  async list(): Promise<Draft[]> {
    return this.listLocal();
  }
  async listOtherDevices(): Promise<DraftVersion[]> {
    const device = this.path.basename(this.directory), root = this.path.dirname(this.directory);
    let devices: string[];
    try { devices = await this.fs.readdir(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') devices = []; else throw error; }
    const physical: DraftVersion[] = [], local = await this.listLocal();
    const observed = local.map(draft => ({ device, note: draft.note }));
    for (const source of devices.filter(value => uuid.test(value) && value !== device).sort()) {
      const store = new LocalDraftStore(this.fs, this.path, this.path.join(root, source));
      for (const draft of await store.listLocal()) {
        observed.push({ device: source, note: draft.note });
        if (isSavedToSiYuan(draft.note) && draft.note.revision === draft.note.savedRevision) continue;
        const version = await this.catalogId(`${source}:${draft.note.id}`);
        physical.push({ device: source, version, note: draft.note });
      }
      this.warnings.push(...store.warnings);
    }
    // Preserve branches created by the previous shared-draft implementation.
    // Never import, resolve, compact or modify them while viewing/copying.
    const legacy = (await this.shared?.listVersions() ?? []).filter(value => !observed.some(raw => raw.device === value.device
      && raw.note.id === value.note.id && (draftStamp(raw.note) === draftStamp(value.note)
        || raw.note.draftSync && covers(raw.note.draftSync.clock, value.note.draftSync!.clock))));
    return physical.concat(legacy.map(value => ({ ...value, legacy: true })))
      .sort((a, b) => b.note.updatedAt - a.note.updatedAt || a.device.localeCompare(b.device) || a.version.localeCompare(b.version));
  }
  private async catalogId(value: string): Promise<string> {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    const hex = [...hash.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
