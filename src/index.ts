import { Plugin, Menu, Dialog, getFrontend, getBackend, showMessage, openTab, openWindow, openSetting, confirm } from 'siyuan';
import './styles/index.css';
import { defaults, parseSettings } from './core/settings';
import { parseHistory } from './core/history';
import { QuickNoteWindowManager, type HistoryRecord } from './core/windows';
import { createNote, noteSummary } from './core/identity';
import { SerialQueue } from './core/serial';
import { ElectronAdapter } from './platform/desktop';
import { TrayAdapter } from './platform/tray';
import { LocalDraftStore } from './platform/drafts';
import { NoteRepository } from './services/repository';
import { SiYuanApi } from './services/kernel';
import { createMarkdownNormalizer } from './services/markdown';
import { AutoSaveService, message } from './services/autosave';
import { createSettings } from './components/settings';
import { assertPluginWrite } from './services/plugin-data';
import type { Settings } from './types';

const hostRequire = (name: string): any => (window as unknown as { require(name: string): unknown }).require(name);
export default class QuickNotesPlugin extends Plugin {
  private settingsValue: Settings = { ...defaults };
  private historyValue: HistoryRecord[] = [];
  private manager?: QuickNoteWindowManager;
  private repository?: NoteRepository;
  private drafts?: LocalDraftStore;
  private ipc?: any;
  private tray?: TrayAdapter;
  private trayIconPath?: string;
  private trayLifetimePath?: string;
  private workspaceName = '';
  private remote?: any;
  private disposed = false;
  private unloading = false;
  private dialogs = new Set<Dialog>();
  private fallbackServices = new Map<Dialog, { service: AutoSaveService; input: HTMLTextAreaElement; status: Element }>();
  private historyWrites = new SerialQueue();
  private settingsWrites = new SerialQueue();
  private nativeError?: string;
  private shortcutListener = (_: unknown, data: { failed?: string[] }) => {
    const command = this.commands.find(command => command.langKey === 'newQuickNote');
    if (data.failed?.some(key => key === command?.customHotkey || key === command?.hotkey)) {
      this.report('全局快捷键注册失败：可能被其他程序占用，请在思源快捷键设置中更换绑定');
    }
  };
  private report = (text: string): void => { if (!this.disposed) showMessage(text, 7000, 'error'); console.warn('[Quick Notes]', text); };
  private confirmDelete = (): Promise<boolean> => new Promise(resolve => {
    const main = this.remote?.getCurrentWindow?.(); main?.show(); main?.focus();
    confirm('删除这条速记？', '将删除这条速记的正文、本机草稿和最近记录。文档中的其他内容和文档本身保留。此操作不可通过插件撤销。', () => resolve(true), () => resolve(false));
  });
  private async writeData(name: string, value: unknown): Promise<void> {
    assertPluginWrite(await this.saveData(name, value));
  }
  private persistHistory(history: HistoryRecord[]): Promise<void> {
    return this.historyWrites.run('history', async () => { if (!this.disposed) await this.writeData('history.json', history); });
  }
  private recordFallback(note: import('./types').NoteRecord): void {
    const prior = this.historyValue.findIndex(item => item.id === note.id);
    if (prior >= 0) this.historyValue.splice(prior, 1);
    this.historyValue.unshift({ id: note.id, blockId: note.blockId, docId: note.docId, target: note.target,
      createdAt: note.createdAt, updatedAt: note.updatedAt, summary: noteSummary(note.text) });
    this.historyValue.splice(this.settingsValue.historyLimit);
    void this.persistHistory([...this.historyValue]).catch(error => this.report(`最近列表保存失败：${message(error)}`));
  }
  async onload(): Promise<void> {
    this.disposed = false;
    this.unloading = false;
    if (getFrontend() !== 'desktop' || getBackend() !== 'windows') return;
    this.settingsValue = parseSettings(await this.loadData('settings.json'));
    const history: unknown = await this.loadData('history.json');
    this.historyValue = parseHistory(history, this.settingsValue.historyLimit);
    const lute = window.Lute?.New();
    this.repository = new NoteRepository(new SiYuanApi(), () => this.settingsValue,
      lute ? createMarkdownNormalizer(lute) : undefined);
    const fs = hostRequire('fs/promises') as typeof import('node:fs/promises');
    const path = hostRequire('path') as typeof import('node:path');
    const nodeCrypto = hostRequire('crypto') as typeof import('node:crypto');
    const process = hostRequire('process') as NodeJS.Process;
    const config = window.siyuan.config as unknown as { system: { workspaceDir: string } };
    const workspace = config.system.workspaceDir;
    if (!workspace || !process.env.LOCALAPPDATA) throw new Error('无法定位工作空间或本机恢复草稿目录');
    const workspaceKey = nodeCrypto.createHash('sha256').update(workspace.toLowerCase()).digest('hex').slice(0, 24);
    this.workspaceName = path.basename(workspace);
    this.trayIconPath = path.join(workspace, 'data', 'plugins', this.name, 'tray.ico');
    this.trayLifetimePath = path.join(workspace, 'data', 'plugins', this.name, 'tray-lifetime.cjs');
    this.drafts = new LocalDraftStore(fs, path, path.join(process.env.LOCALAPPDATA, 'SiYuanQuickNotes', workspaceKey));
    try {
      this.remote = hostRequire('@electron/remote');
      const adapter = new ElectronAdapter(this.remote);
      this.manager = new QuickNoteWindowManager(adapter, this.repository, this.drafts, () => this.settingsValue, this.historyValue,
        history => this.persistHistory(history), this.report,
        id => { void openTab({ app: this.app, doc: { id, action: ['cb-get-focus'] } }).catch(error => this.report(message(error))); },
        () => { void this.showRecent(); }, this.confirmDelete, () => this.fallbackServices.size);
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
    this.addCommand({ langKey: 'recentQuickNotes', langText: '最近速记与恢复草稿', callback: () => { void this.showRecent(); } });
    this.addTopBar({ icon: 'iconEdit', title: '悬浮速记', position: 'right', callback: event => {
      const menu = new Menu('quick-notes-menu');
      menu.addItem({ icon: 'iconAdd', label: '新建悬浮速记', click: trigger });
      menu.addItem({ icon: 'iconHistory', label: '最近速记与恢复草稿', click: () => { void this.showRecent(); } });
      menu.addItem({ icon: 'iconSettings', label: '速记设置', click: () => { void this.openSettingsPanel(); } });
      menu.open({ x: event.clientX, y: event.clientY });
    } });
    this.syncTray();
    await this.manager?.initialize();
    if (!this.manager) this.report(`原生速记窗口不可用：${this.nativeError}。新建命令将提供明确标记的官方窗口降级入口。`);
  }
  openSetting(): void { void this.openSettingsPanel(); }
  private syncTray(): void {
    if (this.disposed || this.unloading || !this.settingsValue.trayEnabled) { this.tray?.stop(); return; }
    try {
      this.remote ??= hostRequire('@electron/remote');
      this.tray ??= new TrayAdapter(this.remote, {
        createNote: () => this.newNote(), recent: () => this.showRecent(), settings: () => this.openSettingsPanel(),
        windows: () => [...(this.manager?.windows.entries() ?? [])].map(([id, entry], index) => ({ id,
          label: `${index + 1}. ${noteSummary(entry.service.note.text, 40)}`,
        })),
        focusWindow: async id => { const entry = this.manager?.windows.get(id); if (entry) await this.manager?.open(entry.service.note); },
        showOwner: () => {
          const owner = this.remote.getCurrentWindow();
          if (!owner.isDestroyed()) { if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus(); }
        },
      }, this.report, window, this.trayLifetimePath!);
      this.tray.start(this.trayIconPath!, this.workspaceName);
    } catch (error) { this.report(`独立速记托盘不可用：${message(error)}。仍可使用顶栏和快捷键。`); }
  }
  private async openSettingsPanel(): Promise<void> {
    try {
      const notebooks = await this.repository?.notebooks() ?? [];
      if (this.disposed || this.unloading) return;
      this.setting = createSettings(this.settingsValue, notebooks, settings => this.settingsWrites.run('settings', async () => {
        if (this.disposed || this.unloading) throw new Error('插件已停用，设置未保存');
        await this.writeData('settings.json', settings);
        if (this.disposed || this.unloading) return;
        this.settingsValue = settings;
        this.manager?.refresh(); this.syncTray();
        if (this.historyValue.length > settings.historyLimit) {
          this.historyValue.splice(settings.historyLimit);
          try { await this.persistHistory([...this.historyValue]); }
          catch (error) { this.report(`设置已保存，最近列表保存失败：${message(error)}`); return; }
        }
        showMessage('速记设置已保存');
      }), () => {
        // 3.8.6 supports a tab argument; SDK 1.2.7 still declares the one-argument form.
        (openSetting as unknown as (app: typeof this.app, tab: string) => void)(this.app, 'keymap');
      }, () => { void this.showRecent(); }, this.report, value => this.repository!.resolveTarget(createNote(), value));
      this.setting.open('悬浮速记');
    } catch (error) { this.report(message(error)); }
  }
  private async newNote(useShortcutBehavior = false): Promise<void> {
    if (this.disposed || this.unloading) return;
    if (this.manager) {
      try { if (useShortcutBehavior) await this.manager.trigger(); else await this.manager.open(createNote()); }
      catch (error) { this.report(`轻量窗口创建失败：${message(error)}。已提供官方窗口降级入口。`); this.fallback(); }
    }
    else this.fallback();
  }
  private async showRecent(): Promise<void> {
    try {
      const drafts = await this.drafts?.list() ?? [];
      if (this.disposed || this.unloading) return;
      const dialog = this.dialog('最近速记与恢复草稿', '<div class="qn-list"><input class="b3-text-field qn-search" type="search" aria-label="搜索速记" placeholder="搜索摘要、保存位置或时间"><div class="qn-results"></div></div>');
      const list = dialog.element.querySelector('.qn-results')!;
      const search = dialog.element.querySelector('input')!;
      const draftIds = new Set(drafts.map(draft => draft.note.id));
      const entries = [...drafts.map(draft => ({ id: draft.note.id, time: draft.note.updatedAt, path: draft.note.target?.path || '',
        item: draft.note, label: `本机草稿 · ${noteSummary(draft.note.text, 40)}`, open: async () => {
        if (this.manager) await this.manager.open(draft.note, draft.geometry); else this.fallback(draft.note);
      } })), ...this.historyValue.filter(item => !draftIds.has(item.id)).map(item => ({ id: item.id, time: item.updatedAt,
        item, label: item.summary || item.target?.path.split('/').pop() || '速记', path: item.target?.path || '', open: async () => {
        if (this.manager) await this.manager.reopen(item); else openWindow({ doc: { id: item.blockId } });
      } }))];
      if (!entries.length) list.textContent = '暂无速记。使用 Ctrl + Alt + N 新建。';
      const appendRow = (item: HistoryRecord, label: string, searchable: string, open: () => Promise<void>) => {
        const row = document.createElement('div'); row.className = 'qn-history-row'; row.dataset.search = searchable.toLocaleLowerCase();
        const button = document.createElement('button'); button.className = 'qn-history-item';
        button.textContent = label;
        button.onclick = () => { button.disabled = true; void open().then(() => dialog.destroy()).catch(error => { button.disabled = false; this.report(message(error)); }); };
        const remove = document.createElement('button'); remove.className = 'qn-delete b3-button b3-button--outline'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除 ${label.split('\n')[0]}`);
        remove.onclick = () => {
          remove.disabled = true;
          void this.deleteRecent(item).then(deleted => {
            if (deleted) { dialog.destroy(); void this.showRecent(); }
          }).catch(error => this.report(`删除失败：${message(error)}`)).finally(() => { remove.disabled = false; });
        };
        row.append(button, remove); list.append(row);
      };
      for (const entry of entries) {
        const label = `${entry.label}\n${new Date(entry.time).toLocaleString()}${entry.path ? `\n${entry.path}` : ''}`;
        appendRow(entry.item, label, `${label} ${entry.path}`, entry.open);
      }
      if (this.manager?.windows.size) {
        const title = document.createElement('p'); title.textContent = `当前打开 ${this.manager.windows.size} 个窗口（点击下列项目唤醒）`; list.append(title);
        for (const [id, entry] of this.manager.windows) {
          const label = `${noteSummary(entry.service.note.text, 40)}${entry.service.note.target ? `\n${entry.service.note.target.path}` : ''}`;
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
  private async deleteRecent(item: HistoryRecord): Promise<boolean> {
    if (this.disposed || this.unloading) return false;
    if (this.manager) return this.manager.deleteNote(item);
    if (!await this.confirmDelete()) return false;
    const active = [...this.fallbackServices].find(([, entry]) => entry.service.note.id === item.id);
    if (active) {
      const [dialog, entry] = active; entry.service.pause(); entry.input.readOnly = true;
      try {
        await entry.service.edit(entry.input.value, entry.service.note.revision + 1, false);
        if (!await entry.service.closeToDraft()) throw new Error('最新草稿未确认落盘，请保留窗口内容');
        await entry.service.delete(); dialog.destroy();
      } finally { entry.input.readOnly = false; entry.service.resume(); }
    } else {
      const draft = (await this.drafts!.list()).find(value => value.note.id === item.id);
      await this.repository!.delete(draft?.note ?? item); await this.drafts!.remove(item.id);
    }
    const index = this.historyValue.findIndex(value => value.id === item.id);
    if (index >= 0) this.historyValue.splice(index, 1);
    await this.persistHistory([...this.historyValue]); return true;
  }
  private dialog(title: string, content: string, disableClose = false): Dialog {
    const dialog = new Dialog({ title, content, width: '560px', disableClose, destroyCallback: () => {
      this.dialogs.delete(dialog); this.fallbackServices.get(dialog)?.service.dispose(); this.fallbackServices.delete(dialog);
    } });
    this.dialogs.add(dialog); return dialog;
  }
  private fallback(existing?: import('./types').NoteRecord): void {
    if ((this.manager?.windows.size ?? 0) + this.fallbackServices.size >= this.settingsValue.maxWindows) {
      this.report('已达到窗口数量上限，请先关闭一个窗口'); return;
    }
    const note = existing ? structuredClone(existing) : createNote();
    const dialog = this.dialog('降级模式：保存后打开思源官方窗口', '<div class="qn-fallback"><p>当前无法创建轻量原生窗口。输入内容并保存后，打开思源官方文档窗口（至少 493 × 376）。</p><textarea class="b3-text-field" placeholder="Markdown 速记"></textarea><button class="b3-button">保存并打开官方窗口</button> <button class="b3-button b3-button--outline" data-keep-draft>保留草稿并关闭</button><p role="status"></p></div>', true);
    const input = dialog.element.querySelector('textarea')!; input.value = note.text;
    const button = dialog.element.querySelector('button.b3-button') as HTMLButtonElement;
    const status = dialog.element.querySelector('[role=status]')!;
    const keepDraft = dialog.element.querySelector('[data-keep-draft]') as HTMLButtonElement;
    const service = new AutoSaveService(note, this.repository!, this.drafts!, () => this.settingsValue.debounceMs,
      () => { if (service.error) status.textContent = service.error; },
      () => ({ width: this.settingsValue.width, height: this.settingsValue.height, pinned: this.settingsValue.alwaysOnTop }),
      saved => this.recordFallback(saved));
    this.fallbackServices.set(dialog, { service, input, status });
    keepDraft.onclick = () => {
      input.disabled = true; keepDraft.disabled = true; button.disabled = true;
      void service.closeToDraft().then(safe => { if (!safe) throw new Error(service.error || '最新草稿未确认落盘'); dialog.destroy(); }).catch(error => {
        status.textContent = `草稿未落盘，不能关闭：${message(error)}`; input.disabled = false; keepDraft.disabled = false; button.disabled = false;
      });
    };
    input.oninput = () => {
      void service.edit(input.value, service.note.revision + 1, false).catch(error => { status.textContent = `草稿失败：${message(error)}`; });
    };
    button.onclick = () => {
      if (!service.note.text.trim()) return;
      button.disabled = true; keepDraft.disabled = true; input.disabled = true;
      void service.flush().then(async safe => {
        if (!safe) throw new Error(service.error || '保存未确认');
        if (this.unloading || this.disposed) return;
        const note = service.note;
        await this.historyWrites.run('history', async () => {});
        openWindow({ doc: { id: note.blockId }, alwaysOnTop: this.settingsValue.alwaysOnTop }); dialog.destroy();
      }).catch(error => { status.textContent = `保存失败：${message(error)}`; button.disabled = false; keepDraft.disabled = false; input.disabled = false; });
    };
  }
  async onunload(): Promise<void> {
    this.unloading = true;
    this.tray?.stop();
    this.ipc?.removeListener('siyuan-hotkey', this.shortcutListener);
    // Start native shutdown immediately; fallback disk I/O must not consume
    // SiYuan's five-second unload budget before the native windows are notified.
    const nativeShutdown = this.manager?.dispose();
    const retained = new Set<Dialog>();
    await Promise.all([...this.fallbackServices].map(async ([dialog, { service, input, status }]) => {
      input.disabled = false; input.readOnly = true; service.pause();
      if (input.value !== service.note.text) void service.edit(input.value, service.note.revision + 1, false);
      const safe = await service.closeToDraft(); service.dispose();
      if (!safe) {
        retained.add(dialog); status.textContent = '插件已停用，最新草稿未确认落盘。请复制文本后关闭。';
        for (const button of dialog.element.querySelectorAll('button.b3-button')) (button as HTMLButtonElement).disabled = true;
        const close = document.createElement('button'); close.className = 'b3-button'; close.textContent = '复制文本后关闭';
        close.onclick = () => dialog.destroy(); status.parentElement?.append(close);
        this.report('降级窗口草稿未确认落盘，已保留窗口，请复制文本');
      }
    }));
    await nativeShutdown;
    await this.settingsWrites.run('settings', async () => {});
    await this.historyWrites.run('history', async () => {});
    this.disposed = true;
    for (const dialog of [...this.dialogs]) if (!retained.has(dialog)) dialog.destroy();
    this.dialogs.clear(); this.fallbackServices.clear();
    this.manager = undefined;
    this.tray = undefined;
    // Host destroyPlugin removes commands and refreshes its global shortcut bindings.
  }
  uninstall(): void { /* Formal documents and recovery drafts are intentionally retained. */ }
}
