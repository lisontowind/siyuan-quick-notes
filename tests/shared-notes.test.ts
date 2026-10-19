import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { SharedNoteStore } from '../src/platform/shared-notes';
import { createNote, noteReference } from '../src/core/identity';
import { toolbarActions, parseToolbarLayout, validToolbarLayout, toolbarCapacity } from '../src/core/toolbar';
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function setup() {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-shared-')); directories.push(directory);
  const a = new SharedNoteStore(fs, path, directory, crypto.randomUUID()), b = new SharedNoteStore(fs, path, directory, crypto.randomUUID());
  return { directory, a, b };
}
function record(text: string) { const note = createNote(); note.docId = '20261010000000-doc0001'; return { ...noteReference(note), summary: text }; }
describe('cross-device registry', () => {
  it('merges independently created notes and later metadata without publishing draft text or geometry', async () => {
    const { a, b, directory } = await setup(), first = record('A'), second = record('B');
    await Promise.all([a.publish({ ...first, text: 'private draft', baseline: 'private baseline' } as any), b.publish(second)]);
    expect((await a.load()).records).toHaveLength(2);
    await b.publish({ ...first, summary: 'B edit', updatedAt: first.updatedAt + 1 });
    expect((await a.load()).records.find(note => note.id === first.id)?.summary).toBe('B edit');
    const files = await fs.readdir(path.join(directory, 'notes'));
    for (const file of files) expect(await fs.readFile(path.join(directory, 'notes', file), 'utf8')).not.toMatch(/private|baseline|geometry/);
  });
  it('keeps a backfilled body preview across devices without advancing the content modification time', async () => {
    const { a, b } = await setup(), original = { ...record('标题'), caption: '标题' };
    await a.publish(original); await b.publish({ ...original, bodySummary: '正文摘要' });
    for (const store of [a, b]) expect((await store.load()).records[0]).toMatchObject({ caption: '标题', bodySummary: '正文摘要', updatedAt: original.updatedAt });
    await a.publish(original);
    expect((await b.load()).records[0].bodySummary).toBe('正文摘要');
  });
  it('keeps deletions when an offline device returns stale metadata or migration history', async () => {
    const { a, b } = await setup(), old = record('old');
    await a.publish(old); await a.remove(old.id);
    await b.publish({ ...old, summary: 'late edit', updatedAt: old.updatedAt + 100000 });
    await b.migrate([old]);
    expect((await b.load()).records).toEqual([]); expect((await b.load()).deleted.has(old.id)).toBe(true);
  });
  it('migrates once per device, preserves unlisted records and ignores incomplete atomic writes', async () => {
    const { a, b, directory } = await setup(), first = record('old'), second = record('other');
    await a.migrate([first]); await b.publish(second); await a.migrate([record('must not import')]);
    await fs.writeFile(path.join(directory, 'notes', 'interrupted.tmp'), 'broken');
    expect((await a.load()).records).toHaveLength(2);
    await a.publish(first); expect((await b.load()).records).toHaveLength(2);
  });
  it('fails closed on damaged deletion records and rejects path-like IDs', async () => {
    const { a, directory } = await setup(), item = record('note'); await a.remove(item.id);
    await fs.writeFile(path.join(directory, 'deleted', `${item.id}.json`), '{}');
    await expect(a.load()).rejects.toThrow('删除记录损坏'); await expect(a.remove('../other')).rejects.toThrow();
  });
  it('handles delayed two-device transfers without rewriting imported metadata', async () => {
    const one = await setup(), two = await setup(), item = record('A');
    await one.a.publish(item); expect((await two.a.load()).records).toHaveLength(0);
    await fs.cp(one.directory, two.directory, { recursive: true });
    expect((await two.a.load()).records[0]).toEqual(item);
    await two.a.remove(item.id); await fs.cp(two.directory, one.directory, { recursive: true });
    expect((await one.a.load()).deleted.has(item.id)).toBe(true);
  });
});
describe('toolbar layout compatibility', () => {
  it('requires a complete permutation, recovers old settings and reserves the more button', () => {
    expect(validToolbarLayout({ order: [...toolbarActions].reverse() })).toBe(true);
    expect(validToolbarLayout({ order: [...toolbarActions, 'bold'] })).toBe(false);
    expect(validToolbarLayout({ order: ['unknown'] })).toBe(false);
    expect(parseToolbarLayout(undefined).order).toEqual(toolbarActions);
    expect(toolbarCapacity(318)).toBeLessThan(toolbarActions.length);
    expect(toolbarCapacity(500)).toBe(toolbarActions.length);
  });
});
