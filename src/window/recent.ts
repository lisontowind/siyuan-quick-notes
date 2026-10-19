import './window.css';
import './recent.css';
import '../styles/note-colors.css';
import { validCalloutType } from '../core/callout';
import { localizeWindow, resolveLocale, t } from '../core/i18n';
import type { RecentAction, RecentItem, RecentPage, RecentRequest, RecentResponse } from '../core/recent';
import { WindowSettingsPanel } from './settings-panel';
import { windowIcons } from './icons';
import { CleanupPanel } from './cleanup-panel';
import { DraftVersionsPanel } from './draft-versions';
import '../styles/cleanup.css';

const params = new URLSearchParams(location.search), session = params.get('session') || '', channelName = params.get('channel') || '';
if (!session || channelName !== `siyuan-quick-notes:recent:${session}`) throw new Error('缺少列表会话信息');
document.documentElement.lang = resolveLocale(params.get('lang')); localizeWindow(document.body);
document.title = t('速记列表');
windowIcons();
const channel = new BroadcastChannel(channelName);
const search = document.getElementById('search') as HTMLInputElement, results = document.getElementById('results')!, status = document.getElementById('recent-status')!;
const footer = document.getElementById('recent-footer')!, organize = document.getElementById('organize') as HTMLButtonElement,
  snooze = document.getElementById('cleanup-snooze') as HTMLButtonElement,
  otherDevices = document.getElementById('other-devices') as HTMLButtonElement,
  more = document.getElementById('more') as HTMLButtonElement, menu = document.getElementById('actions')!;
