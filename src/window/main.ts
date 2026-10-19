import { t, resolveLocale, localizeWindow } from '../core/i18n';
import './window.css';
import { QuickNoteEditor } from './editor';
import { presentStatus } from './status';
import { bindImageInputs, readImages } from './images';
import type { Request, Response, WindowState, NoteContent } from '../types';
import type { FormatAction } from './formatting';
import { FormatToolbar } from './toolbar';
import { windowIcons } from './icons';
import type { ToolbarLayout } from '../core/toolbar';
import { calloutTypes, validCalloutType, type CalloutType } from '../core/callout';
import { isSavedToSiYuan, validNoteTitle } from '../core/identity';

const params = new URLSearchParams(location.search);
document.documentElement.lang = resolveLocale(params.get('lang'));
localizeWindow(document.body);
document.title = t('悬浮速记');
windowIcons();
const session = params.get('session') ?? '';
const windowId = params.get('windowId') ?? '';
const channelName = params.get('channel') ?? '';
const $ = (id: string) => document.getElementById(id)!;
const status = $('status');
const titleDisplay = $('title-display'), titleEditButton = $('edit-title');
if (!session || !windowId || !channelName.startsWith('siyuan-quick-notes:')) throw new Error(t('缺少速记会话信息'));
const channel = new BroadcastChannel(channelName);
let caption = '', lastSentCaption = '';
let calloutType: CalloutType = 'NOTE', lastSentCalloutType: CalloutType = 'NOTE';
let revision = 0, connected = false, lastSent = '', pendingAction: Request['action'] | undefined;
let latestState: WindowState | undefined;
let editTimer: ReturnType<typeof setTimeout> | undefined;
let lastHeard = Date.now(), reloadConfirmed = false, frozen = false, stopped = false;
let disconnected = false, closeConfirmed = false, resendEdit = false;
let closeConfirmTimer: ReturnType<typeof setTimeout> | undefined;
let collectionId: string | undefined;
let reloadConfirmTimer: ReturnType<typeof setTimeout> | undefined;
let imageBusy = false;
let reminderTimer: ReturnType<typeof setTimeout> | undefined;
function dismissReminder(): void { $('cleanup-reminder').hidden = true; clearTimeout(reminderTimer); }
$('cleanup-open').addEventListener('click', () => { dismissReminder(); action('cleanup'); });
$('cleanup-later').addEventListener('click', () => { dismissReminder(); action('cleanup-snooze'); });
$('cleanup-dismiss').addEventListener('click', dismissReminder);
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
const titleDialog = $('title-editor') as HTMLDialogElement;
const titleInput = $('note-caption') as HTMLInputElement;
let titleComposing = false;
function updateTitle(): void {
  titleDisplay.textContent = caption || latestState?.docTitle || t('新速记');
  titleDisplay.title = `${titleDisplay.textContent} · ${t('拖动移动窗口，点击铅笔修改标题')}`;
  document.title = `${titleDisplay.textContent} · ${t('悬浮速记')}`;
}
function openTitleEditor(): void {
  if (titleDialog.open || !connected || disconnected || stopped || frozen || imageBusy || composing()) return;
  closeMenu(); closeCalloutPicker(); formatToolbar.close();
  titleInput.value = caption; $('title-error').textContent = ''; titleComposing = false;
  titleDialog.showModal(); titleEditButton.setAttribute('aria-expanded', 'true'); titleInput.focus(); titleInput.select();
}
function cancelTitleEdit(): void {
  if (titleDialog.open) titleDialog.close(); titleComposing = false; titleEditButton.setAttribute('aria-expanded', 'false');
}
titleEditButton.addEventListener('click', openTitleEditor);
titleDialog.addEventListener('close', () => { titleComposing = false; titleEditButton.setAttribute('aria-expanded', 'false'); });
$('title-cancel').addEventListener('click', cancelTitleEdit);
$('rename-note').addEventListener('click', openTitleEditor);
titleInput.addEventListener('compositionstart', () => { titleComposing = true; });
titleInput.addEventListener('compositionend', () => { titleComposing = false; });
$('title-form').addEventListener('submit', event => {
  event.preventDefault();
  if (titleComposing || !connected || disconnected || stopped || frozen || imageBusy) return;
  const value = titleInput.value.trim();
  if (!validNoteTitle(value)) { $('title-error').textContent = t('便签标题须为不超过 200 字符的单行文本'); return; }
  if (value !== caption) {
    const previous = caption; caption = value;
    if (!sendEdit()) { caption = previous; return; }
    updateTitle();
  }
  cancelTitleEdit(); titleEditButton.focus();
});
const calloutPicker = $('callout-picker'), calloutButton = $('callout-type');
function closeCalloutPicker(restoreFocus = false): void {
  calloutPicker.hidden = true; calloutButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) calloutButton.focus();
}
function applyCallout(): void {
  document.documentElement.dataset.noteKind = calloutType;
  calloutButton.title = `${t('提示块类别')} · ${calloutType}`; calloutButton.setAttribute('aria-label', calloutButton.title);
  for (const type of calloutTypes) $(`callout-${type.toLowerCase()}`).setAttribute('aria-checked', String(type === calloutType));
}
function openCalloutPicker(): void {
  if (!connected || disconnected || stopped || frozen || imageBusy || composing() || titleDialog.open) return;
  closeMenu(); formatToolbar.close();
  calloutPicker.hidden = false; calloutButton.setAttribute('aria-expanded', 'true'); $(`callout-${calloutType.toLowerCase()}`).focus();
}
calloutButton.addEventListener('click', () => { if (calloutPicker.hidden) openCalloutPicker(); else closeCalloutPicker(true); });
calloutButton.addEventListener('keydown', event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); openCalloutPicker(); } });
for (const type of calloutTypes) {
  const item = $(`callout-${type.toLowerCase()}`);
  item.addEventListener('click', () => {
    if (!connected || disconnected || stopped || frozen || imageBusy || composing()) return;
    if (type !== calloutType) {
      const previous = calloutType; calloutType = type;
      if (!sendEdit()) { calloutType = previous; return; }
      applyCallout();
    }
    closeCalloutPicker(true);
  });
  item.addEventListener('keydown', event => {
    const index = calloutTypes.indexOf(type);
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? calloutTypes.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + calloutTypes.length) % calloutTypes.length;
      $(`callout-${calloutTypes[next].toLowerCase()}`).focus();
    }
  });
}
const dismissCalloutPicker = (event: Event) => {
  const target = event.target as Node | null;
  if (target && !calloutPicker.contains(target) && !calloutButton.contains(target)) closeCalloutPicker();
};
document.addEventListener('pointerdown', dismissCalloutPicker, true);
document.addEventListener('focusin', dismissCalloutPicker);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !calloutPicker.hidden) { event.preventDefault(); closeCalloutPicker(true); }
  else if (event.key === 'Tab' && !calloutPicker.hidden) closeCalloutPicker(true);
});
closeCalloutPicker(); applyCallout();
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
let liveRendering = true;
$('render-mode').addEventListener('click', () => {
  if (composing() || frozen && !stopped && !disconnected || imageBusy) return;
  liveRendering = !liveRendering; editor.setLiveRendering(liveRendering);
  $('render-mode').title = t(liveRendering ? '显示源码' : '返回渲染');
  $('render-mode').setAttribute('aria-label', $('render-mode').title);
  $('render-mode').setAttribute('aria-pressed', String(!liveRendering)); closeMenu(); editor.focus();
});
let toolbarVisible = false;
let insertLink: ((url: string) => void) | undefined;
let layoutRequest: { id: string; resolve: (layout: ToolbarLayout) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
const formatToolbar = new FormatToolbar($('format-toolbar'), kind => {
  if (!connected || disconnected || frozen || stopped || imageBusy || composing()) return;
  if (kind === 'image') ($('image-picker') as HTMLInputElement).click();
  else if (kind === 'link') {
    insertLink = editor.prepareLinkInsertion(); $('link-editor').hidden = false;
    ($('link-url') as HTMLInputElement).value = 'https://'; $('link-url').focus();
  } else editor.format(kind as FormatAction);
}, level => { if (!composing() && !frozen && !imageBusy && !stopped && !disconnected) editor.setHeading(level); }, layout => new Promise((resolve, reject) => {
  if (!connected || disconnected || stopped) { reject(new Error(t('与插件失去连接，请重新打开列表。'))); return; }
  const id = crypto.randomUUID();
  const timer = setTimeout(() => { layoutRequest = undefined; reject(new Error(t('工具栏设置未收到确认，请重试'))); }, 12000);
  layoutRequest = { id, resolve, reject, timer }; request('save-toolbar', { requestId: id, toolbarLayout: layout });
}), showError);
$('toolbar-toggle').addEventListener('click', () => {
  toolbarVisible = !toolbarVisible; $('format-toolbar').hidden = !toolbarVisible;
  if (!toolbarVisible) { formatToolbar.close(); $('link-editor').hidden = true; insertLink = undefined; }
  $('toolbar-toggle').title = t(toolbarVisible ? '隐藏工具栏' : '显示工具栏');
  $('toolbar-toggle').setAttribute('aria-label', $('toolbar-toggle').title);
  $('toolbar-toggle').setAttribute('aria-expanded', String(toolbarVisible));
});
$('link-editor').addEventListener('submit', event => {
  event.preventDefault();
  if (!insertLink || composing() || frozen || stopped || disconnected || imageBusy) return;
  const url = ($('link-url') as HTMLInputElement).value.trim();
  if (!/^https?:\/\/[^\s<>]+$/i.test(url)) { showError(t('请输入有效的 HTTP 或 HTTPS 链接')); return; }
  try { insertLink(url); $('link-editor').hidden = true; insertLink = undefined; }
  catch (error) { showError(error instanceof Error ? error.message : String(error)); }
});
$('link-cancel').addEventListener('click', () => { $('link-editor').hidden = true; insertLink = undefined; editor.focus(); });
function setEditable(enabled: boolean): void {
  editor.setEditable(enabled && !imageBusy);
  calloutButton.toggleAttribute('disabled', !enabled || imageBusy);
  $('rename-note').toggleAttribute('disabled', !enabled || imageBusy);
  titleEditButton.toggleAttribute('disabled', !enabled || imageBusy);
  if (!enabled || imageBusy) closeCalloutPicker();
  $('insert-image').toggleAttribute('disabled', !enabled || imageBusy);
  formatToolbar.setEnabled(enabled && !imageBusy);
  if (!enabled || imageBusy) { $('link-editor').hidden = true; insertLink = undefined; }
}
setEditable(false);

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
  if (resendEdit || text !== lastSent || caption !== lastSentCaption || calloutType !== lastSentCalloutType) {
    resendEdit = false; lastSent = text; lastSentCaption = caption; lastSentCalloutType = calloutType;
    request('edit', { text, caption, calloutType, revision: ++revision });
  }
  return true;
}
function showError(text: string): void { status.hidden = false; status.textContent = t(text); status.dataset.phase = 'error'; }
const pluginActions = ['edit-title', 'rename-note', 'new', 'open', 'pin', 'save', 'reload', 'copy-note', 'close-draft', 'recent', 'delete', 'minimize'];
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
  formatToolbar.close();
  closeMenu(); closeCalloutPicker(); cancelTitleEdit();
  if (imageBusy) { request('collected', { requestId, error: t('图片正在上传，已保留窗口，请等待完成后再关闭或重新载入') }); return; }
  collectionId = requestId; pendingAction = undefined; clearTimeout(editTimer);
  if (!connected) { request('collected', { requestId, error: t('窗口尚未完成初始化，内容未确认') }); return; }
  // Let the IME finish before freezing; shutdown waits for this explicit snapshot, not a sleep.
  if (composing()) return;
  frozen = true; setEditable(false);
  const text = editor.getText();
  if (text.length > 2_000_000) { request('collected', { requestId, error: t('速记超过 200 万字符，草稿未提交，请复制文本') }); return; }
  if (text !== lastSent || caption !== lastSentCaption || calloutType !== lastSentCalloutType) { lastSent = text; lastSentCaption = caption; lastSentCalloutType = calloutType; revision++; }
  request('collected', { requestId, text, caption, calloutType, revision });
}
function render(state: WindowState, content?: NoteContent): void {
  latestState = state;
  if (content && (!connected || content.revision > revision)) {
    revision = content.revision; lastSent = content.text; caption = lastSentCaption = content.caption ?? '';
    calloutType = lastSentCalloutType = content.calloutType ?? 'NOTE';
    editor.setText(content.text);
    if (!connected) { connected = true; setEditable(!frozen); editor.focus(); }
  }
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  $('pin').setAttribute('aria-pressed', String(state.pinned));
  $('pin').title = state.pinned ? t('取消置顶') : t('置顶');
  $('pin').setAttribute('aria-label', $('pin').title);
  if (state.revision >= revision && typeof state.caption === 'string') caption = state.caption;
  if (state.revision >= revision && validCalloutType(state.calloutType)) calloutType = state.calloutType;
  applyCallout(); updateTitle();
  const presentation = imageBusy ? { text: t('正在上传图片…'), phase: 'saving', hidden: false } : presentStatus(state, revision, editor.getText() !== lastSent);
  status.dataset.phase = presentation.phase; status.textContent = presentation.text; status.hidden = presentation.hidden;
  status.title = presentation.text;
  $('close-draft').title = state.localRevision >= revision ? t('本机草稿已落盘，可关闭后恢复') : t('先确保本机草稿落盘再关闭');
  const linked = isSavedToSiYuan(state);
  $('open').title = t(linked ? '在思源中打开' : '保存到思源中');
  $('open').setAttribute('aria-label', $('open').title);
  $('open').toggleAttribute('disabled', state.phase === 'saving'); $('reload').toggleAttribute('disabled', !state.docId);
  for (const id of ['save', 'reload', 'open']) if (state.removed) $(id).setAttribute('disabled', '');
}
channel.onmessage = event => {
  const response = event.data as Response;
  if (stopped || !response || response.session !== session || response.windowId !== windowId) return;
  lastHeard = Date.now();
  if (response.cleanupReminder) {
    $('cleanup-reminder').hidden = false; clearTimeout(reminderTimer); reminderTimer = setTimeout(dismissReminder, 15000);
  }
  if (response.toolbarLayout) formatToolbar.update(response.toolbarLayout);
  if (layoutRequest && response.requestId === layoutRequest.id && response.toolbarLayout) {
    const pending = layoutRequest; layoutRequest = undefined; clearTimeout(pending.timer);
    if (response.toolbarError) pending.reject(new Error(t(response.toolbarError)));
    else {
      pending.resolve(response.toolbarLayout);
      if (status.textContent?.startsWith(t('工具栏顺序未保存'))) { status.textContent = t('工具栏顺序已保存'); status.dataset.phase = 'saved'; }
    }
  }
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
  if (response.focus && !titleDialog.open) editor.focus();
  if (response.flush) action('close');
  if (response.collect && response.requestId) collect(response.requestId);
  if (response.resume) { collectionId = undefined; frozen = false; setEditable(connected); }
  if (response.stopped) {
    cancelTitleEdit();
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
  if (event.key === 'F2' && !event.defaultPrevented) { event.preventDefault(); openTitleEditor(); }
  if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(); more.focus(); }
});
$('reload').addEventListener('click', () => {
  if (!reloadConfirmed) {
    reloadConfirmed = true; $('reload').textContent = t('再次点击确认放弃本窗口修改');
    reloadConfirmTimer = setTimeout(() => { reloadConfirmed = false; $('reload').textContent = t('重新载入原文'); }, 5000); return;
  }
  closeMenu(); action('reload');
});
window.addEventListener('blur', () => { closeMenu(); closeCalloutPicker(); action('save'); });
window.addEventListener('beforeunload', () => { stopped = true; dismissReminder(); clearInterval(readyTimer); clearTimeout(editTimer); clearTimeout(reloadConfirmTimer); clearTimeout(closeConfirmTimer); clearTimeout(imageRequest?.timer); clearTimeout(layoutRequest?.timer); imageRequest = undefined; channel.close(); formatToolbar.destroy(); editor.destroy(); });
const readyTimer = setInterval(() => {
  request(connected ? 'heartbeat' : 'ready');
  if (!disconnected && Date.now() - lastHeard > 6000) {
    disconnected = true; pendingAction = undefined; clearTimeout(editTimer); closeMenu();
    cancelImageRequest(t('与插件失去连接，请重新插入图片'));
    closeCalloutPicker(); cancelTitleEdit(); setEditable(false);
    for (const id of pluginActions) $(id).setAttribute('disabled', '');
    showError(t('与插件失去连接，当前输入可能尚未保存。请复制文本后点击关闭。'));
  }
}, 1500);
request('ready');
setTimeout(() => { if (!connected && !stopped && !disconnected) showError(t('插件连接失败。请保留窗口内容并检查主窗口中的插件状态。')); }, 10000);
