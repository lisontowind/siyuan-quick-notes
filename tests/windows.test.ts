import { describe, it, expect, vi } from 'vitest';
import { ElectronAdapter, type NativeWindow } from '../src/platform/desktop';
import { QuickNoteWindowManager } from '../src/core/windows';
import { createNote } from '../src/core/identity';
import { defaults } from '../src/core/settings';
import { NoteRepository } from '../src/services/repository';
import { FakeKernel } from './fake-kernel';
import type { LocalDraftStore } from '../src/platform/drafts';
import type { Draft, NoteRecord, Response, Settings, WindowRecoveryState } from '../src/types';

class FakeWindow implements NativeWindow {
  callbacks = new Map<string, (...args: any[]) => void>(); destroyed = false; pinned = false; shown = false;
  webContents = { on: vi.fn(), openDevTools: vi.fn() };
  constructor(public options: any = {}) { this.pinned = options.alwaysOnTop ?? false; }
  on(name: string, callback: (...args: any[]) => void) { this.callbacks.set(name, callback); }
  removeAllListeners() { this.callbacks.clear(); }
  async loadURL() {}
  show() { this.shown = true; } focus() {} restore() {} minimize() {} isMinimized() { return false; }
  isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.callbacks.get('closed')?.(); }
  setAlwaysOnTop(value: boolean) { this.pinned = value; } isAlwaysOnTop() { return this.pinned; }
  getBounds() { return { x: this.options.x ?? 100, y: this.options.y ?? 100, width: this.options.width ?? 420, height: this.options.height ?? 320 }; }
}
describe('native windows and ownership', () => {
  it('keeps dimensions stable over repeated restores and user resizing with Windows frame padding', async () => {
    class DecoratedWindow extends FakeWindow {
      getBounds() { const bounds = super.getBounds(); return { ...bounds, width: bounds.width + 4, height: bounds.height + 4 }; }
    }
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    const adapter = new ElectronAdapter({ BrowserWindow: DecoratedWindow, screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: area }), getAllDisplays: () => [{ workArea: area }] } });
    let geometry: import('../src/types').Geometry = { x: 200, y: 150, width: 420, height: 320, pinned: true };
    for (let index = 0; index < 3; index++) {
      const window = await adapter.create('http://localhost/plugins/window.html', geometry) as DecoratedWindow;
      geometry = adapter.geometry(window);
      expect(geometry).toEqual({ x: 200, y: 150, width: index === 0 ? 420 : 600, height: index === 0 ? 320 : 400, pinned: true, open: true });
      if (index === 0) {
        window.options.width = 600; window.options.height = 400;
        geometry = adapter.geometry(window);
        expect(geometry.width).toBe(600); expect(geometry.height).toBe(400);
      }
      window.destroy();
    }
  });
  it('creates a compact independent window with no renderer native privileges and clamps lost positions', async () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    const remote = { BrowserWindow: FakeWindow, screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: area }), getAllDisplays: () => [{ workArea: area }] } };
    const adapter = new ElectronAdapter(remote);
    const window = await adapter.create('http://localhost/plugins/window.html', { width: 420, height: 320, x: -5000, y: -5000, pinned: true }) as FakeWindow;
    expect(window.options.width).toBe(420); expect(window.options.height).toBe(320); expect(window.options.parent).toBeUndefined();
    expect(window.options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
    expect(window.options.x).toBeGreaterThanOrEqual(0); expect(window.options.y).toBeGreaterThanOrEqual(0); expect(window.pinned).toBe(true);
  });
  it('deduplicates concurrent opens, isolates five windows, and releases only plugin windows', async () => {
    vi.stubGlobal('document', { documentElement: { getAttribute: () => 'light' } });
    vi.stubGlobal('location', { origin: 'http://localhost:6806' });
    const created: FakeWindow[] = [], api = new FakeKernel();
    const drafts = { write: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]), saveWindowState: vi.fn().mockResolvedValue(undefined) } as unknown as LocalDraftStore;
    const adapter = { create: vi.fn(async () => { const win = new FakeWindow(); created.push(win); return win; }), geometry: (win: NativeWindow) => ({ ...win.getBounds(), pinned: win.isAlwaysOnTop(), open: true }), focus: (win: NativeWindow) => { win.show(); } };
    const manager = new QuickNoteWindowManager(adapter, new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), drafts, () => defaults, [], async () => {}, () => {}, () => {}, () => {});
    const peer = new BroadcastChannel(manager.channelName);
    peer.onmessage = event => {
      if (!event.data.collect) return;
      const note = manager.windows.get(event.data.windowId)?.service.note;
      if (note) peer.postMessage({ session: manager.session, windowId: note.id, requestId: event.data.requestId,
        action: 'collected', text: note.text, revision: note.revision });
    };
    try {
      const first = createNote(); await Promise.all([manager.open(first), manager.open(first)]);
      for (let i = 0; i < 4; i++) await manager.open(createNote());
      expect(manager.windows.size).toBe(5); expect(created).toHaveLength(5);
      const entries = [...manager.windows.values()];
      await Promise.all(entries.map((entry, i) => entry.service.edit(`independent ${i}`, 1)));
      await Promise.all(entries.map(entry => entry.service.flush()));
      expect(api.blocks.size).toBe(5); expect(new Set(entries.map(entry => entry.service.note.text)).size).toBe(5);
      created[0].setAlwaysOnTop(true); expect(created[1].isAlwaysOnTop()).toBe(false);
      created[0].destroy(); expect(manager.windows.size).toBe(4); expect(created.slice(1).every(win => !win.destroyed)).toBe(true);
    } finally { await manager.dispose(); peer.close(); vi.unstubAllGlobals(); }
    expect(created.every(win => win.destroyed)).toBe(true);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(settings: Settings = { ...defaults, debounceMs: 10000 }, initialDrafts: Draft[] = [], history: import('../src/core/windows').HistoryRecord[] = [], externalWindowCount = () => 0) {
  settings.notebook ||= '20261010000000-book001';
  vi.stubGlobal('document', { documentElement: { getAttribute: () => 'light' } });
  vi.stubGlobal('location', { origin: 'http://localhost:6806' });
  const values = new Map(initialDrafts.map(draft => [draft.note.id, structuredClone(draft)]));
  let geometries: Record<string, WindowRecoveryState> = Object.fromEntries(initialDrafts.filter(draft => draft.geometry).map(draft => [draft.note.id, draft.geometry!]));
  const writes = vi.fn(async (draft: Draft) => { values.set(draft.note.id, structuredClone(draft)); });
  const drafts = { write: writes, remove: vi.fn(async (id: string) => { values.delete(id); }), list: async () => [...values.values()],
    loadWindowState: async () => structuredClone(geometries), saveWindowState: vi.fn(async (value: Record<string, WindowRecoveryState>) => { geometries = structuredClone(value); }), warnings: [] } as unknown as LocalDraftStore;
  const api = new FakeKernel(), repo = new NoteRepository(api, () => settings), created: FakeWindow[] = [];
  const persistHistory = vi.fn().mockResolvedValue(undefined), report = vi.fn(), confirmDelete = vi.fn().mockResolvedValue(true);
  const create = vi.fn(async (_url: string, _geometry: import('../src/types').Geometry) => { const win = new FakeWindow(); created.push(win); return win; });
  const manager = new QuickNoteWindowManager({ create,
    geometry: () => ({ width: 420, height: 320, pinned: false, open: true }), focus() {} }, repo, drafts, () => settings, history, persistHistory, report, () => {}, () => {}, confirmDelete, externalWindowCount);
  const peer = new BroadcastChannel(manager.channelName), messages: Response[] = [];
  const snapshots = new Map<string, Pick<NoteRecord, 'text' | 'revision'>>();
  let acknowledge = true;
  peer.onmessage = event => {
    const response = event.data as Response; messages.push(response);
    if (response.collect && acknowledge) {
      const snapshot = snapshots.get(response.windowId) ?? manager.windows.get(response.windowId)?.service.note;
      if (snapshot) peer.postMessage({ session: manager.session, windowId: response.windowId, requestId: response.requestId,
        action: 'collected', text: snapshot.text, revision: snapshot.revision });
    }
  };
  const request = (id: string, action: string, extra = {}) => peer.postMessage({ session: manager.session, windowId: id,
    requestId: crypto.randomUUID(), action, ...extra });
  return { manager, repo, api, drafts, values, writes, created, create, persistHistory, messages, snapshots, request, report, confirmDelete,
    ignoreCollections: () => { acknowledge = false; },
    cleanup: async () => { await manager.dispose(); peer.close(); created.forEach(win => win.destroy()); vi.unstubAllGlobals(); } };
}