let items: RecentItem[] = [], connected = false, lastHeard = Date.now(), stopped = false;
let errorText = '';
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const deleteDialog = document.createElement('dialog'); deleteDialog.className = 'delete-confirm';
const deleteTitle = document.createElement('h2'); deleteTitle.id = 'delete-title'; deleteTitle.textContent = t('从插件删除这条速记？');
const deleteSummary = document.createElement('p'), deleteHelp = document.createElement('p');
deleteHelp.textContent = t('将清理插件中的草稿、最近记录和窗口记录，并同步移除其他设备的列表记录。已保存到思源的正文保留。尚未保存的本机内容将被删除，此操作不可通过插件撤销。');
const deleteCancel = document.createElement('button'), deleteConfirm = document.createElement('button');
deleteCancel.textContent = t('取消'); deleteCancel.autofocus = true; deleteConfirm.textContent = t('删除'); deleteConfirm.className = 'danger';
const deleteActions = document.createElement('div'); deleteActions.className = 'confirm-actions'; deleteActions.append(deleteCancel, deleteConfirm);
deleteDialog.setAttribute('aria-labelledby', 'delete-title'); deleteDialog.append(deleteTitle, deleteSummary, deleteHelp, deleteActions); document.body.append(deleteDialog);
let deletingItem: RecentItem | undefined, deleteOrigin: HTMLElement | undefined;
function closeDelete(): void { deleteDialog.close(); deletingItem = undefined; deleteOrigin?.focus({ preventScroll: true }); }
deleteCancel.onclick = closeDelete;
deleteDialog.addEventListener('cancel', event => { event.preventDefault(); if (!deleteConfirm.disabled) closeDelete(); });
deleteConfirm.onclick = () => {
  if (!deletingItem || !connected || pending.size) return;
  const id = deletingItem.id; closeDelete(); request('delete', id);
};
const settingsRequests = new Map<string, { resolve: (response: RecentResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function cleanupRequest(action: RecentAction, extra: Partial<RecentRequest> = {}): Promise<RecentResponse> {
  if (stopped || !connected) return Promise.reject(new Error(t('与插件失去连接，请重新打开列表。')));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { settingsRequests.delete(requestId); reject(new Error(t('操作未确认，请刷新后重试'))); }, 45000);
    settingsRequests.set(requestId, { resolve, reject, timer });
    channel.postMessage({ ...extra, session, windowId: 'recent', requestId, action } satisfies RecentRequest);
  });
}
const cleanupPanel = new CleanupPanel(document.getElementById('cleanup-panel')!, {
  snapshot: async () => { const value = await cleanupRequest('cleanup'); if (!value.cleanup) throw new Error(t('整理数据读取失败')); return value.cleanup; },
  start: async (mode, selections, discard) => { const value = await cleanupRequest('cleanup-start', { mode, selections, discard }); if (!value.cleanupProgress) throw new Error(t('操作未确认，请刷新后重试')); return value.cleanupProgress; },
  cancel: async () => { await cleanupRequest('cleanup-cancel'); }, snooze: async () => { await cleanupRequest('cleanup-snooze'); },
});
const versionsView = new DraftVersionsPanel(document.getElementById('drafts-panel')!, {
  load: async id => { const value = await cleanupRequest('draft-versions', { id }); if (!value.draftVersions) throw new Error(t('草稿版本已变化，请刷新后重试')); return value.draftVersions; },
  choose: async (id, version, token, copy) => { await cleanupRequest('choose-draft-version', { id, version, token, copy }); },
}, t, () => showPage('notes', true));
versionsView.setConnected(false);
function closeMenu(restoreFocus = false): void {
  menu.hidden = true; more.setAttribute('aria-expanded', 'false');
  if (restoreFocus) more.focus();
}
function openMenu(last = false): void {
  if (!connected) return;
  menu.hidden = false; more.setAttribute('aria-expanded', 'true');
  const entries = menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
  entries[last ? entries.length - 1 : 0]?.focus();
}
more.addEventListener('click', () => { if (menu.hidden) openMenu(); else closeMenu(true); });
more.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(event.key === 'ArrowUp'); }
});
menu.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const entries = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if (!entries.length) return;
  const index = entries.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
  entries[next].focus();
});
function dismissOutside(event: Event): void {
  const target = event.target as Node | null;
  if (target && !menu.contains(target) && !more.contains(target)) closeMenu();
}
document.addEventListener('pointerdown', dismissOutside, true);
document.addEventListener('focusin', dismissOutside);
document.addEventListener('keydown', event => {
  if (menu.hidden) {
    if (event.key === 'Escape' && currentPage === 'drafts') { event.preventDefault(); showPage('notes', true); }
    return;
  }
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  else if (event.key === 'Tab') closeMenu(true);
});
otherDevices.addEventListener('click', () => showDrafts());
organize.addEventListener('click', () => { closeMenu(true); showPage('cleanup'); });
snooze.addEventListener('click', () => {
  snooze.disabled = true;
  void cleanupRequest('cleanup-snooze').then(() => { snooze.hidden = true; status.textContent = t('已延后 7 天提醒'); })
    .catch(error => { errorText = error.message; status.textContent = errorText; }).finally(() => { snooze.disabled = !connected; });
});
const settingsPanel = new WindowSettingsPanel(document.getElementById('settings-panel')!, (action, settings) => {
  if (stopped || !connected) return Promise.reject(new Error(t('与插件失去连接，请重新打开列表。')));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { settingsRequests.delete(requestId); reject(new Error(t('设置操作未确认，请重试'))); }, 45000);
    settingsRequests.set(requestId, { resolve, reject, timer });
    channel.postMessage({ session, windowId: 'recent', requestId, action, settings } satisfies RecentRequest);
  });
});
let currentPage: RecentPage = 'notes';
let listScroll = 0;
let draftId: string | undefined;
function showDrafts(id?: string): void { draftId = id; showPage('drafts'); }
function showPage(page: RecentPage, notify = false): void {
  closeMenu();
  const previousPage = currentPage;
  if (currentPage === 'notes') listScroll = results.scrollTop;
  currentPage = page;
  for (const name of ['notes', 'settings', 'cleanup', 'drafts'] as const) {
    document.getElementById(`${name}-panel`)!.hidden = name !== page;
  }
  document.getElementById('back')!.hidden = page === 'notes';
  document.getElementById('settings')!.setAttribute('aria-pressed', String(page === 'settings'));
  const title = t({ notes: '速记列表', settings: '设置', cleanup: '整理便签', drafts: draftId ? '恢复本机草稿' : '其他设备草稿' }[page]);
  document.getElementById('title-display')!.textContent = title;
  if (page === 'drafts') document.getElementById('drafts-panel')!.setAttribute('aria-label', title);
  status.hidden = page !== 'notes';
  footer.hidden = page !== 'notes';
  if (page === 'notes') results.scrollTop = listScroll;
  if (page === 'settings') settingsPanel.open(); else if (notify && page === 'notes') request('notes');
  if (page === 'cleanup') cleanupPanel.open(); else cleanupPanel.close();
  if (page === 'drafts') void versionsView.show(draftId); else versionsView.close();
  if (page === 'notes' && previousPage === 'drafts') more.focus({ preventScroll: true });
}
document.getElementById('settings')!.addEventListener('click', () => { if (currentPage !== 'settings') showPage('settings', true); });
document.getElementById('back')!.addEventListener('click', () => showPage('notes', true));
function cancelSettingsRequests(): void {
  for (const pending of settingsRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error(t('与插件失去连接，请重新打开列表。'))); }
  settingsRequests.clear();
}
function request(action: RecentAction, id?: string): void {
  if (stopped) return;
  const requestId = crypto.randomUUID();
  if (['open', 'siyuan', 'delete', 'new'].includes(action)) {
    if (pending.size) return;
    pending.set(requestId, setTimeout(() => { pending.delete(requestId); errorText = t('操作未确认，请刷新后重试'); status.textContent = errorText; render(); }, action === 'siyuan' ? 45000 : 10000)); render();
  }
  if (['refresh', 'open', 'siyuan', 'delete', 'new'].includes(action)) { errorText = ''; if (connected) status.textContent = ''; }
  channel.postMessage({ session, windowId: 'recent', requestId, action, id } satisfies RecentRequest);
}
function render(): void {
  const scroll = currentPage === 'notes' ? results.scrollTop : listScroll, focus = document.activeElement as HTMLElement | null;
  const focusedId = focus?.dataset.id, focusedAction = focus?.dataset.action;
  const query = search.value.trim().toLocaleLowerCase(), fragment = document.createDocumentFragment();
  for (const item of items) {
    const updated = new Date(item.updatedAt), fullDate = updated.toLocaleString(document.documentElement.lang);
    const date = updated.toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' });
    if (!`${item.title ?? item.summary} ${item.bodySummary ?? ''} ${item.path} ${date} ${fullDate}`.toLocaleLowerCase().includes(query)) continue;
    const row = document.createElement('div'); row.className = 'recent-row qn-note-color'; row.dataset.noteKind = validCalloutType(item.calloutType) ? item.calloutType : 'NOTE';
    const open = document.createElement('button'); open.className = 'recent-item'; open.dataset.id = item.id; open.dataset.action = 'open';
    const title = item.title === undefined ? item.summary : item.title || t('未命名便签');
    const label = document.createElement('strong'); label.textContent = title;
    const preview = document.createElement('span'); preview.className = 'recent-body';
    preview.textContent = item.bodySummary === undefined ? t('正文摘要待更新') : item.bodySummary || t('暂无正文');
    preview.title = preview.textContent;
    const badges = document.createElement('span'); badges.className = 'recent-badges';
    badges.textContent = [item.removed ? t('已移除 · 草稿恢复') : !item.siyuanSaved ? t('已保存到插件') : item.draft ? t('草稿') : t('已保存到思源'),
      (item.versions ?? 0) > 1 ? `${t('多个版本')} (${item.versions})` : '', item.open ? t('已打开') : ''].filter(Boolean).join(' · ');
    badges.title = badges.textContent;
    const time = document.createElement('time'); time.className = 'recent-time'; time.dateTime = updated.toISOString(); time.textContent = date; time.title = fullDate;
    const details = document.createElement('span'); details.className = 'recent-details'; details.append(badges, time);
    open.append(label, preview, details);
    if (item.path) {
      const meta = document.createElement('span'); meta.className = 'recent-meta'; meta.textContent = item.path; meta.title = item.path; open.append(meta);
    }
    open.onclick = () => { if (item.removed) showDrafts(item.id); else request('open', item.id); };
    const remove = document.createElement('button'); remove.className = 'recent-delete'; remove.textContent = t('删除'); remove.dataset.id = item.id; remove.dataset.action = 'delete';
    remove.setAttribute('aria-label', `${t('删除')} ${item.summary}`); remove.onclick = () => {
      deletingItem = item; deleteOrigin = remove; deleteSummary.textContent = [title, item.bodySummary].filter(Boolean).join('\n'); deleteDialog.showModal(); deleteCancel.focus();
    };
    const siyuan = document.createElement('button'); siyuan.className = 'recent-siyuan'; siyuan.dataset.id = item.id; siyuan.dataset.action = 'siyuan';
    siyuan.textContent = t(item.siyuanSaved ? '在思源中打开' : '保存到思源中'); siyuan.title = siyuan.textContent;
    siyuan.setAttribute('aria-label', `${siyuan.textContent} ${item.summary}`); siyuan.onclick = () => { request('siyuan', item.id); };
    open.disabled = remove.disabled = !connected || pending.size > 0;
    siyuan.disabled = open.disabled || !!item.removed;
    const actions = document.createElement('div'); actions.className = 'recent-row-actions'; actions.append(siyuan, remove);
    row.append(open, actions); fragment.append(row);
  }
  if (!fragment.childNodes.length) {
    const empty = document.createElement('p'); empty.className = 'recent-empty'; empty.textContent = t(query ? '没有匹配的速记' : '暂无速记，点击上方加号新建。'); fragment.append(empty);
  }
  results.replaceChildren(fragment); results.scrollTop = scroll; listScroll = scroll;
  if (focusedId) [...results.querySelectorAll<HTMLElement>('button')].find(button => button.dataset.id === focusedId && button.dataset.action === focusedAction)?.focus({ preventScroll: true });
}
channel.onmessage = event => {
  const value = event.data as RecentResponse;
  if (!value || value.session !== session || value.windowId !== 'recent') return;
  const wasConnected = connected, completed = !!value.requestId && pending.has(value.requestId);
  lastHeard = Date.now(); connected = true;
  settingsPanel.setConnected(true);
  cleanupPanel.setConnected(true);
  versionsView.setConnected(true);
  more.disabled = otherDevices.disabled = organize.disabled = snooze.disabled = false;
  if (value.settingsChanged) settingsPanel.externalChange();
  const settingsRequest = value.requestId ? settingsRequests.get(value.requestId) : undefined;
  if (settingsRequest) {
    clearTimeout(settingsRequest.timer); settingsRequests.delete(value.requestId!);
    if (value.error) settingsRequest.reject(new Error(t(value.error))); else settingsRequest.resolve(value);
  }
  if (value.requestId) { clearTimeout(pending.get(value.requestId)); pending.delete(value.requestId); }
  if (value.items) items = value.items;
  if (value.cleanup) {
    cleanupPanel.apply(value.cleanup);
    document.getElementById('cleanup-summary')!.textContent = `${t('全部未归档')} ${value.cleanup.total} · ${t('未保存到思源')} ${value.cleanup.unsaved} · ${t('可归档')} ${value.cleanup.eligible}`;
    snooze.hidden = !value.cleanup.reminderActive;
  }
  if (deleteDialog.open && deletingItem && value.items && !items.some(item => item.id === deletingItem!.id)) closeDelete();
  if (value.dark !== undefined) document.documentElement.dataset.theme = value.dark ? 'dark' : 'light';
  const pin = document.getElementById('pin')!; pin.setAttribute('aria-pressed', String(!!value.pinned)); pin.title = t(value.pinned ? '取消置顶' : '置顶'); pin.setAttribute('aria-label', pin.title);
  if (value.error && !settingsRequest) { errorText = t(value.error); status.textContent = errorText; }
  else if (value.items || status.textContent === t('与插件失去连接，请重新打开列表。')) status.textContent = errorText || '';
  if (value.items || !wasConnected || completed) render();
  if (value.page) showPage(value.page);
  else if (!wasConnected && currentPage === 'settings') settingsPanel.open();
  else if (!wasConnected && currentPage === 'drafts') void versionsView.show(draftId);
};
for (const action of ['new', 'pin', 'minimize', 'close', 'refresh'] as const) document.getElementById(action)!.addEventListener('click', () => {
  if (action === 'close' && !connected) { window.close(); return; }
  request(action);
});
search.addEventListener('input', render);
window.addEventListener('focus', () => request('refresh'));
const timer = setInterval(() => {
  if (Date.now() - lastHeard > 6000) { connected = false; closeMenu(); more.disabled = otherDevices.disabled = organize.disabled = snooze.disabled = true; if (deleteDialog.open) closeDelete(); settingsPanel.setConnected(false); cleanupPanel.setConnected(false); versionsView.setConnected(false); cancelSettingsRequests(); status.textContent = t('与插件失去连接，请重新打开列表。'); render(); }
  request(connected ? 'heartbeat' : 'ready');
}, 1500);
window.addEventListener('beforeunload', () => { stopped = true; cleanupPanel.dispose(); versionsView.dispose(); clearInterval(timer); for (const timeout of pending.values()) clearTimeout(timeout); cancelSettingsRequests(); channel.close(); });
showPage(params.get('page') === 'settings' ? 'settings' : params.get('page') === 'cleanup' ? 'cleanup' : params.get('page') === 'drafts' ? 'drafts' : 'notes');
request('ready');
