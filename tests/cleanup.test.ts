import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { CleanupService, dayMs, type CleanupSelection } from '../src/services/cleanup';
import { LocalDraftStore } from '../src/platform/drafts';
import { SharedNoteStore } from '../src/platform/shared-notes';
import { NoteRepository } from '../src/services/repository';
import { createNote, noteReference } from '../src/core/identity';
import { defaults, parseSettings, validateSettingsDraft } from '../src/core/settings';
import { validRecentRequest } from '../src/core/recent';
import type { NoteRecord } from '../src/types';
import { FakeKernel } from './fake-kernel';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function setup() {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-cleanup-')); directories.push(directory);
  const api = new FakeKernel(), settings = { ...defaults, notebook: api.notebook, cleanupThreshold: 1 };
  const store = new LocalDraftStore(fs, path, path.join(directory, 'drafts'));
  const shared = new SharedNoteStore(fs, path, path.join(directory, 'shared'), crypto.randomUUID());
  const repo = new NoteRepository(api, () => settings), active: NoteRecord[] = [], busy = new Set<string>();
  let stopped = false;
  const host = { active: () => active, busy: (id: string) => busy.has(id), stopped: () => stopped,
    removed: vi.fn(), forget: vi.fn().mockResolvedValue(undefined), changed: vi.fn() };
  const service = new CleanupService(store, shared, repo, () => settings, host);
  const make = (text = 'local text', time = Date.now() - 31 * dayMs) => ({ ...createNote(time), text, revision: 1 });
  const saved = async (text = 'saved text') => {
    const note: NoteRecord = make(text); await repo.save(note, async () => {}); note.siyuanSaved = true; note.savedRevision = note.revision;
    await store.backup({ note }); await shared.publish({ ...noteReference(note), summary: text }); return note;
  };
  const run = async (mode: 'archive' | 'clear', selections?: CleanupSelection[], discard = false) => {
    const data = await service.snapshot(); service.start(mode, selections ?? data.items.map(({ id, version }) => ({ id, version })), discard);
    await vi.waitFor(() => expect(service.currentProgress()?.running).toBe(false), { timeout: 10000, interval: 10 });
    return service.currentProgress()!;
  };
  return { directory, api, settings, store, shared, repo, active, busy, host, service, make, saved, run, stop: () => { stopped = true; } };
}

describe('complete note inventory and reminders', () => {
  it('deduplicates all shared notes, drafts, backups and windows beyond the display limit', async () => {
    const h = await setup(); h.settings.historyLimit = 1;
    const a = await h.saved('A'), b = await h.saved('B'), orphan = await h.saved('C'), draft = h.make('draft');
    const files = await fs.readdir(path.join(h.directory, 'shared', 'notes'));
    for (const file of files.filter(file => file.startsWith(orphan.id))) await fs.unlink(path.join(h.directory, 'shared', 'notes', file));
    await h.store.write({ note: draft }); h.active.push(a);
    const data = await h.service.snapshot();
    expect(data.total).toBe(4); expect(data.unsaved).toBe(1); expect(data.eligible).toBe(3);
    expect(data.items.find(item => item.id === a.id)).toMatchObject({ open: true, eligible: false });
    expect(data.items.some(item => item.id === b.id)).toBe(true);
  });
  it('uses a strict thirty-day content age and skips open or busy notes', async () => {
    const h = await setup(), now = Date.now();
    for (const time of [now - 30 * dayMs, now - 30 * dayMs - 1, now]) await h.store.write({ note: h.make('age', time) });
    expect((await h.service.snapshot(now)).eligible).toBe(1);
    const item = (await h.service.snapshot(now)).items.find(item => item.eligible)!; h.busy.add(item.id);
    expect((await h.service.snapshot(now)).eligible).toBe(0);
  });
  it('persists daily limits and seven-day snooze across service restarts, without deleting', async () => {
    const h = await setup(), now = new Date(2026, 9, 19, 12).getTime();
    await h.store.write({ note: h.make() });
    expect(await h.service.reminderDue(now)).toBe(true); expect(await h.service.reminderDue(now + 1000)).toBe(false);
    const restarted = new CleanupService(h.store, h.shared, h.repo, () => h.settings, h.host);
    expect(await restarted.reminderDue(now)).toBe(false); await restarted.snooze(now);
    expect((await restarted.snapshot(now)).reminderActive).toBe(false);
    expect(await restarted.reminderDue(now + 6 * dayMs)).toBe(false);
    expect(await restarted.reminderDue(now + 7 * dayMs)).toBe(true);
    expect((await restarted.snapshot(now + 7 * dayMs)).reminderActive).toBe(true);
    expect((await h.store.list()).length).toBe(1); h.settings.cleanupReminder = false;
    expect(await restarted.reminderDue(now + 8 * dayMs)).toBe(false);
    expect((await restarted.snapshot(now + 8 * dayMs)).reminderActive).toBe(false);
  });
  it('does not remind below the threshold and permits local-only settings without a notebook', async () => {
    const h = await setup(); h.settings.cleanupThreshold = 2; await h.store.write({ note: h.make() });
    expect(await h.service.reminderDue()).toBe(false);
    expect((await h.service.snapshot()).reminderActive).toBe(false);
    expect(validateSettingsDraft({ ...defaults }, []).notebook).toBe('');
    expect(parseSettings({}).cleanupThreshold).toBe(100); expect(parseSettings({}).archiveDays).toBe(30);
    expect(parseSettings({ archiveDays: 7 }).archiveDays).toBe(7);
  });
});

