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
  Dialog: class { element = { querySelector: () => new Element() }; constructor() { host.dialogs.push(this); } destroy() {} },
  Menu: class {}, getFrontend: () => host.frontend, getBackend: () => host.backend, showMessage: host.showMessage,
  openTab: vi.fn(), openWindow: vi.fn(), openSetting: vi.fn(), confirm: vi.fn(),
}));
import QuickNotesPlugin from '../src/index';
import { AutoSaveService } from '../src/services/autosave';
import { NoteRepository } from '../src/services/repository';
import { defaults } from '../src/core/settings';
import { createNote } from '../src/core/identity';
import { FakeKernel } from './fake-kernel';
import type { Draft, DraftStore } from '../src/types';

class Element {
  type = ''; value = ''; checked = false; textContent = ''; className = ''; children: any[] = []; onclick?: () => void;
  dataset: Record<string, string> = {}; classList = { add() {} }; listeners = new Map<string, () => void>();
  setAttribute() {} append(...children: any[]) { this.children.push(...children); } add() {}
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
}
class Input extends Element {}
class MemoryDrafts implements DraftStore {
  async write(_draft: Draft) {} async remove(_id: string) {} async list() { return []; }
}
beforeEach(() => {
  host.panels.length = 0; host.dialogs.length = 0; host.showMessage.mockClear();
  host.frontend = 'desktop'; host.backend = 'windows';
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'input' ? new Input() : new Element(), documentElement: { getAttribute: () => 'light' } });
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
      await service.edit('正式正文', 1, false, '便签标题'); await service.flush();
      await service.edit('未保存修改', 2, false, '待删除标题');
      const note = service.note; states[note.id] = { note };
      const dialog = { destroy: vi.fn() };
      plugin.fallbackServices.set(dialog, { service, input: { value: note.text }, titleInput: { value: note.title }, status: {} });
      if (nativeManager) plugin.manager = { deleteNote: vi.fn(), forgetNote: vi.fn().mockResolvedValue(undefined) };
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
      await service.flush(); expect([...api.docs.keys()][0]).toMatch(/^\/Original\//);
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
