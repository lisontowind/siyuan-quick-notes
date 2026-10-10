import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Request, Response, WindowState } from '../src/types';
const editor = vi.hoisted(() => ({ text: '', composing: false, enabled: false, changed: () => {}, compositionEnded: () => {} }));
vi.mock('../src/window/editor', () => ({ QuickNoteEditor: class {
  constructor(_: unknown, changed: () => void, ended: () => void) { editor.changed = changed; editor.compositionEnded = ended; }
  get composing() { return editor.composing; }
  getText() { return editor.text; } setText(value: string) { editor.text = value; }
  setEditable(value: boolean) { editor.enabled = value; } focus() {} destroy() {}
} }));
class Element {
  value = ''; disabled = false; readOnly = false;
  textContent = ''; hidden = false; dataset: Record<string, string> = {}; attributes = new Map<string, string>();
  listeners = new Map<string, (event?: any) => void>();
  children = new Set<Element>(); focus = vi.fn();
  contains(target: Element): boolean { return target === this || this.children.has(target); }
  addEventListener(name: string, listener: (event?: any) => void) { this.listeners.set(name, listener); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  toggleAttribute(name: string, enabled: boolean) { if (enabled) this.attributes.set(name, ''); else this.attributes.delete(name); }
}
class Channel {
  static latest: Channel; sent: Request[] = []; onmessage?: (event: { data: Response }) => void; closed = false;
  constructor() { Channel.latest = this; }
  postMessage(value: Request) { this.sent.push(structuredClone(value)); } close() { this.closed = true; }
}
let elements: Map<string, Element>, windowListeners: Map<string, () => void>;
let documentListeners: Map<string, (event: any) => void>;
const state: WindowState = { revision: 1, savedRevision: 1, title: 'Inbox', docId: '20261010000000-doc0001', phase: 'saved',
  localRevision: -1, pinned: false, dark: false, showSaved: false };
function response(extra: Partial<Response>) { Channel.latest.onmessage?.({ data: { session: 's', windowId: 'w', ...extra } }); }
function initialize() { response({ state, content: { text: 'saved', revision: 1 } }); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); elements = new Map(); windowListeners = new Map(); documentListeners = new Map();
  Object.assign(editor, { text: '', composing: false, enabled: false });
  vi.stubGlobal('location', { search: '?session=s&windowId=w&channel=siyuan-quick-notes:s' });
  vi.stubGlobal('BroadcastChannel', Channel);
  vi.stubGlobal('document', { documentElement: { dataset: {} }, addEventListener: (name: string, listener: (event: any) => void) => documentListeners.set(name, listener), getElementById(id: string) {
    if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id);
  } });
  vi.stubGlobal('window', { addEventListener: (name: string, listener: () => void) => windowListeners.set(name, listener), close: vi.fn() });
  await import('../src/window/main');
});
afterEach(() => { windowListeners.get('beforeunload')?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('renderer close protocol', () => {
  it('shows the document title in the draggable header and edits only the body', () => {
    response({ state: { ...state, docTitle: '编号文档' }, content: { text: '# 旧标题\n\n正文', revision: 1 } });
    expect(elements.get('title-display')!.textContent).toBe('编号文档');
    expect(elements.has('note-title')).toBe(false); expect(editor.text).toBe('# 旧标题\n\n正文');
    editor.text = 'body edit'; editor.changed();
    expect(elements.get('status')!.textContent).toBe('正在编辑…');
    response({ state: { ...state, docTitle: '重命名后的文档' } });
    expect(elements.get('title-display')!.textContent).toBe('重命名后的文档');
    expect(editor.text).toBe('body edit');
  });
  it('keeps disconnected text selectable and closes only after an explicit second click', async () => {
    initialize(); editor.text = 'unsaved before update'; editor.changed();
    await vi.advanceTimersByTimeAsync(7500);
    expect(editor.enabled).toBe(false);
    expect(editor.text).toBe('unsaved before update');
    elements.get('close')!.listeners.get('click')!();
    expect(window.close).not.toHaveBeenCalled();
    expect(elements.get('status')!.textContent).toContain('再次点击');
    elements.get('close')!.listeners.get('click')!();
    expect(window.close).toHaveBeenCalledOnce();
    expect(Channel.latest.sent.some(item => item.action === 'close')).toBe(false);
  });
  it('recovers from a temporary heartbeat loss without replacing unacknowledged text', async () => {
    initialize(); editor.text = 'unacknowledged edit'; editor.changed();
    await vi.advanceTimersByTimeAsync(7500);
    expect(editor.enabled).toBe(false);
    response({ state, content: { text: 'saved', revision: 1 } });
    expect(editor.enabled).toBe(true); expect(editor.text).toBe('unacknowledged edit');
    expect(Channel.latest.sent.at(-1)).toMatchObject({ action: 'edit', text: 'unacknowledged edit', revision: 3 });
  });
  it('allows a retained stopped window to close after the same copy warning', () => {
    initialize(); editor.text = 'disk failure text';
    response({ stopped: '未确认落盘，请复制文本' });
    elements.get('close')!.listeners.get('click')!(); expect(window.close).not.toHaveBeenCalled();
    elements.get('close')!.listeners.get('click')!(); expect(window.close).toHaveBeenCalledOnce();
    expect(editor.text).toBe('disk failure text');
  });
  it('dismisses the menu on outside clicks and after choosing an action', () => {
    initialize(); const menu = elements.get('actions')!, more = elements.get('more')!;
    more.listeners.get('click')!(); expect(menu.hidden).toBe(false); expect(more.attributes.get('aria-expanded')).toBe('true');
    documentListeners.get('pointerdown')!({ target: elements.get('editor') });
    expect(menu.hidden).toBe(true); expect(more.attributes.get('aria-expanded')).toBe('false');
    more.listeners.get('click')!(); elements.get('save')!.listeners.get('click')!();
    expect(menu.hidden).toBe(true); expect(Channel.latest.sent.at(-1)?.action).toBe('save');
  });
  it('keeps the menu open for its own elements and dismisses when keyboard focus leaves it', () => {
    initialize(); const menu = elements.get('actions')!, more = elements.get('more')!, save = elements.get('save')!, icon = new Element();
    menu.children.add(save); more.children.add(icon); more.listeners.get('click')!();
    documentListeners.get('pointerdown')!({ target: save }); expect(menu.hidden).toBe(false);
    documentListeners.get('focusin')!({ target: save }); expect(menu.hidden).toBe(false);
    documentListeners.get('pointerdown')!({ target: icon }); expect(menu.hidden).toBe(false);
    documentListeners.get('focusin')!({ target: elements.get('editor') }); expect(menu.hidden).toBe(true);
  });
  it('dismisses on Escape or window blur while retaining save on blur', () => {
    initialize(); const menu = elements.get('actions')!, more = elements.get('more')!, preventDefault = vi.fn();
    more.listeners.get('click')!(); documentListeners.get('keydown')!({ key: 'Escape', preventDefault });
    expect(menu.hidden).toBe(true); expect(preventDefault).toHaveBeenCalled(); expect(more.focus).toHaveBeenCalled();
    more.listeners.get('click')!(); windowListeners.get('blur')!();
    expect(menu.hidden).toBe(true); expect(Channel.latest.sent.at(-1)?.action).toBe('save');
  });
  it('cancels pending reload confirmation when the menu closes and requires two fresh clicks', () => {
    initialize(); const menu = elements.get('actions')!, more = elements.get('more')!, reload = elements.get('reload')!;
    more.listeners.get('click')!(); reload.listeners.get('click')!();
    expect(menu.hidden).toBe(false); expect(reload.textContent).toContain('再次点击');
    documentListeners.get('pointerdown')!({ target: elements.get('editor') });
    expect(reload.textContent).toBe('重新载入原文');
    more.listeners.get('click')!(); reload.listeners.get('click')!();
    expect(Channel.latest.sent.some(item => item.action === 'reload')).toBe(false);
    reload.listeners.get('click')!();
    expect(menu.hidden).toBe(true); expect(Channel.latest.sent.at(-1)?.action).toBe('reload');
    more.listeners.get('click')!(); response({ collect: true, requestId: 'close-menu' }); expect(menu.hidden).toBe(true);
  });
  it('offers delete in the menu and disables it when the plugin stops', () => {
    initialize(); elements.get('delete')!.listeners.get('click')!();
    expect(Channel.latest.sent.at(-1)?.action).toBe('delete');
    response({ stopped: 'stopped' }); expect(elements.get('delete')!.attributes.has('disabled')).toBe(true);
  });
  it('enables editing only after content initialization and keeps new input status visible', async () => {
    expect(editor.enabled).toBe(false); initialize(); expect(editor.enabled).toBe(true);
    expect(elements.get('status')!.hidden).toBe(true);
    editor.text = 'new input'; editor.changed(); expect(elements.get('status')!.hidden).toBe(false);
    response({ state }); expect(elements.get('status')!.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(Channel.latest.sent.some(item => item.action === 'heartbeat')).toBe(true);
    expect(Channel.latest.sent.filter(item => item.action === 'ready')).toHaveLength(1);
  });
  it('collects unsent input into a frozen, versioned snapshot and resumes after failure', () => {
    initialize(); editor.text = 'pending text'; editor.changed();
    response({ collect: true, requestId: 'collect-1' });
    expect(Channel.latest.sent.at(-1)).toMatchObject({ action: 'collected', requestId: 'collect-1', text: 'pending text', revision: 2 });
    expect(editor.enabled).toBe(false);
    response({ state: { ...state, revision: 2, phase: 'error', error: 'disk full' }, resume: true });
    expect(editor.enabled).toBe(true); expect(editor.text).toBe('pending text');
    expect(elements.get('status')!.textContent).toContain('disk full');
  });
  it('waits for IME completion before acknowledging a shutdown snapshot', () => {
    initialize(); editor.composing = true; editor.text = '中文中间态';
    response({ collect: true, requestId: 'ime' });
    expect(Channel.latest.sent.some(item => item.action === 'collected')).toBe(false);
    editor.composing = false; editor.text = '中文完成'; editor.compositionEnded();
    expect(Channel.latest.sent.at(-1)).toMatchObject({ action: 'collected', requestId: 'ime', text: '中文完成' });
    expect(editor.enabled).toBe(false);
  });
  it('rejects oversized collection and preserves text after plugin stop', () => {
    initialize(); editor.text = 'a'.repeat(2_000_001);
    response({ collect: true, requestId: 'oversized' });
    expect(Channel.latest.sent.at(-1)?.error).toContain('200 万字符');
    expect(Channel.latest.sent.at(-1)?.text).toBeUndefined();
    response({ stopped: '未确认落盘，请复制文本' });
    expect(editor.text).toHaveLength(2_000_001); expect(editor.enabled).toBe(false);
    expect(elements.get('status')!.hidden).toBe(false); expect(Channel.latest.closed).toBe(true);
  });
});
