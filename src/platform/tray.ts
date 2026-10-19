import { message } from '../services/autosave';
import type { DesktopPlatform } from './runtime';

export interface TrayWindowItem { id: string; label: string }
export interface TrayActions {
  leftClick?(): void | Promise<void>;
  createNote(): void | Promise<void>;
  recent(): void | Promise<void>;
  settings(): void | Promise<void>;
  closeTray(): void | Promise<void>;
  windows(): TrayWindowItem[];
  focusWindow(id: string): void | Promise<void>;
  showOwner(): void;
}
interface NativeTray {
  on(event: string, callback: () => void): void;
  removeAllListeners(): void;
  setToolTip(text: string): void;
  popUpContextMenu(menu: unknown): void;
  setContextMenu(menu: unknown): void;
  isDestroyed(): boolean;
  destroy(): void;
}
interface MenuItem {
  label?: string; type?: 'separator'; enabled?: boolean;
  click?: () => void; submenu?: MenuItem[];
}
interface TrayRuntime {
  Tray: new (icon: string) => NativeTray;
  Menu: { buildFromTemplate(template: MenuItem[]): unknown };
  require(path: string): typeof import('./tray-lifetime');
  getCurrentWebContents(): Parameters<typeof import('./tray-lifetime').attachTrayLifetime>[1];
}
type TrayOwner = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/** Owns only our additional tray; never reads or replaces SiYuan's tray menu. */
export class TrayAdapter {
  private tray?: NativeTray;
  private lifetime?: { stop(): void };
  private epoch = 0;
  private ownerEnded = false;
  private menuSnapshot?: string;
  private ownerExit = () => { this.ownerEnded = true; this.stop(); };
  constructor(private remote: TrayRuntime, private actions: TrayActions, private report: (text: string) => void,
    private owner: TrayOwner, private lifetimePath: string, private platform: DesktopPlatform = 'windows') {}
  start(iconPath: string, workspaceName: string): void {
    if (this.ownerEnded) return;
    if (this.tray && !this.tray.isDestroyed()) return;
    if (this.tray) this.stop();
    if (!this.remote?.Tray || !this.remote?.Menu?.buildFromTemplate) throw new Error('宿主未提供独立托盘能力');
    const epoch = ++this.epoch;
    const tray = new this.remote.Tray(iconPath);
    this.tray = tray;
    this.menuSnapshot = undefined;
    try {
      // Passing a renderer callback to a remote WebContents event is too late
      // after destroy(). Load the small owner guard in the main process instead.
      this.lifetime = this.remote.require(this.lifetimePath)
        .attachTrayLifetime(tray, this.remote.getCurrentWebContents());
      if (tray.isDestroyed()) { this.ownerEnded = true; this.stop(); return; }
      // DOM exit is an additional early cleanup path while IPC is available.
      this.owner.addEventListener('pagehide', this.ownerExit);
      this.owner.addEventListener('unload', this.ownerExit);
      tray.setToolTip(`悬浮速记 · ${workspaceName}`);
      if (this.platform === 'linux') {
        // Linux StatusNotifier hosts expose the attached menu themselves. Neither
        // right-click nor popUpContextMenu is portable there; avoid also creating
        // a note when the desktop activates the icon to display its menu.
        this.updateMenu();
      } else {
        tray.on('click', this.run(epoch, () => this.actions.leftClick ? this.actions.leftClick() : this.actions.createNote()));
        tray.on('right-click', this.run(epoch, () => {
          tray.popUpContextMenu(this.buildMenu(this.actions.windows()));
        }));
      }
    } catch (error) { this.stop(); throw error; }
  }
  private run(epoch: number, action: () => void | Promise<void>): () => void {
    return () => {
      if (this.epoch !== epoch || !this.tray || this.tray.isDestroyed()) return;
      try { void Promise.resolve(action()).catch(error => this.report(`托盘操作失败：${message(error)}`)); }
      catch (error) { this.report(`托盘操作失败：${message(error)}`); }
    };
  }
  private buildMenu(windows: TrayWindowItem[]): unknown {
    const run = (action: () => void | Promise<void>) => this.run(this.epoch, action);
    const menu: MenuItem[] = [
      { label: '新建闪念速记', click: run(() => this.actions.createNote()) },
      { label: '速记列表', click: run(() => this.actions.recent()) },
      { label: `管理速记窗口（${windows.length}）`, submenu: windows.length ? windows.map(item => ({
        // Electron treats & as a mnemonic marker. Escape user-derived titles.
        label: item.label.replaceAll('&', '&&'), click: run(() => {
          if (this.actions.windows().some(current => current.id === item.id)) return this.actions.focusWindow(item.id);
        }),
      })) : [{ label: '当前没有速记窗口', enabled: false }] },
      { type: 'separator' },
      { label: '速记设置', click: run(() => this.actions.settings()) },
      { label: '关闭托盘图标', click: run(() => this.actions.closeTray()) },
    ];
    return this.remote.Menu.buildFromTemplate(menu);
  }
  private updateMenu(): void {
    const windows = this.actions.windows(), snapshot = JSON.stringify(windows);
    if (snapshot === this.menuSnapshot) return;
    this.tray!.setContextMenu(this.buildMenu(windows));
    this.menuSnapshot = snapshot;
  }
  refresh(): void {
    if (this.platform !== 'linux' || !this.tray || this.tray.isDestroyed()) return;
    try { this.updateMenu(); }
    catch (error) {
      this.stop();
      this.report(`独立速记托盘不可用：${message(error)}。仍可使用顶栏和快捷键。`);
    }
  }
  stop(): void {
    this.owner.removeEventListener('pagehide', this.ownerExit);
    this.owner.removeEventListener('unload', this.ownerExit);
    const tray = this.tray;
    const lifetime = this.lifetime;
    this.lifetime = undefined;
    this.menuSnapshot = undefined;
    this.tray = undefined; this.epoch++;
    if (!tray) return;
    try { lifetime?.stop(); }
    catch (error) { this.report(`托盘生命周期清理失败：${message(error)}`); }
    try { tray.removeAllListeners(); }
    catch (error) { this.report(`托盘监听清理失败：${message(error)}`); }
    try { if (!tray.isDestroyed()) tray.destroy(); }
    catch (error) { this.report(`托盘销毁失败：${message(error)}`); }
  }
}
