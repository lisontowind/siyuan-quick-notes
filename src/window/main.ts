import { t, resolveLocale, localizeWindow } from '../core/i18n';
import './window.css';
import { QuickNoteEditor } from './editor';
import { presentStatus } from './status';
import { bindImageInputs, readImages } from './images';
import type { Request, Response, WindowState, NoteContent } from '../types';

const params = new URLSearchParams(location.search);
document.documentElement.lang = resolveLocale(params.get('lang'));
localizeWindow(document.body);
document.title = t('悬浮速记');
const session = params.get('session') ?? '';
const windowId = params.get('windowId') ?? '';
const channelName = params.get('channel') ?? '';
const $ = (id: string) => document.getElementById(id)!;
const status = $('status');
const titleDisplay = $('title-display');
if (!session || !windowId || !channelName.startsWith('siyuan-quick-notes:')) throw new Error(t('缺少速记会话信息'));
const channel = new BroadcastChannel(channelName);
let revision = 0, connected = false, lastSent = '', pendingAction: Request['action'] | undefined;
let latestState: WindowState | undefined;
let editTimer: ReturnType<typeof setTimeout> | undefined;
let lastHeard = Date.now(), reloadConfirmed = false, frozen = false, stopped = false;
let disconnected = false, closeConfirmed = false, resendEdit = false;
let closeConfirmTimer: ReturnType<typeof setTimeout> | undefined;
let collectionId: string | undefined;
let reloadConfirmTimer: ReturnType<typeof setTimeout> | undefined;
let imageBusy = false;
let imageRequest: { id: string; resolve: (markdown: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
function cancelImageRequest(reason: string): void {
  if (!imageRequest) return;
  const pending = imageRequest; imageRequest = undefined; clearTimeout(pending.timer);
  pending.reject(new Error(reason));
}
const menu = $('actions'), more = $('more');
function closeMenu(): void {
  menu.hidden = true; more.setAttribute('aria-expanded', 'false');
  clearTimeout(reloadConfirmTimer); reloadConfirmed = false; $('reload').textContent = t('重新载入原文');
}
const composing = () => editor.composing;
function changed(): void {
  clearTimeout(editTimer);
  if (!composing() && !frozen) editTimer = setTimeout(sendEdit, 120);
  status.hidden = false;
  const presentation = latestState ? presentStatus(latestState, revision, true) : { text: t('正在编辑…'), phase: 'dirty' };
  status.textContent = presentation.text; status.title = presentation.text; status.dataset.phase = presentation.phase;
}
function compositionEnded(): void {
  if (composing()) return;
  if (collectionId) { collect(collectionId); return; }
  sendEdit();
  if (pendingAction) { const kind = pendingAction; pendingAction = undefined; action(kind); }
}
const editor = new QuickNoteEditor($('editor'), changed, compositionEnded, () => action('save'));
function setEditable(enabled: boolean): void {
  editor.setEditable(enabled && !imageBusy);
  $('insert-image').toggleAttribute('disabled', !enabled || imageBusy);
}

async function insertImages(files: File[], point?: { x: number; y: number }): Promise<void> {
  closeMenu();
  if (!connected || disconnected || frozen || stopped || imageBusy || composing()) {
    showError(t('当前无法插入图片，请等待连接、输入或上传完成')); return;
  }
  const insert = editor.prepareImageInsertion(point);
  sendEdit();
  imageBusy = true; setEditable(false);
  status.hidden = false; status.dataset.phase = 'saving'; status.textContent = t('正在上传图片…');
  try {
    const images = await readImages(files);
    if (stopped || disconnected || frozen) throw new Error(t('连接或窗口状态已变化，请重新插入图片'));
    const markdown = await new Promise<string>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { imageRequest = undefined; reject(new Error(t('图片上传未收到确认，请重新插入图片'))); }, 35000);
      imageRequest = { id, resolve, reject, timer };
      request('upload-images', { requestId: id, images });
    });
    if (stopped || disconnected || frozen) throw new Error(t('连接或窗口状态已变化，请重新插入图片'));
    imageBusy = false; setEditable(true); insert(markdown); sendEdit();
  } catch (error) {
    if (!stopped && !disconnected) showError(`图片未插入：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    imageBusy = false; if (!stopped) setEditable(connected && !disconnected && !frozen);
  }
}
bindImageInputs($('editor'), $('image-picker') as HTMLInputElement, $('insert-image'), (files, point) => { void insertImages(files, point); });

function request(action: Request['action'], extra: Partial<Request> = {}): void {
  if (stopped) return;
  channel.postMessage({ session, windowId, requestId: crypto.randomUUID(), action, ...extra } satisfies Request);
}
function sendEdit(): boolean {
  clearTimeout(editTimer);
  if (!connected || disconnected || composing() || frozen || stopped) return false;
  const text = editor.getText();
  if (text.length > 2_000_000) { showError(t('速记超过 200 万字符，当前内容未提交。请拆分或复制保留。')); return false; }
  if (resendEdit || text !== lastSent) {
    resendEdit = false; lastSent = text;
    request('edit', { text, revision: ++revision });
  }
  return true;
}
function showError(text: string): void { status.hidden = false; status.textContent = t(text); status.dataset.phase = 'error'; }
const pluginActions = ['new', 'open', 'pin', 'save', 'reload', 'copy-note', 'close-draft', 'recent', 'delete', 'minimize'];
function resetCloseConfirmation(): void {
  closeConfirmed = false; clearTimeout(closeConfirmTimer);
  $('close').title = t('关闭'); $('close').setAttribute('aria-label', t('关闭'));
}
function closeDisconnected(): void {
  if (closeConfirmed) { window.close(); return; }
  closeConfirmed = true;
  $('close').title = t('再次点击关闭'); $('close').setAttribute('aria-label', t('再次点击关闭'));
  showError(t('请先选中并复制文本。再次点击关闭将关闭窗口，未保存的内容可能丢失。'));
  closeConfirmTimer = setTimeout(() => {
    resetCloseConfirmation(); showError(t('与插件失去连接，请复制文本后点击关闭。'));
  }, 5000);
}
function action(kind: Request['action']): void {
  if (stopped || disconnected) { if (kind === 'close') closeDisconnected(); return; }
  if (!connected) { showError(t('尚未连接插件，请稍后重试')); return; }
  if (frozen) return;
  if (composing()) { pendingAction = kind; return; }
  if (sendEdit()) request(kind);
}
function collect(requestId: string): void {
  closeMenu();
  if (imageBusy) { request('collected', { requestId, error: t('图片正在上传，已保留窗口，请等待完成后再关闭或重新载入') }); return; }
  collectionId = requestId; pendingAction = undefined; clearTimeout(editTimer);
  if (!connected) { request('collected', { requestId, error: t('窗口尚未完成初始化，内容未确认') }); return; }
  // Let the IME finish before freezing; shutdown waits for this explicit snapshot, not a sleep.
  if (composing()) return;
  frozen = true; setEditable(false);
  const text = editor.getText();
  if (text.length > 2_000_000) { request('collected', { requestId, error: t('速记超过 200 万字符，草稿未提交，请复制文本') }); return; }
  if (text !== lastSent) { lastSent = text; revision++; }
  request('collected', { requestId, text, revision });
}
function render(state: WindowState, content?: NoteContent): void {
  latestState = state;
  if (content && (!connected || content.revision > revision)) {
    revision = content.revision; lastSent = content.text;
    editor.setText(content.text);
    if (!connected) { connected = true; setEditable(!frozen); editor.focus(); }
  }
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  $('pin').setAttribute('aria-pressed', String(state.pinned));
  $('pin').title = state.pinned ? t('取消置顶') : t('置顶');
  $('pin').setAttribute('aria-label', $('pin').title);
  titleDisplay.textContent = state.docTitle || t('新速记');
  titleDisplay.title = `${titleDisplay.textContent} · ${t('拖动移动窗口')}`;
  document.title = `${titleDisplay.textContent} · ${t('悬浮速记')}`;
  const presentation = imageBusy ? { text: t('正在上传图片…'), phase: 'saving', hidden: false } : presentStatus(state, revision, editor.getText() !== lastSent);
  status.dataset.phase = presentation.phase; status.textContent = presentation.text; status.hidden = presentation.hidden;
  status.title = presentation.text;
  $('close-draft').title = state.localRevision >= revision ? t('本机草稿已落盘，可关闭后恢复') : t('先确保本机草稿落盘再关闭');
  $('open').toggleAttribute('disabled', !state.docId); $('reload').toggleAttribute('disabled', !state.docId);
}
channel.onmessage = event => {
  const response = event.data as Response;
  if (stopped || !response || response.session !== session || response.windowId !== windowId) return;
  lastHeard = Date.now();
  if (response.imageUpload && imageRequest && imageRequest.id === response.requestId) {
    const pending = imageRequest; imageRequest = undefined; clearTimeout(pending.timer);
    if (response.imageUpload.error) pending.reject(new Error(response.imageUpload.error));
    else if (response.imageUpload.markdown) pending.resolve(response.imageUpload.markdown);
    else pending.reject(new Error(t('图片上传结果为空')));
  }
  const recovered = disconnected;
  if (recovered) {
    disconnected = false; resetCloseConfirmation();
    for (const id of pluginActions) $(id).toggleAttribute('disabled', false);
    setEditable(connected && !frozen); resendEdit = true;
  }
  if (response.state) render(response.state, response.content);
  if (response.focus) editor.focus();
  if (response.flush) action('close');
  if (response.collect && response.requestId) collect(response.requestId);
  if (response.resume) { collectionId = undefined; frozen = false; setEditable(connected); }
  if (response.stopped) {
    closeMenu();
    stopped = true; frozen = true; collectionId = undefined; setEditable(false);
    cancelImageRequest(t('插件已停用，请重新插入图片'));
    clearInterval(readyTimer); clearTimeout(editTimer); showError(response.stopped);
    for (const id of pluginActions) $(id).setAttribute('disabled', '');
    channel.close();
  }
  if (recovered && !stopped) { sendEdit(); if (!response.state) showError(t('连接已恢复，正在核对保存状态…')); }
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
    reloadConfirmed = true; $('reload').textContent = t('再次点击确认放弃本窗口修改');
    reloadConfirmTimer = setTimeout(() => { reloadConfirmed = false; $('reload').textContent = t('重新载入原文'); }, 5000); return;
  }
  closeMenu(); action('reload');
});
window.addEventListener('blur', () => { closeMenu(); action('save'); });
window.addEventListener('beforeunload', () => { stopped = true; clearInterval(readyTimer); clearTimeout(editTimer); clearTimeout(reloadConfirmTimer); clearTimeout(closeConfirmTimer); clearTimeout(imageRequest?.timer); imageRequest = undefined; channel.close(); editor.destroy(); });
const readyTimer = setInterval(() => {
  request(connected ? 'heartbeat' : 'ready');
  if (!disconnected && Date.now() - lastHeard > 6000) {
    disconnected = true; pendingAction = undefined; clearTimeout(editTimer); closeMenu();
    cancelImageRequest(t('与插件失去连接，请重新插入图片'));
    setEditable(false);
    for (const id of pluginActions) $(id).setAttribute('disabled', '');
    showError(t('与插件失去连接，当前输入可能尚未保存。请复制文本后点击关闭。'));
  }
}, 1500);
request('ready');
setTimeout(() => { if (!connected && !stopped && !disconnected) showError(t('插件连接失败。请保留窗口内容并检查主窗口中的插件状态。')); }, 10000);
