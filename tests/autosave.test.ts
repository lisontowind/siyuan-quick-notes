import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoSaveService } from '../src/services/autosave';
import { NoteRepository, ConflictError, unwrapMarkdown, unwrapNoteMarkdown } from '../src/services/repository';
import { createNote } from '../src/core/identity';
import { defaults } from '../src/core/settings';
import type { Draft, DraftStore } from '../src/types';
import { FakeKernel } from './fake-kernel';

class MemoryDrafts implements DraftStore {
  values = new Map<string, Draft>(); fail = false;
  backups = new Map<string, Draft>();
  async backup(draft: Draft) { this.backups.set(draft.note.id, structuredClone(draft)); }
  async readBackup(id: string) { return this.backups.get(id); }
  async removeBackup(id: string) { this.backups.delete(id); }
  async write(draft: Draft) { if (this.fail) throw new Error('disk full'); this.values.set(draft.note.id, structuredClone(draft)); }
  async remove(id: string) { this.values.delete(id); }
  async list() { return [...this.values.values()]; }
}
function setup(autoSaveToSiYuan = () => false) {
  const api = new FakeKernel(), drafts = new MemoryDrafts(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
  const service = new AutoSaveService(createNote(), repo, drafts, () => 800, () => {}, () => ({ width: 420, height: 320, pinned: false }), undefined, autoSaveToSiYuan);
  return { api, drafts, repo, service };
}
afterEach(() => vi.useRealTimers());
describe('autosave and recovery', () => {
  it('automatically saves a new note after the configured delay when enabled and keeps syncing after disabling', async () => {
    vi.useFakeTimers(); let enabled = true;
    const { service, api, drafts } = setup(() => enabled);
    try {
      await service.edit('first', 1); await vi.advanceTimersByTimeAsync(799);
      expect(api.calls).toEqual([]); expect(drafts.values.get(service.note.id)?.note.text).toBe('first');
      await vi.advanceTimersByTimeAsync(1);
      expect(service.note).toMatchObject({ siyuanSaved: true, savedRevision: 1 });
      expect(api.blocks.size).toBe(1); expect(drafts.values.size).toBe(0);
      enabled = false; service.settingsChanged();
      await service.edit('second', 2); await vi.advanceTimersByTimeAsync(800);
      expect(service.note.savedRevision).toBe(2); expect(api.blocks.size).toBe(1);
      expect(api.blocks.get(service.note.blockId)?.raw).toContain('second');
    } finally { service.dispose(); }
  });
  it('starts saving an open draft when enabled and reads the current setting before a pending first save', async () => {
    vi.useFakeTimers(); let enabled = false;
    const { service, api } = setup(() => enabled);
    try {
      await service.edit('draft', 1); await vi.advanceTimersByTimeAsync(800); expect(api.calls).toEqual([]);
      enabled = true; service.settingsChanged(); enabled = false;
      await vi.advanceTimersByTimeAsync(800); expect(api.calls).toEqual([]);
      enabled = true; service.settingsChanged(); await vi.advanceTimersByTimeAsync(800);
      expect(service.note).toMatchObject({ siyuanSaved: true, savedRevision: 1 });
    } finally { service.dispose(); }
  });
  it('resumes a nonempty draft on reopening with automatic SiYuan saving enabled', async () => {
    vi.useFakeTimers(); const { service, repo, drafts, api } = setup();
    await service.edit('recovered', 1, false); service.dispose();
    const recovered = new AutoSaveService(drafts.values.get(service.note.id)!.note, repo, drafts, () => 800, () => {},
      () => ({ width: 320, height: 320, pinned: false }), undefined, () => true);
    try {
      await vi.advanceTimersByTimeAsync(800);
      expect(recovered.note.siyuanSaved).toBe(true); expect(api.blocks.size).toBe(1);
    } finally { recovered.dispose(); }
  });
  it('skips empty automatic saves but saves title-only notes and leaves explicit empty-save errors visible', async () => {
    vi.useFakeTimers(); const { service, api } = setup(() => true);
    try {
      await service.edit(' \n ', 1); await vi.advanceTimersByTimeAsync(800);
      expect(await service.flush()).toBe(true); expect(service.error).toBeUndefined(); expect(api.calls).toEqual([]);
      expect(await service.saveToSiYuan()).toBe(false); expect(service.error).toContain('内容为空');
      await service.edit('', 2, true, undefined, '仅标题'); await vi.advanceTimersByTimeAsync(800);
      expect(service.note.siyuanSaved).toBe(true); expect(unwrapNoteMarkdown(service.note.baseline!).caption).toBe('仅标题');
    } finally { service.dispose(); }
  });
  it('retains a failed automatic save as a draft and retries without duplicating the partially created document', async () => {
    vi.useFakeTimers(); const { service, api, drafts } = setup(() => true);
    try {
      api.fail = '/api/block/appendBlock'; await service.edit('keep me', 1); await vi.advanceTimersByTimeAsync(800);
      expect(service.phase).toBe('error'); expect(service.note.siyuanSaved).toBe(false);
      expect(drafts.values.get(service.note.id)?.note.text).toBe('keep me'); expect(api.docs.size).toBe(1);
      api.fail = undefined; expect(await service.flush()).toBe(true);
      expect(service.note.siyuanSaved).toBe(true); expect(api.docs.size).toBe(1); expect(api.blocks.size).toBe(1);
    } finally { service.dispose(); }
  });
  it('persists category-only changes without changing text and saves title-only native callouts', async () => {
    const { service, drafts, api } = setup();
    try {
      await service.edit('', 1, false, undefined, 'Title', 'WARNING');
      expect(drafts.values.get(service.note.id)?.note).toMatchObject({ text: '', caption: 'Title', calloutType: 'WARNING' });
      expect(await service.saveToSiYuan()).toBe(true);
      expect(unwrapNoteMarkdown(service.note.baseline!)).toMatchObject({ text: '', caption: 'Title', calloutType: 'WARNING' });
      await service.edit('', 2, false, undefined, undefined, 'TIP'); expect(await service.flush()).toBe(true);
      expect(api.blocks.size).toBe(1); expect(unwrapNoteMarkdown(service.note.baseline!)).toMatchObject({ text: '', caption: 'Title', calloutType: 'TIP' });
    } finally { service.dispose(); }
  });
  it('converts a clean legacy container on explicit saving without changing its ID or update time', async () => {
    const { service: initial, api, repo, drafts } = setup(); initial.dispose();
    const note = { ...createNote(), text: 'legacy body', revision: 1, savedRevision: 1, docId: '20261010000000-doc0001', siyuanSaved: true, storage: 'superblock' as const,
      target: { notebook: api.notebook, path: '/Legacy' }, baseline: '' };
    note.baseline = `{{{row\nlegacy body\n}}}\n{: id="${note.blockId}" custom-quick-note="${note.id}"}`;
    api.docs.set('/Legacy', note.docId); api.blocks.set(note.blockId, { raw: note.baseline, root_id: note.docId });
    const service = new AutoSaveService(note, repo, drafts, () => 800, () => {}, () => ({ width: 320, height: 320, pinned: false }));
    try {
      expect(await service.saveToSiYuan()).toBe(true); expect(service.note.storage).toBe('callout'); expect(service.note.updatedAt).toBe(note.updatedAt);
      expect(service.note.blockId).toBe(note.blockId); expect(api.blocks.size).toBe(1); expect(api.calls.filter(call => call.path.endsWith('updateBlock'))).toHaveLength(1);
    } finally { service.dispose(); }
  });
  it('persists title-only drafts and restores custom titles at the top of their native callout', async () => {
    const { service, drafts, repo, api } = setup();
    try {
      await service.edit('', 1, false, undefined, '仅标题');
      expect(await service.closeToDraft()).toBe(true); expect(api.calls).toEqual([]);
      const draft = drafts.values.get(service.note.id)!; expect(draft.note).toMatchObject({ caption: '仅标题', text: '' });
      const reopened = new AutoSaveService(draft.note, repo, drafts, () => 800, () => {}, () => ({ width: 320, height: 320, pinned: false }));
      try {
        expect(reopened.note.caption).toBe('仅标题'); expect(reopened.note.text).toBe('');
        await reopened.edit('body', 2, false); expect(reopened.note.caption).toBe('仅标题');
        expect(await reopened.saveToSiYuan()).toBe(true);
        expect(api.blocks.get(reopened.note.blockId)?.raw).toContain('body'); expect(unwrapNoteMarkdown(api.blocks.get(reopened.note.blockId)!.raw)).toMatchObject({ caption: '仅标题', calloutType: 'NOTE', text: 'body' });
        expect(drafts.backups.get(reopened.note.id)?.note.caption).toBe('仅标题');
        await reopened.reload(); expect(reopened.note.caption).toBe('仅标题');
      } finally { reopened.dispose(); }
    } finally { service.dispose(); }
  });
  it('changes and clears a saved note title inside the callout while retaining its document and body', async () => {
    const { service, api, drafts } = setup();
    try {
      await service.edit('unchanged body', 1, false); expect(await service.saveToSiYuan()).toBe(true);
      const raw = api.blocks.get(service.note.blockId)?.raw, target = structuredClone(service.note.target), docId = service.note.docId;
      api.calls.length = 0;
      await service.edit(service.note.text, 2, false, undefined, '自定义 <script>'); expect(await service.flush()).toBe(true);
      expect(service.note.docId).toBe(docId); expect(service.note.target).toEqual(target);
      expect(unwrapMarkdown(api.blocks.get(service.note.blockId)!.raw)).toBe(unwrapMarkdown(raw!)); expect(drafts.backups.get(service.note.id)?.note.caption).toBe('自定义 <script>');
      expect(api.calls.some(call => /createDoc|renameDoc|appendBlock/.test(call.path))).toBe(false);
      await service.edit(service.note.text, 3, false, undefined, ''); expect(await service.flush()).toBe(true);
      expect(service.note.caption).toBeUndefined(); expect(drafts.backups.get(service.note.id)?.note.caption).toBeUndefined();
    } finally { service.dispose(); }
  });
  it('keeps a changed title recoverable on disk failure and rejects invalid titles before mutation', async () => {
    const { service, drafts } = setup();
    try {
      drafts.fail = true; await service.edit('body', 1, false, undefined, '待恢复标题');
      expect(service.error).toContain('disk full'); expect(service.note.caption).toBe('待恢复标题');
      await expect(service.edit('discard', 2, false, undefined, 'bad\ntitle')).rejects.toThrow('单行文本');
      expect(service.note).toMatchObject({ text: 'body', revision: 1, caption: '待恢复标题' });
      drafts.fail = false; expect(await service.persist()).toBe(true); expect(drafts.values.get(service.note.id)?.note.caption).toBe('待恢复标题');
    } finally { service.dispose(); }
  });
  it('backs up a clean recovered note from older versions before removing its recovery draft', async () => {
    const { service, repo, drafts } = setup(); service.dispose();
    const note = { ...createNote(), text: 'old confirmed copy', revision: 1, savedRevision: 1, docId: '20261010000000-doc0001', siyuanSaved: true };
    await drafts.write({ note });
    const restored = new AutoSaveService(note, repo, drafts, () => 10000, () => {}, () => ({ width: 320, height: 320, pinned: false }));
    try {
      await restored.flush(); expect(drafts.values.size).toBe(0); expect(drafts.backups.get(note.id)?.note.text).toBe(note.text);
    } finally { restored.dispose(); }
  });
  it('retains a complete confirmed plugin copy and restores a deleted source only on explicit restoration', async () => {
    const { service, drafts, api } = setup();
    try {
      await service.edit('full original\n\nbody', 1); await service.saveToSiYuan();
      expect(drafts.values.size).toBe(0); expect(drafts.backups.get(service.note.id)?.note.text).toBe(service.note.text);
      api.blocks.delete(service.note.blockId); await service.edit('latest local body', 2);
      expect(await service.flush()).toBe(false); expect(api.blocks.size).toBe(0); expect(service.phase).toBe('conflict');
      expect(await service.restoreToSiYuan()).toBe(true);
      expect(api.blocks.get(service.note.blockId)?.raw).toContain('latest local body');
      expect(drafts.backups.get(service.note.id)?.note.text).toBe('latest local body');
      await service.delete(); expect(drafts.backups.size).toBe(0);
    } finally { service.dispose(); }
  });
  it('retains recovery content when a confirmed plugin copy cannot be stored', async () => {
    const { service, drafts } = setup();
    try {
      vi.spyOn(drafts, 'backup').mockRejectedValueOnce(new Error('disk full'));
      await service.edit('retain', 1); expect(await service.saveToSiYuan()).toBe(false);
      expect(drafts.values.get(service.note.id)?.note.text).toBe('retain'); expect(service.error).toContain('副本');
      expect(await service.saveToSiYuan()).toBe(true); expect(drafts.backups.get(service.note.id)?.note.text).toBe('retain');
    } finally { service.dispose(); }
  });
  it('keeps ordinary saves, timers, empty edits and restart recovery entirely in the plugin without a notebook', async () => {
    vi.useFakeTimers(); const { service, repo, api, drafts } = setup();
    const resolve = vi.spyOn(repo, 'resolveTarget').mockRejectedValue(new Error('no notebook'));
    let restored: AutoSaveService | undefined;
    try {
      await service.edit('plugin only', 1); await vi.advanceTimersByTimeAsync(1000);
      expect(await service.flush()).toBe(true); expect(await service.closeToDraft()).toBe(true);
      expect(service.phase).toBe('local'); expect(service.note.savedRevision).toBe(0);
      expect(resolve).not.toHaveBeenCalled(); expect(api.calls).toEqual([]);
      await service.edit('', 2); await service.flush(); await service.cleanSavedDraft();
      const recovery = drafts.values.get(service.note.id)!;
      expect(recovery.note).toMatchObject({ text: '', revision: 2, siyuanSaved: false });
      restored = new AutoSaveService(recovery.note, repo, drafts, () => 800, () => {}, () => recovery.geometry!);
      expect(restored.phase).toBe('local'); expect(await restored.flush()).toBe(true);
      expect(drafts.values.has(service.note.id)).toBe(true); expect(api.calls).toEqual([]);
    } finally { service.dispose(); restored?.dispose(); }
  });
  it('keeps a failed partial first save local across restart and retries without duplicating the document', async () => {
    const { service, repo, api, drafts } = setup();
    let restored: AutoSaveService | undefined;
    try {
      api.fail = '/api/block/appendBlock'; await service.edit('keep this', 1);
      expect(await service.saveToSiYuan()).toBe(false);
      expect(service.note.docId).toBeDefined(); expect(service.note.siyuanSaved).toBe(false);
      const recovery = drafts.values.get(service.note.id)!;
      restored = new AutoSaveService(recovery.note, repo, drafts, () => 10000, () => {}, () => recovery.geometry!);
      api.fail = undefined; const calls = api.calls.length;
      await restored.edit('newer local', 2); await restored.flush(); expect(api.calls).toHaveLength(calls);
      expect(await restored.saveToSiYuan()).toBe(true);
      expect(restored.note.siyuanSaved).toBe(true); expect(api.docs.size).toBe(1);
      expect(api.blocks.get(service.note.blockId)?.raw).toContain('newer local');
    } finally { service.dispose(); restored?.dispose(); }
  });
  it('normalizes older unsaved drafts before persisting a partially created document', async () => {
    const { service, repo, api, drafts } = setup(); service.dispose();
    const legacy = createNote(); delete legacy.siyuanSaved;
    const restored = new AutoSaveService(legacy, repo, drafts, () => 10000, () => {}, () => ({ width: 320, height: 320, pinned: false }));
    try {
      api.fail = '/api/block/appendBlock'; await restored.edit('old plugin draft', 1);
      expect(await restored.saveToSiYuan()).toBe(false);
      expect(restored.note.docId).toBeDefined(); expect(restored.note.siyuanSaved).toBe(false);
      expect(drafts.values.get(legacy.id)?.note.siyuanSaved).toBe(false);
      const calls = api.calls.length; await restored.flush(); expect(api.calls).toHaveLength(calls);
    } finally { restored.dispose(); }
  });
  it('deduplicates simultaneous first saves and automatically syncs edits made during the save', async () => {
    vi.useFakeTimers(); const { service, repo, api, drafts } = setup();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = repo.save.bind(repo);
    vi.spyOn(repo, 'save').mockImplementationOnce(async (note, persist) => { entered(); await new Promise<void>(resolve => { release = resolve; }); await original(note, persist); });
    try {
      await service.edit('first', 1); const first = service.saveToSiYuan(); await started;
      await service.edit('second', 2); await vi.advanceTimersByTimeAsync(1000);
      release(); await first; await vi.advanceTimersByTimeAsync(1000);
      expect(service.note).toMatchObject({ siyuanSaved: true, revision: 2, savedRevision: 2 });
      expect(api.docs.size).toBe(1); expect(api.blocks.size).toBe(1);
      expect(api.blocks.get(service.note.blockId)?.raw).toContain('second');
      expect(drafts.values.size).toBe(0);
      await service.edit('third', 3);
      await Promise.all([service.saveToSiYuan(), service.saveToSiYuan()]);
      expect(api.calls.filter(call => call.path.endsWith('appendBlock'))).toHaveLength(1);
    } finally { service.dispose(); }
  });
  it('keeps plugin disk failures visible and retries without creating a SiYuan document', async () => {
    const { service, drafts, api } = setup();
    try {
      drafts.fail = true; await service.edit('keep in memory', 1);
      expect(await service.flush()).toBe(false); expect(service.phase).toBe('error');
      drafts.fail = false; expect(await service.flush()).toBe(true);
      expect(service.phase).toBe('local'); expect(service.error).toBeUndefined(); expect(api.calls).toEqual([]);
    } finally { service.dispose(); }
  });
  it('rejects a first empty SiYuan save without removing the plugin record', async () => {
    const { service, drafts, api } = setup();
    try {
      await service.edit('', 1); expect(await service.saveToSiYuan()).toBe(false);
      expect(service.note.siyuanSaved).toBe(false); expect(drafts.values.has(service.note.id)).toBe(true); expect(api.calls).toEqual([]);
    } finally { service.dispose(); }
  });
  it('continues autosaving older confirmed records without a confirmation flag', async () => {
    vi.useFakeTimers(); const { service, api } = setup();
    try {
      await service.edit('old saved note', 1); await service.saveToSiYuan(); delete service.note.siyuanSaved;
      await service.edit('updated legacy note', 2); await vi.advanceTimersByTimeAsync(800);
      expect(api.blocks.get(service.note.blockId)?.raw).toContain('updated legacy note'); expect(service.note.savedRevision).toBe(2);
    } finally { service.dispose(); }
  });
  it('keeps local recovery content after remote removal and blocks both autosave and explicit reload', async () => {
    const { service, repo, drafts } = setup();
    try {
      await service.edit('saved', 1); expect(await service.saveToSiYuan()).toBe(true);
      await service.edit('local unsaved', 2); const save = vi.spyOn(repo, 'save');
      service.markRemoved(); service.resume(); expect(await service.saveToSiYuan()).toBe(false);
      await expect(service.reload()).rejects.toThrow('移除'); expect(save).not.toHaveBeenCalled();
      expect(drafts.values.get(service.note.id)?.note.text).toBe('local unsaved');
      await service.edit('recover this too', 3); expect(service.phase).toBe('conflict');
      expect(drafts.values.get(service.note.id)?.note.text).toBe('recover this too');
    } finally { service.dispose(); }
  });
  it('retains the draft if removal arrives while a kernel save is in flight', async () => {
    const { service, repo, drafts } = setup();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(repo, 'save').mockImplementationOnce(async note => {
      entered(); await new Promise<void>(resolve => { release = resolve; }); note.baseline = 'late';
    });
    try {
      await service.edit('keep', 1); const saving = service.saveToSiYuan(); await started;
      service.markRemoved(); release(); expect(await saving).toBe(false);
      expect(service.phase).toBe('conflict'); expect(service.note.savedRevision).toBe(0);
      expect(drafts.values.get(service.note.id)?.note.text).toBe('keep');
    } finally { service.dispose(); }
  });
  it('keeps a recovered draft title in the editable body exactly once across save and reopen', async () => {
    const { api, repo, drafts, service } = setup(); service.dispose();
    const note = { ...createNote(), title: '旧草稿标题 # *', text: '尚未保存的正文', revision: 1 };
    const restored = new AutoSaveService(note, repo, drafts, () => 10000, () => {}, () => ({ width: 320, height: 320, pinned: false }));
    try {
      expect(restored.note.title).toBeUndefined(); expect(restored.note.text).toBe('# 旧草稿标题 \\# \\*\n\n尚未保存的正文');
      await restored.persist(); expect(drafts.values.get(note.id)?.note).toMatchObject({ text: restored.note.text, title: undefined });
      expect(await restored.saveToSiYuan()).toBe(true);
      const reloaded = await repo.reload(restored.note); expect(reloaded.text).toBe(restored.note.text);
      expect(api.blocks.get(note.blockId)?.raw.match(/旧草稿标题/g)).toHaveLength(1);
      await restored.edit('只留下正文', 2); expect(await restored.saveToSiYuan()).toBe(true);
      expect(api.blocks.get(note.blockId)?.raw).not.toContain('旧草稿标题');
    } finally { restored.dispose(); }
  });
  it('durably records a whole-document copy to a shared container and recovers a lost append response', async () => {
    const { api, repo, drafts, service } = setup();
    let restored: AutoSaveService | undefined;
    try {
      const originalBlock = service.note.blockId;
      const raw = 'original';
      service.note = { ...service.note, siyuanSaved: undefined, docId: originalBlock, storage: 'document', baseline: raw, text: 'original',
        target: { notebook: api.notebook, path: '/Old/Shared' }, docPath: '/Old/Shared' };
      api.docs.set('/Old/Shared', service.note.docId!);
      api.blocks.set(originalBlock, { raw, root_id: service.note.docId! });
      await service.edit('changed', 1); api.lostAppend = true;
      expect(await service.saveToSiYuan()).toBe(false);
      const recovery = drafts.values.get(service.note.id)!;
      expect(recovery.note.storage).toBe('callout'); expect(recovery.note.blockId).not.toBe(originalBlock);
      expect(recovery.note.docPath).toBeUndefined();
      restored = new AutoSaveService(recovery.note, repo, drafts, () => 10000, () => {}, () => ({ width: 420, height: 320, pinned: false }));
      expect(await restored.saveToSiYuan()).toBe(true);
      expect(restored.note.docId).toBe(recovery.note.docId);
      expect(api.blocks.get(restored.note.blockId)?.raw).toMatch(/^> \[!NOTE\]\n>\n> changed/);
      expect(api.blocks.get(originalBlock)?.raw).toBe(raw); expect(api.docs.size).toBe(2);
      expect(api.calls.filter(call => call.path.endsWith('createDocWithMd'))).toHaveLength(1);
      expect(api.calls.filter(call => call.path.endsWith('appendBlock'))).toHaveLength(1);
    } finally { service.dispose(); restored?.dispose(); }
  });
  it('cannot resurrect discarded edits when removing a reloaded draft fails', async () => {
    const { service, drafts, repo, api } = setup();
    let restored: AutoSaveService | undefined;
    try {
      await service.edit('formal original', 1); await service.saveToSiYuan();
      await service.edit('discard this edit', 2);
      vi.spyOn(drafts, 'remove').mockRejectedValue(new Error('file locked'));
      await service.reload();
      const recovery = drafts.values.get(service.note.id)!;
      expect(service.note.text).toBe('formal original');
      expect(service.error).toContain('本机草稿清理失败');
      expect(recovery.note.text).toBe('formal original');
      expect(recovery.note.savedRevision).toBe(recovery.note.revision);
      restored = new AutoSaveService(recovery.note, repo, drafts, () => 10000, () => {}, () => ({ width: 420, height: 320, pinned: false }));
      expect(await restored.saveToSiYuan()).toBe(true);
      expect(api.blocks.get(service.note.blockId)?.raw).toContain('formal original');
      expect(api.blocks.get(service.note.blockId)?.raw).not.toContain('discard this edit');
    } finally { service.dispose(); restored?.dispose(); }
  });
  it('keeps current edits if the replacement recovery snapshot cannot be written', async () => {
    const { service, drafts } = setup();
    try {
      await service.edit('formal original', 1); await service.saveToSiYuan();
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
      await service.edit('formal original', 1); await service.saveToSiYuan();
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
  it('resolves settings on the first explicit SiYuan save', async () => {
    const api = new FakeKernel(), drafts = new MemoryDrafts();
    let settings = { ...defaults, notebook: api.notebook, directory: '/Original' };
    const repo = new NoteRepository(api, () => settings);
    const service = new AutoSaveService(createNote(), repo, drafts, () => 800, () => {}, () => ({ width: 420, height: 320, pinned: false }));
    await service.edit('remember original', 1); settings = { ...settings, directory: '/Changed' };
    await service.saveToSiYuan(); expect(service.note.target?.path.startsWith('/Changed/')).toBe(true); service.dispose();
  });
  it('delays formal document creation until valid content and saves on explicit flush', async () => {
    const { service, api, drafts } = setup();
    await service.edit('  ', 1); await service.flush(); expect(api.docs.size).toBe(0);
    await service.edit('中文速记', 2); expect(api.docs.size).toBe(0); expect(drafts.values.size).toBe(1);
    expect(await service.saveToSiYuan()).toBe(true); expect(service.phase).toBe('saved'); expect(drafts.values.size).toBe(0); service.dispose();
  });
  it('debounces continuous input', async () => {
    vi.useFakeTimers(); const { service, api } = setup();
    await service.edit('initial', 1); await service.saveToSiYuan();
    await service.edit('a', 2); await vi.advanceTimersByTimeAsync(500); await service.edit('ab', 3);
    await vi.advanceTimersByTimeAsync(500); expect(service.note.savedRevision).toBe(1);
    await vi.advanceTimersByTimeAsync(300); expect(service.note.savedRevision).toBe(service.note.revision); expect(api.blocks.size).toBe(1); service.dispose();
  });
  it('ignores duplicate and stale edit revisions', async () => {
    const { service } = setup(); await service.edit('new', 2); await service.edit('old', 1); await service.edit('duplicate', 2);
    expect(service.note.text).toBe('new'); service.dispose();
  });
  it('resumes autosaving dirty content after an interrupted operation without another edit', async () => {
    vi.useFakeTimers(); const { service, api } = setup();
    await service.edit('initial', 1); await service.saveToSiYuan();
    await service.edit('pending before pause', 2); service.pause();
    await service.edit('latest collected text', 3, false);
    await vi.advanceTimersByTimeAsync(2000); expect(service.note.savedRevision).toBe(1);
    service.resume(); await vi.advanceTimersByTimeAsync(799); expect(service.note.savedRevision).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.note.savedRevision).toBe(3); expect(api.blocks.get(service.note.blockId)?.raw).toContain('latest collected text');
    service.dispose();
  });
  it('does not postpone an existing autosave when resuming a service that was not paused', async () => {
    vi.useFakeTimers(); const { service, api } = setup();
    await service.edit('initial', 1); await service.saveToSiYuan();
    await service.edit('still pending', 2); await vi.advanceTimersByTimeAsync(700);
    service.resume(); await vi.advanceTimersByTimeAsync(100);
    expect(service.note.savedRevision).toBe(service.note.revision); expect(api.blocks.size).toBe(1); service.dispose();
  });
  it('does not retry a conflict or a disposed service when resuming', async () => {
    vi.useFakeTimers(); const { service, repo } = setup();
    await service.edit('first', 1); await service.saveToSiYuan();
    const save = vi.spyOn(repo, 'save').mockRejectedValueOnce(new ConflictError('external edit'));
    await service.edit('local conflict', 2); await service.saveToSiYuan(); service.pause(); service.resume();
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
    await service.edit('first', 1); const saving = service.saveToSiYuan(); await started;
    await service.edit('second', 2); release(); await saving;
    expect(service.note.savedRevision).toBe(1); expect(service.note.text).toBe('second'); expect(service.phase).toBe('dirty');
    expect(drafts.values.get(service.note.id)?.note.text).toBe('second');
    await service.saveToSiYuan(); expect(service.note.savedRevision).toBe(2); service.dispose();
  });
  it('keeps a durable recovery draft on kernel failure and succeeds on retry', async () => {
    const { service, api, drafts } = setup(); api.fail = '/api/filetree/createDocWithMd';
    await service.edit('recover', 1); expect(await service.saveToSiYuan()).toBe(false); expect(service.phase).toBe('error');
    expect(await service.closeToDraft()).toBe(true); expect(drafts.values.get(service.note.id)?.note.text).toBe('recover');
    api.fail = undefined; expect(await service.saveToSiYuan()).toBe(true); expect(drafts.values.size).toBe(0); service.dispose();
  });
  it('prevents closing or submitting if the recovery draft cannot be written', async () => {
    const { service, drafts, api } = setup(); drafts.fail = true;
    await service.edit('do not lose', 1); expect(await service.closeToDraft()).toBe(false); expect(await service.saveToSiYuan()).toBe(false);
    expect(api.docs.size).toBe(0); expect(service.localRevision).toBe(-1); service.dispose();
  });
  it('keeps conflict latched while typing until explicit reload', async () => {
    const { service, repo } = setup(); await service.edit('first', 1); await service.saveToSiYuan();
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new ConflictError('external edit'));
    await service.edit('second', 2); await service.saveToSiYuan(); await service.edit('third', 3);
    expect(service.phase).toBe('conflict'); expect(await service.saveToSiYuan()).toBe(false);
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
    await service.edit('old', 1); const save = service.saveToSiYuan(); await started;
    await service.edit('latest', 2); expect(await service.closeToDraft()).toBe(true); service.dispose();
    release(); expect(await save).toBe(false);
    expect(drafts.values.get(service.note.id)?.note.text).toBe('latest');
    expect(service.note.savedRevision).toBe(0);
  });
});
