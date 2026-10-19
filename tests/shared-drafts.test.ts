import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { SharedDraftStore } from '../src/platform/shared-drafts';
import { LocalDraftStore } from '../src/platform/drafts';
import { SharedNoteStore } from '../src/platform/shared-notes';
import { createNote } from '../src/core/identity';
import { AutoSaveService } from '../src/services/autosave';
import { NoteRepository } from '../src/services/repository';
import { defaults } from '../src/core/settings';
import { CleanupService } from '../src/services/cleanup';
import { FakeKernel } from './fake-kernel';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sqn-device-drafts-')); roots.push(root);
  const deviceA = crypto.randomUUID(), deviceB = crypto.randomUUID();
  const sharedDir = path.join(root, 'shared', 'drafts');
  const shared = new SharedDraftStore(fs, path, sharedDir, deviceA);
  const a = new LocalDraftStore(fs, path, path.join(root, 'drafts', deviceA), shared);
  const b = new LocalDraftStore(fs, path, path.join(root, 'drafts', deviceB));
  const note = { ...createNote(), text: 'source body', revision: 1 };
  return { root, sharedDir, deviceA, deviceB, shared, a, b, note };
}
describe('device-owned drafts and read-only foreign catalog', () => {
  it('keeps ordinary lists, recovery windows and writes device-local, even for matching note IDs', async () => {
    const h = await setup();
    await h.a.write({ note: h.note }); await h.b.write({ note: { ...h.note, text: 'B body' }, geometry: { width: 800, height: 600, pinned: true, open: true } });
    expect((await h.a.list()).map(value => value.note.text)).toEqual(['source body']);
    expect((await h.b.list()).map(value => value.note.text)).toEqual(['B body']);
    const catalog = await h.a.listOtherDevices(); expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ device: h.deviceB, note: { text: 'B body' } });
    expect(catalog[0]).not.toHaveProperty('geometry'); expect(await h.a.loadWindowState()).toEqual({});
    await expect(fs.stat(h.sharedDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('discovers all foreign drafts beyond recent limits, keeping equal IDs on different devices separate', async () => {
    const h = await setup();
    for (let index = 0; index < 31; index++) await h.b.write({ note: { ...createNote(), text: `draft ${index}`, revision: 1 } });
    const c = new LocalDraftStore(fs, path, path.join(h.root, 'drafts', crypto.randomUUID()));
    const same = (await h.b.list())[0]; await c.write(same);
    const catalog = await h.a.listOtherDevices(); expect(catalog).toHaveLength(32);
    expect(new Set(catalog.map(value => value.version)).size).toBe(32);
    expect(await h.a.list()).toEqual([]);
  });
  it('reads foreign directories without changing source files or sharing their geometry', async () => {
    const h = await setup(); await h.b.write({ note: h.note, geometry: { width: 800, height: 600, pinned: true } });
    const file = path.join(h.b.directory, `${h.note.id}.json`), original = await fs.readFile(file, 'utf8');
    const first = await h.a.listOtherDevices(), second = await h.a.listOtherDevices(); expect(second).toEqual(first);
    expect(await fs.readFile(file, 'utf8')).toBe(original); expect(first[0]).not.toHaveProperty('geometry');
    expect(await fs.readdir(h.root)).toEqual(['drafts']);
  });
  it('shows pending edits but excludes clean saved checkpoints in the foreign view', async () => {
    const h = await setup(); const saved = { ...h.note, docId: h.note.blockId, siyuanSaved: true, savedRevision: 1 };
    await h.b.write({ note: saved }); expect(await h.a.listOtherDevices()).toEqual([]);
    await h.b.write({ note: { ...saved, text: 'pending', revision: 2 } });
    expect((await h.a.listOtherDevices())[0].note.text).toBe('pending');
  });
  it('preserves orphaned legacy shared branches as read-only recovery entries', async () => {
    const h = await setup(), other = new SharedDraftStore(fs, path, h.sharedDir, h.deviceB);
    await h.shared.publish({ ...h.note, text: 'old A branch' }, crypto.randomUUID());
    await other.publish({ ...h.note, text: 'old B branch' }, crypto.randomUUID());
    const before = await Promise.all((await fs.readdir(h.sharedDir)).map(file => fs.readFile(path.join(h.sharedDir, file), 'utf8')));
    expect(await h.a.list()).toEqual([]);
    const catalog = await h.a.listOtherDevices(); expect(catalog.map(value => value.note.text).sort()).toEqual(['old A branch', 'old B branch']);
    expect(catalog.every(value => value.legacy)).toBe(true);
    expect(await Promise.all((await fs.readdir(h.sharedDir)).map(file => fs.readFile(path.join(h.sharedDir, file), 'utf8')))).toEqual(before);
  });
  it('deduplicates legacy branches covered by a physical device draft', async () => {
    const h = await setup(), other = new SharedDraftStore(fs, path, h.sharedDir, h.deviceB);
    const context = await other.publish(h.note, crypto.randomUUID());
    const note = { ...h.note, draftSync: context };
    await h.b.write({ note }); expect(await h.a.listOtherDevices()).toHaveLength(1);
    await h.b.write({ note: { ...note, text: 'new local edit', revision: 2 } });
    const catalog = await h.a.listOtherDevices(); expect(catalog).toHaveLength(1); expect(catalog[0].note.text).toBe('new local edit');
  });
  it('reports corrupt legacy revisions without breaking local recovery or modifying originals', async () => {
    const h = await setup(); await h.a.write({ note: h.note });
    await h.shared.publish(h.note, crypto.randomUUID()); const file = path.join(h.sharedDir, (await fs.readdir(h.sharedDir))[0]);
    await fs.writeFile(file, '{}'); await expect(h.a.listOtherDevices()).rejects.toThrow('版本损坏');
    expect((await h.a.list())[0].note.text).toBe(h.note.text); expect(await fs.readFile(file, 'utf8')).toBe('{}');
  });
  it('skips malformed foreign files and retains them for recovery', async () => {
    const h = await setup(); await h.b.write({ note: h.note });
    const file = path.join(h.b.directory, `${crypto.randomUUID()}.json`); await fs.writeFile(file, '{}');
    expect(await h.a.listOtherDevices()).toHaveLength(1); expect(h.a.warnings).toHaveLength(1);
    expect(await fs.readFile(file, 'utf8')).toBe('{}');
  });
  it('does not count or archive foreign drafts and preserves their files during local cleanup', async () => {
    const h = await setup(), api = new FakeKernel(), settings = { ...defaults, notebook: api.notebook };
    const registry = new SharedNoteStore(fs, path, path.join(h.root, 'shared'), h.deviceA);
    const cleanup = new CleanupService(h.a, registry, new NoteRepository(api, () => settings), () => settings,
      { active: () => [], busy: () => false, stopped: () => false, removed() {}, async forget() {}, changed() {} });
    await h.b.write({ note: h.note }); expect(await cleanup.snapshot()).toMatchObject({ total: 0, unsaved: 0, items: [] });
    await h.a.write({ note: { ...h.note, text: 'local distinct body' } });
    cleanup.start('clear', (await cleanup.snapshot()).items, true);
    await vi.waitFor(() => expect(cleanup.currentProgress()?.running).toBe(false));
    await cleanup.reconcile(); expect(await h.a.list()).toEqual([]);
    expect((await h.b.list())[0].note.text).toBe('source body'); expect(await h.a.listOtherDevices()).toHaveLength(1);
  });
  it('saves local edits independently of foreign drafts while retaining SiYuan repository conflict protection', async () => {
    const h = await setup(), api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    await h.b.write({ note: { ...h.note, text: 'foreign version' } });
    const service = new AutoSaveService(h.note, repo, h.a, () => 800, () => {}, () => ({ width: 320, height: 320, pinned: false }));
    await service.persist(); expect(await service.saveToSiYuan()).toBe(true); service.dispose();
    expect(await h.a.list()).toEqual([]); expect(api.blocks.get(h.note.blockId)?.raw).toContain('source body');
    expect((await h.b.list())[0].note.text).toBe('foreign version');
  });
});
