import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
const host = vi.hoisted(() => ({ panels: [] as any[], dialogs: [] as any[], showMessage: vi.fn(), frontend: 'desktop', backend: 'windows' }));
vi.mock('siyuan', () => ({
  Plugin: class { saveData = vi.fn(); loadData = vi.fn(); name = 'siyuan-quick-notes'; commands: any[] = []; app = {};
    addCommand(command: any) { this.commands.push(command); } addTopBar = vi.fn(); },
  Setting: class { items: any[] = []; constructor(public options: any) { host.panels.push(this); } addItem(item: any) { this.items.push(item); } open() {} },
  Dialog: class {
    elements = new Map<string, Element>();
    element = { querySelector: (selector: string) => {
      if (!this.elements.has(selector)) this.elements.set(selector, new Element()); return this.elements.get(selector)!;
    }, querySelectorAll: () => [] };
    constructor(public options: any) { host.dialogs.push(this); }
    destroy = vi.fn(() => this.options.destroyCallback?.());
  },
  Menu: class {}, getFrontend: () => host.frontend, getBackend: () => host.backend, showMessage: host.showMessage,
  openTab: vi.fn(), openWindow: vi.fn(), openSetting: vi.fn(), confirm: vi.fn(),
}));
import QuickNotesPlugin from '../src/index';
import { openTab, openWindow } from 'siyuan';
import { AutoSaveService } from '../src/services/autosave';
import { NoteRepository } from '../src/services/repository';
import { defaults } from '../src/core/settings';
import { createNote } from '../src/core/identity';
import { FakeKernel } from './fake-kernel';
import { SharedDraftStore } from '../src/platform/shared-drafts';
import { SharedNoteStore } from '../src/platform/shared-notes';
import { LocalDraftStore } from '../src/platform/drafts';
import type { Draft, DraftStore } from '../src/types';