describe('durable window shutdown and independent input', () => {
  it('finishes shutdown within its deadline when native creation has not resolved', async () => {
    const h = harness(), note = createNote(), release = deferred(), realTimeout = globalThis.setTimeout;
    let opening: Promise<void> | undefined;
    try {
      h.create.mockImplementationOnce(async () => { await release.promise; const win = new FakeWindow(); h.created.push(win); return win; });
      opening = h.manager.open(note);
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: any[]) => void, delay?: number, ...args: any[]) =>
        realTimeout(callback, delay === 4000 ? 40 : delay, ...args)) as typeof setTimeout);
      const stopping = h.manager.dispose(); expect(h.manager.dispose()).toBe(stopping);
      const finished = await Promise.race([stopping.then(() => true), new Promise<boolean>(resolve => realTimeout(() => resolve(false), 100))]);
      expect(finished).toBe(true); expect(h.manager.windows.size).toBe(0);
      release.resolve(); await opening;
      expect(h.created[0].destroyed).toBe(true);
    } finally { release.resolve(); await opening; vi.restoreAllMocks(); await h.cleanup(); }
  });
  it('closes a confirmed durable window even if writing window metadata stalls', async () => {
    const h = harness(), note = createNote(), release = deferred(), realTimeout = globalThis.setTimeout;
    try {
      await h.manager.open(note); h.snapshots.set(note.id, { text: 'durable before update', revision: 1 });
      vi.mocked(h.drafts.saveWindowState).mockImplementation(async () => { await release.promise; });
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: any[]) => void, delay?: number, ...args: any[]) =>
        realTimeout(callback, delay === 4000 ? 40 : delay, ...args)) as typeof setTimeout);
      const finished = await Promise.race([h.manager.dispose().then(() => true), new Promise<boolean>(resolve => realTimeout(() => resolve(false), 100))]);
      expect(finished).toBe(true); expect(h.created[0].destroyed).toBe(true);
      expect(h.values.get(note.id)?.note.text).toBe('durable before update');
    } finally { release.resolve(); vi.restoreAllMocks(); await h.cleanup(); }
  });
  it('releases native close interception before host unload times out even if a draft write stalls', async () => {
    const h = harness(), note = createNote(), release = deferred(), realTimeout = globalThis.setTimeout;
    let stopping: Promise<void> | undefined;
    try {
      await h.manager.open(note); h.snapshots.set(note.id, { text: 'latest pending input', revision: 1 });
      h.writes.mockImplementation(async draft => { await release.promise; h.values.set(draft.note.id, structuredClone(draft)); });
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: any[]) => void, delay?: number, ...args: any[]) =>
        realTimeout(callback, delay === 4000 ? 40 : delay === 2500 ? 25 : delay, ...args)) as typeof setTimeout);
      stopping = h.manager.dispose();
      const finished = await Promise.race([stopping.then(() => true), new Promise<boolean>(resolve => realTimeout(() => resolve(false), 100))]);
      expect(finished).toBe(true);
      expect(h.created[0].destroyed).toBe(false);
      await vi.waitFor(() => expect(h.messages.some(item => item.stopped)).toBe(true));
      const preventDefault = vi.fn(); h.created[0].callbacks.get('close')!({ preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      release.resolve(); await vi.waitFor(() => expect(h.values.get(note.id)?.note.text).toBe('latest pending input'));
      expect(h.manager.windows.size).toBe(0);
    } finally { release.resolve(); vi.restoreAllMocks(); await stopping; await h.cleanup(); }
  });
  it('caps concurrent opens at the default ten and focuses a recent note when the shortcut reaches the cap', async () => {
    const h = harness();
    try {
      await Promise.all(Array.from({ length: 12 }, () => h.manager.open(createNote())));
      expect(h.manager.windows.size).toBe(10); expect(h.created).toHaveLength(10);
      expect(h.report).toHaveBeenCalledTimes(2);
      await h.manager.trigger(); expect(h.created).toHaveLength(10);
      expect(h.report).toHaveBeenCalledWith(expect.stringContaining('已唤醒最近窗口'));
    } finally { await h.cleanup(); }
  });
  it('applies a lower limit without closing existing windows and permits reopening after enough close', async () => {
    const settings = { ...defaults, debounceMs: 10000 }, h = harness(settings);
    try {
      const notes = Array.from({ length: 3 }, () => createNote());
      for (const note of notes) await h.manager.open(note);
      settings.maxWindows = 1; h.manager.refresh(); await h.manager.open(createNote());
      expect(h.manager.windows.size).toBe(3); expect(h.created.every(win => !win.destroyed)).toBe(true);
      for (const note of notes) h.request(note.id, 'close-draft');
      await vi.waitFor(() => expect(h.manager.windows.size).toBe(0));
      await h.manager.open(createNote()); await h.manager.open(createNote());
      expect(h.manager.windows.size).toBe(1); expect(h.created).toHaveLength(4);
    } finally { await h.cleanup(); }
  });
  it('limits automatic recovery to ten without removing unopened drafts', async () => {
    const notes = Array.from({ length: 12 }, (_, index) => ({ ...createNote(), text: `draft ${index}`, revision: 1, updatedAt: index + 1 }));
    const h = harness({ ...defaults, restoreWindows: true }, notes.map(note => ({ note,
      geometry: { width: 320, height: 320, pinned: false, open: true } })));
    try {
      await h.manager.initialize(); expect(h.manager.windows.size).toBe(10);
      expect([...h.manager.windows.keys()]).toEqual(notes.slice(2).reverse().map(note => note.id));
      expect(h.values.size).toBe(12);
    } finally { await h.cleanup(); }
  });
  it('includes fallback editors in the cap for native openings', async () => {
    const h = harness({ ...defaults, maxWindows: 1 }, [], [], () => 1);
    try {
      await h.manager.open(createNote()); await h.manager.trigger();
      expect(h.created).toHaveLength(0); expect(h.manager.windows.size).toBe(0);
      expect(h.report).toHaveBeenCalledWith('已达到窗口数量上限，请先关闭一个窗口');
    } finally { await h.cleanup(); }
  });
  it('does not create hidden copies at the window cap, and can copy after a slot is freed', async () => {
    const h = harness({ ...defaults, maxWindows: 5, debounceMs: 10000 }), notes = Array.from({ length: 5 }, () => createNote());
    try {
      for (const note of notes) await h.manager.open(note);
      await h.manager.windows.get(notes[0].id)!.service.edit('copy me', 1, false);
      const ids = [...h.values.keys()];
      for (let attempt = 1; attempt <= 2; attempt++) {
        h.request(notes[0].id, 'copy-note');
        await vi.waitFor(() => expect(h.report).toHaveBeenCalledTimes(attempt));
      }
      expect([...h.values.keys()]).toEqual(ids); expect(h.created).toHaveLength(5);
      h.request(notes[4].id, 'close-draft');
      await vi.waitFor(() => expect(h.manager.windows.size).toBe(4));
      h.request(notes[0].id, 'copy-note');
      await vi.waitFor(() => expect(h.created).toHaveLength(6));
      const copy = [...h.manager.windows.values()].find(entry => !notes.some(note => note.id === entry.service.note.id))!;
      expect(copy.service.note.text).toBe('copy me');
      expect(copy.service.note.blockId).not.toBe(notes[0].blockId);
      expect(h.values.get(copy.service.note.id)?.note.text).toBe('copy me');
    } finally { await h.cleanup(); }
  });
  it('reserves a copy slot before a slow disk write so another open cannot exceed the cap', async () => {
    const h = harness({ ...defaults, maxWindows: 5, debounceMs: 10000 }), notes = Array.from({ length: 4 }, () => createNote()), blocked = deferred();
    try {
      for (const note of notes) await h.manager.open(note);
      await h.manager.windows.get(notes[0].id)!.service.edit('durable copy', 1, false);
      const write = h.writes.getMockImplementation()!;
      h.writes.mockImplementationOnce(async draft => { await blocked.promise; await write(draft); });
      h.request(notes[0].id, 'copy-note');
      await vi.waitFor(() => expect(h.manager.windows.size).toBe(5));
      expect(h.created).toHaveLength(4);
      await h.manager.open(createNote()); expect(h.created).toHaveLength(4);
      blocked.resolve(); await vi.waitFor(() => expect(h.created).toHaveLength(5));
      expect(h.manager.windows.size).toBe(5); expect(h.values.size).toBe(2);
    } finally { blocked.resolve(); await h.cleanup(); }
  });
  it('retains the source and releases the slot when copying cannot persist its recovery draft', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); await h.manager.windows.get(note.id)!.service.edit('keep source', 1, false);
      h.writes.mockRejectedValueOnce(new Error('disk full')); h.request(note.id, 'copy-note');
      await vi.waitFor(() => expect(h.report).toHaveBeenCalledWith(expect.stringContaining('副本草稿未确认落盘')));
      expect(h.manager.windows.size).toBe(1); expect(h.created).toHaveLength(1);
      expect(h.values.size).toBe(1); expect(h.values.get(note.id)?.note.text).toBe('keep source');
    } finally { await h.cleanup(); }
  });
  it('always creates with the plus button while the shortcut still focuses the recent window', async () => {
    const h = harness({ ...defaults, shortcutBehavior: 'recent', debounceMs: 10000 }), note = createNote();
    try {
      await h.manager.open(note); await h.manager.trigger();
      expect(h.manager.windows.size).toBe(1);
      h.request(note.id, 'new'); await vi.waitFor(() => expect(h.manager.windows.size).toBe(2));
      expect(h.created).toHaveLength(2);
    } finally { await h.cleanup(); }
  });
  it('publishes the first nonblank content line as the window title', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); h.request(note.id, 'edit', { text: '\n  标题摘要  \n正文', revision: 1 });
      await vi.waitFor(() => expect(h.messages.some(response => response.state?.title === '标题摘要')).toBe(true));
    } finally { await h.cleanup(); }
  });
  it('restores saved open windows independently of a history limit of one, reading current kernel content', async () => {
    const h = harness({ ...defaults, restoreWindows: true, historyLimit: 1, debounceMs: 10000 });
    const notes = [createNote(), createNote()];
    let restored: QuickNoteWindowManager | undefined, peer: BroadcastChannel | undefined;
    try {
      for (const [index, note] of notes.entries()) {
        await h.manager.open(note); const service = h.manager.windows.get(note.id)!.service;
        await service.edit(`saved ${index}`, 1); await service.flush();
      }
      expect(h.manager.history).toHaveLength(1); expect(h.values.size).toBe(0);
      await h.manager.dispose();
      const states = await h.drafts.loadWindowState();
      expect(states[notes[0].id].note?.blockId).toBe(notes[0].blockId);
      expect(JSON.stringify(states)).not.toMatch(/saved 0|baseline|revision/);
      const prior = h.api.blocks.get(notes[0].blockId)!;
      prior.raw = prior.raw.replace('saved 0', 'external latest');
      restored = new QuickNoteWindowManager({ create: async () => new FakeWindow(),
        geometry: () => ({ width: 320, height: 320, pinned: false, open: true }), focus() {} },
        h.repo, h.drafts, () => ({ ...defaults, restoreWindows: true }), h.manager.history, async () => {}, h.report, () => {}, () => {});
      const manager = restored;
      peer = new BroadcastChannel(manager.channelName);
      peer.onmessage = event => {
        if (!event.data.collect) return;
        const note = manager.windows.get(event.data.windowId)?.service.note;
        if (note) peer!.postMessage({ session: manager.session, windowId: note.id, requestId: event.data.requestId,
          action: 'collected', text: note.text, revision: note.revision });
      };
      await manager.initialize(); expect(manager.windows.size).toBe(2);
      expect(manager.windows.get(notes[0].id)?.service.note.text).toBe('external latest');
    } finally { await restored?.dispose(); peer?.close(); await h.cleanup(); }
  });
  it('cancels deletion without touching saved content, draft or window', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); const service = h.manager.windows.get(note.id)!.service;
      await service.edit('saved', 1); await service.flush(); await service.edit('draft', 2);
      h.confirmDelete.mockResolvedValue(false);
      expect(await h.manager.deleteNote(service.note)).toBe(false);
      expect(h.api.blocks.has(note.blockId)).toBe(true); expect(h.values.get(note.id)?.note.text).toBe('draft');
      expect(h.created[0].destroyed).toBe(false);
    } finally { await h.cleanup(); }
  });
  it('deletes an open note and its history/draft only after collecting and finishing a stalled save', async () => {
    const h = harness(), note = createNote(), started = deferred(), release = deferred();
    try {
      await h.manager.open(note); const service = h.manager.windows.get(note.id)!.service;
      await service.edit('first', 1); await service.flush(); await service.edit('second', 2);
      const save = h.repo.save.bind(h.repo);
      vi.spyOn(h.repo, 'save').mockImplementationOnce(async (...args) => { started.resolve(); await release.promise; await save(...args); });
      const saving = service.flush(); await started.promise;
      const deleting = h.manager.deleteNote(service.note);
      await vi.waitFor(() => expect(h.messages.some(item => item.collect)).toBe(true));
      expect(h.api.blocks.has(note.blockId)).toBe(true); release.resolve(); await saving;
      expect(await deleting).toBe(true);
      expect(h.api.blocks.has(note.blockId)).toBe(false); expect(h.values.has(note.id)).toBe(false);
      expect(h.manager.history).toHaveLength(0); expect(h.created[0].destroyed).toBe(true);
      expect((await h.drafts.loadWindowState())[note.id]).toBeUndefined();
      await service.flush(); expect(h.api.blocks.has(note.blockId)).toBe(false);
    } finally { release.resolve(); await h.cleanup(); }
  });
  it('preserves the window, draft and recent entry when kernel deletion fails', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); const service = h.manager.windows.get(note.id)!.service;
      await service.edit('saved', 1); await service.flush(); await service.edit('unsaved', 2);
      h.api.fail = '/api/block/deleteBlock';
      await expect(h.manager.deleteNote(service.note)).rejects.toThrow('offline');
      expect(h.api.blocks.has(note.blockId)).toBe(true); expect(h.values.get(note.id)?.note.text).toBe('unsaved');
      expect(h.manager.history).toHaveLength(1); expect(h.created[0].destroyed).toBe(false);
      await vi.waitFor(() => expect(h.messages.some(item => item.resume)).toBe(true));
    } finally { await h.cleanup(); }
  });
  it('deletes a closed recovery-only draft without creating a document', async () => {
    const note = { ...createNote(), text: 'draft only', revision: 1 }, h = harness(undefined, [{ note }]);
    try {
      expect(await h.manager.deleteNote(note)).toBe(true);
      expect(h.values.has(note.id)).toBe(false); expect(h.api.docs.size).toBe(0);
    } finally { await h.cleanup(); }
  });
  it('keeps the latest renderer snapshot when shutdown interrupts a stalled save; heartbeat bypasses the save', async () => {
    const h = harness(), note = createNote(), started = deferred(), release = deferred();
    try {
      await h.manager.open(note); const service = h.manager.windows.get(note.id)!.service;
      await service.edit('before', 1); await service.flush();
      vi.spyOn(h.repo, 'save').mockImplementationOnce(async snapshot => { started.resolve(); await release.promise; snapshot.baseline = 'late response'; });
      h.request(note.id, 'edit', { text: 'saving old', revision: 2 });
      await vi.waitFor(() => expect(service.note.revision).toBe(2));
      h.request(note.id, 'save'); await started.promise;
      h.request(note.id, 'edit', { text: 'latest delivered', revision: 3 });
      h.request(note.id, 'heartbeat');
      await vi.waitFor(() => {
        expect(service.note.text).toBe('latest delivered');
        expect(h.messages.some(item => item.heartbeat)).toBe(true);
      });
      const heartbeat = h.messages.find(item => item.heartbeat)!;
      expect(heartbeat.state).toBeUndefined(); expect(heartbeat.content).toBeUndefined();
      expect(JSON.stringify(heartbeat)).not.toMatch(/latest delivered|baseline/);
      h.snapshots.set(note.id, { text: 'latest still in renderer', revision: 4 });
      await h.manager.dispose();
      expect(h.created[0].destroyed).toBe(true);
      expect(h.values.get(note.id)?.note.text).toBe('latest still in renderer');
      release.resolve(); await vi.waitFor(() => expect(service.note.savedRevision).toBe(1));
      expect(h.values.get(note.id)?.note.text).toBe('latest still in renderer');
    } finally { release.resolve(); await h.cleanup(); }
  });
  it('does not destroy a window when the collected text cannot be written to disk', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); await h.manager.windows.get(note.id)!.service.edit('keep me', 1);
      h.writes.mockRejectedValue(new Error('disk full'));
      h.snapshots.set(note.id, { text: 'newest', revision: 2 }); h.request(note.id, 'close-draft');
      await vi.waitFor(() => expect(h.messages.some(item => item.resume)).toBe(true));
      expect(h.created[0].destroyed).toBe(false);
      expect(h.manager.windows.get(note.id)!.service.error).toContain('disk full');
      await h.manager.dispose();
      expect(h.created[0].destroyed).toBe(false);
      await vi.waitFor(() => expect(h.messages.some(item => item.stopped?.includes('未确认落盘'))).toBe(true));
      expect(h.report).toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
  it('autosaves after a failed draft close once disk writes recover, without further typing', async () => {
    const h = harness({ ...defaults, debounceMs: 100 }), note = createNote();
    try {
      await h.manager.open(note);
      h.writes.mockRejectedValue(new Error('temporary disk failure'));
      h.snapshots.set(note.id, { text: 'latest collected input', revision: 1 });
      h.request(note.id, 'close-draft');
      await vi.waitFor(() => expect(h.messages.some(item => item.resume)).toBe(true));
      expect(h.created[0].destroyed).toBe(false);
      h.writes.mockImplementation(async draft => { h.values.set(draft.note.id, structuredClone(draft)); });
      await vi.waitFor(() => expect(h.manager.windows.get(note.id)?.service.note.savedRevision).toBe(1));
      expect(h.api.blocks.get(note.blockId)?.raw).toContain('latest collected input');
      expect(h.values.has(note.id)).toBe(false);
    } finally { await h.cleanup(); }
  });
  it('collects unsent input before normal close and saves that exact content', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); h.snapshots.set(note.id, { text: 'unsent 中文', revision: 1 });
      h.request(note.id, 'close');
      await vi.waitFor(() => expect(h.created[0].destroyed).toBe(true));
      expect(h.api.blocks.get(note.blockId)?.raw).toContain('unsent 中文');
      expect(h.values.has(note.id)).toBe(false);
    } finally { await h.cleanup(); }
  });
  it('closes normally after a kernel failure while retaining the collected draft', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note);
      vi.spyOn(h.repo, 'save').mockRejectedValue(new Error('kernel unavailable'));
      h.snapshots.set(note.id, { text: 'latest unsent input', revision: 1 });
      h.request(note.id, 'close');
      await vi.waitFor(() => expect(h.created[0].destroyed).toBe(true));
      expect(h.values.get(note.id)?.note.text).toBe('latest unsent input');
      expect(h.values.get(note.id)?.note.savedRevision).toBe(0);
      expect(h.report).toHaveBeenCalledWith(expect.stringContaining('已保留本机草稿'));
      expect(h.manager.windows.has(note.id)).toBe(false);
    } finally { await h.cleanup(); }
  });
  it('still refuses normal close if draft persistence fails after the kernel attempt', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note);
      vi.spyOn(h.repo, 'save').mockImplementation(async () => {
        h.writes.mockRejectedValue(new Error('disk full'));
        throw new Error('kernel unavailable');
      });
      h.snapshots.set(note.id, { text: 'keep in window', revision: 1 });
      h.request(note.id, 'close');
      await vi.waitFor(() => expect(h.messages.some(item => item.resume)).toBe(true));
      expect(h.created[0].destroyed).toBe(false);
      expect(h.manager.windows.get(note.id)?.service.error).toContain('disk full');
    } finally { await h.cleanup(); }
  });
  it('retains the window when the renderer never acknowledges shutdown', async () => {
    const h = harness(), note = createNote();
    const realTimeout = globalThis.setTimeout;
    try {
      await h.manager.open(note); h.ignoreCollections();
      // Exercise the real timeout branch without waiting five seconds in the test suite.
      const timeout = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: any[]) => void, delay?: number, ...args: any[]) =>
        realTimeout(callback, delay === 2500 ? 20 : delay, ...args)) as typeof setTimeout);
      await h.manager.dispose(); timeout.mockRestore();
      expect(h.created[0].destroyed).toBe(false);
      expect(h.report).toHaveBeenCalledWith(expect.stringContaining('未确认落盘'));
    } finally { vi.restoreAllMocks(); await h.cleanup(); }
  });
  it('rejects forged collection tokens rather than closing on unconfirmed content', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); h.ignoreCollections(); h.request(note.id, 'close-draft');
      await vi.waitFor(() => expect(h.messages.some(item => item.collect)).toBe(true));
      const collection = h.messages.find(item => item.collect)!;
      h.request(note.id, 'collected', { requestId: 'wrong-token', text: 'wrong', revision: 1 });
      h.request(note.id, 'heartbeat'); await vi.waitFor(() => expect(h.messages.some(item => item.heartbeat)).toBe(true));
      expect(h.created[0].destroyed).toBe(false);
      h.request(note.id, 'collected', { requestId: collection.requestId, text: 'confirmed', revision: 1 });
      await vi.waitFor(() => expect(h.created[0].destroyed).toBe(true));
      expect(h.values.get(note.id)?.note.text).toBe('confirmed');
    } finally { await h.cleanup(); }
  });
  it('records history only for confirmed saves and never sends full content in ordinary status', async () => {
    const h = harness(), note = createNote();
    try {
      await h.manager.open(note); const service = h.manager.windows.get(note.id)!.service;
      await service.edit('first title\nbody', 1); await service.flush();
      await vi.waitFor(() => expect(h.persistHistory).toHaveBeenCalledTimes(1));
      for (let revision = 2; revision <= 5; revision++) await service.edit(`unsaved ${revision}`, revision);
      expect(h.persistHistory).toHaveBeenCalledTimes(1);
      await service.flush(); await vi.waitFor(() => expect(h.persistHistory).toHaveBeenCalledTimes(2));
      expect(h.manager.history[0].summary).toBe('unsaved 5');
      h.request(note.id, 'ready'); await vi.waitFor(() => expect(h.messages.some(item => item.content)).toBe(true));
      expect(h.messages.filter(item => item.state && !item.content).every(item => !JSON.stringify(item).includes('baseline'))).toBe(true);
      expect(h.messages.find(item => item.content)?.content?.text).toBe('unsaved 5');
    } finally { await h.cleanup(); }
  });
  it('limits recent records without removing saved documents or recovery drafts', async () => {
    const settings = { ...defaults, historyLimit: 2 };
    const draft = { note: { ...createNote(), text: 'recovery only', revision: 1 } };
    const h = harness(settings, [draft]);
    try {
      const notes = Array.from({ length: 3 }, () => createNote());
      for (const [index, note] of notes.entries()) {
        await h.manager.open(note);
        const service = h.manager.windows.get(note.id)!.service;
        await service.edit(`saved ${index}`, 1); await service.flush();
      }
      expect(h.manager.history.map(record => record.id)).toEqual([notes[2].id, notes[1].id]);
      expect(h.api.blocks.size).toBe(3);
      expect(h.values.get(draft.note.id)?.note.text).toBe('recovery only');
      settings.historyLimit = 1;
      const service = h.manager.windows.get(notes[0].id)!.service;
      await service.edit('old note edited again', 2); await service.flush();
      expect(h.manager.history.map(record => record.id)).toEqual([notes[0].id]);
      expect(h.api.blocks.size).toBe(3);
      expect(h.values.has(draft.note.id)).toBe(true);
    } finally { await h.cleanup(); }
  });
  it('restores unsaved drafts absent from history and deduplicates saved entries within the window limit', async () => {
    const notes = Array.from({ length: 7 }, (_, index) => ({ ...createNote(), text: `draft ${index}`, revision: 1, updatedAt: index + 1 }));
    const drafts = notes.map(note => ({ note, geometry: { width: 420, height: 320, pinned: false, open: true } }));
    const history = [{ ...notes[6], docId: '20261010000000-doc0001' }];
    const h = harness({ ...defaults, restoreWindows: true, maxWindows: 5 }, drafts, history);
    try {
      await h.manager.initialize(); expect(h.manager.windows.size).toBe(5); expect(h.created).toHaveLength(5);
      expect([...h.manager.windows.keys()]).toEqual(notes.slice(2).reverse().map(note => note.id));
      expect(h.manager.windows.get(notes[6].id)?.service.note.text).toBe('draft 6');
    } finally { await h.cleanup(); }
  });
  it('uses the newest window geometry instead of the older draft geometry during recovery', async () => {
    const note = { ...createNote(), text: 'recover me', revision: 1 };
    const old = { x: 100, y: 100, width: 420, height: 320, pinned: false, open: true };
    const latest = { x: 900, y: 250, width: 600, height: 450, pinned: true, open: true };
    const h = harness({ ...defaults, restoreWindows: true }, [{ note, geometry: old }]);
    try {
      const reference = { id: note.id, blockId: note.blockId, docId: '20261010000000-doc0001', createdAt: note.createdAt, updatedAt: note.updatedAt };
      await h.drafts.saveWindowState({ [note.id]: { ...latest, note: reference } });
      await h.manager.initialize();
      expect(h.create).toHaveBeenCalledWith(expect.any(String), latest);
      expect(h.create.mock.calls[0][1]).not.toHaveProperty('note');
      expect(h.manager.windows.get(note.id)?.service.note.text).toBe('recover me');
    } finally { await h.cleanup(); }
  });
  it('fills recovery slots after an earlier saved note cannot be reopened', async () => {
    const valid = Array.from({ length: 5 }, (_, index) => ({ ...createNote(), text: `draft ${index}`, revision: 1, updatedAt: index + 1 }));
    const missing = { ...createNote(), docId: '20261010000000-doc0001', updatedAt: 100 };
    const geometry = { width: 420, height: 320, pinned: false, open: true };
    const h = harness({ ...defaults, restoreWindows: true, maxWindows: 5 }, valid.map(note => ({ note, geometry })), [missing]);
    try {
      await h.drafts.saveWindowState(Object.fromEntries([...valid, missing].map(note => [note.id, geometry])));
      await h.manager.initialize();
      expect(h.manager.windows.size).toBe(5);
      expect(h.manager.windows.has(valid[0].id)).toBe(true);
      expect(h.report).toHaveBeenCalledWith(expect.stringContaining('恢复窗口失败'));
    } finally { await h.cleanup(); }
  });
  it.each([true, false])('uses draft geometry only as a fallback and respects rememberPosition=%s', async rememberPosition => {
    const note = { ...createNote(), text: 'draft fallback', revision: 1 };
    const geometry = { x: 800, y: 200, width: 700, height: 500, pinned: true, open: true };
    const h = harness({ ...defaults, restoreWindows: true, rememberPosition }, [{ note, geometry }]);
    try {
      await h.drafts.saveWindowState({});
      await h.manager.initialize();
      expect(h.create.mock.calls[0][1]).toEqual(rememberPosition ? geometry : {
        width: defaults.width, height: defaults.height, pinned: defaults.alwaysOnTop, open: true,
      });
    } finally { await h.cleanup(); }
  });
});
