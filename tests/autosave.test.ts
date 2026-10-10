import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoSaveService } from '../src/services/autosave';
import { NoteRepository, ConflictError } from '../src/services/repository';
import { createNote } from '../src/core/identity';
import { defaults } from '../src/core/settings';
import type { Draft, DraftStore } from '../src/types';
import { FakeKernel } from './fake-kernel';

class MemoryDrafts implements DraftStore {
  values = new Map<string, Draft>(); fail = false;
  async write(draft: Draft) { if (this.fail) throw new Error('disk full'); this.values.set(draft.note.id, structuredClone(draft)); }
  async remove(id: string) { this.values.delete(id); }
  async list() { return [...this.values.values()]; }
}
function setup() {
  const api = new FakeKernel(), drafts = new MemoryDrafts(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
  const service = new AutoSaveService(createNote(), repo, drafts, () => 800, () => {}, () => ({ width: 420, height: 320, pinned: false }));
  return { api, drafts, repo, service };
}
afterEach(() => vi.useRealTimers());
describe('autosave and recovery', () => {
  it('keeps a recovered draft title in the editable body exactly once across save and reopen', async () => {
    const { api, repo, drafts, service } = setup(); service.dispose();
    const note = { ...createNote(), title: '旧草稿标题 # *', text: '尚未保存的正文', revision: 1 };
    const restored = new AutoSaveService(note, repo, drafts, () => 10000, () => {}, () => ({ width: 320, height: 320, pinned: false }));
    try {
      expect(restored.note.title).toBeUndefined(); expect(restored.note.text).toBe('# 旧草稿标题 \\# \\*\n\n尚未保存的正文');
      await restored.persist(); expect(drafts.values.get(note.id)?.note).toMatchObject({ text: restored.note.text, title: undefined });
      expect(await restored.flush()).toBe(true);
      const reloaded = await repo.reload(restored.note); expect(reloaded.text).toBe(restored.note.text);
      expect(api.blocks.get(note.blockId)?.raw.match(/旧草稿标题/g)).toHaveLength(1);
      await restored.edit('只留下正文', 2); expect(await restored.flush()).toBe(true);
      expect(api.blocks.get(note.blockId)?.raw).not.toContain('旧草稿标题');
    } finally { restored.dispose(); }
  });
  it('durably records a whole-document copy to a shared container and recovers a lost append response', async () => {
    const { api, repo, drafts, service } = setup();
    let restored: AutoSaveService | undefined;
    try {
      const originalBlock = service.note.blockId;
      const raw = 'original';
      service.note = { ...service.note, docId: originalBlock, storage: 'document', baseline: raw, text: 'original',
        target: { notebook: api.notebook, path: '/Old/Shared' }, docPath: '/Old/Shared' };
      api.docs.set('/Old/Shared', service.note.docId!);
      api.blocks.set(originalBlock, { raw, root_id: service.note.docId! });
      await service.edit('changed', 1); api.lostAppend = true;
      expect(await service.flush()).toBe(false);
      const recovery = drafts.values.get(service.note.id)!;
      expect(recovery.note.storage).toBe('superblock'); expect(recovery.note.blockId).not.toBe(originalBlock);
      expect(recovery.note.docPath).toBeUndefined();
      restored = new AutoSaveService(recovery.note, repo, drafts, () => 10000, () => {}, () => ({ width: 420, height: 320, pinned: false }));
      expect(await restored.flush()).toBe(true);
      expect(restored.note.docId).toBe(recovery.note.docId);
      expect(api.blocks.get(restored.note.blockId)?.raw).toMatch(/^\{\{\{row\nchanged/);
      expect(api.blocks.get(originalBlock)?.raw).toBe(raw); expect(api.docs.size).toBe(2);
      expect(api.calls.filter(call => call.path.endsWith('createDocWithMd'))).toHaveLength(1);
      expect(api.calls.filter(call => call.path.endsWith('appendBlock'))).toHaveLength(1);
    } finally { service.dispose(); restored?.dispose(); }
  });
  it('cannot resurrect discarded edits when removing a reloaded draft fails', async () => {
    const { service, drafts, repo, api } = setup();
    let restored: AutoSaveService | undefined;
    try {
      await service.edit('formal original', 1); await service.flush();
      await service.edit('discard this edit', 2);
      vi.spyOn(drafts, 'remove').mockRejectedValue(new Error('file locked'));
      await service.reload();
      const recovery = drafts.values.get(service.note.id)!;
      expect(service.note.text).toBe('formal original');
      expect(service.error).toContain('本机草稿清理失败');
      expect(recovery.note.text).toBe('formal original');
      expect(recovery.note.savedRevision).toBe(recovery.note.revision);
      restored = new AutoSaveService(recovery.note, repo, drafts, () => 10000, () => {}, () => ({ width: 420, height: 320, pinned: false }));
      expect(await restored.flush()).toBe(true);
      expect(api.blocks.get(service.note.blockId)?.raw).toContain('formal original');
      expect(api.blocks.get(service.note.blockId)?.raw).not.toContain('discard this edit');
    } finally { service.dispose(); restored?.dispose(); }
  });
  it('keeps current edits if the replacement recovery snapshot cannot be written', async () => {
    const { service, drafts } = setup();
    try {
      await service.edit('formal original', 1); await service.flush();
      await service.edit('keep local edit', 2); drafts.fail = true;
      await expect(service.reload()).rejects.toThrow('已保留当前修改');
      expect(service.note.text).toBe('keep local edit');
      expect(service.note.revision).toBe(2);
      expect(drafts.values.get(service.note.id)?.note.text).toBe('keep local edit');
    } finally { service.dispose(); }
  });
  it.each([false, true])('preserves input and metadata queued during a reload write (new input=%s)', async newerInput => {
    const { service, drafts } = setup();
    try {
      await service.edit('formal original', 1); await service.flush();
      await service.edit('discard this edit', 2);
      let release!: () => void, entered!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      const write = drafts.write.bind(drafts);
      vi.spyOn(drafts, 'write').mockImplementationOnce(async draft => { entered(); await blocked; await write(draft); });
      vi.spyOn(drafts, 'remove').mockRejectedValue(new Error('file locked'));
      // Attach the rejection handler before releasing the write.
      const reload = service.reload().then(() => undefined, error => error);
      await started;
      const pending = newerInput ? service.edit('newer input', 3, false) : service.persist();
      release(); const result = await reload; await pending;
      if (newerInput) expect(result).toBeInstanceOf(ConflictError);
      else expect(result).toBeUndefined();
      const expected = newerInput ? 'newer input' : 'formal original';
      expect(service.note.text).toBe(expected);
      expect(drafts.values.get(service.note.id)?.note.text).toBe(expected);
    } finally { service.dispose(); }
  });
  it('freezes independent settings at first meaningful input', async () => {
    const api = new FakeKernel(), drafts = new MemoryDrafts();
    let settings = { ...defaults, notebook: api.notebook, directory: '/Original' };
    const repo = new NoteRepository(api, () => settings);
    const service = new AutoSaveService(createNote(), repo, drafts, () => 800, () => {}, () => ({ width: 420, height: 320, pinned: false }));
    await service.edit('remember original', 1); settings = { ...settings, directory: '/Changed' };
    await service.flush(); expect(service.note.target?.path.startsWith('/Original/')).toBe(true); service.dispose();
  });
  it('delays formal document creation until valid content and saves on explicit flush', async () => {
    const { service, api, drafts } = setup();
    await service.edit('  ', 1); await service.flush(); expect(api.docs.size).toBe(0);
    await service.edit('中文速记', 2); expect(api.docs.size).toBe(0); expect(drafts.values.size).toBe(1);
    expect(await service.flush()).toBe(true); expect(service.phase).toBe('saved'); expect(drafts.values.size).toBe(0); service.dispose();
  });
  it('debounces continuous input', async () => {
    vi.useFakeTimers(); const { service, api } = setup();
    await service.edit('a', 1); await vi.advanceTimersByTimeAsync(500); await service.edit('ab', 2);
    await vi.advanceTimersByTimeAsync(500); expect(api.docs.size).toBe(0);
    await vi.advanceTimersByTimeAsync(300); expect(api.blocks.size).toBe(1); service.dispose();
  });
  it('ignores duplicate and stale edit revisions', async () => {
    const { service } = setup(); await service.edit('new', 2); await service.edit('old', 1); await service.edit('duplicate', 2);
    expect(service.note.text).toBe('new'); service.dispose();
  });
  it('resumes autosaving dirty content after an interrupted operation without another edit', async () => {
    vi.useFakeTimers(); const { service, api } = setup();
    await service.edit('pending before pause', 1); service.pause();
    await service.edit('latest collected text', 2, false);
    await vi.advanceTimersByTimeAsync(2000); expect(api.docs.size).toBe(0);
    service.resume(); await vi.advanceTimersByTimeAsync(799); expect(api.docs.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.note.savedRevision).toBe(2); expect(api.blocks.get(service.note.blockId)?.raw).toContain('latest collected text');
    service.dispose();
  });
  it('does not postpone an existing autosave when resuming a service that was not paused', async () => {
    vi.useFakeTimers(); const { service, api } = setup();
    await service.edit('still pending', 1); await vi.advanceTimersByTimeAsync(700);
    service.resume(); await vi.advanceTimersByTimeAsync(100);
    expect(api.blocks.size).toBe(1); service.dispose();
  });
  it('does not retry a conflict or a disposed service when resuming', async () => {
    vi.useFakeTimers(); const { service, repo } = setup();
    await service.edit('first', 1); await service.flush();
    const save = vi.spyOn(repo, 'save').mockRejectedValueOnce(new ConflictError('external edit'));
    await service.edit('local conflict', 2); await service.flush(); service.pause(); service.resume();
    await vi.advanceTimersByTimeAsync(2000); expect(save).toHaveBeenCalledTimes(1);
    service.phase = 'dirty'; service.pause(); service.dispose(); service.resume();
    await vi.advanceTimersByTimeAsync(2000); expect(save).toHaveBeenCalledTimes(1);
  });
  it('retains the newer edit when an old save finishes', async () => {
    const { service, repo, drafts } = setup();
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const original = repo.save.bind(repo);
    vi.spyOn(repo, 'save').mockImplementationOnce(async (note, persist) => { entered(); await blocked; await original(note, persist); });
    await service.edit('first', 1); const saving = service.flush(); await started;
    await service.edit('second', 2); release(); await saving;
    expect(service.note.savedRevision).toBe(1); expect(service.note.text).toBe('second'); expect(service.phase).toBe('dirty');
    expect(drafts.values.get(service.note.id)?.note.text).toBe('second');
    await service.flush(); expect(service.note.savedRevision).toBe(2); service.dispose();
  });
  it('keeps a durable recovery draft on kernel failure and succeeds on retry', async () => {
    const { service, api, drafts } = setup(); api.fail = '/api/filetree/createDocWithMd';
    await service.edit('recover', 1); expect(await service.flush()).toBe(false); expect(service.phase).toBe('error');
    expect(await service.closeToDraft()).toBe(true); expect(drafts.values.get(service.note.id)?.note.text).toBe('recover');
    api.fail = undefined; expect(await service.flush()).toBe(true); expect(drafts.values.size).toBe(0); service.dispose();
  });
  it('prevents closing or submitting if the recovery draft cannot be written', async () => {
    const { service, drafts, api } = setup(); drafts.fail = true;
    await service.edit('do not lose', 1); expect(await service.closeToDraft()).toBe(false); expect(await service.flush()).toBe(false);
    expect(api.docs.size).toBe(0); expect(service.localRevision).toBe(-1); service.dispose();
  });
  it('keeps conflict latched while typing until explicit reload', async () => {
    const { service, repo } = setup(); await service.edit('first', 1); await service.flush();
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new ConflictError('external edit'));
    await service.edit('second', 2); await service.flush(); await service.edit('third', 3);
    expect(service.phase).toBe('conflict'); expect(await service.flush()).toBe(false);
    await service.reload(); expect(service.phase).toBe('saved'); expect(service.note.text).toBe('first'); service.dispose();
  });
  it('coalesces slow draft writes and persists recovery metadata even at the same revision', async () => {
    const { service, drafts } = setup();
    service.note.target = { notebook: '20261010000000-book001', path: '/Inbox' };
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const original = drafts.write.bind(drafts);
    const write = vi.spyOn(drafts, 'write').mockImplementationOnce(async draft => { entered(); await blocked; await original(draft); });
    const first = service.edit('first', 1); await started;
    const edits = Array.from({ length: 20 }, (_, index) => service.edit(`latest ${index}`, index + 2));
    service.note.docId = '20261010000000-doc0001'; const metadata = service.persist();
    expect(service.note.text).toBe('latest 19'); release();
    await Promise.all([first, ...edits, metadata]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(drafts.values.get(service.note.id)?.note).toMatchObject({ text: 'latest 19', revision: 21, docId: '20261010000000-doc0001' });
    service.note.baseline = 'confirmed baseline'; await service.persist();
    expect(drafts.values.get(service.note.id)?.note.baseline).toBe('confirmed baseline');
    service.dispose();
  });
  it('does not acknowledge or delete drafts after a late kernel response to a disposed service', async () => {
    const { service, repo, drafts } = setup();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(repo, 'save').mockImplementationOnce(async note => {
      entered(); await new Promise<void>(resolve => { release = resolve; }); note.baseline = 'late';
    });
    await service.edit('old', 1); const save = service.flush(); await started;
    await service.edit('latest', 2); expect(await service.closeToDraft()).toBe(true); service.dispose();
    release(); expect(await save).toBe(false);
    expect(drafts.values.get(service.note.id)?.note.text).toBe('latest');
    expect(service.note.savedRevision).toBe(0);
  });
});
