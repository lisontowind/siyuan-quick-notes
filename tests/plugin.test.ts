import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
const host = vi.hoisted(() => ({ panels: [] as any[], dialogs: [] as any[], showMessage: vi.fn() }));
vi.mock('siyuan', () => ({
  Plugin: class { saveData = vi.fn(); loadData = vi.fn(); name = 'siyuan-quick-notes'; commands = []; app = {}; },
  Setting: class { items: any[] = []; constructor(public options: any) { host.panels.push(this); } addItem(item: any) { this.items.push(item); } open() {} },
  Dialog: class { element = { querySelector: () => new Element() }; constructor() { host.dialogs.push(this); } destroy() {} },
  Menu: class {}, getFrontend: () => 'desktop', getBackend: () => 'windows', showMessage: host.showMessage,
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
  it('starts native shutdown before waiting for a stalled fallback draft write', async () => {
    const { plugin } = setup();
    let release!: (safe: boolean) => void;
    const closeToDraft = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const dispose = vi.fn().mockResolvedValue(undefined);
    plugin.manager = { dispose };
    const dialog = { destroy: vi.fn() }, service = { note: { text: 'fallback' }, pause: vi.fn(), closeToDraft, dispose: vi.fn() };
    plugin.fallbackServices.set(dialog, { service, input: { value: 'fallback' }, status: {} });
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
    const { plugin, api } = setup(), valid = { ...createNote(), docId: '20261010000000-doc0001', summary: 'valid note' };
    const corrupt = { ...createNote(), docId: valid.docId, target: { notebook: api.notebook, path: 123 } };
    plugin.loadData.mockImplementation(async (name: string) => name === 'history.json' ? [corrupt, valid] : defaults);
    vi.stubGlobal('window', { siyuan: { config: { system: { workspaceDir: 'D:/Review' } } }, require(name: string) {
      if (name === 'fs/promises') return { readdir: async () => [] };
      if (name === 'path') return path;
      if (name === 'crypto') return crypto;
      if (name === 'process') return { env: { LOCALAPPDATA: 'D:/Review' } };
      if (name === 'electron') return { ipcRenderer: {} };
      throw new Error('native windows unavailable in test');
    } });
    await plugin.onload(); expect(plugin.historyValue.map((item: any) => item.id)).toEqual([valid.id]);
    await plugin.showRecent(); expect(host.dialogs).toHaveLength(1); expect(host.showMessage).not.toHaveBeenCalled();
  });
});
