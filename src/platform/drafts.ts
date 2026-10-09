import type { Draft, DraftStore, NoteReference, WindowRecoveryState } from '../types';
import type * as Fs from 'node:fs/promises';
import type * as Path from 'node:path';
import { SerialQueue } from '../core/serial';
import { validBlockId } from '../services/repository';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validNoteReference(value: unknown): value is NoteReference {
  if (!value || typeof value !== 'object') return false;
  const note = value as NoteReference;
  return typeof note.id === 'string' && uuid.test(note.id) && typeof note.blockId === 'string' && validBlockId(note.blockId)
    && typeof note.docId === 'string' && validBlockId(note.docId)
    && Number.isFinite(note.createdAt) && Number.isFinite(note.updatedAt)
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
    && Number.isSafeInteger(note.revision) && note.revision >= 0 && Number.isSafeInteger(note.savedRevision) && note.savedRevision >= 0 && note.savedRevision <= note.revision
    && Number.isFinite(note.createdAt) && Number.isFinite(note.updatedAt)
    && (!note.target || (validBlockId(note.target.notebook) && typeof note.target.path === 'string' && note.target.path.startsWith('/')))
    && (!note.docId || validBlockId(note.docId)) && (note.baseline === undefined || typeof note.baseline === 'string')
    && ((value as Draft).geometry === undefined || validGeometry((value as Draft).geometry));
}
export class LocalDraftStore implements DraftStore {
  private queue = new SerialQueue();
  readonly warnings: string[] = [];
  constructor(private fs: typeof Fs, private path: typeof Path, readonly directory: string) {}
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
  async write(draft: Draft): Promise<void> {
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
  async remove(id: string): Promise<void> {
    await this.queue.run(id, async () => { await this.fs.unlink(this.file(id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); });
  }
  async list(): Promise<Draft[]> {
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
}
