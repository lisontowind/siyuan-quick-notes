import type * as Fs from 'node:fs/promises';
import type * as Path from 'node:path';
import type { Draft, DraftVersion, NoteRecord } from '../types';
import { validDraft } from './drafts';
import { isSavedToSiYuan, noteReference } from '../core/identity';
import { SerialQueue } from '../core/serial';

type Clock = Record<string, number>;
interface Revision { id: string; version: string; device: string; clock: Clock; note?: NoteRecord }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const validClock = (value: unknown): value is Clock => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length <= 10000 && Object.entries(value).every(([id, count]) => uuid.test(id) && Number.isSafeInteger(count) && count > 0);
export const covers = (a: Clock, b: Clock): boolean => Object.entries(b).every(([id, count]) => (a[id] ?? 0) >= count);
export const mergeClocks = (...clocks: Clock[]): Clock => {
  const result: Clock = {};
  for (const clock of clocks) for (const [id, count] of Object.entries(clock)) result[id] = Math.max(result[id] ?? 0, count);
  return result;
};
export const draftStamp = (note: NoteRecord): string => JSON.stringify([note.text, note.title ?? '', note.caption ?? '', note.calloutType ?? 'NOTE', note.blockId, note.docId,
  note.target, note.storage, note.baseline, isSavedToSiYuan(note), note.revision > note.savedRevision]);
const dirty = (note: NoteRecord) => !isSavedToSiYuan(note) || note.revision > note.savedRevision;

