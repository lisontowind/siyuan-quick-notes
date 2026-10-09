import './window.css';
import { QuickNoteEditor } from './editor';
import { presentStatus } from './status';
import type { Request, Response, WindowState, NoteContent } from '../types';

const params = new URLSearchParams(location.search);
const session = params.get('session') ?? '';
const windowId = params.get('windowId') ?? '';
const channelName = params.get('channel') ?? '';
const $ = (id: string) => document.getElementById(id)!;
const status = $('status');
if (!session || !windowId || !channelName.startsWith('siyuan-quick-notes:')) throw new Error('缺少速记会话信息');
const channel = new BroadcastChannel(channelName);
let revision = 0, connected = false, lastSent = '', pendingAction: Request['action'] | undefined;
let editTimer: ReturnType<typeof setTimeout> | undefined;
let lastHeard = Date.now(), reloadConfirmed = false, frozen = false, stopped = false;
let disconnected = false, closeConfirmed = false, resendEdit = false;
let closeConfirmTimer: ReturnType<typeof setTimeout> | undefined;
let collectionId: string | undefined;
let reloadConfirmTimer: ReturnType<typeof setTimeout> | undefined;
const menu = $('actions'), more = $('more');
function closeMenu(): void {
  menu.hidden = true; more.setAttribute('aria-expanded', 'false');
  clearTimeout(reloadConfirmTimer); reloadConfirmed = false; $('reload').textContent = '重新载入原文';
}
const editor = new QuickNoteEditor($('editor'), () => {
  clearTimeout(editTimer);
  if (!editor.composing && !frozen) editTimer = setTimeout(sendEdit, 120);
  status.hidden = false; status.textContent = '正在编辑…'; status.dataset.phase = 'dirty';
}, () => {
  if (collectionId) { collect(collectionId); return; }
  sendEdit();
  if (pendingAction) { const kind = pendingAction; pendingAction = undefined; action(kind); }
}, () => action('save'));

