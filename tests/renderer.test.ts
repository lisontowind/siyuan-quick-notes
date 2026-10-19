import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Request, Response, WindowState } from '../src/types';
// Protocol tests isolate visual components; verify-ui exercises the real DOM,
// overflow, pointer sorting, heading menus and local confirmation dialog.
vi.mock('../src/window/icons', () => ({ windowIcons() {} }));
vi.mock('../src/window/toolbar', () => ({ FormatToolbar: class {
  constructor(_: unknown, run: (action: string) => void) {
    for (const id of ['bold', 'italic', 'underline', 'strike', 'heading', 'unordered', 'ordered', 'task', 'quote', 'code', 'link', 'image']) {
      document.getElementById(`format-${id}`)!.addEventListener('click', () => run(id));
    }
  }
  setEnabled(value: boolean) {
    for (const id of ['bold', 'italic', 'underline', 'strike', 'heading', 'unordered', 'ordered', 'task', 'quote', 'code', 'link', 'image']) document.getElementById(`format-${id}`)!.toggleAttribute('disabled', !value);
  }
  close() {} update() {} destroy() {}
} }));
const editor = vi.hoisted(() => ({ text: '', composing: false, enabled: false, changed: () => {}, compositionEnded: () => {}, format: vi.fn(), rendering: vi.fn() }));
vi.mock('../src/window/editor', () => ({ QuickNoteEditor: class {
  constructor(_: unknown, changed: () => void, ended: () => void) { editor.changed = changed; editor.compositionEnded = ended; }
  get composing() { return editor.composing; }
  getText() { return editor.text; } setText(value: string) { editor.text = value; }
  prepareImageInsertion() { return (markdown: string) => { editor.text += `\n${markdown}`; editor.changed(); }; }
  setEditable(value: boolean) { editor.enabled = value; } focus() {} destroy() {}
  format(value: string) { editor.format(value); } setLiveRendering(value: boolean) { editor.rendering(value); }
} }));
class Element {
  value = ''; disabled = false; readOnly = false; open = false;
  showModal() { this.open = true; } close() { this.open = false; } select = vi.fn();
  textContent = ''; hidden = false; dataset: Record<string, string> = {}; attributes = new Map<string, string>();
  listeners = new Map<string, (event?: any) => void>();
  children = new Set<Element>(); focus = vi.fn();
  contains(target: Element): boolean { return target === this || this.children.has(target); }
  addEventListener(name: string, listener: (event?: any) => void) { this.listeners.set(name, listener); }
  removeEventListener(name: string) { this.listeners.delete(name); }
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
  editor.format.mockClear(); editor.rendering.mockClear();
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
  it('selects callout categories without changing body, ignores stale category state and includes selection in close snapshots', () => {
    initialize(); const text = editor.text; expect(document.documentElement.dataset.noteKind).toBe('NOTE');
    elements.get('callout-type')!.listeners.get('click')!(); expect(elements.get('callout-picker')!.hidden).toBe(false);
    elements.get('callout-warning')!.listeners.get('click')!(); expect(editor.text).toBe(text);
    expect(document.documentElement.dataset.noteKind).toBe('WARNING'); expect(elements.get('callout-warning')!.attributes.get('aria-checked')).toBe('true');
    expect(Channel.latest.sent.filter(request => request.action === 'edit').at(-1)).toMatchObject({ text, calloutType: 'WARNING', revision: 2 });
    response({ state: { ...state, calloutType: 'TIP', revision: 1 } }); expect(document.documentElement.dataset.noteKind).toBe('WARNING');
    response({ collect: true, requestId: 'snapshot' }); expect(Channel.latest.sent.filter(request => request.action === 'collected').at(-1)?.calloutType).toBe('WARNING');
    elements.get('callout-caution')!.listeners.get('click')!(); expect(document.documentElement.dataset.noteKind).toBe('WARNING');
  });
  it('opens titles with one pencil click while leaving native caption events alone, with menu and F2 alternatives', () => {
    const title = elements.get('title-display')!, pencil = elements.get('edit-title')!, input = elements.get('note-caption')!;
    pencil.listeners.get('click')!(); expect(elements.get('title-editor')!.open).toBe(false);
    initialize(); expect(title.listeners.has('contextmenu')).toBe(false); expect(title.listeners.has('dblclick')).toBe(false);
    pencil.listeners.get('click')!(); expect(elements.get('title-editor')!.open).toBe(true); expect(pencil.attributes.get('aria-expanded')).toBe('true');
    input.value = 'still typing'; pencil.listeners.get('click')!(); expect(input.value).toBe('still typing');
    elements.get('title-cancel')!.listeners.get('click')!(); expect(pencil.attributes.get('aria-expanded')).toBe('false');
    elements.get('rename-note')!.listeners.get('click')!(); expect(elements.get('title-editor')!.open).toBe(true);
    elements.get('title-cancel')!.listeners.get('click')!();
    documentListeners.get('keydown')!({ key: 'F2', preventDefault() {} }); expect(elements.get('title-editor')!.open).toBe(true);
    expect(Channel.latest.sent.filter(value => value.action === 'edit')).toHaveLength(0);
  });
  it('edits a custom title independently, cancels without edits and includes it in close snapshots', () => {
    initialize(); const text = editor.text;
    const event = { preventDefault: vi.fn() };
    elements.get('edit-title')!.listeners.get('click')!(event);
    expect(elements.get('title-editor')!.open).toBe(true);
    elements.get('note-caption')!.value = '  新标题 <script>  ';
    elements.get('title-form')!.listeners.get('submit')!(event);
    expect(elements.get('title-display')!.textContent).toBe('新标题 <script>'); expect(editor.text).toBe(text);
    expect(Channel.latest.sent.filter(request => request.action === 'edit').at(-1)).toMatchObject({ text, caption: '新标题 <script>', revision: 2 });
    response({ state: { ...state, caption: '', revision: 1 } }); expect(elements.get('title-display')!.textContent).toBe('新标题 <script>');
    elements.get('edit-title')!.listeners.get('click')!({ preventDefault() {} }); elements.get('note-caption')!.value = 'discard';
    elements.get('title-cancel')!.listeners.get('click')!(); expect(Channel.latest.sent.filter(request => request.action === 'edit')).toHaveLength(1);
    response({ collect: true, requestId: 'snapshot' });
    expect(Channel.latest.sent.filter(request => request.action === 'collected').at(-1)).toMatchObject({ caption: '新标题 <script>', text });
  });
  it('loads, clears and rejects invalid titles, and does not submit during title composition', () => {
    response({ state: { ...state, caption: '恢复标题', docTitle: '原文档' }, content: { text: 'saved', revision: 1, caption: '恢复标题' } });
    expect(elements.get('title-display')!.textContent).toBe('恢复标题');
    elements.get('edit-title')!.listeners.get('click')!({ preventDefault() {} }); const field = elements.get('note-caption')!, event = { preventDefault: vi.fn() };
    field.value = 'bad\ntitle'; elements.get('title-form')!.listeners.get('submit')!(event);
    expect(elements.get('title-error')!.textContent).toContain('单行文本'); expect(Channel.latest.sent.filter(request => request.action === 'edit')).toHaveLength(0);
    field.value = ''; field.listeners.get('compositionstart')!(); elements.get('title-form')!.listeners.get('submit')!(event);
    expect(elements.get('title-editor')!.open).toBe(true);
    field.listeners.get('compositionend')!(); elements.get('title-form')!.listeners.get('submit')!(event);
    expect(elements.get('title-display')!.textContent).toBe('原文档');
    expect(Channel.latest.sent.filter(request => request.action === 'edit').at(-1)?.caption).toBe('');
  });
  it('shows organization reminders without editing content and routes the snooze action', () => {
    initialize(); const text = editor.text;
    response({ cleanupReminder: true }); expect(elements.get('cleanup-reminder')!.hidden).toBe(false);
    elements.get('cleanup-later')!.listeners.get('click')!();
    expect(elements.get('cleanup-reminder')!.hidden).toBe(true);
    expect(Channel.latest.sent.some(request => request.action === 'cleanup-snooze')).toBe(true);
    expect(editor.text).toBe(text); expect(Channel.latest.sent.filter(request => request.action === 'edit')).toHaveLength(0);
  });
  it('offers save before confirmation and open afterwards, including partial first writes', () => {
    response({ state: { ...state, siyuanSaved: false, phase: 'local' }, content: { text: 'plugin only', revision: 1 } });
    const open = elements.get('open')!;
    expect(open.attributes.get('aria-label')).toBe('保存到思源中'); expect(open.attributes.has('disabled')).toBe(false);
    response({ state: { ...state, siyuanSaved: false, phase: 'saving' } }); expect(open.attributes.has('disabled')).toBe(true);
    response({ state: { ...state, siyuanSaved: false, phase: 'error' } }); expect(open.attributes.get('aria-label')).toBe('保存到思源中');
    response({ state: { ...state, siyuanSaved: true } }); expect(open.attributes.get('aria-label')).toBe('在思源中打开');
  });
  it('switches source and toolbar without editing text and blocks formatting during IME and collection', () => {
    initialize(); const text = editor.text;
    elements.get('render-mode')!.listeners.get('click')!(); expect(editor.rendering).toHaveBeenCalledWith(false);
    expect(elements.get('render-mode')!.attributes.get('aria-pressed')).toBe('true');
    elements.get('toolbar-toggle')!.listeners.get('click')!(); expect(elements.get('format-toolbar')!.hidden).toBe(false);
    expect(editor.text).toBe(text); expect(Channel.latest.sent.filter(request => request.action === 'edit')).toHaveLength(0);
    editor.composing = true; elements.get('format-bold')!.listeners.get('click')!(); expect(editor.format).not.toHaveBeenCalled();
    editor.composing = false; elements.get('format-bold')!.listeners.get('click')!(); expect(editor.format).toHaveBeenCalledWith('bold');
    response({ collect: true, requestId: 'snapshot' }); elements.get('format-bold')!.listeners.get('click')!(); expect(editor.format).toHaveBeenCalledTimes(1);
    expect(elements.get('format-bold')!.attributes.has('disabled')).toBe(true);
  });
  it('uses English for runtime state, reload confirmation, and disconnect warnings without changing note text', async () => {
    document.documentElement.lang = 'en-US';
    response({ state: { ...state, docTitle: '我的中文标题', showSaved: true }, content: { text: '正文保持原样', revision: 1 } });
    expect(elements.get('status')!.textContent).toBe('Saved to SiYuan');
    expect(elements.get('title-display')!.textContent).toBe('我的中文标题');
    elements.get('reload')!.listeners.get('click')!();
    expect(elements.get('reload')!.textContent).toBe('Click again to discard this window’s changes');
    await vi.advanceTimersByTimeAsync(7500);
    expect(elements.get('status')!.textContent).toContain('Disconnected.');
    elements.get('close')!.listeners.get('click')!();
    expect(elements.get('status')!.textContent).toContain('Select and copy the text first.');
    expect(window.close).not.toHaveBeenCalled();
    expect(editor.text).toBe('正文保持原样');
  });
  const pasteImage = async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'screenshot.png');
    const preventDefault = vi.fn();
    elements.get('editor')!.listeners.get('paste')!({ clipboardData: { files: [file] }, preventDefault, stopPropagation: vi.fn() });
    await vi.waitFor(() => expect(Channel.latest.sent.some(item => item.action === 'upload-images')).toBe(true));
    expect(preventDefault).toHaveBeenCalledOnce();
    return Channel.latest.sent.filter(item => item.action === 'upload-images').at(-1)!;
  };
  it('inserts only a matching confirmed image response and submits it as a normal revision', async () => {
    initialize(); editor.text = 'unsent text';
    const request = await pasteImage(); expect(editor.enabled).toBe(false);
    expect(Channel.latest.sent.some(item => item.action === 'edit' && item.text === 'unsent text')).toBe(true);
    response({ requestId: 'other', imageUpload: { markdown: 'wrong' } });
    expect(editor.text).toBe('unsent text');
    response({ requestId: request.requestId, imageUpload: { markdown: '![截图](assets/screenshot.png)' } });
    await vi.waitFor(() => expect(editor.enabled).toBe(true));
    expect(Channel.latest.sent.at(-1)).toMatchObject({ action: 'edit', text: 'unsent text\n![截图](assets/screenshot.png)' });
  });
  it('refuses close collection during upload and resumes editing after failure', async () => {
    initialize(); const request = await pasteImage();
    response({ collect: true, requestId: 'close-pending' });
    expect(Channel.latest.sent.at(-1)).toMatchObject({ action: 'collected', error: expect.stringContaining('图片正在上传') });
    response({ resume: true }); expect(editor.enabled).toBe(false);
    response({ requestId: request.requestId, imageUpload: { error: 'disk full' } });
    await vi.waitFor(() => expect(editor.enabled).toBe(true));
    expect(editor.text).toBe('saved'); expect(elements.get('status')!.textContent).toContain('disk full');
  });
  it('does not insert a late upload into a stopped window', async () => {
    initialize(); const request = await pasteImage();
    response({ stopped: '插件已停用' });
    response({ requestId: request.requestId, imageUpload: { markdown: 'late image' } });
    expect(editor.text).toBe('saved'); expect(editor.enabled).toBe(false);
  });
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
