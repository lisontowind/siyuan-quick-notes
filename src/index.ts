import { Plugin, Menu, Dialog, getFrontend, getBackend, showMessage, openTab, openWindow, openSetting, confirm } from 'siyuan';
import './styles/index.css';
import './styles/note-colors.css';
import { calloutTypes, calloutLabels, validCalloutType } from './core/callout';
import { defaults, parseSettings, validateSettingsDraft } from './core/settings';
import { parseHistory } from './core/history';
import { recentItems, noteListDetails } from './core/recent';
import { RecentWindowController } from './core/recent-window';
import { QuickNoteWindowManager, type HistoryRecord } from './core/windows';
import { createNote, noteLabel, noteSummary, noteReference, migrateNoteTitle, validNoteTitle, isSavedToSiYuan, isEmptyNewNote } from './core/identity';
import { SerialQueue } from './core/serial';
import { ElectronAdapter, type NativeWindow } from './platform/desktop';
import { TrayAdapter } from './platform/tray';
import { isDesktopPlatform, shortcutLabel, trayIconName, type DesktopPlatform } from './platform/runtime';
import { LocalDraftStore } from './platform/drafts';
import { loadDeviceId, migrateLegacyDrafts } from './platform/draft-location';
import { MissingSourceError, NoteRepository } from './services/repository';
import { SiYuanApi } from './services/kernel';
import { createMarkdownNormalizer } from './services/markdown';
import { AutoSaveService, message } from './services/autosave';
import { createSettings } from './components/settings';
import { assertPluginWrite } from './services/plugin-data';
import { ImageUploadService } from './services/images';
import { bindImageInputs, readImages } from './window/images';
import type { MissingSourceChoice, NoteRecord, NoteReference, Settings } from './types';
import { hostLocale, translate } from './core/i18n';
import { SharedNoteStore } from './platform/shared-notes';
import { SharedDraftStore } from './platform/shared-drafts';
import type { DraftVersion } from './types';
import { parseToolbarLayout, type ToolbarLayout } from './core/toolbar';
import { CleanupService } from './services/cleanup';
import { CleanupPanel } from './window/cleanup-panel';
import { icon } from './window/icons';
import { DraftVersionsDialog } from './window/draft-versions';
import type { DraftVersionsData } from './core/recent';
import './styles/cleanup.css';