function request(action: Request['action'], extra: Partial<Request> = {}): void {
  if (stopped) return;
  channel.postMessage({ session, windowId, requestId: crypto.randomUUID(), action, ...extra } satisfies Request);
}
function sendEdit(): boolean {
  clearTimeout(editTimer);
  if (!connected || disconnected || editor.composing || frozen || stopped) return false;
  const text = editor.getText();
  if (text.length > 2_000_000) { showError('速记超过 200 万字符，当前内容未提交。请拆分或复制保留。'); return false; }
  if (resendEdit || text !== lastSent) { resendEdit = false; lastSent = text; request('edit', { text, revision: ++revision }); }
  return true;
}
function showError(text: string): void { status.hidden = false; status.textContent = text; status.dataset.phase = 'error'; }
const pluginActions = ['new', 'open', 'pin', 'save', 'reload', 'copy-note', 'close-draft', 'recent', 'delete', 'minimize'];
function resetCloseConfirmation(): void {
  closeConfirmed = false; clearTimeout(closeConfirmTimer);
  $('close').title = '关闭'; $('close').setAttribute('aria-label', '关闭');
}
function closeDisconnected(): void {
  if (closeConfirmed) { window.close(); return; }
  closeConfirmed = true;
  $('close').title = '再次点击关闭'; $('close').setAttribute('aria-label', '再次点击关闭');
  showError('请先选中并复制文本。再次点击关闭将关闭窗口，未保存的内容可能丢失。');
  closeConfirmTimer = setTimeout(() => {
    resetCloseConfirmation(); showError('与插件失去连接，请复制文本后点击关闭。');
  }, 5000);
}
function action(kind: Request['action']): void {
  if (stopped || disconnected) { if (kind === 'close') closeDisconnected(); return; }
  if (!connected) { showError('尚未连接插件，请稍后重试'); return; }
  if (frozen) return;
  if (editor.composing) { pendingAction = kind; return; }
  if (sendEdit()) request(kind);
}
function collect(requestId: string): void {
  closeMenu();
  collectionId = requestId; pendingAction = undefined; clearTimeout(editTimer);
  if (!connected) { request('collected', { requestId, error: '窗口尚未完成初始化，内容未确认' }); return; }
  // Let the IME finish before freezing; shutdown waits for this explicit snapshot, not a sleep.
  if (editor.composing) return;
  frozen = true; editor.setEditable(false);
  const text = editor.getText();
  if (text.length > 2_000_000) { request('collected', { requestId, error: '速记超过 200 万字符，草稿未提交，请复制文本' }); return; }
  if (text !== lastSent) { lastSent = text; revision++; }
  request('collected', { requestId, text, revision });
}
function render(state: WindowState, content?: NoteContent): void {
  if (content && (!connected || content.revision > revision)) {
    revision = content.revision; lastSent = content.text; editor.setText(content.text);
    if (!connected) { connected = true; editor.setEditable(!frozen); editor.focus(); }
  }
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  $('pin').setAttribute('aria-pressed', String(state.pinned));
  $('pin').title = state.pinned ? '取消置顶' : '置顶';
  $('pin').setAttribute('aria-label', $('pin').title);
  $('title').textContent = state.title;
  $('title').title = state.title;
  document.title = `${state.title} · 悬浮速记`;
  const presentation = presentStatus(state, revision, editor.getText() !== lastSent);
  status.dataset.phase = presentation.phase; status.textContent = presentation.text; status.hidden = presentation.hidden;
  $('close-draft').title = state.localRevision >= revision ? '本机草稿已落盘，可关闭后恢复' : '先确保本机草稿落盘再关闭';
  $('open').toggleAttribute('disabled', !state.docId); $('reload').toggleAttribute('disabled', !state.docId);
}
channel.onmessage = event => {
  const response = event.data as Response;
  if (stopped || !response || response.session !== session || response.windowId !== windowId) return;
  lastHeard = Date.now();
  const recovered = disconnected;
  if (recovered) {
    disconnected = false; resetCloseConfirmation();
    for (const id of pluginActions) $(id).toggleAttribute('disabled', false);
    editor.setEditable(connected && !frozen); resendEdit = true;
  }
  if (response.state) render(response.state, response.content);
  if (response.focus) editor.focus();
  if (response.flush) action('close');
  if (response.collect && response.requestId) collect(response.requestId);
  if (response.resume) { collectionId = undefined; frozen = false; editor.setEditable(connected); }
  if (response.stopped) {
    closeMenu();
    stopped = true; frozen = true; collectionId = undefined; editor.setEditable(false);
    clearInterval(readyTimer); clearTimeout(editTimer); showError(response.stopped);
    for (const id of pluginActions) $(id).setAttribute('disabled', '');
    channel.close();
  }
  if (recovered && !stopped) { sendEdit(); if (!response.state) showError('连接已恢复，正在核对保存状态…'); }
};
for (const [id, kind] of Object.entries({ new: 'new', open: 'open', pin: 'pin', minimize: 'minimize', close: 'close', save: 'save', 'copy-note': 'copy-note', 'close-draft': 'close-draft', recent: 'recent', delete: 'delete' } as const)) {
  $(id).addEventListener('click', () => { closeMenu(); action(kind); });
}
closeMenu();
more.addEventListener('click', () => {
  if (!menu.hidden) closeMenu();
  else { menu.hidden = false; more.setAttribute('aria-expanded', 'true'); }
});
function dismissOutside(event: Event): void {
  const target = event.target as Node | null;
  if (target && !menu.contains(target) && !more.contains(target)) closeMenu();
}
document.addEventListener('pointerdown', dismissOutside, true);
document.addEventListener('focusin', dismissOutside);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(); more.focus(); }
});
$('reload').addEventListener('click', () => {
  if (!reloadConfirmed) {
    reloadConfirmed = true; $('reload').textContent = '再次点击确认放弃本窗口修改';
    reloadConfirmTimer = setTimeout(() => { reloadConfirmed = false; $('reload').textContent = '重新载入原文'; }, 5000); return;
  }
  closeMenu(); action('reload');
});
window.addEventListener('blur', () => { closeMenu(); action('save'); });
window.addEventListener('beforeunload', () => { clearInterval(readyTimer); clearTimeout(editTimer); clearTimeout(reloadConfirmTimer); clearTimeout(closeConfirmTimer); channel.close(); editor.destroy(); });
const readyTimer = setInterval(() => {
  request(connected ? 'heartbeat' : 'ready');
  if (!disconnected && Date.now() - lastHeard > 6000) {
    disconnected = true; pendingAction = undefined; clearTimeout(editTimer); closeMenu();
    editor.setEditable(false);
    for (const id of pluginActions) $(id).setAttribute('disabled', '');
    showError('与插件失去连接，当前输入可能尚未保存。请复制文本后点击关闭。');
  }
}, 1500);
request('ready');
setTimeout(() => { if (!connected && !stopped && !disconnected) showError('插件连接失败。请保留窗口内容并检查主窗口中的插件状态。'); }, 10000);
