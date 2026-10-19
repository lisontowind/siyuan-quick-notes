import type { DesktopAdapter, NativeWindow } from '../platform/desktop';
import type { LocalDraftStore } from '../platform/drafts';
import type { Settings, Target } from '../types';
import { hostLocale } from './i18n';
import { validRecentRequest, type RecentItem, type RecentPage, type RecentSettingsData, type RecentRequest, type RecentResponse } from './recent';
import { message } from '../services/autosave';
import { SerialQueue } from './serial';
import type { CleanupSnapshot, CleanupSelection, CleanupProgress } from '../services/cleanup';
import type { DraftVersionsData } from './recent';

export interface RecentActions {
  items(): Promise<RecentItem[]>;
  open(id: string): Promise<void>;
  siYuan(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  createNote(): Promise<void>;
  loadSettings(): Promise<RecentSettingsData>;
  saveSettings(settings: Settings): Promise<{ settings: Settings; warning?: string }>;
  previewSettings(settings: Settings): Promise<Target>;
  shortcuts(): void;
  cleanup?(): Promise<CleanupSnapshot>;
  cleanupStart?(mode: 'archive' | 'clear', selections: CleanupSelection[], discard: boolean): CleanupProgress;
  cleanupCancel?(): void;
  cleanupSnooze?(): Promise<void>;
  versions?(id?: string): Promise<DraftVersionsData>;
  chooseVersion?(id: string | undefined, version: string, token: string, copy: boolean): Promise<void>;
}
export class RecentWindowController {
  readonly session = crypto.randomUUID();
  readonly channelName = `siyuan-quick-notes:recent:${this.session}`;
  private channel = new BroadcastChannel(this.channelName);
  private native?: NativeWindow;
  private pending?: Promise<void>;
  private active = true;
  private queue = new SerialQueue();
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private geometryTimer?: ReturnType<typeof setTimeout>;
  private refreshing = false;
  private refreshAgain = false;
  private lifetime?: { stop(): void };
  private writes: Promise<void> = Promise.resolve();
  private page: RecentPage = 'notes';
  get nativeWindow(): NativeWindow | undefined { return this.native; }
  constructor(private adapter: DesktopAdapter, private store: LocalDraftStore, private settings: () => Settings,
    private actions: RecentActions, private guard: (window: NativeWindow) => { stop(): void },
    private report: (error: string) => void) {
    this.channel.onmessage = event => {
      if (!this.active || !this.native || !validRecentRequest(event.data, this.session)) return;
      const request: RecentRequest = event.data;
      if (request.action === 'heartbeat') { this.send({ requestId: request.requestId }); return; }
      void this.queue.run('actions', async () => {
        if (!this.active || !this.native) return;
        await this.handle(request);
      }).catch(error => this.send({ requestId: request.requestId, error: message(error) }));
    };
  }
  async show(page: RecentPage = 'notes'): Promise<void> {
    if (!this.active) return;
    this.page = page;
    if (this.pending) { await this.pending; this.send({ page: this.page }); return; }
    if (this.native && !this.native.isDestroyed()) { this.adapter.focus(this.native); this.send({ page }); this.refresh(); return; }
    this.pending = this.create();
    try { await this.pending; } finally { this.pending = undefined; }
  }
  private async create(): Promise<void> {
    let geometry = { width: 400, height: 560, pinned: false };
    if (this.settings().rememberPosition) {
      try { geometry = await this.store.loadRecentGeometry() ?? geometry; }
      catch (error) { this.report(message(error)); }
    }
    if (!this.active) return;
    const url = new URL('/plugins/siyuan-quick-notes/recent.html', location.origin);
    url.searchParams.set('session', this.session); url.searchParams.set('channel', this.channelName); url.searchParams.set('lang', hostLocale());
    url.searchParams.set('page', this.page);
    const native = await this.adapter.create(url.href, geometry);
    if (!this.active) { native.destroy(); return; }
    this.native = native;
    try { this.lifetime = this.guard(native); }
    catch (error) { this.native = undefined; if (!native.isDestroyed()) native.destroy(); throw error; }
    native.on('close', () => this.remember());
    native.on('closed', () => {
      this.native = undefined; clearTimeout(this.refreshTimer); clearTimeout(this.geometryTimer);
      this.lifetime?.stop(); this.lifetime = undefined;
    });
    native.on('focus', () => this.refresh());
    for (const event of ['move', 'resize']) native.on(event, () => {
      clearTimeout(this.geometryTimer); this.geometryTimer = setTimeout(() => this.remember(), 250);
    });
    native.webContents.on('will-navigate', (event: { preventDefault(): void }) => event.preventDefault());
    native.webContents.on('new-window', (event: { preventDefault(): void }) => event.preventDefault());
    this.adapter.focus(native); this.refresh();
  }
  private send(value: Omit<RecentResponse, 'session' | 'windowId'>): void {
    if (!this.active || !this.native || this.native.isDestroyed()) return;
    this.channel.postMessage({ session: this.session, windowId: 'recent', pinned: this.adapter.geometry(this.native).pinned,
      dark: document.documentElement.getAttribute('data-theme-mode') === 'dark', ...value } satisfies RecentResponse);
  }
  refresh(): void {
    if (!this.active || !this.native) return;
    if (this.refreshing) { this.refreshAgain = true; return; }
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined; this.refreshing = true;
      void Promise.all([this.actions.items(), this.actions.cleanup?.()]).then(([items, cleanup]) => this.send({ items, cleanup })).catch(error => this.send({ error: message(error) })).finally(() => {
        this.refreshing = false;
        if (this.refreshAgain) { this.refreshAgain = false; this.refresh(); }
      });
    }, 250);
  }
  settingsChanged(): void { this.send({ settingsChanged: true }); this.refresh(); }
  private remember(): void {
    if (!this.native || this.native.isDestroyed() || !this.settings().rememberPosition) return;
    const geometry = this.adapter.geometry(this.native);
    this.writes = this.store.saveRecentGeometry(geometry).catch(error => this.report(`最近列表窗口状态保存失败：${message(error)}`));
  }
  private async handle(request: RecentRequest): Promise<void> {
    const native = this.native!;
    switch (request.action) {
      case 'ready': this.send({ page: this.page }); this.refresh(); break;
      case 'refresh': this.refresh(); break;
      case 'notes': this.page = 'notes'; this.refresh(); break;
      case 'draft-versions': this.send({ requestId: request.requestId, draftVersions: await this.actions.versions?.(request.id!) }); return;
      case 'choose-draft-version': await this.actions.chooseVersion?.(request.id!, request.version!, request.token!, request.copy!); this.refresh(); break;
      case 'cleanup': this.page = 'cleanup'; this.send({ requestId: request.requestId, cleanup: await this.actions.cleanup?.() }); return;
      case 'cleanup-start': this.send({ requestId: request.requestId, cleanupProgress: this.actions.cleanupStart?.(request.mode!, request.selections!, request.discard!) }); this.refresh(); return;
      case 'cleanup-cancel': this.actions.cleanupCancel?.(); this.refresh(); break;
      case 'cleanup-snooze': await this.actions.cleanupSnooze?.(); break;
      case 'settings': this.page = 'settings'; this.send({ requestId: request.requestId, settingsData: await this.actions.loadSettings() }); return;
      case 'save-settings': {
        const result = await this.actions.saveSettings(request.settings!);
        this.send({ requestId: request.requestId, savedSettings: result.settings, settingsWarning: result.warning }); this.refresh(); return;
      }
      case 'preview-settings': this.send({ requestId: request.requestId, preview: await this.actions.previewSettings(request.settings!) }); return;
      case 'shortcuts': {
        this.actions.shortcuts(); native.minimize();
        break;
      }
      case 'open': await this.actions.open(request.id!); this.refresh(); break;
      case 'siyuan': await this.actions.siYuan(request.id!); this.refresh(); break;
      case 'new': await this.actions.createNote(); this.refresh(); break;
      case 'delete': {
        await this.actions.delete(request.id!); this.refresh();
        break;
      }
      case 'pin': native.setAlwaysOnTop(!this.adapter.geometry(native).pinned); this.remember(); break;
      case 'minimize': native.minimize(); break;
      case 'close': this.remember(); this.lifetime?.stop(); this.native = undefined; this.lifetime = undefined; break;
    }
    this.send({ requestId: request.requestId });
  }
  async dispose(): Promise<void> {
    if (!this.active) return;
    this.remember(); this.active = false;
    clearTimeout(this.refreshTimer); clearTimeout(this.geometryTimer);
    this.lifetime?.stop(); this.lifetime = undefined; this.native = undefined; this.channel.close();
    await this.writes;
  }
}