const hostRequire = (name: string): any => (window as unknown as { require(name: string): unknown }).require(name);
export default class QuickNotesPlugin extends Plugin {
  private settingsValue: Settings = { ...defaults };
  private historyValue: HistoryRecord[] = [];
  private manager?: QuickNoteWindowManager;
  private recentWindow?: RecentWindowController;
  private repository?: NoteRepository;
  private drafts?: LocalDraftStore;
  private ipc?: any;
  private tray?: TrayAdapter;
  private trayIconPath?: string;
  private trayLifetimePath?: string;
  private workspaceName = '';
  private platform: DesktopPlatform = 'windows';
  private remote?: any;
  private disposed = false;
  private unloading = false;
  private dialogs = new Set<Dialog>();
  private fallbackServices = new Map<Dialog, { service: AutoSaveService; input: HTMLTextAreaElement; status: Element; siYuan(): Promise<void> }>();
  private siYuanActions = new Set<string>();
  private backgroundServices = new Map<string, AutoSaveService>();
  private historyWrites = new SerialQueue();
  private settingsWrites = new SerialQueue();
  private nativeError?: string;
  private shared?: SharedNoteStore;
  private sharedDrafts?: SharedDraftStore;
  private draftVersionViews = new Map<string, { token: string; signature: string; copied?: NoteRecord; selected?: string }>();
  private deleted = new Set<string>();
  private toolbarLayout = parseToolbarLayout(undefined);
  private sharedRead?: Promise<void>;
  private cleanup?: CleanupService;
  private reminderTimer?: ReturnType<typeof setTimeout>;
  private lastReminderCheck = 0;
  private cleanupNeeded = true;
  private cleanupActiveIds = new Set<string>();
  private cleanupFailureJob?: string;
  private changed = (): void => {
    const active = new Set([...(this.manager?.windows.keys() ?? []), ...[...this.fallbackServices.values()].map(entry => entry.service.note.id)]);
    for (const id of this.cleanupActiveIds) if (!active.has(id) && this.deleted.has(id)) this.cleanupNeeded = true;
    this.cleanupActiveIds = active;
    const progress = this.cleanup?.currentProgress();
    if (progress && !progress.running && progress.failures.length && progress.jobId !== this.cleanupFailureJob) {
      this.cleanupFailureJob = progress.jobId; this.cleanupNeeded = true;
    }
    this.tray?.refresh(); this.recentWindow?.refresh();
    if (!this.cleanup || this.disposed || this.unloading || this.reminderTimer) return;
    this.reminderTimer = setTimeout(() => {
      this.reminderTimer = undefined; this.lastReminderCheck = Date.now();
      void this.cleanup?.reminderDue().then(due => {
        if (due && !this.disposed && !this.unloading && !this.manager?.showCleanupReminder()) showMessage(translate('便签已达到整理提醒条数。请打开速记列表整理，或选择 7 天后再提醒。', hostLocale()), 10000);
      }).catch(error => this.report(message(error)));
    }, Math.max(1500, 60000 - (Date.now() - this.lastReminderCheck)));
  };
  private async refreshShared(): Promise<void> {
    if (!this.shared || this.disposed || this.unloading) return;
    if (this.sharedRead) return this.sharedRead;
    this.sharedRead = (async () => {
      const result = await this.shared!.load();
      if (this.disposed || this.unloading) return;
      if (result.deleted.size !== this.deleted.size || [...result.deleted].some(id => !this.deleted.has(id))) this.cleanupNeeded = true;
      this.deleted = result.deleted;
      this.historyValue.splice(0, this.historyValue.length, ...result.records.slice(0, this.settingsValue.historyLimit));
      this.manager?.applyDeletions();
      for (const entry of this.fallbackServices.values()) if (this.deleted.has(entry.service.note.id)) entry.service.markRemoved();
      for (const service of this.backgroundServices.values()) if (this.deleted.has(service.note.id)) service.markRemoved();
      if (this.cleanup && this.cleanupNeeded && !this.cleanup.currentProgress()?.running) {
        try { await this.cleanup.reconcile(); this.cleanupNeeded = false; }
        catch (error) { this.report(message(error)); }
      }
    })().finally(() => { this.sharedRead = undefined; });
    return this.sharedRead;
  }
  async onDataChanged(): Promise<void> {
    if (!this.shared || this.disposed || this.unloading) return;
    this.cleanupNeeded = true;
    await this.settingsWrites.run('settings', async () => {
      const [settings, layout] = await Promise.all([this.loadData('settings.json'), this.loadData('toolbar.json')]);
      if (this.disposed || this.unloading) return;
      const next = parseSettings(settings), changed = JSON.stringify(next) !== JSON.stringify(this.settingsValue);
      this.settingsValue = next; this.toolbarLayout = parseToolbarLayout(layout);
      await this.refreshShared();
      this.manager?.refresh(); this.syncTray();
      if (changed) this.recentWindow?.settingsChanged(); else this.recentWindow?.refresh();
    });
  }
  private async removeShared(id: string): Promise<void> {
    const note = this.manager?.windows.get(id)?.service.note ?? [...this.fallbackServices.values()].find(value => value.service.note.id === id)?.service.note
      ?? (await this.drafts?.list() ?? []).find(value => value.note.id === id)?.note;
    await this.shared?.remove(id, note?.draftSync?.clock); this.deleted.add(id); this.cleanupNeeded = true;
  }
  private async saveToolbar(layout: ToolbarLayout): Promise<void> {
    await this.settingsWrites.run('settings', async () => {
      if (this.disposed || this.unloading) throw new Error('插件已停用，设置未保存');
      await this.writeData('toolbar.json', layout); this.toolbarLayout = parseToolbarLayout(layout);
    });
  }
  private shortcutListener = (_: unknown, data: { failed?: string[] }) => {
    const command = this.commands.find(command => command.langKey === 'newQuickNote');
    if (data.failed?.some(key => key === command?.customHotkey || key === command?.hotkey)) {
      this.report('全局快捷键注册失败：可能被其他程序占用或当前桌面环境不支持，请在思源快捷键设置中更换绑定，也可从思源顶栏新建速记');
    }
  };
  private report = (text: string): void => { if (!this.disposed) showMessage(text, 7000, 'error'); console.warn('[Quick Notes]', text); };
  private confirmDelete = (): Promise<boolean> => new Promise(resolve => {
    const main = this.remote?.getCurrentWindow?.(); main?.show(); main?.focus();
    confirm('从插件删除这条速记？', '将清理插件中的草稿、最近记录和窗口记录，并同步移除其他设备的列表记录。已保存到思源的正文保留。尚未保存的本机内容将被删除，此操作不可通过插件撤销。', () => resolve(true), () => resolve(false));
  });
  private async writeData(name: string, value: unknown): Promise<void> {
    assertPluginWrite(await this.saveData(name, value));
  }
  private persistHistory(history: HistoryRecord[]): Promise<void> {
    return this.historyWrites.run('history', async () => {
      if (this.disposed) return;
      if (this.shared) {
        for (const item of history) if (!this.deleted.has(item.id)) await this.shared.publish(item);
      } else await this.writeData('history.json', history);
    });
  }
  private recordFallback(note: import('./types').NoteRecord): void {
    if (this.deleted.has(note.id)) return;
    const prior = this.historyValue.findIndex(item => item.id === note.id);
    if (prior >= 0) this.historyValue.splice(prior, 1);
    this.historyValue.unshift({ ...noteReference(note), summary: noteLabel(note), bodySummary: noteSummary(note.text, 120, '') });
    this.historyValue.splice(this.settingsValue.historyLimit);
    this.recentWindow?.refresh();
    void this.persistHistory([...this.historyValue]).catch(error => this.report(`最近列表保存失败：${message(error)}`));
  }
  async onload(): Promise<void> {
    this.disposed = false;
    this.unloading = false;
    const backend = getBackend();
    if (getFrontend() !== 'desktop' || !isDesktopPlatform(backend)) return;
    this.platform = backend;
    this.settingsValue = parseSettings(await this.loadData('settings.json'));
    const history: unknown = await this.loadData('history.json');
    this.historyValue = parseHistory(history, 200);
    const lute = window.Lute?.New();
    const fs = hostRequire('fs/promises') as typeof import('node:fs/promises');
    const path = hostRequire('path') as typeof import('node:path');
    const nodeCrypto = hostRequire('crypto') as typeof import('node:crypto');
    const process = hostRequire('process') as NodeJS.Process;
    const os = hostRequire('os') as typeof import('node:os');
    const config = window.siyuan.config as unknown as { system: { workspaceDir: string } };
    const workspace = config.system.workspaceDir;
    if (!workspace || !path.isAbsolute(workspace)) throw new Error('无法定位工作空间');
    const deviceId = await loadDeviceId(fs, path, nodeCrypto, os.homedir());
    this.sharedDrafts = new SharedDraftStore(fs, path, path.join(workspace, 'data', 'storage', 'petal', this.name, 'shared', 'drafts'), deviceId);
    this.shared = new SharedNoteStore(fs, path, path.join(workspace, 'data', 'storage', 'petal', this.name, 'shared'), deviceId);
    await this.shared.migrate(this.historyValue);
    this.toolbarLayout = parseToolbarLayout(await this.loadData('toolbar.json'));
    await this.refreshShared();
    const draftDirectory = path.join(workspace, 'data', 'storage', 'petal', this.name, 'drafts', deviceId);
    const workspaceKey = nodeCrypto.createHash('sha256').update(workspace.toLowerCase()).digest('hex').slice(0, 24);
    const legacyDirectory = process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'SiYuanQuickNotes', workspaceKey) : undefined;
    await migrateLegacyDrafts(fs, path, nodeCrypto, draftDirectory, legacyDirectory);
    this.workspaceName = path.basename(workspace);
    this.trayIconPath = path.join(workspace, 'data', 'plugins', this.name, trayIconName(this.platform));
    this.trayLifetimePath = path.join(workspace, 'data', 'plugins', this.name, 'tray-lifetime.cjs');
    this.drafts = new LocalDraftStore(fs, path, draftDirectory, this.sharedDrafts);
    this.repository = new NoteRepository(new SiYuanApi(), () => this.settingsValue,
      lute ? createMarkdownNormalizer(lute) : undefined);
    this.cleanup = new CleanupService(this.drafts, this.shared, this.repository, () => this.settingsValue, {
      active: () => [...(this.manager?.windows.values() ?? [])].map(entry => entry.service.note)
        .concat([...this.fallbackServices.values()].map(entry => entry.service.note)),
      busy: id => this.siYuanActions.has(id) || this.backgroundServices.has(id) || !!this.manager?.isBusy(id),
      stopped: () => this.disposed || this.unloading,
      removed: id => this.deleted.add(id), forget: id => this.forgetEmptyNote(id), changed: this.changed,
    });
    try {
      this.remote = hostRequire('@electron/remote');
      const adapter = new ElectronAdapter(this.remote, this.report);
      this.manager = new QuickNoteWindowManager(adapter, this.repository, this.drafts, () => this.settingsValue, this.historyValue,
        history => this.persistHistory(history), this.report,
        id => { void openTab({ app: this.app, doc: { id, action: ['cb-get-focus'] } }).catch(error => this.report(message(error))); },
        () => { void this.showRecent(); }, this.confirmDelete, () => this.fallbackServices.size,
        undefined, this.changed, {
          layout: () => this.toolbarLayout, saveLayout: layout => this.saveToolbar(layout),
          deleted: id => this.deleted.has(id), remove: id => this.removeShared(id),
          busy: id => this.cleanup?.locks.has(id) ?? false,
          organize: () => { void this.showCleanup(); }, snooze: () => this.cleanup!.snooze(),
        }, (note, parent) => this.chooseMissingSource(note, parent));
      this.recentWindow = new RecentWindowController(adapter, this.drafts, () => this.settingsValue, {
        items: async () => {
          await this.refreshShared();
          return recentItems(this.historyValue, await this.drafts!.list(), [
          ...[...this.manager!.windows.values()].map(entry => entry.service.note),
          ...[...this.fallbackServices.values()].map(entry => entry.service.note),
          ]).filter(item => !this.deleted.has(item.id) || item.draft).map(item => ({ ...item, removed: this.deleted.has(item.id) }));
        },
        open: async id => {
          if (this.cleanup?.locks.has(id)) throw new Error('整理任务正在处理这条便签，请稍后重试');
          if (this.siYuanActions.has(id)) throw new Error('窗口忙碌，请稍后重试');
          const active = this.manager!.windows.get(id);
          if (active) { await this.manager!.open(active.service.note); return; }
          const fallback = [...this.fallbackServices.values()].find(entry => entry.service.note.id === id);
          if (fallback) { const owner = this.remote.getCurrentWindow(); if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus(); fallback.input.focus(); return; }
          if (this.manager!.windows.size + this.fallbackServices.size >= this.settingsValue.maxWindows) throw new Error('已达到窗口数量上限，请先关闭一个窗口');
          const draft = (await this.drafts!.list()).find(draft => draft.note.id === id);
          if (draft) { await this.manager!.reopen(draft.note); return; }
          const history = this.historyValue.find(item => item.id === id);
          if (!history) throw new Error('速记已不在列表中，请刷新后重试');
          try { await this.manager!.reopen(history); }
          catch (error) { throw new Error(`正文暂不可用，请等待思源同步完成后刷新重试：${message(error)}`); }
        },
        siYuan: id => this.siYuanRecent(id),
        versions: id => this.draftVersions(id),
        chooseVersion: (id, version, token, copy) => this.chooseDraftVersion(id, version, token, copy),
        delete: async id => {
          const item = this.manager!.windows.get(id)?.service.note
            ?? [...this.fallbackServices.values()].find(entry => entry.service.note.id === id)?.service.note
            ?? (await this.drafts!.list()).find(draft => draft.note.id === id)?.note
            ?? this.historyValue.find(item => item.id === id);
          if (!item) throw new Error('速记已不在列表中，请刷新后重试');
          if (!await this.deleteRecent(item, true)) throw new Error('删除未完成，请重试');
        },
        createNote: () => {
          if (this.manager!.windows.size + this.fallbackServices.size >= this.settingsValue.maxWindows) throw new Error('已达到窗口数量上限，请先关闭一个窗口');
          return this.newNote();
        },
        loadSettings: async () => ({ settings: { ...this.settingsValue },
          notebooks: (await this.repository!.notebooks()).map(({ id, name }) => ({ id, name })),
          platform: this.platform, shortcut: shortcutLabel(this.platform) }),
        previewSettings: async value => {
          const notebooks = await this.repository!.notebooks();
          return this.repository!.resolveTarget(createNote(), validateSettingsDraft(value, notebooks.map(notebook => notebook.id)));
        },
        saveSettings: async value => {
          const notebooks = await this.repository!.notebooks();
          const settings = validateSettingsDraft(value, notebooks.map(notebook => notebook.id));
          if (settings.notebook) await this.repository!.resolveTarget(createNote(), settings);
          const warning = await this.persistSettings(settings);
          return { settings: { ...this.settingsValue }, warning };
        },
        shortcuts: () => this.showShortcutSettings(),
        cleanup: () => this.cleanup!.snapshot(),
        cleanupStart: (mode, selections, discard) => this.cleanup!.start(mode, selections, discard),
        cleanupCancel: () => this.cleanup!.cancel(), cleanupSnooze: () => this.cleanup!.snooze(),
      }, native => this.remote.require(this.trayLifetimePath!).attachTrayLifetime(native, this.remote.getCurrentWebContents()), this.report);
    } catch (error) { this.nativeError = message(error); }
    this.ipc = hostRequire('electron').ipcRenderer;
  }
  async onLayoutReady(): Promise<void> {
    if (this.disposed || !this.repository) return;
    // The host layout/shortcut modules are ready here. Only the desktop owner registers.
    this.ipc?.on('siyuan-hotkey', this.shortcutListener);
    const trigger = () => { void this.newNote().catch(error => this.report(message(error))); };
    const shortcutTrigger = () => { void this.newNote(true).catch(error => this.report(message(error))); };
    this.addCommand({ langKey: 'newQuickNote', langText: '新建悬浮速记', hotkey: '⌥⌘N', callback: shortcutTrigger, globalCallback: shortcutTrigger, execute: shortcutTrigger });
    this.addCommand({ langKey: 'recentQuickNotes', langText: '速记列表', callback: () => { void this.showRecent(); } });
    this.addTopBar({ icon: 'iconEdit', title: '悬浮速记', position: 'right', callback: event => {
      const menu = new Menu('quick-notes-menu');
      menu.addItem({ icon: 'iconAdd', label: '新建悬浮速记', click: trigger });
      menu.addItem({ icon: 'iconHistory', label: '速记列表', click: () => { void this.showRecent(); } });
      menu.addItem({ icon: 'iconArchive', label: translate('整理便签', hostLocale()), click: () => { void this.showCleanup(); } });
      menu.addItem({ icon: 'iconSettings', label: '速记设置', click: () => { void this.openSettingsPanel(); } });
      menu.open({ x: event.clientX, y: event.clientY });
    } });
    this.syncTray();
    await this.manager?.initialize();
    try { await this.cleanup?.reconcile(); this.cleanupNeeded = false; } catch (error) { this.report(message(error)); }
    this.changed();
    if (!this.manager) this.report(`原生速记窗口不可用：${this.nativeError}。新建命令将提供明确标记的官方窗口降级入口。`);
  }
  openSetting(): void { void this.openSettingsPanel(); }
  private syncTray(): void {
    if (this.disposed || this.unloading || !this.settingsValue.trayEnabled) { this.tray?.stop(); return; }
    try {
      this.remote ??= hostRequire('@electron/remote');
      this.tray ??= new TrayAdapter(this.remote, {
        leftClick: () => this.settingsValue.trayClickAction === 'recent' ? this.showRecent() : this.newNote(),
        createNote: () => this.newNote(), recent: () => this.showRecent(), settings: () => this.openSettingsPanel(),
        closeTray: () => this.settingsWrites.run('settings', async () => {
          if (this.disposed || this.unloading) return;
          const settings = { ...this.settingsValue, trayEnabled: false };
          await this.writeData('settings.json', settings);
          if (this.disposed || this.unloading) return;
          this.settingsValue = settings; this.syncTray();
          showMessage('速记托盘图标已关闭，可在速记设置中重新开启');
        }),
        windows: () => [...(this.manager?.windows.entries() ?? [])].map(([id, entry], index) => ({ id,
          label: `${index + 1}. ${noteLabel(entry.service.note, 40)}`,
        })),
        focusWindow: async id => { const entry = this.manager?.windows.get(id); if (entry) await this.manager?.open(entry.service.note); },
        showOwner: () => {
          const owner = this.remote.getCurrentWindow();
          if (!owner.isDestroyed()) { if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus(); }
        },
      }, this.report, window, this.trayLifetimePath!, this.platform);
      this.tray.start(this.trayIconPath!, this.workspaceName);
    } catch (error) { this.report(`独立速记托盘不可用：${message(error)}。仍可使用顶栏和快捷键。`); }
  }
  private async openSettingsPanel(): Promise<void> {
    if (this.disposed || this.unloading) return;
    if (this.recentWindow) {
      try { await this.recentWindow.show('settings'); return; }
      catch (error) { this.report(`独立设置窗口不可用：${message(error)}。已提供主窗口设置。`); }
    }
    const owner = this.remote?.getCurrentWindow?.();
    if (owner && !owner.isDestroyed()) { if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus(); }
    await this.openSettingsFallback();
  }
  private showShortcutSettings(): void {
    const owner = this.remote?.getCurrentWindow?.();
    if (owner && !owner.isDestroyed()) { if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus(); }
    // 3.8.6 supports a tab argument; SDK 1.2.7 still declares the one-argument form.
    (openSetting as unknown as (app: typeof this.app, tab: string) => void)(this.app, 'keymap');
  }
  private persistSettings(settings: Settings): Promise<string | undefined> {
    return this.settingsWrites.run('settings', async () => {
      if (this.disposed || this.unloading) throw new Error('插件已停用，设置未保存');
      await this.writeData('settings.json', settings);
      if (this.disposed || this.unloading) throw new Error('插件已停用，设置将在重新加载后生效');
      this.settingsValue = settings;
      this.manager?.refresh(); this.syncTray();
      let warning: string | undefined;
      if (this.historyValue.length > settings.historyLimit) {
        this.historyValue.splice(settings.historyLimit);
        try { await this.persistHistory([...this.historyValue]); }
        catch (error) { warning = `设置已保存，最近列表保存失败：${message(error)}`; }
      }
      this.recentWindow?.refresh();
      return warning;
    });
  }
  private async openSettingsFallback(): Promise<void> {
    try {
      const notebooks = await this.repository?.notebooks() ?? [];
      if (this.disposed || this.unloading) return;
      this.setting = createSettings(this.settingsValue, notebooks, async settings => {
        const warning = await this.persistSettings(settings);
        if (warning) this.report(warning); else showMessage('速记设置已保存');
      }, () => this.showShortcutSettings(), () => { void this.showRecent(); }, this.report, value => this.repository!.resolveTarget(createNote(), value), this.platform);
      this.setting.open('悬浮速记');
    } catch (error) { this.report(message(error)); }
  }
  private async newNote(useShortcutBehavior = false): Promise<void> {
    if (this.disposed || this.unloading) return;
    this.changed();
    if (useShortcutBehavior && this.settingsValue.shortcutBehavior === 'list') { await this.showRecent(); return; }
    if (this.manager) {
      try { if (useShortcutBehavior) await this.manager.trigger(); else await this.manager.open(createNote()); }
      catch (error) { this.report(`轻量窗口创建失败：${message(error)}。已提供官方窗口降级入口。`); this.fallback(); }
    }
    else this.fallback();
  }
  private async showRecent(): Promise<void> {
    if (this.disposed || this.unloading) return;
    this.changed();
    if (this.recentWindow) {
      try { await this.recentWindow.show(); return; }
      catch (error) { this.report(`独立列表窗口不可用：${message(error)}。已提供主窗口列表。`); }
    }
    const owner = this.remote?.getCurrentWindow?.();
    if (owner && !owner.isDestroyed()) { if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus(); }
    await this.showRecentFallback();
  }
  private async showCleanup(): Promise<void> {
    if (!this.cleanup || this.disposed || this.unloading) return;
    if (this.recentWindow) {
      try { await this.recentWindow.show('cleanup'); return; } catch (error) { this.report(message(error)); }
    }
    let panel: CleanupPanel | undefined;
    const dialog = this.dialog(translate('整理便签', hostLocale()), '<div class="qn-cleanup-host"></div>', false, () => panel?.dispose());
    panel = new CleanupPanel(dialog.element.querySelector('.qn-cleanup-host')!, {
      snapshot: () => this.cleanup!.snapshot(), start: (mode, selections, discard) => Promise.resolve(this.cleanup!.start(mode, selections, discard)),
      cancel: async () => this.cleanup!.cancel(), snooze: () => this.cleanup!.snooze(),
    }, value => translate(value, hostLocale()));
    panel.open();
  }
  private async showRecentFallback(): Promise<void> {
    try {
      await this.refreshShared();
      const drafts = (await this.drafts?.list() ?? []).filter(draft => !this.deleted.has(draft.note.id) || draft.note.revision > draft.note.savedRevision);
      if (this.disposed || this.unloading) return;
      const dialog = this.dialog('速记列表', '<div class="qn-list"><div class="qn-list-tools"><input class="b3-text-field qn-search" type="search" aria-label="搜索速记" placeholder="搜索摘要、保存位置或时间"><button class="qn-list-more" aria-haspopup="menu"></button></div><div class="qn-results"></div></div>');
      const list = dialog.element.querySelector('.qn-results')!;
      const more = dialog.element.querySelector('.qn-list-more') as HTMLButtonElement;
      more.title = translate('更多', hostLocale()); more.setAttribute('aria-label', more.title); more.append(icon('ellipsis'));
      more.onclick = () => {
        const menu = new Menu('quick-notes-list-more');
        menu.addItem({ icon: 'iconHistory', label: translate('其他设备草稿', hostLocale()), click: () => { void this.showDraftVersions(); } });
        menu.addItem({ icon: 'iconArchive', label: translate('整理便签', hostLocale()), click: () => { void this.showCleanup(); } });
        const rect = more.getBoundingClientRect(); menu.open({ x: rect.right, y: rect.bottom, isLeft: true });
      };
      if (this.cleanup) {
        const snapshot = await this.cleanup.snapshot(), overview = document.createElement('div'); overview.className = 'cleanup-footer';
        const tr = (value: string) => translate(value, hostLocale());
        const summary = document.createElement('span'); summary.textContent = `${tr('全部未归档')} ${snapshot.total} · ${tr('未保存到思源')} ${snapshot.unsaved} · ${tr('可归档')} ${snapshot.eligible}`;
        const snooze = document.createElement('button'); snooze.textContent = tr('7 天后再提醒'); snooze.hidden = !snapshot.reminderActive;
        snooze.onclick = () => { snooze.disabled = true; void this.cleanup!.snooze().then(() => { snooze.hidden = true; }).catch(error => { snooze.disabled = false; this.report(message(error)); }); };
        overview.append(summary, snooze); list.after(overview);
      }
      const search = dialog.element.querySelector('input')!;
      const draftIds = new Set(drafts.map(draft => draft.note.id));
      const entries = [...drafts.map(draft => ({ id: draft.note.id, time: draft.note.updatedAt, path: draft.note.target?.path || '',
        item: draft.note, label: `${(draft.variants?.length ?? 0) > 1 ? '多个版本' : '草稿'} · ${noteLabel(draft.note, 40)}`, open: async () => {
        if (this.deleted.has(draft.note.id)) { await this.showDraftVersions(draft.note.id); return; }
        if (this.manager) await this.manager.reopen(draft.note); else { const note = await this.noteForOpen(draft.note); if (note) this.fallback(note); }
      } })), ...this.historyValue.filter(item => !draftIds.has(item.id)).map(item => ({ id: item.id, time: item.updatedAt,
        item, label: item.caption || item.summary || item.target?.path.split('/').pop() || '速记', path: item.target?.path || '', open: async () => {
        if (this.manager) await this.manager.reopen(item); else { const note = await this.noteForOpen(item); if (note) this.fallback(note); }
      } }))];
      if (!entries.length) list.textContent = `暂无速记。使用 ${shortcutLabel(this.platform)} 或思源顶栏新建。`;
      const appendRow = (item: HistoryRecord, label: string, searchable: string, open: () => Promise<void>) => {
        const row = document.createElement('div'); row.className = 'qn-history-row qn-note-color'; row.dataset.noteKind = validCalloutType(item.calloutType) ? item.calloutType : 'NOTE'; row.dataset.search = [searchable, noteListDetails(item).title, noteListDetails(item).bodySummary].filter(Boolean).join(' ').toLocaleLowerCase();
        const button = document.createElement('button'); button.className = 'qn-history-item';
        const details = noteListDetails(item), heading = document.createElement('strong'), preview = document.createElement('span'), meta = document.createElement('span');
        heading.className = 'qn-history-title'; heading.textContent = details.title || translate('未命名便签', hostLocale());
        preview.className = 'qn-history-body'; preview.textContent = details.bodySummary === undefined ? translate('正文摘要待更新', hostLocale()) : details.bodySummary || translate('暂无正文', hostLocale());
        meta.className = 'qn-history-meta'; meta.textContent = [draftIds.has(item.id) ? '草稿' : '', new Date(item.updatedAt).toLocaleString(), item.target?.path || item.docPath].filter(Boolean).join(' · ');
        button.append(heading, preview, meta);
        button.onclick = () => { button.disabled = true; void open().then(() => dialog.destroy()).catch(error => { button.disabled = false; this.report(message(error)); }); };
        const siyuan = document.createElement('button'); siyuan.className = 'b3-button b3-button--outline';
        siyuan.textContent = isSavedToSiYuan(item) ? '在思源中打开' : '保存到思源中';
        siyuan.disabled = this.deleted.has(item.id);
        siyuan.onclick = () => {
          siyuan.disabled = true; remove.disabled = true; button.disabled = true;
          void this.siYuanRecent(item.id).then(() => { dialog.destroy(); void this.showRecent(); })
            .catch(error => this.report(message(error))).finally(() => { siyuan.disabled = this.deleted.has(item.id); remove.disabled = false; button.disabled = false; });
        };
        const remove = document.createElement('button'); remove.className = 'qn-delete b3-button b3-button--outline'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除 ${label.split('\n')[0]}`);
        remove.onclick = () => {
          remove.disabled = true;
          void this.deleteRecent(item).then(deleted => {
            if (deleted) { dialog.destroy(); void this.showRecent(); }
          }).catch(error => this.report(`删除失败：${message(error)}`)).finally(() => { remove.disabled = false; });
        };
        const actions = document.createElement('div'); actions.className = 'qn-history-actions'; actions.append(siyuan, remove);
        row.append(button, actions); list.append(row);
      };
      for (const entry of entries) {
        const label = `${entry.label}\n${new Date(entry.time).toLocaleString()}${entry.path ? `\n${entry.path}` : ''}`;
        appendRow(entry.item, label, `${label} ${entry.path}`, entry.open);
      }
      if (this.manager?.windows.size) {
        const title = document.createElement('p'); title.textContent = `当前打开 ${this.manager.windows.size} 个窗口（点击下列项目唤醒）`; list.append(title);
        for (const [id, entry] of this.manager.windows) {
          const label = `${noteLabel(entry.service.note, 40)}${entry.service.note.target ? `\n${entry.service.note.target.path}` : ''}`;
          appendRow(entry.service.note, label, `${label} ${entry.service.note.target?.path || ''}`, async () => { await this.manager?.open(entry.service.note); });
        }
      }
      const empty = document.createElement('p'); empty.textContent = '没有匹配的速记'; empty.hidden = true; list.append(empty);
      search.addEventListener('input', () => {
        const query = search.value.trim().toLocaleLowerCase();
        const buttons = [...list.querySelectorAll<HTMLElement>('.qn-history-row')];
        for (const button of buttons) button.hidden = !button.dataset.search?.includes(query);
        empty.hidden = !query || buttons.some(button => !button.hidden);
      });
    } catch (error) { this.report(message(error)); }
  }
  private async chooseMissingSource(note: NoteReference, parent?: NativeWindow): Promise<MissingSourceChoice> {
    const tr = (value: string) => translate(value, hostLocale());
    if (this.remote?.dialog?.showMessageBox) {
      const owner = parent ?? this.recentWindow?.nativeWindow ?? this.remote.getCurrentWindow?.();
      const options = { type: 'warning', title: tr('思源中已删除'), message: tr('思源中已删除，是否删除便签或恢复到思源？'),
        detail: tr('删除将清理插件中的便签和副本；恢复将使用插件副本重新写入思源。'),
        buttons: [tr('恢复到思源'), tr('删除便签'), tr('取消')], defaultId: 2, cancelId: 2, noLink: true };
      const result = owner ? await this.remote.dialog.showMessageBox(owner, options) : await this.remote.dialog.showMessageBox(options);
      return result.response === 0 ? 'restore' : result.response === 1 ? 'delete' : 'cancel';
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = (choice: MissingSourceChoice) => { if (!settled) { settled = true; resolve(choice); } };
      const dialog = this.dialog(tr('思源中已删除'), '<div class="qn-fallback"><p data-missing-help></p><button class="b3-button" data-restore></button> <button class="b3-button b3-button--outline" data-remove></button> <button class="b3-button b3-button--outline" data-cancel></button></div>', false, () => finish('cancel'));
      dialog.element.querySelector('[data-missing-help]')!.textContent = tr('思源中已删除，是否删除便签或恢复到思源？');
      for (const [selector, label, choice] of [['restore', '恢复到思源', 'restore'], ['remove', '删除便签', 'delete'], ['cancel', '取消', 'cancel']] as const) {
        const button = dialog.element.querySelector(`[data-${selector}]`) as HTMLButtonElement;
        button.textContent = tr(label); button.onclick = () => { finish(choice); dialog.destroy(); };
      }
    });
  }
  private async draftChoices(id?: string): Promise<DraftVersion[]> {
    if (!id) return this.drafts!.listOtherDevices();
    // Only removed local notes use this path, for recovery as a new note.
    const draft = (await this.drafts!.list()).find(value => value.note.id === id);
    if (!draft || !this.deleted.has(id)) throw new Error('草稿版本已变化，请刷新后重试');
    return [{ version: 'local', device: this.sharedDrafts?.device ?? '', note: draft.note }];
  }
  private choiceSignature(versions: DraftVersion[]): string {
    return JSON.stringify(versions.map(value => [value.version, value.device, value.note]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }
  private async draftVersions(id?: string): Promise<DraftVersionsData> {
    const choices = await this.draftChoices(id), token = crypto.randomUUID();
    this.draftVersionViews.set(id ?? 'remote', { token, signature: this.choiceSignature(choices) });
    return { token, removed: !!id && this.deleted.has(id), versions: choices.map(value => ({ version: value.version,
      device: value.device, legacy: value.legacy, summary: noteLabel(value.note, 80), text: value.note.text, updatedAt: value.note.updatedAt })) };
  }
  private async chooseDraftVersion(id: string | undefined, version: string, token: string, copy: boolean): Promise<void> {
    if (!copy) throw new Error('其他设备草稿仅供查看，请复制到本设备后编辑');
    const key = id ?? 'remote';
    if (this.disposed || this.unloading || this.siYuanActions.has(key) || id && this.cleanup?.locks.has(id)) throw new Error('窗口忙碌，请稍后重试');
    if ((this.manager?.windows.size ?? 0) + this.fallbackServices.size >= this.settingsValue.maxWindows) throw new Error('已达到窗口数量上限，请先关闭一个窗口');
    this.siYuanActions.add(key);
    try {
      const view = this.draftVersionViews.get(key);
      if (!view || token !== view.token) throw new Error('草稿版本已变化，请刷新后重试');
      if (view.copied && view.selected !== version) throw new Error('草稿版本已变化，请刷新后重试');
      if (!view.copied) {
        const choices = await this.draftChoices(id);
        if (view.signature !== this.choiceSignature(choices)) throw new Error('草稿版本已变化，请刷新后重试');
        const chosen = choices.find(value => value.version === version);
        if (!chosen) throw new Error('草稿版本已变化，请刷新后重试');
        // A fresh identity deliberately carries no source document, baseline, sync context or geometry.
        const note = { ...createNote(), text: chosen.note.text, title: chosen.note.title, caption: chosen.note.caption, calloutType: chosen.note.calloutType, revision: 1 };
        await this.drafts!.write({ note }); view.copied = note; view.selected = version;
      }
      if (this.disposed || this.unloading) return;
      if (this.manager) await this.manager.open(view.copied); else this.fallback(view.copied);
    } finally { this.siYuanActions.delete(key); this.changed(); }
  }
  private async showDraftVersions(id?: string): Promise<void> {
    let panel: DraftVersionsDialog | undefined;
    const dialog = this.dialog(translate(id ? '恢复本机草稿' : '其他设备草稿', hostLocale()), '<div class="qn-versions-host"></div>', false, () => panel?.dispose());
    panel = new DraftVersionsDialog(dialog.element.querySelector('.qn-versions-host')!, {
      load: value => this.draftVersions(value), choose: async (...args) => { await this.chooseDraftVersion(...args); dialog.destroy(); },
    }, value => translate(value, hostLocale()), () => dialog.destroy());
    await panel.show(id);
  }
  private async noteForOpen(item: HistoryRecord): Promise<NoteRecord | undefined> {
    if (this.cleanup?.locks.has(item.id)) throw new Error('整理任务正在处理这条便签，请稍后重试');
    const draft = (await this.drafts!.list()).find(value => value.note.id === item.id);
    if ((draft?.variants?.length ?? 0) > 1) throw new Error('草稿存在多个版本，请从速记列表选择版本或另存');
    if (draft && !isSavedToSiYuan(draft.note)) return draft.note;
    try {
      if (draft) { await this.repository!.assertSource(draft.note); return draft.note; }
      const backup = await this.drafts!.readBackup?.(item.id);
      const note = await this.repository!.reload({ ...item, text: backup?.note.text ?? '', baseline: backup?.note.baseline,
        draftSync: await this.drafts!.savedContext?.(item.id) ?? backup?.note.draftSync, revision: 0, savedRevision: 0 });
      await this.drafts!.backup?.({ note }); return note;
    } catch (error) {
      if (!(error instanceof MissingSourceError)) throw error;
      const choice = await this.chooseMissingSource(item);
      if (this.disposed || this.unloading) return;
      if (choice === 'delete') { await this.deleteRecent(item, true, true); return; }
      if (choice !== 'restore') return;
      const local = draft ?? await this.drafts!.readBackup?.(item.id);
      if (!local) throw new Error('没有可用的插件正文副本，无法恢复。请从思源历史或回收站恢复。');
      if (this.deleted.has(item.id)) throw new Error('速记已从插件移除');
      const service = new AutoSaveService(local.note, this.repository!, this.drafts!, () => this.settingsValue.debounceMs,
        () => this.recentWindow?.refresh(), () => local.geometry ?? { width: this.settingsValue.width, height: this.settingsValue.height, pinned: false }, saved => this.recordFallback(saved));
      this.backgroundServices.set(item.id, service);
      try {
        if (!await service.restoreToSiYuan()) throw new Error(service.error || '保存未确认');
        return service.note;
      } finally { service.dispose(); this.backgroundServices.delete(item.id); }
    }
  }
  private async siYuanRecent(id: string): Promise<void> {
    if (this.disposed || this.unloading) throw new Error('插件已停用');
    if (this.cleanup?.locks.has(id)) throw new Error('整理任务正在处理这条便签，请稍后重试');
    if (this.siYuanActions.has(id)) throw new Error('正在保存到思源，请稍后重试');
    this.siYuanActions.add(id);
    try {
      if (((await this.drafts!.list()).find(value => value.note.id === id)?.variants?.length ?? 0) > 1) throw new Error('草稿存在多个版本，请从速记列表选择版本或另存');
      if (this.deleted.has(id)) throw new Error('速记已从插件移除');
      if (this.manager?.windows.has(id)) { await this.manager.siYuan(id); return; }
      const fallback = [...this.fallbackServices.values()].find(entry => entry.service.note.id === id);
      if (fallback) { await fallback.siYuan(); return; }
      const draft = (await this.drafts!.list()).find(value => value.note.id === id);
      const item = draft?.note ?? this.historyValue.find(value => value.id === id);
      if (!item) throw new Error('速记已不在列表中，请刷新后重试');
      const note = await this.noteForOpen(item);
      if (!note) return;
      let docId: string | undefined;
      let linked = false;
      if (draft) {
        linked = isSavedToSiYuan(note);
        const service = new AutoSaveService(note, this.repository!, this.drafts!, () => this.settingsValue.debounceMs,
          () => this.recentWindow?.refresh(), () => draft.geometry ?? { width: this.settingsValue.width, height: this.settingsValue.height, pinned: false },
          saved => this.recordFallback(saved));
        this.backgroundServices.set(id, service);
        try {
          if (!await service.saveToSiYuan()) throw new Error(service.error || '保存未确认');
          docId = service.note.docId;
        } finally { service.dispose(); this.backgroundServices.delete(id); }
      } else {
        linked = true; docId = note.docId;
      }
      if (linked && docId && !this.disposed && !this.unloading) await openTab({ app: this.app, doc: { id: docId, action: ['cb-get-focus'] } });
    } finally { this.siYuanActions.delete(id); this.recentWindow?.refresh(); }
  }
  private async deleteRecent(item: HistoryRecord, confirmed = false, fromMissingPrompt = false): Promise<boolean> {
    if (this.disposed || this.unloading) return false;
    if (this.cleanup?.locks.has(item.id)) throw new Error('整理任务正在处理这条便签，请稍后重试');
    if (this.siYuanActions.has(item.id) && !fromMissingPrompt) throw new Error('正在保存到思源，请稍后重试');
    const active = [...this.fallbackServices].find(([, entry]) => entry.service.note.id === item.id);
    if (this.manager && !active) return this.manager.deleteNote(item, confirmed);
    if (!confirmed && !await this.confirmDelete()) return false;
    if (this.cleanup?.locks.has(item.id)) throw new Error('整理任务正在处理这条便签，请稍后重试');
    if (active) {
      const [dialog, entry] = active; entry.service.pause(); entry.input.readOnly = true;
      try {
        await entry.service.edit(entry.input.value, entry.service.note.revision + 1, false);
        if (!await entry.service.closeToDraft()) throw new Error('最新草稿未确认落盘，请保留窗口内容');
        await this.removeShared(item.id);
        entry.service.markRemoved();
        await entry.service.delete(); dialog.destroy();
      } finally { entry.input.readOnly = false; entry.service.resume(); }
    } else {
      await this.removeShared(item.id);
      await this.drafts!.remove(item.id);
      await this.drafts!.removeBackup?.(item.id);
    }
    if (this.manager) { await this.manager.forgetNote(item.id); return true; }
    const states = await this.drafts!.loadWindowState(); delete states[item.id]; await this.drafts!.saveWindowState(states);
    const index = this.historyValue.findIndex(value => value.id === item.id);
    if (index >= 0) this.historyValue.splice(index, 1);
    await this.persistHistory([...this.historyValue]); return true;
  }
  private dialog(title: string, content: string, disableClose = false, onDestroy: () => void = () => {}): Dialog {
    const dialog = new Dialog({ title, content, width: '560px', disableClose, destroyCallback: () => {
      onDestroy();
      this.dialogs.delete(dialog); this.fallbackServices.get(dialog)?.service.dispose(); this.fallbackServices.delete(dialog);
      this.recentWindow?.refresh();
    } });
    this.dialogs.add(dialog); return dialog;
  }
  private async forgetEmptyNote(id: string): Promise<void> {
    if (this.manager) { await this.manager.forgetNote(id); return; }
    const states = await this.drafts!.loadWindowState(); delete states[id]; await this.drafts!.saveWindowState(states);
    this.historyValue = this.historyValue.filter(item => item.id !== id);
    this.recentWindow?.refresh();
  }
  private fallback(existing?: import('./types').NoteRecord): void {
    if (existing && this.cleanup?.locks.has(existing.id)) { this.report('整理任务正在处理这条便签，请稍后重试'); return; }
    if ((this.manager?.windows.size ?? 0) + this.fallbackServices.size >= this.settingsValue.maxWindows) {
      this.report('已达到窗口数量上限，请先关闭一个窗口'); return;
    }
    const note = existing ? migrateNoteTitle(structuredClone(existing)) : createNote();
    const dialog = this.dialog('降级模式：速记', '<div class="qn-fallback"><div class="qn-note-heading-row"><div class="qn-note-heading" data-note-heading></div><button type="button" class="qn-edit-title" data-edit-title aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5M4 15l5 5"/></svg></button></div><p>输入后自动保存在本设备。其他设备草稿可从列表查看，复制到本设备后编辑。手动保存到思源成功后，后续修改自动同步。</p><textarea class="b3-text-field" placeholder="Markdown 速记"></textarea><button class="b3-button">保存到思源中</button> <button class="b3-button b3-button--outline" data-keep-draft>保存到插件并关闭</button> <button class="b3-button b3-button--outline" data-insert-image>插入图片…</button><input type="file" multiple hidden data-image-picker><button class="b3-button b3-button--outline qn-callout-select" data-callout-select></button><p role="status"></p></div>', true);
    const input = dialog.element.querySelector('textarea')!; input.value = note.text;
    const surface = dialog.element.querySelector('.qn-fallback') as HTMLElement, calloutSelect = dialog.element.querySelector('[data-callout-select]') as HTMLButtonElement;
    const applyKind = (kind = service?.note.calloutType ?? note.calloutType ?? 'NOTE') => { surface.dataset.noteKind = kind; calloutSelect.textContent = kind; calloutSelect.title = translate('提示块类别', hostLocale()); };

    const heading = dialog.element.querySelector('[data-note-heading]') as HTMLElement;
    heading.textContent = note.caption || note.docTitle || translate('新速记', hostLocale()); heading.title = heading.textContent;
    const button = dialog.element.querySelector('button.b3-button') as HTMLButtonElement;
    const status = dialog.element.querySelector('[role=status]')!;
    const keepDraft = dialog.element.querySelector('[data-keep-draft]') as HTMLButtonElement;
    const insertImage = dialog.element.querySelector('[data-insert-image]') as HTMLButtonElement;
    let imageBusy = false;
    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    const service = new AutoSaveService(note, this.repository!, this.drafts!, () => this.settingsValue.debounceMs,
      () => {
        this.recentWindow?.refresh();
        applyKind(); heading.textContent = service.note.caption || service.note.docTitle || translate('新速记', hostLocale());
        button.textContent = isSavedToSiYuan(service.note) ? '在思源中打开' : '保存到思源中';
        if (imageBusy) return;
        status.textContent = service.error || (service.phase === 'saved' ? '已保存到思源' : service.phase === 'local' ? '已保存到插件' : '');
      },
      () => ({ width: this.settingsValue.width, height: this.settingsValue.height, pinned: this.settingsValue.alwaysOnTop }),
      saved => this.recordFallback(saved));
    applyKind();
    if (this.deleted.has(note.id)) service.markRemoved();
    calloutSelect.onclick = () => {
      if (this.unloading || this.disposed || input.disabled || imageBusy || composing) return;
      const menu = new Menu('quick-note-callout');
      for (const kind of calloutTypes) menu.addItem({ label: `${kind} · ${translate(calloutLabels[kind], hostLocale())}`, click: () => {
        if (this.unloading || this.disposed || input.disabled || imageBusy || composing || kind === service.note.calloutType) return;
        void service.edit(input.value, service.note.revision + 1, true, undefined, undefined, kind).catch(error => { status.textContent = message(error); });
      } });
      const rect = calloutSelect.getBoundingClientRect(); menu.open({ x: rect.right, y: rect.top, isLeft: true });
    };
    const editCaption = () => {
      if (this.unloading || this.disposed || imageBusy || composing || input.disabled) return;
      const tr = (value: string) => translate(value, hostLocale());
      const rename = this.dialog(tr('修改标题'), '<div class="qn-fallback"><input class="b3-text-field" data-caption maxlength="200"><p data-caption-help></p><p data-caption-error role="alert"></p><button class="b3-button" data-caption-save></button> <button class="b3-button b3-button--outline" data-caption-cancel></button></div>');
      const field = rename.element.querySelector('[data-caption]') as HTMLInputElement;
      field.value = service.note.caption ?? ''; field.placeholder = tr('留空使用默认标题'); field.setAttribute('aria-label', tr('便签标题'));
      rename.element.querySelector('[data-caption-help]')!.textContent = tr('标题将显示在思源提示块顶部，思源文档名保持不变。');
      const save = rename.element.querySelector('[data-caption-save]') as HTMLButtonElement; save.textContent = tr('保存');
      const cancel = rename.element.querySelector('[data-caption-cancel]') as HTMLButtonElement; cancel.textContent = tr('取消'); cancel.onclick = () => rename.destroy();
      save.onclick = () => {
        const value = field.value.trim();
        if (!validNoteTitle(value)) { rename.element.querySelector('[data-caption-error]')!.textContent = tr('便签标题须为不超过 200 字符的单行文本'); return; }
        if (this.unloading || this.disposed || !this.fallbackServices.has(dialog) || input.disabled || imageBusy || composing) return;
        if (value === (service.note.caption ?? '')) { rename.destroy(); return; }
        save.disabled = true;
        void service.edit(input.value, service.note.revision + 1, true, undefined, value).then(() => {
          if (service.error) throw new Error(service.error); rename.destroy();
        }).catch(error => { save.disabled = false; rename.element.querySelector('[data-caption-error]')!.textContent = message(error); });
      };
      field.focus(); field.select();
    };
    const titleEditButton = dialog.element.querySelector('[data-edit-title]') as HTMLButtonElement;
    titleEditButton.title = translate('修改标题', hostLocale()); titleEditButton.setAttribute('aria-label', titleEditButton.title);
    titleEditButton.onclick = editCaption;
    const siYuan = async () => {
      if (imageBusy || composing || input.disabled) throw new Error('窗口忙碌，请稍后重试');
      button.disabled = true; keepDraft.disabled = true; input.disabled = true; insertImage.disabled = true; service.pause();
      try {
        await service.edit(input.value, service.note.revision + 1, false);
        const linked = isSavedToSiYuan(service.note);
        if (linked) {
          try { await service.assertSource(); }
          catch (error) {
            if (!(error instanceof MissingSourceError)) throw error;
            const choice = await this.chooseMissingSource(service.note, this.remote?.getCurrentWindow?.());
            if (this.unloading || this.disposed) return;
            if (choice === 'delete') { await this.deleteRecent(service.note, true, true); return; }
            if (choice !== 'restore') return;
            if (!await service.restoreToSiYuan()) throw new Error(service.error || '保存未确认');
            openWindow({ doc: { id: service.note.docId! }, alwaysOnTop: this.settingsValue.alwaysOnTop }); return;
          }
        }
        if (!await service.saveToSiYuan()) throw new Error(service.error || '保存未确认');
        if (linked && !this.unloading && !this.disposed) openWindow({ doc: { id: service.note.docId! }, alwaysOnTop: this.settingsValue.alwaysOnTop });
      } finally {
        button.disabled = keepDraft.disabled = input.disabled = insertImage.disabled = this.unloading || this.disposed;
        service.resume();
      }
    };
    this.fallbackServices.set(dialog, { service, input, status, siYuan });
    if (isSavedToSiYuan(service.note)) this.recordFallback(service.note);
    button.textContent = isSavedToSiYuan(note) ? '在思源中打开' : '保存到思源中';
    this.recentWindow?.refresh();
    bindImageInputs(input, dialog.element.querySelector('[data-image-picker]') as HTMLInputElement, insertImage, files => {
      if (imageBusy || input.disabled || this.unloading || this.disposed || composing) return;
      const original = input.value, from = input.selectionStart, to = input.selectionEnd;
      imageBusy = true; input.readOnly = true; insertImage.disabled = true;
      status.textContent = '正在上传图片…';
      void readImages(files).then(images => new ImageUploadService().upload(images)).then(async markdown => {
        if (this.unloading || this.disposed || !this.fallbackServices.has(dialog)) return;
        if (input.value !== original) throw new Error('正文已变化，请重新插入图片');
        const insert = `${from && original[from - 1] !== '\n' ? '\n\n' : ''}${markdown}\n\n`;
        if (original.length - (to - from) + insert.length > 2_000_000) throw new Error('插入图片后超过 200 万字符');
        input.value = original.slice(0, from) + insert + original.slice(to);
        input.setSelectionRange(from + insert.length, from + insert.length);
        imageBusy = false;
        await service.edit(input.value, service.note.revision + 1);
        input.focus();
      }).catch(error => { if (!this.unloading && !this.disposed) status.textContent = `图片未插入：${message(error)}`; }).finally(() => {
        imageBusy = false; input.readOnly = this.unloading || this.disposed; insertImage.disabled = this.unloading || this.disposed;
      });
    });
    keepDraft.onclick = () => {
      if (composing) { status.textContent = '请完成输入后再关闭'; return; }
      if (imageBusy) { status.textContent = '图片正在上传，请等待完成后再关闭'; return; }
      input.disabled = true; keepDraft.disabled = true; button.disabled = true;
      void (async () => {
        await service.edit(input.value, service.note.revision + 1, false);
        if (isEmptyNewNote(service.note)) { await service.delete(); await this.forgetEmptyNote(service.note.id).catch(error => this.report(message(error))); }
        else if (!await service.closeToDraft()) throw new Error(service.error || '最新草稿未确认落盘');
        dialog.destroy();
      })().catch(error => {
        status.textContent = `草稿未落盘，不能关闭：${message(error)}`; input.disabled = false; keepDraft.disabled = false; button.disabled = false;
      });
    };
    input.oninput = () => {
      void service.edit(input.value, service.note.revision + 1).catch(error => { status.textContent = `草稿失败：${message(error)}`; });
    };
    button.onclick = () => {
      void this.siYuanRecent(service.note.id).catch(error => { status.textContent = `保存失败：${message(error)}`; });
    };
  }
  async onunload(): Promise<void> {
    this.unloading = true;
    clearTimeout(this.reminderTimer); this.reminderTimer = undefined;
    const cleanupShutdown = this.cleanup?.stop();
    this.tray?.stop();
    this.ipc?.removeListener('siyuan-hotkey', this.shortcutListener);
    // Start native shutdown immediately; fallback disk I/O must not consume
    // SiYuan's five-second unload budget before the native windows are notified.
    const nativeShutdown = this.manager?.dispose();
    const recentShutdown = this.recentWindow?.dispose();
    const backgroundShutdown = Promise.all([...this.backgroundServices.values()].map(async service => { service.pause(); await service.closeToDraft(); service.dispose(); }));
    const retained = new Set<Dialog>();
    await Promise.all([...this.fallbackServices].map(async ([dialog, { service, input, status }]) => {
      input.disabled = false; input.readOnly = true; service.pause();
      if (input.value !== service.note.text) void service.edit(input.value, service.note.revision + 1, false);
      let safe = await service.closeToDraft();
      if (safe && isEmptyNewNote(service.note)) {
        try { await service.delete(); await this.forgetEmptyNote(service.note.id).catch(error => this.report(message(error))); }
        catch (error) { safe = false; status.textContent = message(error); }
      }
      service.dispose();
      if (!safe) {
        retained.add(dialog); status.textContent = '插件已停用，最新草稿未确认落盘。请复制文本后关闭。';
        for (const button of dialog.element.querySelectorAll('button.b3-button')) (button as HTMLButtonElement).disabled = true;
        const close = document.createElement('button'); close.className = 'b3-button'; close.textContent = '复制文本后关闭';
        close.onclick = () => dialog.destroy(); status.parentElement?.append(close);
        this.report('降级窗口草稿未确认落盘，已保留窗口，请复制文本');
      }
    }));
    await nativeShutdown;
    await recentShutdown;
    await backgroundShutdown;
    await cleanupShutdown;
    await this.settingsWrites.run('settings', async () => {});
    await this.historyWrites.run('history', async () => {});
    await this.shared?.drain();
    this.disposed = true;
    for (const dialog of [...this.dialogs]) if (!retained.has(dialog)) dialog.destroy();
    this.dialogs.clear(); this.fallbackServices.clear();
    this.manager = undefined;
    this.recentWindow = undefined;
    this.tray = undefined;
    // Host destroyPlugin removes commands and refreshes its global shortcut bindings.
  }
  uninstall(): void { /* Formal documents and recovery drafts are intentionally retained. */ }
}