describe('safe batch archive and clear', () => {
  it('archives unsaved drafts using the existing save path, then removes local and shared copies only', async () => {
    const h = await setup(), note = h.make(); await h.store.write({ note });
    const progress = await h.run('archive'); expect(progress.succeeded).toBe(1); expect(progress.failures).toEqual([]);
    expect(h.api.blocks.get(note.blockId)?.raw).toContain('local text'); expect(await h.store.list()).toEqual([]); expect(await h.store.listBackups()).toEqual([]);
    expect((await h.shared.load()).deleted.has(note.id)).toBe(true);
    expect(await fs.readdir(path.join(h.directory, 'shared', 'notes'))).toEqual([]);
    expect(h.api.calls.some(call => /delete|remove/i.test(call.path))).toBe(false);
  });
  it('keeps a newer SiYuan edit and performs only reads for already-saved notes', async () => {
    const h = await setup(), note = await h.saved();
    const block = h.api.blocks.get(note.blockId)!; block.raw = block.raw.replace('saved text', 'newer remote text'); h.api.calls.length = 0;
    expect((await h.run('archive')).succeeded).toBe(1); expect(block.raw).toContain('newer remote text');
    expect(h.api.calls.every(call => !/updateBlock|appendBlock|createDoc/.test(call.path))).toBe(true);
  });
  it('submits pending edits to the original destination', async () => {
    const h = await setup(), note = await h.saved();
    await h.store.write({ note: { ...note, text: 'pending edit', revision: 2 } }); h.settings.directory = '/Changed';
    expect((await h.run('archive')).succeeded).toBe(1); expect(h.api.blocks.get(note.blockId)?.raw).toContain('pending edit'); expect(h.api.docs.size).toBe(1);
  });
  it('retains missing sources, conflicts and save failures while continuing other notes', async () => {
    const h = await setup(), missing = await h.saved('missing'), conflict = await h.saved('original'), good = h.make('good');
    h.api.blocks.delete(missing.blockId);
    h.api.blocks.get(conflict.blockId)!.raw = h.api.blocks.get(conflict.blockId)!.raw.replace('original', 'external');
    await h.store.write({ note: { ...conflict, text: 'local conflict', revision: 2 } }); await h.store.write({ note: good });
    const progress = await h.run('archive'); expect(progress.succeeded).toBe(1); expect(progress.failures).toHaveLength(2);
    expect(await h.store.readBackup(missing.id)).toBeDefined(); expect((await h.store.list()).some(draft => draft.note.id === conflict.id)).toBe(true);
    expect((await h.shared.load()).deleted.has(missing.id)).toBe(false);
  });
  it('retries a lost first-write response without creating a duplicate container', async () => {
    const h = await setup(), note = h.make(); await h.store.write({ note }); h.api.lostAppend = true;
    expect((await h.run('archive')).failures).toHaveLength(1); expect(h.api.blocks.size).toBe(1);
    expect((await h.run('archive')).succeeded).toBe(1); expect(h.api.blocks.size).toBe(1);
  });
  it('skips stale previews and open windows and requires explicit discard for local-only content', async () => {
    const h = await setup(), note = h.make(); await h.store.write({ note });
    const preview = await h.service.snapshot(); await h.store.write({ note: { ...note, text: 'new input', revision: 2 } });
    expect((await h.run('clear', preview.items)).skipped).toBe(1); expect((await h.run('clear')).failures).toHaveLength(1);
    h.active.push(note); expect((await h.run('clear', undefined, true)).skipped).toBe(1); h.active.length = 0;
    expect((await h.run('clear', undefined, true)).succeeded).toBe(1); expect(h.api.blocks.size).toBe(0);
  });
  it('blocks duplicate jobs, cancels only subsequent work, and can resume remaining notes', async () => {
    const h = await setup(); for (const text of ['A', 'B']) await h.store.write({ note: h.make(text) });
    const preview = await h.service.snapshot();
    const original = h.repo.save.bind(h.repo); let release!: () => void;
    vi.spyOn(h.repo, 'save').mockImplementationOnce(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); });
    h.service.start('archive', preview.items, false);
    expect(() => h.service.start('clear', preview.items, true)).toThrow('正在进行');
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); h.service.cancel(); release();
    await vi.waitFor(() => expect(h.service.currentProgress()?.running).toBe(false));
    expect(h.service.currentProgress()).toMatchObject({ succeeded: 1, completed: 1, cancelled: true });
    expect((await h.run('archive')).succeeded).toBe(1);
  });
  it('retains local recovery if the plugin stops during a save', async () => {
    const h = await setup(), note = h.make(); await h.store.write({ note });
    const original = h.repo.save.bind(h.repo);
    vi.spyOn(h.repo, 'save').mockImplementationOnce(async (...args) => { await original(...args); h.stop(); });
    expect((await h.run('archive')).skipped).toBe(1); expect(await h.store.readBackup(note.id)).toBeDefined(); expect((await h.shared.load()).deleted.has(note.id)).toBe(false);
  });
  it('recovers interrupted cleanup from a durable journal after restart', async () => {
    const h = await setup(), note = h.make(); await h.store.write({ note });
    vi.spyOn(h.store, 'remove').mockRejectedValueOnce(new Error('disk locked'));
    expect((await h.run('clear', undefined, true)).failures).toHaveLength(1);
    expect((await h.store.list()).length).toBe(1);
    const restarted = new CleanupService(h.store, h.shared, h.repo, () => h.settings, h.host); await restarted.reconcile();
    expect(await h.store.list()).toEqual([]); expect(await h.store.readMaintenance('cleanup', [])).toEqual([]);
    expect(h.host.forget).toHaveBeenCalledWith(note.id);
  });
  it('protects changes made after an interrupted clear', async () => {
    const h = await setup(), note = h.make(); await h.store.write({ note });
    vi.spyOn(h.store, 'remove').mockRejectedValueOnce(new Error('disk locked')); await h.run('clear', undefined, true);
    await h.store.write({ note: { ...note, text: 'newer local content', revision: 2 } }); await h.service.reconcile();
    expect((await h.store.list())[0].note.text).toBe('newer local content');
  });
  it('cleans synced remote removals but preserves dirty drafts and never resurrects stale metadata', async () => {
    const h = await setup(), clean = await h.saved('clean'), dirty = await h.saved('dirty');
    await h.store.write({ note: { ...dirty, text: 'not submitted', revision: 2 } });
    const remote = new SharedNoteStore(fs, path, path.join(h.directory, 'shared'), crypto.randomUUID());
    await remote.remove(clean.id); await remote.remove(dirty.id); await h.service.reconcile();
    expect(await h.store.readBackup(clean.id)).toBeUndefined(); expect((await h.store.list())[0].note.text).toBe('not submitted');
    await remote.publish(noteReference(clean)); expect((await h.shared.load()).records).toEqual([]);
    const data = await h.service.snapshot(); expect(data.total).toBe(0); expect(data.items[0]).toMatchObject({ removed: true, unsaved: true, eligible: false });
  });
  it('rejects malformed batch messages before the host can mutate storage', () => {
    const valid = { action: 'cleanup-start', session: 's', windowId: 'recent', requestId: 'r', mode: 'clear', discard: true,
      selections: [{ id: crypto.randomUUID(), version: crypto.randomUUID() }] };
    expect(validRecentRequest(valid, 's')).toBe(true);
    for (const change of [{ selections: [] }, { mode: 'delete-siyuan' }, { discard: 'true' }, { selections: [{ id: '../escape', version: 'x' }] }]) expect(validRecentRequest({ ...valid, ...change }, 's')).toBe(false);
  });
  it('does not refresh content age on identical reloads and detects an external content change', async () => {
    const h = await setup(), note = await h.saved();
    expect((await h.repo.reload(note)).updatedAt).toBe(note.updatedAt);
    expect((await h.repo.reload({ ...noteReference(note), text: '', revision: 0, savedRevision: 0 })).updatedAt).toBe(note.updatedAt);
    h.api.blocks.get(note.blockId)!.raw = h.api.blocks.get(note.blockId)!.raw.replace('saved text', 'remote edit');
    expect((await h.repo.reload(note)).updatedAt).toBeGreaterThan(note.updatedAt);
    await h.store.backup({ note: await h.repo.reload(note) });
    expect((await h.service.snapshot()).eligible).toBe(0);
  });
});
