import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { recentItems, validRecentRequest, type RecentRequest } from '../src/core/recent';
import { RecentWindowController } from '../src/core/recent-window';
import { createNote, noteReference } from '../src/core/identity';
import { defaults } from '../src/core/settings';
import type { LocalDraftStore } from '../src/platform/drafts';
import type { NativeWindow } from '../src/platform/desktop';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
class Channel {
  static latest: Channel; onmessage?: (event: { data: unknown }) => void;
  sent: any[] = []; close = vi.fn();
  constructor() { Channel.latest = this; }
  postMessage(value: unknown) { this.sent.push(value); }
}
class Window extends EventEmitter {
  destroyed = false; pinned = false;
  webContents = new EventEmitter();
  destroy = vi.fn(() => { this.destroyed = true; this.emit('closed'); });
  isDestroyed() { return this.destroyed; }
  setAlwaysOnTop = vi.fn((pinned: boolean) => { this.pinned = pinned; });
  minimize = vi.fn();
}
function setup() {
  vi.useFakeTimers(); vi.stubGlobal('BroadcastChannel', Channel);
  vi.stubGlobal('location', { origin: 'http://localhost:16818' });
  vi.stubGlobal('document', { documentElement: { getAttribute: () => 'dark' } });
  const settings = { ...defaults, maxWindows: 1 }, windows: Window[] = [];
  const create = vi.fn(async () => { const window = new Window(); windows.push(window); return window as unknown as NativeWindow; });
  const focus = vi.fn(), store = { loadRecentGeometry: vi.fn().mockResolvedValue(undefined), saveRecentGeometry: vi.fn().mockResolvedValue(undefined) };
  const actions = { items: vi.fn().mockResolvedValue([]), open: vi.fn().mockResolvedValue(undefined), siYuan: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined), createNote: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue({ settings: { ...settings }, notebooks: [], platform: 'windows', shortcut: 'Ctrl + Alt + N' }),
    saveSettings: vi.fn().mockImplementation(async settings => ({ settings })), previewSettings: vi.fn().mockResolvedValue({ notebook: 'n', path: '/preview' }), shortcuts: vi.fn() };
  const guards: Array<{ stop(): void }> = [], report = vi.fn();
  const controller = new RecentWindowController({ create, focus, geometry: native => ({ width: 400, height: 560, pinned: (native as unknown as Window).pinned }) },
    store as unknown as LocalDraftStore, () => settings, actions, native => {
      const guard = { stop: vi.fn(() => { native.removeAllListeners(); native.destroy(); }) }; guards.push(guard); return guard;
    }, report);
  const channel = Channel.latest;
  const request = async (action: RecentRequest['action'], id?: string, extra = {}) => {
    channel.onmessage!({ data: { session: controller.session, windowId: 'recent', requestId: crypto.randomUUID(), action, id, ...extra } });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { controller, settings, windows, create, focus, store, actions, channel, request, guards, report };
}
describe('recent list data', () => {
  it('exposes confirmed state independently of draft status and partially created documents', () => {
    const note = { ...createNote(), docId: '20261010000000-doc0001', text: 'partially written', revision: 1 };
    expect(recentItems([], [{ note }], [])[0].siyuanSaved).toBe(false);
    expect(recentItems([], [{ note: { ...note, siyuanSaved: true } }], [])[0].siyuanSaved).toBe(true);
    const legacy = { ...noteReference(note), summary: 'legacy', siyuanSaved: undefined };
    expect(recentItems([legacy], [], [])[0].siyuanSaved).toBe(true);
  });
  it('carries callout colors from history and drafts, preferring the active note and defaulting old notes to NOTE', () => {
    const saved = { ...createNote(), calloutType: 'TIP' as const };
    const draft = { ...saved, calloutType: 'IMPORTANT' as const };
    const active = { ...saved, calloutType: 'CAUTION' as const };
    expect(recentItems([noteReference(saved)], [], [])[0].calloutType).toBe('TIP');
    expect(recentItems([noteReference(saved)], [{ note: draft }], [])[0].calloutType).toBe('IMPORTANT');
    expect(recentItems([noteReference(saved)], [{ note: draft }], [active])[0].calloutType).toBe('CAUTION');
    expect(recentItems([], [{ note: createNote() }], [])[0].calloutType).toBe('NOTE');
  });
  it('keeps explicit titles separate from body previews, preferring live text and preserving empty bodies', () => {
    const note = { ...createNote(), caption: '独立标题', text: '正文第一行\n正文第二行', revision: 2, docTitle: '保存文档名' };
    const history = { ...noteReference(note), summary: '独立标题', bodySummary: '旧正文摘要' };
    expect(recentItems([history], [], [])[0]).toMatchObject({ title: '独立标题', bodySummary: '旧正文摘要' });
    expect(recentItems([history], [{ note }], [])[0]).toMatchObject({ title: '独立标题', bodySummary: '正文第一行' });
    expect(recentItems([history], [{ note }], [{ ...note, caption: '', text: '' }])[0]).toMatchObject({ title: '保存文档名', bodySummary: '' });
    expect(recentItems([{ ...noteReference(note), summary: '独立标题' }], [], [])[0].bodySummary).toBeUndefined();
    expect(recentItems([{ ...noteReference(note), caption: undefined, summary: '旧版正文' }], [], [])[0]).toMatchObject({ title: '保存文档名', bodySummary: '旧版正文' });
    expect(recentItems([], [{ note: { ...createNote(), text: '无标题的正文' } }], [])[0]).toMatchObject({ title: '', bodySummary: '无标题的正文' });
  });
  it('accepts complete settings payloads but rejects malformed types and incomplete forms', () => {
    const request = { session: 's', windowId: 'recent', requestId: 'r', action: 'save-settings', settings: { ...defaults } };
    expect(validRecentRequest(request, 's')).toBe(true);
    for (const change of [undefined, { notebook: 'n' }, { ...defaults, trayEnabled: 'false' }, { ...defaults, width: NaN }, { ...defaults, trayClickAction: 'invalid' }]) expect(validRecentRequest({ ...request, settings: change }, 's')).toBe(false);
  });
  it('deduplicates history, disk drafts and live notes with current content taking priority', () => {
    const saved = { ...createNote(), text: 'saved', updatedAt: 10, revision: 1, savedRevision: 1 };
    const draft = { ...saved, text: 'draft', updatedAt: 20, revision: 2 };
    const active = { ...draft, text: 'latest', updatedAt: 30, revision: 3 };
    const other = { ...createNote(), text: 'other', updatedAt: 40 };
    const items = recentItems([{ ...noteReference(saved), summary: 'history' }], [{ note: draft }, { note: other }], [active]);
    expect(items).toHaveLength(2); expect(items[0].id).toBe(other.id);
    expect(items[1]).toMatchObject({ summary: 'latest', draft: true, open: true });
    expect(recentItems([], [{ note: draft }], [{ ...active, savedRevision: 3 }])[0].draft).toBe(false);
  });
  it('rejects wrong sessions, unlisted actions and malformed item references', () => {
    const request = { session: 'session', windowId: 'recent', requestId: 'r', action: 'open', id: crypto.randomUUID() };
    expect(validRecentRequest(request, 'session')).toBe(true);
    for (const change of [{ session: 'other' }, { windowId: 'note' }, { action: 'edit' }, { id: '../path' }, { requestId: '' }]) expect(validRecentRequest({ ...request, ...change }, 'session')).toBe(false);
  });
  it('validates copy-only previews with optional recovery references', () => {
    const note = { ...createNote(), text: 'body', revision: 1 };
    const variant = { note, device: crypto.randomUUID(), version: crypto.randomUUID() };
    expect(recentItems([], [{ note, variants: [variant, { ...variant, version: crypto.randomUUID() }] }], [note])[0].versions).toBe(2);
    const request = { action: 'choose-draft-version', session: 's', windowId: 'recent', requestId: 'r', id: note.id, token: crypto.randomUUID(), version: variant.version, copy: true };
    expect(validRecentRequest(request, 's')).toBe(true);
    expect(validRecentRequest({ ...request, id: undefined }, 's')).toBe(true);
    for (const change of [{ copy: false }, { copy: undefined }, { token: '../bad' }, { version: 'arbitrary-file' }]) expect(validRecentRequest({ ...request, ...change }, 's')).toBe(false);
  });
});
describe('independent recent window', () => {
  it('routes foreign read-only previews and copies, rejecting direct continuation requests', async () => {
    const h = setup(), token = crypto.randomUUID(), version = crypto.randomUUID();
    const versions = vi.fn().mockResolvedValue({ token, removed: false, versions: [] });
    const chooseVersion = vi.fn().mockResolvedValue(undefined); Object.assign(h.actions, { versions, chooseVersion });
    await h.controller.show(); await h.request('draft-versions');
    expect(versions).toHaveBeenCalledWith(undefined); expect(h.channel.sent.at(-1).draftVersions.token).toBe(token);
    await h.request('choose-draft-version', undefined, { token, version, copy: true });
    expect(chooseVersion).toHaveBeenCalledWith(undefined, version, token, true);
    await h.request('choose-draft-version', undefined, { token, version, copy: false }); expect(chooseVersion).toHaveBeenCalledOnce();
    await h.controller.dispose();
  });
  it('routes organization previews, immediate job acknowledgement, cancellation and snooze without blocking heartbeats', async () => {
    const h = setup(), selections = [{ id: crypto.randomUUID(), version: crypto.randomUUID() }];
    const progress = { jobId: 'job', mode: 'archive' as const, running: true, cancelled: false, total: 1, completed: 0, succeeded: 0, skipped: 0, failures: [] };
    const cleanup = vi.fn().mockResolvedValue({ items: [], total: 100, unsaved: 40, eligible: 60, progress });
    const cleanupStart = vi.fn().mockReturnValue(progress), cleanupCancel = vi.fn(), cleanupSnooze = vi.fn().mockResolvedValue(undefined);
    Object.assign(h.actions, { cleanup, cleanupStart, cleanupCancel, cleanupSnooze });
    await h.controller.show('cleanup'); await h.request('cleanup');
    expect(h.channel.sent.at(-1).cleanup.total).toBe(100);
    await h.request('cleanup-start', undefined, { mode: 'archive', selections, discard: false });
    expect(cleanupStart).toHaveBeenCalledWith('archive', selections, false); expect(h.channel.sent.at(-1).cleanupProgress.running).toBe(true);
    await h.request('heartbeat'); expect(h.channel.sent.at(-1).requestId).toBeTypeOf('string');
    await h.request('cleanup-cancel'); expect(cleanupCancel).toHaveBeenCalledOnce();
    await h.request('cleanup-snooze'); expect(cleanupSnooze).toHaveBeenCalledOnce();
    await h.controller.dispose();
  });
  it('routes SiYuan actions, refreshes on success and returns failures to the list', async () => {
    const h = setup(), id = crypto.randomUUID(); await h.controller.show();
    await h.request('siyuan', id); expect(h.actions.siYuan).toHaveBeenCalledWith(id);
    await vi.advanceTimersByTimeAsync(250); expect(h.actions.items).toHaveBeenCalled();
    h.actions.siYuan.mockRejectedValueOnce(new Error('save failed'));
    await h.request('siyuan', id); expect(h.channel.sent.at(-1).error).toBe('save failed');
    await h.request('siyuan', '../bad-id'); expect(h.actions.siYuan).toHaveBeenCalledTimes(2);
    await h.controller.dispose();
  });
  it('routes settings to the same window and returns load, preview, save and failure responses', async () => {
    const h = setup(); await h.controller.show(); await h.controller.show('settings');
    expect(h.create).toHaveBeenCalledOnce(); expect(h.channel.sent.at(-1).page).toBe('settings');
    await h.request('settings'); expect(h.channel.sent.at(-1).settingsData.settings).toEqual(h.settings);
    await h.request('preview-settings', undefined, { settings: { ...h.settings, directory: '/preview' } });
    expect(h.actions.previewSettings).toHaveBeenCalledWith(expect.objectContaining({ directory: '/preview' })); expect(h.channel.sent.at(-1).preview.path).toBe('/preview');
    await h.request('save-settings', undefined, { settings: { ...h.settings, trayClickAction: 'recent' } });
    expect(h.channel.sent.at(-1).savedSettings.trayClickAction).toBe('recent');
    h.actions.saveSettings.mockRejectedValueOnce(new Error('settings disk failure'));
    await h.request('save-settings', undefined, { settings: h.settings }); expect(h.channel.sent.at(-1).error).toBe('settings disk failure');
    await h.request('shortcuts'); expect(h.actions.shortcuts).toHaveBeenCalledOnce(); expect(h.windows[0].minimize).toHaveBeenCalledOnce();
    expect(h.windows[0].destroy).not.toHaveBeenCalled(); await h.controller.dispose();
  });
  it('reserves one creation, restores its own geometry and remains independent of note limits', async () => {
    const h = setup(); h.store.loadRecentGeometry.mockResolvedValue({ width: 450, height: 600, pinned: true, x: 15, y: 20 });
    await Promise.all([h.controller.show(), h.controller.show(), h.controller.show()]);
    expect(h.create).toHaveBeenCalledOnce(); expect(h.create).toHaveBeenCalledWith(expect.stringContaining('recent.html'), expect.objectContaining({ width: 450, x: 15 }));
    await h.controller.show(); expect(h.focus).toHaveBeenCalledTimes(2);
    await h.request('open', crypto.randomUUID()); expect(h.actions.open).toHaveBeenCalledOnce(); expect(h.windows[0].destroy).not.toHaveBeenCalled();
    await h.request('pin'); expect(h.windows[0].pinned).toBe(true); expect(h.store.saveRecentGeometry).toHaveBeenCalled();
    await h.controller.dispose(); expect(h.windows[0].destroy).toHaveBeenCalledOnce(); expect(h.channel.close).toHaveBeenCalledOnce();
  });
  it('coalesces changes, refreshes after open, and ignores forged requests', async () => {
    const h = setup(); await h.controller.show();
    for (let i = 0; i < 30; i++) h.controller.refresh();
    await vi.advanceTimersByTimeAsync(250); expect(h.actions.items).toHaveBeenCalledOnce();
    await h.request('open', crypto.randomUUID(), { session: 'wrong' }); expect(h.actions.open).not.toHaveBeenCalled();
    await h.request('open', crypto.randomUUID()); await vi.advanceTimersByTimeAsync(250); expect(h.actions.items).toHaveBeenCalledTimes(2);
    await h.controller.dispose();
  });
  it('keeps topmost during locally confirmed deletion and reports failures in the list', async () => {
    const h = setup(); await h.controller.show(); h.windows[0].pinned = true;
    h.actions.delete.mockImplementation(async () => { expect(h.windows[0].pinned).toBe(true); throw new Error('disk locked'); });
    await h.request('delete', crypto.randomUUID());
    expect(h.windows[0].pinned).toBe(true); expect(h.windows[0].setAlwaysOnTop).not.toHaveBeenCalled();
    expect(h.channel.sent.at(-1).error).toBe('disk locked'); expect(h.windows[0].destroy).not.toHaveBeenCalled();
    await h.controller.dispose();
  });
  it('closes and reopens one list, does not remember when disabled, and destroys a late-created window on unload', async () => {
    const h = setup(); h.settings.rememberPosition = false; await h.controller.show();
    expect(h.store.loadRecentGeometry).not.toHaveBeenCalled();
    await h.request('close'); expect(h.windows[0].destroy).toHaveBeenCalledOnce(); expect(h.store.saveRecentGeometry).not.toHaveBeenCalled();
    await h.controller.show(); expect(h.create).toHaveBeenCalledTimes(2); await h.controller.dispose();
    const late = setup(); let resolve!: (native: NativeWindow) => void;
    late.create.mockImplementation(() => new Promise(ready => { resolve = ready; }));
    const showing = late.controller.show(); await vi.advanceTimersByTimeAsync(0); await late.controller.dispose();
    const native = new Window(); resolve(native as unknown as NativeWindow); await showing;
    expect(native.destroy).toHaveBeenCalledOnce(); expect(late.guards).toHaveLength(0);
  });
});
