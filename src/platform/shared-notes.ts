import type * as Fs from 'node:fs/promises';
import type * as Path from 'node:path';
import type { HistoryRecord } from '../core/windows';
import { parseHistory } from '../core/history';
import { SerialQueue } from '../core/serial';
import type { SharedDraftStore } from './shared-drafts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface SharedNotes { records: HistoryRecord[]; deleted: Set<string> }
// Each device owns its metadata file. Deletion is monotonic and never inferred from
// history truncation. No draft text, baseline or geometry enters this registry.
export class SharedNoteStore {
  private queue = new SerialQueue();
  private cached = new Map<string, string>();
  constructor(private fs: typeof Fs, private path: typeof Path, private directory: string, private device: string, private drafts?: SharedDraftStore) {
    if (!uuid.test(device)) throw new Error('无效设备标识');
  }
  private async files(folder: string): Promise<string[]> {
    try { return await this.fs.readdir(this.path.join(this.directory, folder)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  private async write(folder: string, name: string, value: unknown): Promise<void> {
    const directory = this.path.join(this.directory, folder);
    await this.fs.mkdir(directory, { recursive: true });
    const file = this.path.join(directory, name), temp = `${file}.${crypto.randomUUID()}.tmp`;
    const handle = await this.fs.open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    try { await this.fs.rename(temp, file); }
    finally { await this.fs.unlink(temp).catch(() => {}); }
  }
  async load(): Promise<SharedNotes> {
    const deleted = new Set<string>();
    for (const file of await this.files('deleted')) {
      const id = file.replace(/\.json$/, '');
      if (!file.endsWith('.json') || !uuid.test(id)) continue;
      const value = JSON.parse(await this.fs.readFile(this.path.join(this.directory, 'deleted', file), 'utf8'));
      if (value?.id !== id || value?.deleted !== true) throw new Error('共享删除记录损坏，请检查同步数据');
      deleted.add(id);
    }
    const records = new Map<string, HistoryRecord>();
    for (const file of (await this.files('notes')).sort()) {
      const parts = file.split('.');
      if (parts.length !== 3 || parts[2] !== 'json' || !uuid.test(parts[0]) || !uuid.test(parts[1]) || deleted.has(parts[0])) continue;
      let value: unknown;
      try { value = JSON.parse(await this.fs.readFile(this.path.join(this.directory, 'notes', file), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const record = parseHistory([value], 1)[0];
      if (!record || record.id !== parts[0]) throw new Error('共享速记记录损坏，请检查同步数据');
      const previous = records.get(record.id);
      if (!previous || record.updatedAt > previous.updatedAt
        || record.updatedAt === previous.updatedAt && previous.bodySummary === undefined && record.bodySummary !== undefined) records.set(record.id, record);
    }
    return { records: [...records.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)), deleted };
  }
  async publish(record: HistoryRecord): Promise<void> {
    const safe = parseHistory([record], 1)[0];
    if (!safe) throw new Error('无效共享速记记录');
    await this.queue.run('write', async () => {
      // Persisted deletion always wins, including a late autosave completion.
      try { await this.fs.access(this.path.join(this.directory, 'deleted', `${safe.id}.json`)); return; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const text = JSON.stringify(safe);
      if (this.cached.get(safe.id) === text) return;
      await this.write('notes', `${safe.id}.${this.device}.json`, safe); this.cached.set(safe.id, text);
    });
  }
  async remove(id: string, clock?: Record<string, number>): Promise<void> {
    if (!uuid.test(id)) throw new Error('无效速记标识');
    await this.queue.run('write', () => this.write('deleted', `${id}.json`, { id, deleted: true }));
    if (clock) await this.drafts?.acknowledge(id, clock);
  }
  async compact(): Promise<void> {
    await this.queue.run('write', async () => {
      const { deleted } = await this.load();
      for (const file of await this.files('notes')) {
        const parts = file.split('.');
        if (parts.length !== 3 || parts[2] !== 'json' || !uuid.test(parts[0]) || !uuid.test(parts[1]) || !deleted.has(parts[0])) continue;
        await this.fs.unlink(this.path.join(this.directory, 'notes', file)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
        this.cached.delete(parts[0]);
      }
    });
  }
  async migrate(records: HistoryRecord[]): Promise<void> {
    const name = `${this.device}.json`;
    try { await this.fs.access(this.path.join(this.directory, 'migrated', name)); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const record of records) await this.publish(record);
    await this.write('migrated', name, { version: 1 });
  }
  async drain(): Promise<void> { await this.queue.run('write', async () => {}); }
}
