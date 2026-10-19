import type { CleanupItem, CleanupProgress, CleanupSelection, CleanupSnapshot } from '../services/cleanup';
import { t } from '../core/i18n';

interface CleanupActions {
  snapshot(): Promise<CleanupSnapshot>;
  start(mode: 'archive' | 'clear', selections: CleanupSelection[], discard: boolean): Promise<CleanupProgress>;
  cancel(): Promise<void>; snooze(): Promise<void>;
}
export class CleanupPanel {
  private root = document.createElement('div');
  private summary = document.createElement('p');
  private list = document.createElement('div');
  private status = document.createElement('p');
  private mode = document.createElement('select');
  private selected = new Map<string, string>();
  private data?: CleanupSnapshot;
  private timer?: ReturnType<typeof setInterval>;
  private loading = false;
  private visible = false;
  private connected = true;
  private submitting = false;
  private errorText = '';
  private buttons: HTMLButtonElement[] = [];
  private startButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private retryButton!: HTMLButtonElement;
  private confirmation = document.createElement('dialog');
  private confirmText = document.createElement('p');
  private confirmButton!: HTMLButtonElement;
  private confirmCancel!: HTMLButtonElement;
  constructor(parent: HTMLElement, private actions: CleanupActions, private tr = t) {
    this.root.className = 'cleanup-panel'; this.summary.className = 'cleanup-summary'; this.list.className = 'cleanup-list';
    this.status.className = 'cleanup-status'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.mode.setAttribute('aria-label', tr('整理方式'));
    for (const [value, text] of [['archive', '归档并移出插件'], ['clear', '直接从插件清除']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = tr(text); this.mode.append(option);
    }
    this.mode.onchange = () => { this.defaults(); this.render(); };
    const help = document.createElement('p'); help.className = 'cleanup-help';
    help.textContent = tr('归档先确认最新内容已保存到思源，再移出所有设备的列表。清除会直接丢弃选中的本机内容。思源文档和图片保留。');
    const controls = document.createElement('div'); controls.className = 'cleanup-controls'; controls.append(this.mode);
    this.button(controls, '选择符合条件的便签', () => { this.defaults(); this.render(); });
    this.button(controls, '取消选择', () => { this.selected.clear(); this.render(); });
    this.button(controls, '刷新', () => { void this.load(); });
    const footer = document.createElement('div'); footer.className = 'cleanup-controls';
    this.startButton = this.button(footer, '执行所选操作', () => this.confirm());
    this.retryButton = this.button(footer, '重试失败项', () => {
      this.selected.clear();
      for (const failure of this.data?.progress?.failures ?? []) {
        const item = this.data?.items.find(value => value.id === failure.id);
        if (item && !item.open && !item.busy) this.selected.set(item.id, item.version);
      }
      if (this.data?.progress) this.mode.value = this.data.progress.mode;
      this.render(); this.confirm();
    });
    this.cancelButton = this.button(footer, '停止后续处理', () => { void this.actions.cancel().then(() => this.load()).catch(error => this.error(error)); });
    this.confirmation.className = 'cleanup-confirm'; this.confirmation.setAttribute('aria-label', tr('确认整理'));
    const confirmActions = document.createElement('div'); confirmActions.className = 'cleanup-controls';
    this.confirmCancel = this.button(confirmActions, '取消', () => this.confirmation.close());
    this.confirmButton = this.button(confirmActions, '确认', () => { this.confirmation.close(); void this.start(); });
    this.confirmation.append(this.confirmText, confirmActions);
    this.root.append(this.summary, help, controls, this.list, this.status, footer, this.confirmation); parent.append(this.root);
    this.confirmation.addEventListener('close', () => this.startButton.focus());
  }
  private button(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = this.tr(text);
    button.onclick = action; parent.append(button); this.buttons.push(button); return button;
  }
  open(): void {
    this.visible = true; void this.load(true);
    clearInterval(this.timer); this.timer = setInterval(() => { void this.load(); }, 1500);
  }
  close(): void { this.visible = false; clearInterval(this.timer); if (this.confirmation.open) this.confirmation.close(); }
  dispose(): void { this.close(); this.root.remove(); }
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected && this.confirmation.open) this.confirmation.close();
    this.render();
  }
  apply(data: CleanupSnapshot): void {
    this.data = data;
    for (const [id, version] of this.selected) if (!data.items.some(item => item.id === id && item.version === version && !item.open && !item.busy)) this.selected.delete(id);
    if (this.visible) this.render();
  }
  private defaults(): void {
    this.selected.clear();
    for (const item of this.data?.items ?? []) {
      if (this.mode.value === 'archive' ? item.eligible : !item.open && !item.busy && !item.unsaved) this.selected.set(item.id, item.version);
    }
  }
  private async load(defaults = false): Promise<void> {
    if (this.loading || !this.visible || !this.connected) return;
    this.loading = true;
    try { this.apply(await this.actions.snapshot()); if (defaults) { this.defaults(); this.render(); } }
    catch (error) { this.error(error); } finally { this.loading = false; }
  }
  private error(error: unknown): void { this.errorText = error instanceof Error ? this.tr(error.message) : String(error); this.status.textContent = this.errorText; }
  private selectedItems(): CleanupItem[] { return this.data?.items.filter(item => this.selected.get(item.id) === item.version) ?? []; }
  private confirm(): void {
    if (!this.connected || this.submitting || this.data?.progress?.running) return;
    const items = this.selectedItems(); if (!items.length) return;
    const unsaved = items.filter(item => item.unsaved).length;
    this.confirmText.textContent = `${this.tr(this.mode.value === 'archive' ? '归档并移出插件' : '直接从插件清除')}：${items.length}\n`
      + (this.mode.value === 'clear' ? `${this.tr('将永久丢弃本机未保存内容的条数')}：${unsaved}\n` : '')
      + this.tr('思源文档和图片保留；操作完成后不能通过插件撤销。');
    this.confirmation.showModal(); this.confirmCancel.focus();
  }
  private async start(): Promise<void> {
    const items = this.selectedItems(); if (!items.length || !this.connected || this.submitting || this.data?.progress?.running) return;
    this.submitting = true; this.errorText = ''; this.render();
    try {
      const progress = await this.actions.start(this.mode.value as 'archive' | 'clear', items.map(({ id, version }) => ({ id, version })), this.mode.value === 'clear' && items.some(item => item.unsaved));
      if (this.data) this.data.progress = progress;
      this.selected.clear(); await this.load();
    } catch (error) { this.error(error); }
    finally { this.submitting = false; this.render(); }
  }
  private render(): void {
    const data = this.data, running = !!data?.progress?.running || this.submitting;
    this.mode.disabled = running || !this.connected;
    for (const button of this.buttons) button.disabled = running || !this.connected;
    this.cancelButton.disabled = !data?.progress?.running || !this.connected;
    this.startButton.disabled ||= !this.selected.size;
    this.retryButton.disabled ||= !data?.progress?.failures.length;
    this.confirmButton.disabled = !this.connected || running;
    this.confirmCancel.disabled = false;
    this.startButton.textContent = `${this.tr('执行所选操作')} (${this.selected.size})`;
    if (!data) return;
    this.summary.textContent = `${this.tr('全部未归档')} ${data.total} · ${this.tr('未保存到思源')} ${data.unsaved} · ${this.tr('可归档')} ${data.eligible}`;
    const scroll = this.list.scrollTop, focusId = (document.activeElement as HTMLElement | null)?.dataset.cleanupId;
    const fragment = document.createDocumentFragment();
    for (const item of data.items) {
      const row = document.createElement('label'); row.className = 'cleanup-row';
      const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.cleanupId = item.id;
      check.checked = this.selected.get(item.id) === item.version; check.disabled = running || !this.connected || item.open || item.busy || this.mode.value === 'archive' && (item.removed || !!item.conflict);
      check.onchange = () => { if (check.checked) this.selected.set(item.id, item.version); else this.selected.delete(item.id); this.render(); };
      const body = document.createElement('span'), title = document.createElement('strong'), details = document.createElement('small');
      title.textContent = item.summary;
      details.textContent = [new Date(item.updatedAt).toLocaleString(), this.tr(item.unsaved ? '有未保存到思源的内容' : '已保存到思源'),
        item.open ? this.tr('已打开，跳过') : item.busy ? this.tr('正在处理，跳过') : '', item.removed ? this.tr('已移除 · 本机恢复') : '', item.path].filter(Boolean).join(' · ');
      if (item.conflict) details.textContent += ` · ${this.tr('多个版本，先选择版本')}`;
      body.append(title, details); row.append(check, body); fragment.append(row);
    }
    if (!data.items.length) { const empty = document.createElement('p'); empty.textContent = this.tr('暂无需要整理的便签'); fragment.append(empty); }
    this.list.replaceChildren(fragment); this.list.scrollTop = scroll;
    if (focusId) [...this.list.querySelectorAll<HTMLInputElement>('input')].find(input => input.dataset.cleanupId === focusId)?.focus({ preventScroll: true });
    const progress = data.progress;
    if (!this.connected) this.status.textContent = this.tr('与插件失去连接，请重新打开列表。');
    else if (this.errorText) this.status.textContent = this.errorText;
    else if (progress) {
      this.status.textContent = `${this.tr(progress.running ? '正在整理' : progress.cancelled ? '已停止后续处理' : '整理完成')} ${progress.completed}/${progress.total} · ${this.tr('成功')} ${progress.succeeded} · ${this.tr('跳过')} ${progress.skipped} · ${this.tr('失败')} ${progress.failures.length}`;
      for (const failure of progress.failures) {
        const line = document.createElement('span'); line.className = 'cleanup-failure';
        line.textContent = `${data.items.find(item => item.id === failure.id)?.summary ?? failure.id}：${this.tr(failure.error)}`; this.status.append(line);
      }
    }
  }
}