/** Immutable revisions with causal clocks. Disk order and device wall clocks never select a winner. */
export class SharedDraftStore {
  private queue = new SerialQueue();
  private issued = new Map<string, Revision>();
  readonly warnings: string[] = [];
  constructor(private fs: typeof Fs, private path: typeof Path, private directory: string, readonly device: string) {
    if (!uuid.test(device)) throw new Error('无效设备标识');
  }
  private async read(): Promise<Revision[]> {
    this.warnings.length = 0;
    let files: string[];
    try { files = await this.fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: Revision[] = [];
    for (const file of files.sort()) {
      const parts = file.split('.');
      if (parts.length !== 3 || parts[2] !== 'json' || !uuid.test(parts[0]) || !uuid.test(parts[1])) continue;
      try {
        const value = JSON.parse(await this.fs.readFile(this.path.join(this.directory, file), 'utf8')) as Revision;
        if (!value || value.id !== parts[0] || value.version !== parts[1] || !uuid.test(value.device) || !validClock(value.clock) || !Object.keys(value.clock).length
          || value.note !== undefined && (!validDraft({ note: value.note }) || value.note.id !== value.id || value.note.text.length > 2_000_000)) throw new Error('共享草稿版本损坏，原文件已保留');
        result.push(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        // Fail closed: a damaged branch must never be silently hidden or consumed.
        this.warnings.push(`共享草稿 ${file} 无法读取，原文件已保留`); throw new Error('共享草稿版本损坏，原文件已保留');
      }
    }
    return result;
  }
  private heads(values: Revision[]): Revision[] {
    return values.filter(a => !values.some(b => a.version !== b.version && covers(b.clock, a.clock) && !covers(a.clock, b.clock)));
  }
  private async write(value: Revision): Promise<void> {
    await this.fs.mkdir(this.directory, { recursive: true });
    const file = this.path.join(this.directory, `${value.id}.${value.version}.json`);
    try {
      const existing = JSON.parse(await this.fs.readFile(file, 'utf8'));
      if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('共享草稿版本损坏，原文件已保留');
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temp = `${file}.${crypto.randomUUID()}.tmp`, handle = await this.fs.open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try { await this.fs.rename(temp, file); } finally { await this.fs.unlink(temp).catch(() => {}); }
  }
  private safe(note: NoteRecord): NoteRecord {
    return { ...noteReference(note), text: note.text, baseline: note.baseline, revision: note.revision, savedRevision: note.savedRevision };
  }
  async publish(note: NoteRecord, actor: string): Promise<NonNullable<NoteRecord['draftSync']>> {
    if (!uuid.test(actor) || !validDraft({ note })) throw new Error('无效草稿内容');
    return this.queue.run('write', async () => {
      const values = (await this.read()).filter(value => value.id === note.id), prior = values.find(value => value.version === note.draftSync?.version);
      if (prior?.note && draftStamp(prior.note) === draftStamp(note)) return { version: prior.version, clock: mergeClocks(prior.clock, note.draftSync?.clock ?? {}) };
      const key = `${note.id}:${actor}`, issued = this.issued.get(key);
      if (issued?.note && draftStamp(issued.note) === draftStamp(note)) return { version: issued.version, clock: issued.clock };
      const clock = mergeClocks(note.draftSync?.clock ?? {}, issued?.clock ?? {});
      clock[actor] = Math.max(clock[actor] ?? 0, ...values.map(value => value.clock[actor] ?? 0)) + 1;
      const value: Revision = { id: note.id, version: crypto.randomUUID(), device: this.device, clock, note: this.safe(note) };
      await this.write(value); this.issued.set(key, value);
      await this.compactValues(values.concat(value));
      return { version: value.version, clock };
    });
  }
  async list(local: Draft[] = []): Promise<Draft[]> {
    const values = await this.read(), groups = new Map<string, Revision[]>();
    for (const value of values) groups.set(value.id, [...(groups.get(value.id) ?? []), value]);
    const result: Draft[] = [];
    for (const [id, revisions] of groups) {
      const all = this.heads(revisions), heads = all.filter(value => value.note);
      const raw = local.find(value => value.note.id === id);
      if (!heads.some(value => dirty(value.note!)) && !raw) continue;
      const variants: DraftVersion[] = heads.map(value => ({ version: value.version, device: value.device,
        note: { ...value.note!, draftSync: { version: value.version, clock: value.clock } } }));
      // Identical bodies reached independently can be continued as a single causal branch.
      const distinct = new Map<string, DraftVersion>();
      for (const value of variants) {
        const key = draftStamp(value.note), previous = distinct.get(key);
        if (previous) previous.note.draftSync!.clock = mergeClocks(previous.note.draftSync!.clock, value.note.draftSync!.clock);
        else distinct.set(key, value);
      }
      let choices = [...distinct.values()].sort((a, b) => b.note.updatedAt - a.note.updatedAt || a.version.localeCompare(b.version));
      if (raw?.syncPending && !choices.some(value => draftStamp(value.note) === draftStamp(raw.note))) {
        choices = choices.filter(value => !covers(raw.note.draftSync?.clock ?? {}, value.note.draftSync!.clock));
        choices.unshift({ version: 'local', device: this.device, note: raw.note });
      }
      if (!choices.length) continue;
      const preferred = choices.find(value => value.version === raw?.note.draftSync?.version && dirty(value.note)) ?? choices.find(value => dirty(value.note)) ?? choices[0];
      result.push({ note: preferred.note, geometry: raw?.geometry, variants: choices });
    }
    for (const draft of local) if (!groups.has(draft.note.id)) result.push(draft);
    return result.sort((a, b) => b.note.updatedAt - a.note.updatedAt || a.note.id.localeCompare(b.note.id));
  }
  async listVersions(): Promise<DraftVersion[]> {
    const groups = new Map<string, Revision[]>();
    for (const value of await this.read()) groups.set(value.id, [...(groups.get(value.id) ?? []), value]);
    return [...groups.values()].flatMap(values => this.heads(values).filter(value => value.note && dirty(value.note))
      .map(value => ({ device: value.device, version: value.version,
        note: { ...value.note!, draftSync: { version: value.version, clock: value.clock } } })));
  }
  async assertWritable(note: NoteRecord): Promise<void> {
    const heads = this.heads((await this.read()).filter(value => value.id === note.id));
    if (heads.some(value => !covers(note.draftSync?.clock ?? {}, value.clock) && (!value.note || draftStamp(value.note) !== draftStamp(note))))
      throw new Error('草稿存在多个版本，请从速记列表选择版本或另存');
  }
  async acknowledge(id: string, clock: Clock): Promise<void> {
    if (!uuid.test(id) || !validClock(clock) || !Object.keys(clock).length) return;
    await this.queue.run('write', async () => {
      const actor = crypto.randomUUID(), context = mergeClocks(clock); context[actor] = 1;
      await this.write({ id, version: crypto.randomUUID(), device: this.device, clock: context });
      await this.compactValues(await this.read());
    });
  }
  async discarded(note: NoteRecord): Promise<boolean> {
    if (!note.draftSync) return false;
    return this.heads((await this.read()).filter(value => value.id === note.id)).some(value => !value.note && covers(value.clock, note.draftSync!.clock));
  }
  async savedContext(id: string): Promise<NoteRecord['draftSync']> {
    const heads = this.heads((await this.read()).filter(value => value.id === id)).filter(value => value.note && !dirty(value.note));
    return heads.length ? { version: heads[0].version, clock: mergeClocks(...heads.map(value => value.clock)) } : undefined;
  }
  async reconcileRemoved(deleted: Set<string>): Promise<void> {
    const values = await this.read();
    for (const id of deleted) {
      const clean = this.heads(values.filter(value => value.id === id)).filter(value => value.note && !dirty(value.note));
      if (clean.length) await this.acknowledge(id, mergeClocks(...clean.map(value => value.clock)));
    }
  }
  async resolve(note: NoteRecord, variants: DraftVersion[]): Promise<NoteRecord> {
    const actor = crypto.randomUUID(), clock = mergeClocks(...variants.map(value => value.note.draftSync?.clock ?? {})); clock[actor] = 1;
    const value: Revision = { id: note.id, version: crypto.randomUUID(), device: this.device, clock, note: this.safe(note) };
    await this.queue.run('write', async () => { await this.write(value); await this.compactValues(await this.read()); });
    return { ...note, draftSync: { version: value.version, clock } };
  }
  async importLegacy(note: NoteRecord, device: string): Promise<void> {
    if (!uuid.test(device) || note.draftSync) return;
    const version = await this.stableId(JSON.stringify([device, this.safe(note)]));
    await this.queue.run('write', () => this.write({ id: note.id, version, device, clock: { [version]: 1 }, note: this.safe(note) }));
  }
  async stableId(text: string): Promise<string> {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    const hex = [...hash.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  private async compactValues(values: Revision[]): Promise<void> {
    const byId = new Map<string, Revision[]>();
    for (const value of values) byId.set(value.id, [...(byId.get(value.id) ?? []), value]);
    for (const group of byId.values()) {
      const heads = new Set(this.heads(group).map(value => value.version));
      for (const value of group) if (!heads.has(value.version)) await this.fs.unlink(this.path.join(this.directory, `${value.id}.${value.version}.json`))
        .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
