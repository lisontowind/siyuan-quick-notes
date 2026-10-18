import type { Draft, Geometry, NoteRecord, NoteReference, Request, Response, Settings, WindowState, WindowRecoveryState } from '../types';
import type { DesktopAdapter, NativeWindow } from '../platform/desktop';
import { LocalDraftStore } from '../platform/drafts';
import { NoteRepository } from '../services/repository';
import { AutoSaveService, message } from '../services/autosave';
import { createNote, noteReference, noteLabel } from './identity';
import { SerialQueue, TriggerGate } from './serial';
import { validRequest } from './protocol';
import { ImageUploadService } from '../services/images';
import { hostLocale } from './i18n';

export type HistoryRecord = NoteReference & { summary?: string };
export interface WindowEntry { native?: NativeWindow; service: AutoSaveService; geometry: Geometry; lastFocus: number; closing: boolean }
export class QuickNoteWindowManager {
  readonly windows = new Map<string, WindowEntry>();
  readonly session = crypto.randomUUID();
  readonly channelName: string;
  private channel: BroadcastChannel;
  private incoming = new SerialQueue();
  private pending = new Map<string, Promise<void>>();
  private gate = new TriggerGate();
  private active = true;
  private tearingDown = false;
  private themeTimer: ReturnType<typeof setInterval>;
  private stateTimer?: ReturnType<typeof setTimeout>;
  private metadataQueue = new SerialQueue();
  private geometries: Record<string, WindowRecoveryState> = {};
  private dark = false;
  private collections = new Map<string, { requestId: string; resolve: (safe: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  private disposal?: Promise<void>;
  private deleting = new Set<string>();
  private deletionWork = new Set<Promise<void>>();
  private uploading = new Set<string>();
  constructor(private adapter: DesktopAdapter, private repo: NoteRepository, private drafts: LocalDraftStore,
    private settings: () => Settings, readonly history: HistoryRecord[],
    private persistHistory: (history: HistoryRecord[]) => Promise<void>, private report: (text: string) => void,
    private openDoc: (id: string) => void, private showRecent: () => void,
    private confirmDelete: () => Promise<boolean> = async () => false,
    private externalWindowCount: () => number = () => 0,
    private images = new ImageUploadService(), private windowListChanged: () => void = () => {}) {
    this.channelName = `siyuan-quick-notes:${this.session}`;
    this.channel = new BroadcastChannel(this.channelName);
    this.channel.onmessage = event => {
      if (!this.active || !validRequest(event.data, this.session) || !this.windows.has(event.data.windowId)) return;
      const req: Request = event.data;
      // Input, heartbeat, and durable close acknowledgements must not wait for kernel I/O.
      const immediate = ['edit', 'ready', 'heartbeat', 'collected', 'close', 'close-draft', 'upload-images'].includes(req.action);
      if (this.tearingDown && !['edit', 'heartbeat', 'collected', 'ready'].includes(req.action)) return;
      const work = immediate ? this.handle(req) : this.incoming.run(req.windowId, () => this.handle(req));
      void work.catch(error => {
        const entry = this.windows.get(req.windowId);
        if (entry) { entry.service.error = message(error); entry.service.phase = 'error'; this.publish(req.windowId, req.requestId); }
        this.report(message(error));
      });
    };
    const updateTheme = () => {
      const dark = document.documentElement.getAttribute('data-theme-mode') === 'dark';
      if (dark !== this.dark) { this.dark = dark; for (const id of this.windows.keys()) this.publish(id); }
    };
    updateTheme(); this.themeTimer = setInterval(updateTheme, 1500);
  }
  async initialize(): Promise<void> {
    try { this.geometries = await this.drafts.loadWindowState(); }
    catch (error) { this.report(`窗口状态读取失败：${message(error)}`); }
    const drafts = await this.drafts.list();
    for (const warning of this.drafts.warnings) this.report(warning);
    if (drafts.length) this.report(`发现 ${drafts.length} 条本机恢复草稿，请从“最近速记与恢复草稿”打开`);
    if (this.settings().restoreWindows) {
      const candidates = new Map<string, { id: string; updatedAt: number; draft?: Draft; history?: HistoryRecord }>();
      for (const item of this.history) if (this.geometries[item.id]?.open) candidates.set(item.id, { ...item, history: item });
      for (const [id, state] of Object.entries(this.geometries)) {
        if (state.open && state.note) candidates.set(id, { id, updatedAt: state.note.updatedAt, history: state.note });
      }
      for (const draft of drafts) {
        const geometry = this.geometries[draft.note.id] ?? draft.geometry;
        if (geometry?.open) candidates.set(draft.note.id, { id: draft.note.id, updatedAt: draft.note.updatedAt, draft });
      }
      for (const item of [...candidates.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
        if (!this.active || this.tearingDown || this.openWindowCount() >= this.settings().maxWindows) break;
        try {
          const draft = item.draft ?? drafts.find(d => d.note.id === item.id);
          if (draft) await this.open(draft.note, draft.geometry);
          else if (item.history) await this.reopen(item.history);
        } catch (error) { this.report(`恢复窗口失败：${message(error)}`); }
      }
    }
  }
  async trigger(): Promise<void> {
    if (!this.active || this.tearingDown || !this.gate.accept()) return;
    const recent = [...this.windows.entries()].sort((a, b) => b[1].lastFocus - a[1].lastFocus)[0];
    if ((this.settings().shortcutBehavior === 'recent' || this.openWindowCount() >= this.settings().maxWindows) && recent) {
      await this.pending.get(recent[0]); this.focus(recent[0]);
      if (this.openWindowCount() >= this.settings().maxWindows) this.report('已达到速记窗口数量上限，已唤醒最近窗口');
      return;
    }
    await this.open(createNote());
  }
  async open(note: NoteRecord, restored?: Geometry, persistDraft = false): Promise<void> {
    if (!this.active || this.tearingDown || this.deleting.has(note.id)) return;
    if (this.windows.has(note.id)) { await this.pending.get(note.id); this.focus(note.id); return; }
    if (this.openWindowCount() >= this.settings().maxWindows) { this.report('已达到窗口数量上限，请先关闭一个窗口'); return; }
    const settings = this.settings();
    const prior = settings.rememberPosition ? this.geometries[note.id] ?? restored : undefined;
    const geometry: Geometry = { width: prior?.width ?? settings.width, height: prior?.height ?? settings.height,
      pinned: prior?.pinned ?? settings.alwaysOnTop, open: true };
    if (prior?.x !== undefined) geometry.x = prior.x;
    if (prior?.y !== undefined) geometry.y = prior.y;
    const entry: WindowEntry = { geometry, lastFocus: Date.now(), closing: false, service: undefined as unknown as AutoSaveService };
    entry.service = new AutoSaveService(structuredClone(note), this.repo, this.drafts, () => this.settings().debounceMs,
      () => this.publish(note.id), () => this.bounds(entry), saved => this.record(saved));
    this.windows.set(note.id, entry);
    const work = (async () => {
      const url = new URL(`/plugins/siyuan-quick-notes/window.html`, location.origin);
      url.searchParams.set('channel', this.channelName); url.searchParams.set('session', this.session); url.searchParams.set('windowId', note.id);
      url.searchParams.set('lang', hostLocale());
      try {
        if (persistDraft && !await entry.service.persist()) throw new Error('副本草稿未确认落盘，未打开新窗口，请重试');
        entry.native = await this.adapter.create(url.href, geometry);
        if (!this.active) { entry.native.destroy(); entry.service.dispose(); this.windows.delete(note.id); return; }
        entry.geometry = this.bounds(entry);
        entry.native.on('close', (event: { preventDefault(): void }) => {
          if (!this.active) return; // A retained, unsafe window may be manually closed after copying its text.
          event.preventDefault();
          if (!entry.closing) void this.closeWindow(note.id, false).catch(error => this.report(message(error)));
        });
        entry.native.on('focus', () => { entry.lastFocus = Date.now(); });
        for (const event of ['move', 'resize']) entry.native.on(event, () => this.scheduleState());
        entry.native.on('closed', () => {
          if (!this.active) return;
          if (this.windows.has(note.id)) { entry.service.dispose(); this.windows.delete(note.id); this.notifyWindowList(); this.scheduleState(); }
        });
        entry.native.webContents.on('will-navigate', (event: { preventDefault(): void }) => event.preventDefault());
        entry.native.webContents.on('new-window', (event: { preventDefault(): void }) => event.preventDefault());
        this.focus(note.id); this.publish(note.id); this.scheduleState();
      } catch (error) { entry.service.dispose(); this.windows.delete(note.id); this.notifyWindowList(); throw error; }
    })();
    this.pending.set(note.id, work);
    try { await work; } finally { this.pending.delete(note.id); }
  }
  private openWindowCount(): number { return this.windows.size + this.externalWindowCount(); }
  private bounds(entry: WindowEntry): Geometry {
    if (!entry.native || entry.native.isDestroyed()) return entry.geometry;
    try { return this.adapter.geometry(entry.native); } catch { return entry.geometry; }
  }
  private focus(id: string): void {
    const entry = this.windows.get(id);
    if (entry?.native && !entry.native.isDestroyed()) {
      try { this.adapter.focus(entry.native); }
      catch (error) { this.report(`窗口唤醒失败：${message(error)}。可从系统窗口列表打开便签。`); }
      entry.lastFocus = Date.now(); this.send({ windowId: id, focus: true });
    }
  }
  private send(value: Omit<Response, 'session'>): void { if (this.active) this.channel.postMessage({ ...value, session: this.session }); }
  private publish(id: string, requestId?: string, content = false): void {
    const entry = this.windows.get(id); if (!entry) return;
    const note = entry.service.note;
    const state: WindowState = { revision: note.revision, savedRevision: note.savedRevision, docId: note.docId,
      title: noteLabel(note, 40, '新速记'), docTitle: note.docTitle || note.docPath?.split('/').pop() || note.target?.path.split('/').pop(), phase: entry.service.phase, error: entry.service.error,
      localRevision: entry.service.localRevision, pinned: this.bounds(entry).pinned, dark: this.dark, showSaved: this.settings().showSaved };
    this.send({ windowId: id, requestId, state, ...(content ? { content: { text: note.text, revision: note.revision } } : {}) });
    this.notifyWindowList();
  }
  private notifyWindowList(): void {
    try { this.windowListChanged(); }
    catch (error) { this.report(`托盘窗口列表更新失败：${message(error)}`); }
  }
  private setPinned(entry: WindowEntry, pinned: boolean): void {
    try { entry.native?.setAlwaysOnTop(pinned); }
    catch (error) { this.report(`当前桌面环境无法置顶：${message(error)}`); }
  }
  private async handle(req: Request): Promise<void> {
    const entry = this.windows.get(req.windowId); if (!entry || !this.active) return;
    if (this.tearingDown && !['edit', 'ready', 'heartbeat', 'collected'].includes(req.action)) return;
    const service = entry.service;
    switch (req.action) {
      case 'upload-images': {
        if (entry.closing || this.uploading.has(req.windowId)) {
          this.send({ windowId: req.windowId, requestId: req.requestId, imageUpload: { error: '窗口忙碌，请稍后重试' } }); return;
        }
        this.uploading.add(req.windowId);
        try {
          const markdown = await this.images.upload(req.images!);
          if (!entry.closing && this.windows.get(req.windowId) === entry && !this.tearingDown) {
            this.send({ windowId: req.windowId, requestId: req.requestId, imageUpload: { markdown } });
          } else this.send({ windowId: req.windowId, requestId: req.requestId, imageUpload: { error: '窗口正在关闭，请稍后重新插入图片' } });
        } catch (error) {
          this.send({ windowId: req.windowId, requestId: req.requestId, imageUpload: { error: message(error) } });
        } finally { this.uploading.delete(req.windowId); }
        return;
      }
      case 'ready': this.publish(req.windowId, req.requestId, true); return;
      case 'heartbeat': this.send({ windowId: req.windowId, requestId: req.requestId,
        heartbeat: { revision: service.note.revision, localRevision: service.localRevision } }); return;
      case 'collected': await this.acceptCollection(req); return;
      case 'edit': {
        const id = req.windowId, requestId = req.requestId;
        void service.edit(req.text!, req.revision!, true, req.title).then(() => this.publish(id, requestId)).catch(error => this.report(message(error)));
        return;
      }
      case 'save': await service.flush(); break;
      case 'close': await this.closeWindow(req.windowId, false); break;
      case 'close-draft': await this.closeWindow(req.windowId, true); break;
      case 'delete': await this.deleteNote(service.note); break;
      case 'pin':
        this.setPinned(entry, !this.bounds(entry).pinned); this.scheduleState();
        break;
      case 'minimize':
        try { entry.native?.minimize(); }
        catch (error) { this.report(`当前桌面环境无法最小化：${message(error)}`); }
        break;
      case 'new': await this.open(createNote()); break;
      case 'open': if (await service.flush() && service.note.docId) this.openDoc(service.note.docId); break;
      case 'recent': this.showRecent(); break;
      case 'reload': {
        if (entry.closing) break;
        entry.closing = true; service.pause();
        try { if (await this.collect(req.windowId)) { await service.reload(); this.publish(req.windowId, req.requestId, true); } }
        finally { if (!this.tearingDown) { entry.closing = false; service.resume(); this.send({ windowId: req.windowId, resume: true }); } }
        break;
      }
      case 'copy-note': {
        const copy = createNote(); copy.text = service.note.text; copy.revision = 1;
        await this.open(copy, undefined, true); break;
      }
    }
    this.publish(req.windowId, req.requestId);
  }
  private collect(id: string): Promise<boolean> {
    return new Promise(resolve => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.collections.delete(id);
        const entry = this.windows.get(id);
        if (entry) { entry.service.error = '未收到窗口最新内容的落盘确认，已保留窗口，请复制文本'; entry.service.phase = 'error'; this.publish(id); }
        resolve(false);
      }, this.tearingDown ? 2500 : 5000);
      this.collections.set(id, { requestId, timer, resolve });
      this.send({ windowId: id, requestId, collect: true });
    });
  }
  private async acceptCollection(req: Request): Promise<void> {
    const pending = this.collections.get(req.windowId), entry = this.windows.get(req.windowId);
    if (!pending || pending.requestId !== req.requestId || !entry) return;
    let safe = false;
    if (req.error) { entry.service.error = req.error; entry.service.phase = 'error'; }
    else if (req.revision! >= entry.service.note.revision && (req.revision !== entry.service.note.revision
      || (req.text === entry.service.note.text && (req.title === undefined || req.title === (entry.service.note.title ?? ''))))) {
      const edit = entry.service.edit(req.text!, req.revision!, false, req.title);
      safe = await entry.service.closeToDraft(); await edit;
    } else { entry.service.error = '窗口内容版本不一致，已保留窗口'; entry.service.phase = 'error'; }
    // Timeout may already have resolved the collection. A late acknowledgement cannot close a window.
    if (this.collections.get(req.windowId) !== pending) return;
    clearTimeout(pending.timer); this.collections.delete(req.windowId);
    if (safe) this.send({ windowId: req.windowId, requestId: req.requestId, durable: { revision: req.revision! } });
    this.publish(req.windowId); pending.resolve(safe);
  }
  private async closeWindow(id: string, draftOnly: boolean): Promise<void> {
    const entry = this.windows.get(id); if (!entry || entry.closing || this.tearingDown) return;
    entry.closing = true; entry.service.pause();
    try {
      if (!await this.collect(id)) return;
      if (draftOnly) await entry.service.cleanSavedDraft();
      else if (!await entry.service.flush()) {
        // A kernel error must not trap the user in a window. Reconfirm the latest
        // recovery metadata after the attempted save, then close with a draft.
        if (!await entry.service.closeToDraft()) return;
        this.report('未保存到思源，已保留本机草稿。可从“最近速记与恢复草稿”继续。');
      }
      if (!this.tearingDown) await this.finishClose(id);
    } finally {
      if (this.windows.has(id) && !this.tearingDown) { entry.closing = false; entry.service.resume(); this.send({ windowId: id, resume: true }); }
    }
  }
  private async finishClose(id: string, persist = true): Promise<void> {
    const entry = this.windows.get(id); if (!entry) return;
    this.geometries[id] = { ...this.bounds(entry), open: false,
      ...(entry.service.note.docId ? { note: noteReference(entry.service.note) } : {}) };
    entry.closing = true; entry.service.dispose(); this.windows.delete(id);
    this.notifyWindowList();
    if (entry.native && !entry.native.isDestroyed()) entry.native.destroy();
    if (persist) await this.persistState();
  }
  private record(note: NoteRecord): void {
    if (!note.docId || note.savedRevision <= 0) return;
    const record: HistoryRecord = { ...noteReference(note), summary: noteLabel(note) };
    this.scheduleState();
    const index = this.history.findIndex(item => item.id === note.id);
    if (index >= 0 && this.history[index].updatedAt === record.updatedAt && this.history[index].summary === record.summary) return;
    if (index >= 0) this.history.splice(index, 1);
    this.history.unshift(record); this.history.splice(this.settings().historyLimit);
    void this.metadataQueue.run('history', () => this.persistHistory([...this.history])).catch(error => this.report(`最近列表保存失败：${message(error)}`));
  }
  private scheduleState(): void { if (!this.active || this.tearingDown) return; clearTimeout(this.stateTimer); this.stateTimer = setTimeout(() => { void this.persistState().catch(error => this.report(message(error))); }, 250); }
  private async persistState(): Promise<void> {
    for (const [id, entry] of this.windows) this.geometries[id] = { ...this.bounds(entry),
      ...(entry.service.note.docId ? { note: noteReference(entry.service.note) } : {}) };
    await this.drafts.saveWindowState(this.geometries);
  }
  async reopen(item: HistoryRecord): Promise<void> {
    if (this.windows.has(item.id)) { this.focus(item.id); return; }
    const draft = (await this.drafts.list()).find(d => d.note.id === item.id);
    if (draft) { await this.open(draft.note, draft.geometry); return; }
    const note = await this.repo.reload({ ...item, text: '', revision: 0, savedRevision: 0 });
    await this.open(note);
  }
  async recoveryDrafts(): Promise<Draft[]> { return this.drafts.list(); }
  async deleteNote(item: HistoryRecord): Promise<boolean> {
    if (!this.active || this.tearingDown || this.deleting.has(item.id)) return false;
    const entry = this.windows.get(item.id);
    if (entry?.closing) return false;
    const pinned = entry ? this.bounds(entry).pinned : false;
    let completed: (() => void) | undefined, work: Promise<void> | undefined;
    this.deleting.add(item.id);
    try {
      if (pinned && entry) this.setPinned(entry, false);
      if (!await this.confirmDelete() || this.tearingDown || !this.active) return false;
      work = new Promise<void>(resolve => { completed = resolve; }); this.deletionWork.add(work);
      if (entry) {
        entry.closing = true; entry.service.pause();
        if (!await this.collect(item.id)) return false;
        await entry.service.delete();
      } else {
        await this.drafts.remove(item.id);
      }
      if (entry) await this.finishClose(item.id, false);
      await this.forgetNote(item.id);
      return true;
    } finally {
      completed?.(); if (work) this.deletionWork.delete(work);
      this.deleting.delete(item.id);
      if (entry && this.windows.has(item.id) && !this.tearingDown) {
        if (pinned) this.setPinned(entry, true);
        entry.closing = false; entry.service.resume(); this.send({ windowId: item.id, resume: true });
      }
    }
  }
  async forgetNote(id: string): Promise<void> {
    const index = this.history.findIndex(value => value.id === id);
    if (index >= 0) this.history.splice(index, 1);
    await this.metadataQueue.run('history', () => this.persistHistory([...this.history])).catch(error => this.report(`速记已删除，最近列表落盘失败：${message(error)}`));
    delete this.geometries[id];
    await this.persistState();
  }
  refresh(): void { for (const id of this.windows.keys()) this.publish(id); }
  dispose(): Promise<void> { return this.disposal ??= this.stop(); }
  private async stop(): Promise<void> {
    if (!this.active) return;
    this.tearingDown = true;
    clearTimeout(this.stateTimer); clearInterval(this.themeTimer);
    for (const entry of this.windows.values()) entry.service.pause();
    const safeToClose = new Set<string>();
    // SiYuan gives onunload five seconds. Release the session and close handlers
    // before that deadline even if native creation, disk I/O or deletion stalls.
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>(resolve => { deadline = setTimeout(resolve, 4000); });
    const cleanup = (async () => {
      await Promise.allSettled([...this.pending.values()]);
      await Promise.allSettled([...this.deletionWork]);
      if (!this.active) return;
      await Promise.all([...this.windows.entries()].map(async ([id, entry]) => {
        const previous = this.collections.get(id);
        if (previous) { clearTimeout(previous.timer); this.collections.delete(id); previous.resolve(false); }
        entry.closing = true;
        const safe = await this.collect(id);
        if (!this.active) return;
        if (safe) { safeToClose.add(id); await entry.service.cleanSavedDraft(); }
        entry.service.dispose();
      }));
      if (this.active) await this.persistState();
    })();
    try { await Promise.race([cleanup, timeout]); }
    catch (error) { this.report(message(error)); }
    finally {
      clearTimeout(deadline);
      for (const { timer, resolve } of this.collections.values()) { clearTimeout(timer); resolve(false); }
      this.collections.clear();
      const entries = [...this.windows.entries()];
      for (const [id, entry] of entries) {
        entry.service.dispose();
        if (!safeToClose.has(id)) {
          const warning = '插件已停用或更新，最新内容未确认落盘。请复制文本后点击关闭。';
          this.send({ windowId: id, stopped: warning }); this.report(warning);
        }
      }
      this.active = false; // Retained windows must allow window.close / Alt+F4.
      for (const [id, entry] of entries) {
        if (safeToClose.has(id) && entry.native && !entry.native.isDestroyed()) entry.native.destroy();
      }
      this.windows.clear(); this.channel.close(); clearTimeout(this.stateTimer);
    }
  }
}
