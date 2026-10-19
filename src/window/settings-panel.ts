import type { Settings } from '../types';
import type { RecentRequest, RecentResponse, RecentSettingsData } from '../core/recent';
import { validateSettingsDraft } from '../core/settings';
import { t } from '../core/i18n';

type SettingsAction = Extract<RecentRequest['action'], 'settings' | 'preview-settings' | 'save-settings' | 'shortcuts'>;
export class WindowSettingsPanel {
  private form = document.createElement('form');
  private fields = document.createElement('fieldset');
  private body = document.createElement('div');
  private status = document.createElement('p');
  private previewOutput = document.createElement('p');
  private save = document.createElement('button');
  private reload = document.createElement('button');
  private previewButton?: HTMLButtonElement;
  private controls = new Map<keyof Settings, HTMLInputElement | HTMLSelectElement>();
  private data?: RecentSettingsData;
  private dirty = false;
  private busy = false;
  private connected = false;
  private version = 0;
  private loading?: Promise<void>;
  constructor(parent: HTMLElement, private send: (action: SettingsAction, settings?: Settings) => Promise<RecentResponse>) {
    this.form.className = 'settings-form'; this.body.className = 'settings-body'; this.fields.className = 'settings-fields'; this.fields.disabled = true;
    this.status.className = 'settings-status'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.save.type = 'submit'; this.save.className = 'settings-save'; this.save.textContent = t('保存设置'); this.save.disabled = true;
    this.reload.type = 'button'; this.reload.textContent = t('重新载入设置');
    this.reload.addEventListener('click', () => { void this.load(); });
    const actions = document.createElement('div'); actions.className = 'settings-actions'; actions.append(this.reload, this.save);
    const footer = document.createElement('div'); footer.className = 'settings-footer'; footer.append(this.status, actions);
    this.body.append(this.fields); this.form.append(this.body, footer); parent.append(this.form);
    this.form.addEventListener('submit', event => { event.preventDefault(); void this.commit(); });
    this.setConnected(false);
  }
  setConnected(value: boolean): void {
    const wasConnected = this.connected;
    this.connected = value; this.fields.disabled = !value || !this.data;
    this.fields.inert = this.busy; this.form.setAttribute('aria-busy', String(this.busy));
    this.save.disabled = !value || !this.data || this.busy; this.reload.disabled = !value || this.busy;
    if (!value) this.showStatus('与插件失去连接，请重新打开列表。', 'error');
    else if (!wasConnected && this.data) this.showStatus(this.dirty ? '有未保存的修改' : '修改后点击保存，返回列表会保留输入。');
  }
  open(): void { if (!this.dirty && !this.busy) void this.load(); }
  externalChange(): void {
    if (this.dirty || this.busy) this.showStatus('其他设备已更新设置。当前输入已保留，重新载入可查看同步结果。');
    else if (this.data) void this.load();
  }
  private showStatus(text: string, phase = ''): void { this.status.textContent = t(text); this.status.dataset.phase = phase; }
  private async load(): Promise<void> {
    if (this.loading) return this.loading;
    if (!this.connected || this.busy) return;
    this.busy = true; this.setConnected(this.connected); this.showStatus('正在载入设置…');
    this.loading = (async () => {
      try {
        const response = await this.send('settings');
        if (!response.settingsData) throw new Error(t('设置读取失败，请重试'));
        this.apply(response.settingsData); this.showStatus('修改后点击保存，返回列表会保留输入。');
      } catch (error) { this.showStatus(error instanceof Error ? error.message : String(error), 'error'); }
      finally { this.busy = false; this.loading = undefined; this.setConnected(this.connected); }
    })();
    return this.loading;
  }
  private apply(data: RecentSettingsData): void {
    this.data = data; this.dirty = false; this.version++; this.controls.clear(); this.fields.replaceChildren();
    const group = (title: string) => {
      const section = document.createElement('fieldset'); section.className = 'settings-group';
      const legend = document.createElement('legend'); legend.textContent = t(title); section.append(legend); this.fields.append(section); return section;
    };
    const field = (parent: HTMLElement, key: keyof Settings, title: string, type: 'checkbox' | 'number' | 'text' | Array<[string, string]>, help?: string, min?: number, max?: number) => {
      const row = document.createElement('div'); row.className = 'settings-row';
      const label = document.createElement('label'), caption = document.createElement('span'); caption.textContent = t(title);
      let control: HTMLInputElement | HTMLSelectElement;
      if (Array.isArray(type)) {
        control = document.createElement('select');
        for (const [value, text] of type) { const option = document.createElement('option'); option.value = value; option.textContent = key === 'notebook' && value ? text : t(text); control.append(option); }
      } else {
        control = document.createElement('input'); control.type = type;
        if (type === 'checkbox') { control.checked = !!data.settings[key]; label.className = 'settings-checkbox'; }
        if (type === 'number') { control.min = String(min); control.max = String(max); control.step = '1'; control.required = true; }
      }
      control.name = key; control.id = `setting-${key}`;
      if (!(control instanceof HTMLInputElement && control.type === 'checkbox')) control.value = String(data.settings[key]);
      label.append(caption, control); row.append(label);
      if (help) { const description = document.createElement('p'); description.className = 'settings-help'; description.textContent = t(help); row.append(description); }
      control.addEventListener(control instanceof HTMLSelectElement ? 'change' : 'input', () => {
        this.dirty = true; this.showStatus('有未保存的修改');
        if (key === 'directory' || key === 'notebook') { this.version++; this.previewOutput.textContent = t('保存位置已更改，请重新预览。'); }
      });
      this.controls.set(key, control); parent.append(row);
    };
    const storage = group('保存位置');
    field(storage, 'notebook', '目标笔记本', [['', '请选择笔记本'], ...data.notebooks.map(note => [note.id, note.name] as [string, string])]);
    field(storage, 'directory', '保存目录（支持模板变量）', 'text', '首次保存到思源时确定保存位置，修改设置只影响尚未确定位置的便签。');
    this.previewButton = document.createElement('button'); this.previewButton.type = 'button'; this.previewButton.textContent = t('预览保存位置');
    this.previewOutput = document.createElement('p'); this.previewOutput.className = 'settings-preview-output'; this.previewOutput.setAttribute('role', 'status');
    this.previewOutput.textContent = t('仅预览，不创建文档。'); this.previewButton.addEventListener('click', () => { void this.preview(); }); storage.append(this.previewButton, this.previewOutput);
    const entry = group('快捷键与托盘');
    const shortcutHelp = document.createElement('p'); shortcutHelp.className = 'settings-help'; shortcutHelp.textContent = `${t('默认快捷键')}：${data.shortcut}`;
    const shortcuts = document.createElement('button'); shortcuts.type = 'button'; shortcuts.textContent = t('打开思源快捷键设置');
    shortcuts.addEventListener('click', () => { void this.send('shortcuts').catch(error => this.showStatus(error.message, 'error')); }); entry.append(shortcutHelp, shortcuts);
    field(entry, 'shortcutBehavior', '快捷键行为', [['new', '新建速记'], ['recent', '唤醒最近窗口'], ['list', '打开速记列表']]);
    field(entry, 'trayEnabled', '显示独立速记托盘图标', 'checkbox');
    field(entry, 'trayClickAction', '托盘左键行为', [['new', '新建便签'], ['recent', '打开速记列表']], data.platform === 'linux' ? 'Linux 使用桌面环境提供的托盘菜单，此选项不改变菜单行为。' : '独立于全局快捷键行为，保存后立即生效。');
    const windows = group('便签窗口');
    field(windows, 'width', '默认窗口宽度', 'number', undefined, 300, 1600);
    field(windows, 'height', '默认窗口高度', 'number', undefined, 220, 1200);
    field(windows, 'alwaysOnTop', '新窗口默认置顶', 'checkbox');
    field(windows, 'rememberPosition', '记忆窗口位置、大小与置顶', 'checkbox');
    field(windows, 'restoreWindows', '重启后恢复上次打开的窗口', 'checkbox', '未保存草稿始终保留恢复入口。');
    field(windows, 'maxWindows', '最多同时打开的便签', 'number', '调小上限不会关闭已打开的便签。', 1, 50);
    const saving = group('保存与历史');
    field(saving, 'autoSaveToSiYuan', '默认保存到思源', 'checkbox', '开启后，新建、打开或编辑的非空便签会自动保存到思源，失败时保留本机草稿。跨设备同步需在思源中配置数据同步。');
    field(saving, 'debounceMs', '自动保存防抖（毫秒）', 'number', undefined, 100, 10000);
    field(saving, 'historyLimit', '最近记录展示条数', 'number', '仅限制最近列表展示，不清理正文、副本或草稿。整理便签可查看全部记录。', 1, 200);
    field(saving, 'showSaved', '显示保存成功状态', 'checkbox', '保存失败与冲突始终显示。');
    const cleanup = group('便签整理');
    field(cleanup, 'cleanupReminder', '启用整理提醒', 'checkbox', '达到条数后每天最多轻提示一次，不会自动删除内容。');
    field(cleanup, 'cleanupThreshold', '整理提醒条数', 'number', undefined, 1, 100000);
    field(cleanup, 'archiveDays', '归档候选天数', 'number', '按最后修改时间筛选，默认跳过正在打开的便签。', 1, 3650);
  }
  private value(): Settings {
    const value = { ...this.data!.settings };
    for (const [key, control] of this.controls) {
      const input = control as HTMLInputElement;
      Object.assign(value, { [key]: input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value });
    }
    return validateSettingsDraft(value, this.data!.notebooks.map(notebook => notebook.id));
  }
  private async preview(): Promise<void> {
    if (!this.data || !this.connected || this.busy || !this.form.reportValidity()) return;
    const version = this.version, button = this.previewButton!;
    try {
      const settings = this.value(); button.disabled = true; this.previewOutput.textContent = t('正在解析保存位置…');
      const response = await this.send('preview-settings', settings);
      if (version !== this.version) return;
      if (!response.preview) throw new Error(t('设置读取失败，请重试'));
      const name = this.data.notebooks.find(note => note.id === response.preview!.notebook)?.name || response.preview.notebook;
      this.previewOutput.textContent = `${name} · ${response.preview.path}`;
    } catch (error) { if (version === this.version) this.previewOutput.textContent = `${t('无法预览')}：${error instanceof Error ? t(error.message) : String(error)}`; }
    finally { button.disabled = false; }
  }
  private async commit(): Promise<void> {
    if (!this.data || !this.connected || this.busy || !this.form.reportValidity()) return;
    const focused = document.activeElement instanceof HTMLElement && this.form.contains(document.activeElement) ? document.activeElement : undefined;
    try {
      const settings = this.value(); this.busy = true; this.setConnected(this.connected); this.showStatus('正在保存设置…');
      const response = await this.send('save-settings', settings);
      if (!response.savedSettings) throw new Error(t('设置保存未确认，请重试'));
      // Keep the existing controls, selection, preview and scroll position.
      // Only write values the host actually normalized.
      for (const [key, control] of this.controls) {
        const value = response.savedSettings[key];
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          if (control.checked !== value) control.checked = !!value;
        } else if (control.value !== String(value)) control.value = String(value);
      }
      if (settings.directory !== response.savedSettings.directory || settings.notebook !== response.savedSettings.notebook) {
        this.version++; this.previewOutput.textContent = t('保存位置已更改，请重新预览。');
      }
      this.data = { ...this.data, settings: response.savedSettings }; this.dirty = false;
      this.showStatus(response.settingsWarning || '速记设置已保存', response.settingsWarning ? 'error' : 'saved');
    } catch (error) { this.showStatus(`${t('设置未保存')}：${error instanceof Error ? t(error.message) : String(error)}`, 'error'); }
    finally {
      this.busy = false; this.setConnected(this.connected);
      if (this.connected && focused?.isConnected && !this.form.closest('[hidden]') && document.activeElement === document.body) focused.focus({ preventScroll: true });
    }
  }
}