class Element {
  type = ''; value = ''; checked = false; textContent = ''; className = ''; children: any[] = []; onclick?: () => void;
  dataset: Record<string, string> = {}; classList = { add() {} }; listeners = new Map<string, () => void>();
  setAttribute() {} append(...children: any[]) { this.children.push(...children); } add() {}
  before(..._children: any[]) {}
  after(..._children: any[]) {}
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
}
class Input extends Element {}
class MemoryDrafts implements DraftStore {
  async write(_draft: Draft) {} async remove(_id: string) {} async list() { return []; }
}
beforeEach(() => {
  host.panels.length = 0; host.dialogs.length = 0; host.showMessage.mockClear();
  host.frontend = 'desktop'; host.backend = 'windows';
  vi.stubGlobal('document', { createElementNS: () => new Element(), createElement: (tag: string) => tag === 'input' ? new Input() : new Element(), documentElement: { getAttribute: () => 'light' } });
  vi.stubGlobal('HTMLInputElement', Input); vi.stubGlobal('Option', class {});
  vi.stubGlobal('location', { origin: 'http://localhost:16818' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  const plugin = new QuickNotesPlugin({ name: 'siyuan-quick-notes', app: {} } as any) as any, api = new FakeKernel();
  plugin.settingsValue = { ...defaults, notebook: api.notebook, directory: '/Original', trayEnabled: false };
  plugin.repository = new NoteRepository(api, () => plugin.settingsValue);
  return { plugin, api };
}
function commit(panel: any, directoryValue: string) {
  const directory = panel.items.find((item: any) => item.title === '保存目录（支持模板变量）').actionElement;
  directory.value = directoryValue; directory.listeners.get('input')(); panel.options.confirmCallback();
}
describe('plugin settings and stored history integration', () => {
  it('only copies foreign drafts to a fresh local identity, preserving the source and avoiding duplicate copies on retry', async () => {
    const { plugin, api } = setup(), root = await fs.mkdtemp(path.join(tmpdir(), 'sqn-choices-')), device = crypto.randomUUID();
    try {
      plugin.sharedDrafts = new SharedDraftStore(fs, path, path.join(root, 'shared', 'drafts'), device);
      plugin.drafts = new LocalDraftStore(fs, path, path.join(root, 'drafts', device), plugin.sharedDrafts);
      const remote = new LocalDraftStore(fs, path, path.join(root, 'drafts', crypto.randomUUID()));
      const original = { ...createNote(), text: 'foreign pending body', caption: '外机便签标题', calloutType: 'CAUTION' as const, revision: 2, savedRevision: 1, siyuanSaved: true,
        docId: '20261010000000-doc0001', baseline: 'original', target: { notebook: api.notebook, path: '/Foreign' } };
      await remote.write({ note: original, geometry: { width: 800, height: 600, pinned: true, open: true } });
      const source = await fs.readFile(path.join(remote.directory, `${original.id}.json`), 'utf8');
      plugin.manager = { windows: new Map(), open: vi.fn().mockRejectedValueOnce(new Error('window failed')).mockResolvedValue(undefined) };
      expect(await plugin.drafts.list()).toEqual([]);
      const data = await plugin.draftVersions(), selected = data.versions[0];
      await expect(plugin.chooseDraftVersion(undefined, selected.version, data.token, false)).rejects.toThrow('仅供查看');
      await expect(plugin.chooseDraftVersion(undefined, selected.version, 'forged', true)).rejects.toThrow('版本已变化');
      await expect(plugin.chooseDraftVersion(original.id, selected.version, data.token, true)).rejects.toThrow('版本已变化');
      await expect(plugin.chooseDraftVersion(undefined, selected.version, data.token, true)).rejects.toThrow('window failed');
      await plugin.chooseDraftVersion(undefined, selected.version, data.token, true);
      await expect(plugin.chooseDraftVersion(undefined, crypto.randomUUID(), data.token, true)).rejects.toThrow('版本已变化');
      const drafts = await plugin.drafts.list(); expect(drafts).toHaveLength(1);
      const copied = drafts[0]; expect(copied.note.text).toBe(original.text); expect(copied.note.caption).toBe(original.caption); expect(copied.note.calloutType).toBe(original.calloutType);
      expect(copied.note.id).not.toBe(original.id); expect(copied.note.blockId).not.toBe(original.blockId);
      expect(copied.note).toMatchObject({ siyuanSaved: false, savedRevision: 0, revision: 1 });
      for (const field of ['docId', 'target', 'baseline', 'draftSync']) expect(copied.note[field]).toBeUndefined();
      expect(copied.geometry).toBeUndefined(); expect(plugin.manager.open).toHaveBeenLastCalledWith(copied.note);
      expect(await fs.readFile(path.join(remote.directory, `${original.id}.json`), 'utf8')).toBe(source);
      expect(api.calls).toEqual([]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it.each(['changed', 'removed'])('rejects stale foreign draft previews when the source is %s', async change => {
    const { plugin } = setup(), root = await fs.mkdtemp(path.join(tmpdir(), 'sqn-stale-'));
    try {
      plugin.drafts = new LocalDraftStore(fs, path, path.join(root, 'drafts', crypto.randomUUID()));
      const remote = new LocalDraftStore(fs, path, path.join(root, 'drafts', crypto.randomUUID()));
      const original = { ...createNote(), text: 'before', revision: 1 }; await remote.write({ note: original });
      plugin.manager = { windows: new Map(), open: vi.fn() };
      const data = await plugin.draftVersions();
      if (change === 'changed') await remote.write({ note: { ...original, text: 'after', revision: 2 } }); else await remote.remove(original.id);
      await expect(plugin.chooseDraftVersion(undefined, data.versions[0].version, data.token, true)).rejects.toThrow('版本已变化');
      expect(await plugin.drafts.list()).toEqual([]); expect(plugin.manager.open).not.toHaveBeenCalled();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it.each([[0, 'restore'], [1, 'delete'], [2, 'cancel']] as const)('offers a parented native deletion dialog and maps button %i to %s', async (response, choice) => {
    const { plugin } = setup(), parent = { id: 'recent' };
    const showMessageBox = vi.fn().mockResolvedValue({ response });
    plugin.remote = { dialog: { showMessageBox } }; plugin.recentWindow = { nativeWindow: parent };
    expect(await plugin.chooseMissingSource(createNote())).toBe(choice);
    expect(showMessageBox).toHaveBeenCalledWith(parent, expect.objectContaining({
      message: '思源中已删除，是否删除便签或恢复到思源？', buttons: ['恢复到思源', '删除便签', '取消'], defaultId: 2, cancelId: 2,
    }));
  });
  it('restores a deleted original from the list using the full plugin copy after all editors closed', async () => {
    const { plugin, api } = setup(), note = { ...createNote(), text: 'full local copy\n\nnot just summary', revision: 1 };
    const values = new Map<string, Draft>([[note.id, { note }]]), backups = new Map<string, Draft>();
    plugin.drafts = { list: async () => [...values.values()], write: async (draft: Draft) => { values.set(draft.note.id, structuredClone(draft)); },
      remove: async (id: string) => { values.delete(id); }, backup: async (draft: Draft) => { backups.set(draft.note.id, structuredClone(draft)); }, readBackup: async (id: string) => backups.get(id) };
    plugin.saveData.mockResolvedValue({ code: 0 });
    await plugin.siYuanRecent(note.id); expect(values.size).toBe(0); expect(backups.size).toBe(1);
    api.blocks.delete(note.blockId); api.docs.clear(); plugin.chooseMissingSource = vi.fn().mockResolvedValue('restore');
    await plugin.siYuanRecent(note.id);
    expect(plugin.chooseMissingSource).toHaveBeenCalledOnce(); expect(api.blocks.get(note.blockId)?.raw).toContain('not just summary');
    await plugin.historyWrites.run('history', async () => {});
  });
  it('does not recover from a summary when an old saved note has no local body copy', async () => {
    const { plugin } = setup(), item = { ...createNote(), docId: '20261010000000-doc0001', siyuanSaved: true, summary: 'only summary' };
    plugin.drafts = { list: async () => [] }; plugin.historyValue = [item]; plugin.chooseMissingSource = vi.fn().mockResolvedValue('restore');
    await expect(plugin.siYuanRecent(item.id)).rejects.toThrow('没有可用的插件正文副本');
  });
  it('removes blank fallback notes on close without creating a document', async () => {
    const { plugin, api } = setup(), values = new Map<string, Draft>();
    plugin.drafts = { write: async (draft: Draft) => { values.set(draft.note.id, structuredClone(draft)); }, remove: async (id: string) => { values.delete(id); },
      list: async () => [...values.values()], loadWindowState: async () => ({}), saveWindowState: vi.fn().mockResolvedValue(undefined) };
    plugin.fallback(); const dialog = host.dialogs.at(-1), entry = [...plugin.fallbackServices.values()][0] as any;
    const keep = dialog.element.querySelector('[data-keep-draft]');
    entry.input.value = ' \n\t'; const id = entry.service.note.id;
    keep.onclick(); await vi.waitFor(() => expect(dialog.destroy).toHaveBeenCalled());
    expect(values.has(id)).toBe(false); expect(api.calls).toEqual([]); expect(plugin.fallbackServices.size).toBe(0);
  });
  it('saves a closed plugin note from the list without opening an editor and opens SiYuan only on the next click', async () => {
    const { plugin, api } = setup(), note = { ...createNote(), text: 'closed plugin content', revision: 1 };
    const values = new Map<string, Draft>([[note.id, { note }]]);
    plugin.drafts = { list: async () => [...values.values()], write: async (draft: Draft) => { values.set(draft.note.id, structuredClone(draft)); }, remove: async (id: string) => { values.delete(id); } };
    plugin.saveData.mockResolvedValue({ code: 0 }); vi.mocked(openTab).mockClear();
    plugin.manager = { windows: new Map(), open: vi.fn() };
    await plugin.siYuanRecent(note.id);
    expect(plugin.manager.open).not.toHaveBeenCalled(); expect(openTab).not.toHaveBeenCalled();
    expect(api.blocks.get(note.blockId)?.raw).toContain('closed plugin content'); expect(values.has(note.id)).toBe(false);
    expect(plugin.historyValue[0]).toMatchObject({ id: note.id, siyuanSaved: true });
    await plugin.siYuanRecent(note.id); expect(openTab).toHaveBeenCalledOnce(); expect(api.docs.size).toBe(1);
    await plugin.historyWrites.run('history', async () => {});
  });
  it('preserves closed plugin notes and a save action after a failed first SiYuan write', async () => {
    const { plugin, api } = setup(), note = { ...createNote(), text: 'retain on failure', revision: 1 };
    const values = new Map<string, Draft>([[note.id, { note }]]);
    plugin.drafts = { list: async () => [...values.values()], write: async (draft: Draft) => { values.set(draft.note.id, structuredClone(draft)); }, remove: async (id: string) => { values.delete(id); } };
    plugin.saveData.mockResolvedValue({ code: 0 }); api.fail = '/api/block/appendBlock';
    await expect(plugin.siYuanRecent(note.id)).rejects.toThrow();
    expect(values.get(note.id)?.note).toMatchObject({ text: note.text, siyuanSaved: false }); expect(plugin.historyValue).toEqual([]);
    api.fail = undefined; await plugin.siYuanRecent(note.id);
    expect(api.docs.size).toBe(1); expect(plugin.historyValue[0].siyuanSaved).toBe(true);
    await plugin.historyWrites.run('history', async () => {});
  });
  it('routes a list SiYuan action through an already open native editor', async () => {
    const { plugin } = setup(), note = createNote();
    plugin.drafts = new MemoryDrafts();
    plugin.manager = { windows: new Map([[note.id, {}]]), siYuan: vi.fn().mockResolvedValue(undefined) };
    await plugin.siYuanRecent(note.id); expect(plugin.manager.siYuan).toHaveBeenCalledWith(note.id);
  });
  it('uses the same save-first behavior in the fallback editor and syncs later edits', async () => {
    const { plugin, api } = setup(); plugin.drafts = new MemoryDrafts(); plugin.saveData.mockResolvedValue({ code: 0 });
    vi.mocked(openWindow).mockClear(); plugin.fallback();
    const entry = [...plugin.fallbackServices.values()][0] as any;
    try {
      entry.input.value = 'latest fallback input'; await plugin.siYuanRecent(entry.service.note.id);
      expect(entry.service.note.siyuanSaved).toBe(true); expect(openWindow).not.toHaveBeenCalled();
      expect(api.blocks.get(entry.service.note.blockId)?.raw).toContain('latest fallback input');
      entry.input.value = 'updated fallback'; entry.input.oninput(); await entry.service.flush();
      expect(api.blocks.get(entry.service.note.blockId)?.raw).toContain('updated fallback');
      await plugin.siYuanRecent(entry.service.note.id); expect(openWindow).toHaveBeenCalledOnce();
      await plugin.historyWrites.run('history', async () => {});
    } finally { entry.service.dispose(); }
  });
  it('applies synced settings and deletions without writing data back or replacing the history array', async () => {
    const { plugin } = setup(), history = plugin.historyValue;
    const note = { ...createNote(), docId: '20261010000000-doc0001', summary: 'synced' };
    const removed = crypto.randomUUID(), markRemoved = vi.fn();
    plugin.shared = { load: vi.fn().mockResolvedValue({ records: [note], deleted: new Set([removed]) }) };
    plugin.fallbackServices.set({}, { service: { note: { id: removed }, markRemoved } });
    plugin.manager = { refresh: vi.fn(), applyDeletions: vi.fn() }; plugin.recentWindow = { settingsChanged: vi.fn(), refresh: vi.fn() }; plugin.syncTray = vi.fn();
    const order = [...plugin.toolbarLayout.order].reverse();
    plugin.loadData.mockImplementation(async (name: string) => name === 'settings.json' ? { ...defaults, debounceMs: 1500 } : { order });
    await plugin.onDataChanged(); await plugin.onDataChanged();
    expect(plugin.settingsValue.debounceMs).toBe(1500); expect(plugin.toolbarLayout.order).toEqual(order);
    expect(plugin.historyValue).toBe(history); expect(plugin.historyValue[0].summary).toBe('synced');
    expect(markRemoved).toHaveBeenCalled(); expect(plugin.manager.applyDeletions).toHaveBeenCalled();
    expect(plugin.recentWindow.settingsChanged).toHaveBeenCalled(); expect(plugin.saveData).not.toHaveBeenCalled();
  });
  it('persists toolbar separately and retains the last accepted layout on a rejected write', async () => {
    const { plugin } = setup(), previous = plugin.toolbarLayout;
    const next = { order: [...previous.order].reverse() };
    plugin.saveData.mockResolvedValueOnce({ code: -1, msg: 'disk locked' });
    await expect(plugin.saveToolbar(next)).rejects.toThrow('disk locked'); expect(plugin.toolbarLayout).toBe(previous);
    plugin.saveData.mockResolvedValueOnce({ code: 0 }); await plugin.saveToolbar(next);
    expect(plugin.toolbarLayout).toEqual(next); expect(plugin.saveData).toHaveBeenLastCalledWith('toolbar.json', next);
    expect(plugin.settingsValue.directory).toBe('/Original');
  });
  it('routes the list shortcut before note limits and native-window fallback', async () => {
    const { plugin } = setup(); plugin.settingsValue.shortcutBehavior = 'list'; plugin.settingsValue.maxWindows = 1;
    plugin.manager = { windows: new Map([['full', {}]]), trigger: vi.fn() }; plugin.showRecent = vi.fn(); plugin.fallback = vi.fn();
    await plugin.newNote(true); expect(plugin.showRecent).toHaveBeenCalledOnce(); expect(plugin.manager.trigger).not.toHaveBeenCalled();
    plugin.manager = undefined; await plugin.newNote(true); expect(plugin.showRecent).toHaveBeenCalledTimes(2); expect(plugin.fallback).not.toHaveBeenCalled();
  });
  it('opens settings inside the existing recent window and keeps the host panel only as a fallback', async () => {
    const { plugin } = setup(); plugin.recentWindow = { show: vi.fn().mockResolvedValue(undefined) };
    await plugin.openSettingsPanel(); expect(plugin.recentWindow.show).toHaveBeenCalledWith('settings'); expect(host.panels).toHaveLength(0);
    plugin.recentWindow.show.mockRejectedValueOnce(new Error('native unavailable'));
    await plugin.openSettingsPanel(); expect(host.panels).toHaveLength(1);
  });
  it('routes recent entries to the independent window without waking the owner and falls back on creation failure', async () => {
    const { plugin } = setup(), owner = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
    plugin.remote = { getCurrentWindow: () => owner }; plugin.recentWindow = { show: vi.fn().mockResolvedValue(undefined), refresh: vi.fn() };
    plugin.showRecentFallback = vi.fn();
    await plugin.showRecent(); expect(plugin.recentWindow.show).toHaveBeenCalledOnce(); expect(owner.show).not.toHaveBeenCalled(); expect(plugin.showRecentFallback).not.toHaveBeenCalled();
    plugin.recentWindow.show.mockRejectedValue(new Error('native unavailable'));
    await plugin.showRecent(); expect(owner.restore).toHaveBeenCalledOnce(); expect(owner.show).toHaveBeenCalledOnce(); expect(plugin.showRecentFallback).toHaveBeenCalledOnce();
  });
  it.each([
    ['windows', 'win32', 'tray.ico', 'Ctrl + Alt + N'],
    ['darwin', 'darwin', 'trayTemplate.png', 'Option + Command + N'],
    ['linux', 'linux', 'tray.png', 'Ctrl + Alt + N'],
  ])('initializes %s with native paths, durable drafts, platform hints and host-owned commands', async (backend, platform, icon, hotkey) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-platform-'));
    const home = path.join(directory, '用户 home'), workspace = path.join(directory, '速记 workspace');
    const plugin = new QuickNotesPlugin({ name: 'siyuan-quick-notes', app: {} } as any) as any;
    const ipc = { on: vi.fn(), removeListener: vi.fn() };
    try {
      host.backend = backend;
      plugin.loadData.mockResolvedValue({ ...defaults, trayEnabled: false });
      vi.stubGlobal('window', { siyuan: { config: { system: { workspaceDir: workspace } } }, require(name: string) {
        if (name === 'fs/promises') return fs;
        if (name === 'path') return path;
        if (name === 'crypto') return crypto;
        if (name === 'process') return { platform, env: {} };
        if (name === 'os') return { homedir: () => home };
        if (name === 'electron') return { ipcRenderer: ipc };
        throw new Error('native windows unavailable in test');
      } });
      await plugin.onload(); await plugin.onLayoutReady();
      expect(plugin.repository).toBeDefined();
      expect(plugin.trayIconPath).toBe(path.join(workspace, 'data', 'plugins', plugin.name, icon));
      expect(plugin.commands.find((command: any) => command.langKey === 'newQuickNote')).toMatchObject({ hotkey: '⌥⌘N', globalCallback: expect.any(Function) });
      expect(ipc.on).toHaveBeenCalledWith('siyuan-hotkey', expect.any(Function));
      host.showMessage.mockClear();
      plugin.shortcutListener({}, { failed: ['⌥⌘N'] });
      expect(host.showMessage).toHaveBeenCalledWith(expect.stringContaining('思源顶栏'), 7000, 'error');
      const note = createNote(); note.text = '跨平台草稿'; note.revision = 1;
      await plugin.drafts.write({ note });
      await plugin.drafts.saveWindowState({ [note.id]: { width: 320, height: 240, pinned: false, open: true } });
      await plugin.onload();
      expect((await plugin.drafts.list())[0].note.text).toBe(note.text);
      expect((await plugin.drafts.loadWindowState())[note.id].open).toBe(true);
      const api = new FakeKernel(); plugin.repository = new NoteRepository(api, () => plugin.settingsValue);
      await plugin.openSettingsPanel();
      const shortcut = host.panels.at(-1).items.find((item: any) => item.title === '全局快捷键');
      expect(shortcut.description).toContain(hotkey);
      if (backend === 'linux') expect(host.panels.at(-1).items.find((item: any) => item.title === '显示独立速记托盘图标').description).toContain('托盘菜单');
    } finally { await plugin.onunload(); await fs.rm(directory, { recursive: true, force: true }); }
  });
  it.each([
    ['desktop-window', 'windows'], ['browser-desktop', 'linux'], ['mobile', 'darwin'],
    ['desktop', 'docker'], ['desktop', 'android'], ['desktop', 'ios'], ['desktop', 'harmony'],
  ])('does not initialize or register commands for frontend %s and backend %s', async (frontend, backend) => {
    host.frontend = frontend; host.backend = backend;
    const plugin = new QuickNotesPlugin({ name: 'siyuan-quick-notes', app: {} } as any) as any;
    const require = vi.fn(); vi.stubGlobal('window', { require });
    await plugin.onload(); await plugin.onLayoutReady();
    expect(plugin.loadData).not.toHaveBeenCalled(); expect(require).not.toHaveBeenCalled();
    expect(plugin.commands).toEqual([]); expect(plugin.addTopBar).not.toHaveBeenCalled();
  });
  it('shows the macOS shortcut in an empty recent list', async () => {
    const { plugin } = setup(), list = new Element(); plugin.platform = 'darwin';
    plugin.dialog = vi.fn(() => ({ element: { querySelector: () => list } }));
    await plugin.showRecent();
    expect(list.textContent).toContain('Option + Command + N'); expect(list.textContent).toContain('思源顶栏');
  });
  it('keeps top-bar and command entries available when the Linux tray fails', async () => {
    const { plugin } = setup(); plugin.platform = 'linux'; plugin.settingsValue.trayEnabled = true;
    vi.stubGlobal('window', new EventTarget());
    plugin.remote = { Tray: class { constructor() { throw new Error('no status notifier'); } }, Menu: { buildFromTemplate() {} } };
    await plugin.onLayoutReady();
    expect(plugin.addTopBar).toHaveBeenCalledOnce(); expect(plugin.commands).toHaveLength(2);
    expect(host.showMessage).toHaveBeenCalledWith(expect.stringContaining('仍可使用顶栏'), 7000, 'error');
    const fallback = vi.spyOn(plugin, 'fallback').mockImplementation(() => {});
    await plugin.newNote(); expect(fallback).toHaveBeenCalledOnce();
  });
  it.each([false, true])('persists the tray close option before removing the icon (write failure: %s)', async failed => {
    const { plugin } = setup(), destroy = vi.fn();
    plugin.settingsValue.trayEnabled = true;
    plugin.saveData.mockResolvedValue({ code: failed ? -1 : 0, msg: 'settings write failed' });
    vi.stubGlobal('window', new EventTarget());
    plugin.remote = {
      Tray: class { on() {} setToolTip() {} removeAllListeners() {} isDestroyed() { return false; } destroy = destroy; },
      Menu: { buildFromTemplate: vi.fn() }, require: () => ({ attachTrayLifetime: () => ({ stop() {} }) }), getCurrentWebContents: () => ({}),
    };
    plugin.syncTray();
    const closing = plugin.tray.actions.closeTray();
    if (failed) await expect(closing).rejects.toThrow('settings write failed'); else await closing;
    expect(plugin.saveData).toHaveBeenCalledWith('settings.json', expect.objectContaining({ trayEnabled: false, directory: '/Original' }));
    expect(plugin.settingsValue.trayEnabled).toBe(failed);
    expect(destroy).toHaveBeenCalledTimes(failed ? 0 : 1);
    if (failed) plugin.tray.stop();
  });
  it.each([false, true])('deletes fallback plugin records while keeping every SiYuan block (native manager: %s)', async nativeManager => {
    const { plugin, api } = setup(), values = new Map<string, Draft>();
    const states: Record<string, any> = {};
    plugin.drafts = { write: async (draft: Draft) => { values.set(draft.note.id, draft); }, remove: async (id: string) => { values.delete(id); },
      list: async () => [...values.values()], loadWindowState: async () => ({ ...states }), saveWindowState: vi.fn(async () => {}) };
    plugin.confirmDelete = vi.fn().mockResolvedValue(true); plugin.saveData.mockResolvedValue({ code: 0 });
    const service = new AutoSaveService(createNote(), plugin.repository, plugin.drafts, () => 10000, () => {}, () => ({ width: 320, height: 320, pinned: false }), saved => plugin.recordFallback(saved));
    try {
      await service.edit('正式正文', 1, false, '便签标题'); await service.saveToSiYuan();
      await service.edit('未保存修改', 2, false, '待删除标题');
      const note = service.note; states[note.id] = { note };
      const dialog = { destroy: vi.fn() };
      plugin.fallbackServices.set(dialog, { service, input: { value: note.text }, titleInput: { value: note.title }, status: {} });
      if (nativeManager) plugin.manager = { windows: new Map(), deleteNote: vi.fn(), forgetNote: vi.fn().mockResolvedValue(undefined) };
      const before = [...api.blocks.entries()], callCount = api.calls.length;
      expect(await plugin.deleteRecent(note)).toBe(true);
      expect([...api.blocks.entries()]).toEqual(before); expect(api.calls).toHaveLength(callCount);
      expect(values.has(note.id)).toBe(false); expect(dialog.destroy).toHaveBeenCalledOnce();
      if (nativeManager) {
        expect(plugin.manager.deleteNote).not.toHaveBeenCalled(); expect(plugin.manager.forgetNote).toHaveBeenCalledWith(note.id);
      } else {
        expect(plugin.historyValue).toHaveLength(0); expect(plugin.drafts.saveWindowState).toHaveBeenCalledWith({});
      }
      expect(plugin.confirmDelete).toHaveBeenCalledOnce();
    } finally { service.dispose(); }
  });
  it('starts native shutdown before waiting for a stalled fallback draft write', async () => {
    const { plugin } = setup();
    let release!: (safe: boolean) => void;
    const closeToDraft = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const dispose = vi.fn().mockResolvedValue(undefined);
    plugin.manager = { dispose };
    const dialog = { destroy: vi.fn() }, service = { note: { text: 'fallback' }, pause: vi.fn(), closeToDraft, dispose: vi.fn() };
    plugin.fallbackServices.set(dialog, { service, input: { value: 'fallback' }, titleInput: { value: '' }, status: {} });
    const stopping = plugin.onunload();
    expect(dispose).toHaveBeenCalledOnce(); expect(closeToDraft).toHaveBeenCalledOnce();
    release(true); await stopping;
  });
  it('counts fallback editors and native notes together before opening a fallback editor', () => {
    const { plugin } = setup();
    plugin.settingsValue.maxWindows = 1;
    plugin.manager = { windows: new Map([['open-native', {}]]) };
    plugin.fallback();
    expect(host.dialogs).toHaveLength(0);
    expect(host.showMessage).toHaveBeenCalledWith(expect.stringContaining('已达到窗口数量上限'), 7000, 'error');
    plugin.manager = undefined; host.showMessage.mockClear();
    plugin.fallback(); expect(host.dialogs).toHaveLength(1);
    plugin.fallback(); expect(host.dialogs).toHaveLength(1);
    expect(plugin.fallbackServices.size).toBe(1);
    for (const entry of plugin.fallbackServices.values()) entry.service.dispose();
  });
  it('does not use rejected settings while their disk write is pending', async () => {
    const { plugin, api } = setup();
    let reject!: (error: Error) => void;
    plugin.saveData.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await plugin.openSettingsPanel(); commit(host.panels[0], '/Rejected');
    await vi.waitFor(() => expect(plugin.saveData).toHaveBeenCalled());
    expect(plugin.settingsValue.directory).toBe('/Original');
    const service = new AutoSaveService(createNote(), plugin.repository, new MemoryDrafts(), () => 10000, () => {}, () => ({ width: 320, height: 320, pinned: false }));
    try {
      await service.edit('during settings write', 1); reject(new Error('settings disk failure'));
      await vi.waitFor(() => expect(host.showMessage).toHaveBeenCalledWith(expect.stringContaining('设置未保存'), 7000, 'error'));
      await service.saveToSiYuan(); expect([...api.docs.keys()][0]).toMatch(/^\/Original\//);
      expect(plugin.settingsValue.directory).toBe('/Original');
    } finally { service.dispose(); }
  });
  it('serializes settings writes and a later failed write keeps the last successful settings', async () => {
    const { plugin } = setup();
    let resolve!: () => void;
    plugin.saveData.mockImplementationOnce(() => new Promise(done => { resolve = () => done({ code: 0 }); }))
      .mockRejectedValueOnce(new Error('second write failed'));
    await plugin.openSettingsPanel(); await plugin.openSettingsPanel();
    commit(host.panels[0], '/Accepted');
    await vi.waitFor(() => expect(plugin.saveData).toHaveBeenCalledTimes(1));
    commit(host.panels[1], '/Rejected');
    // Previewing the second panel completes before the first disk write.
    await vi.waitFor(() => expect(plugin.repository.api.calls.filter((call: any) => call.path === '/api/notebook/lsNotebooks')).toHaveLength(2));
    expect(plugin.settingsValue.directory).toBe('/Original');
    resolve();
    await vi.waitFor(() => expect(plugin.saveData).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(host.showMessage).toHaveBeenCalledWith(expect.stringContaining('second write failed'), 7000, 'error'));
    expect(plugin.settingsValue.directory).toBe('/Accepted');
    expect(plugin.saveData.mock.calls.map((call: any[]) => call[1].directory)).toEqual(['/Accepted', '/Rejected']);
  });
  it('filters corrupt history before rendering the recent panel', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-plugin-'));
    try {
      const { plugin, api } = setup(), valid = { ...createNote(), docId: '20261010000000-doc0001', summary: 'valid note' };
      const corrupt = { ...createNote(), docId: valid.docId, target: { notebook: api.notebook, path: 123 } };
      plugin.loadData.mockImplementation(async (name: string) => name === 'history.json' ? [corrupt, valid] : defaults);
      vi.stubGlobal('window', { siyuan: { config: { system: { workspaceDir: path.join(directory, 'workspace') } } }, require(name: string) {
        if (name === 'fs/promises') return fs;
        if (name === 'path') return path;
        if (name === 'crypto') return crypto;
        if (name === 'process') return { platform: 'win32', env: {} };
        if (name === 'os') return { homedir: () => directory };
        if (name === 'electron') return { ipcRenderer: {} };
        throw new Error('native windows unavailable in test');
      } });
      await plugin.onload(); expect(plugin.historyValue.map((item: any) => item.id)).toEqual([valid.id]);
      expect(plugin.drafts.directory).toMatch(/[\\/]data[\\/]storage[\\/]petal[\\/]siyuan-quick-notes[\\/]drafts[\\/][a-f0-9-]+$/);
      await plugin.showRecent(); expect(host.dialogs).toHaveLength(1); expect(host.showMessage).not.toHaveBeenCalled();
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it.each(['win32', 'darwin', 'linux'])('only imports Windows legacy drafts on win32 (runtime: %s)', async platform => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-migration-'));
    try {
      const workspace = path.join(directory, 'workspace'), local = path.join(directory, 'local');
      const hash = crypto.createHash('sha256').update(workspace.toLowerCase()).digest('hex').slice(0, 24);
      const legacyDirectory = path.join(local, 'SiYuanQuickNotes', hash);
      const note = createNote(); note.text = '待迁移草稿'; note.revision = 1;
      await fs.mkdir(legacyDirectory, { recursive: true });
      await fs.writeFile(path.join(legacyDirectory, note.id + '.json'), JSON.stringify({ note }));
      const plugin = new QuickNotesPlugin({ name: 'siyuan-quick-notes', app: {} } as any) as any;
      host.backend = platform === 'win32' ? 'windows' : platform;
      plugin.loadData.mockResolvedValue(undefined);
      vi.stubGlobal('window', { siyuan: { config: { system: { workspaceDir: workspace } } }, require(name: string) {
        if (name === 'fs/promises') return fs;
        if (name === 'path') return path;
        if (name === 'crypto') return crypto;
        if (name === 'process') return { platform, env: { LOCALAPPDATA: local } };
        if (name === 'os') return { homedir: () => directory };
        if (name === 'electron') return { ipcRenderer: {} };
        throw new Error('native windows unavailable in test');
      } });
      await plugin.onload();
      expect(plugin.repository).toBeDefined();
      const drafts = await plugin.drafts.list();
      if (platform === 'win32') expect(drafts[0].note.text).toBe('待迁移草稿');
      else expect(drafts).toEqual([]);
      expect(await fs.readFile(path.join(legacyDirectory, note.id + '.json'), 'utf8')).toContain('待迁移草稿');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
