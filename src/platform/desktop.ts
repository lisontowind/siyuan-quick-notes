import type { Geometry } from '../types';
import { message } from '../services/autosave';

export interface NativeWindow {
  on(name: string, callback: (...args: any[]) => void): void;
  removeAllListeners(name?: string): void;
  loadURL(url: string): Promise<void>; show(): void; focus(): void; restore(): void;
  minimize(): void; isMinimized(): boolean; isDestroyed(): boolean; destroy(): void;
  setAlwaysOnTop(value: boolean): void; isAlwaysOnTop(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  webContents: { on(name: string, callback: (...args: any[]) => void): void; openDevTools(options?: unknown): void };
}
export interface DesktopAdapter {
  create(url: string, geometry: Geometry): Promise<NativeWindow>;
  geometry(window: NativeWindow): Geometry;
  focus(window: NativeWindow): void;
}
export class ElectronAdapter implements DesktopAdapter {
  private readonly sizeOffsets = new WeakMap<NativeWindow, { width: number; height: number }>();
  private readonly lastGeometry = new WeakMap<NativeWindow, Geometry>();
  private readonly warnings = new Set<string>();
  constructor(private remote: any, private report: (text: string) => void = () => {}) {
    if (!remote?.BrowserWindow || !remote?.screen) throw new Error('宿主未提供 @electron/remote 原生窗口能力');
  }
  async create(url: string, geometry: Geometry): Promise<NativeWindow> {
    const { screen } = this.remote;
    let area: { x: number; y: number; width: number; height: number } | undefined;
    this.control('读取鼠标所在显示器', () => { area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; });
    if (!area) this.control('读取主显示器', () => { area = screen.getPrimaryDisplay().workArea; });
    const width = Math.min(Math.max(300, geometry.width), Math.max(300, area?.width ?? geometry.width));
    const height = Math.min(Math.max(220, geometry.height), Math.max(220, area?.height ?? geometry.height));
    let visible = false;
    this.control('读取显示器位置', () => {
      visible = screen.getAllDisplays().some((d: any) => geometry.x !== undefined && geometry.y !== undefined && geometry.x + 80 > d.workArea.x && geometry.x < d.workArea.x + d.workArea.width - 80 && geometry.y >= d.workArea.y && geometry.y < d.workArea.y + d.workArea.height - 60);
    });
    const position = area ? {
      x: visible ? geometry.x : area.x + Math.round((area.width - width) / 2),
      y: visible ? geometry.y : area.y + Math.round((area.height - height) / 2),
    } : {};
    const window: NativeWindow = new this.remote.BrowserWindow({
      title: '悬浮速记', width, height, minWidth: 300, minHeight: 220,
      ...position,
      show: false, frame: false, resizable: true, minimizable: true, maximizable: false,
      alwaysOnTop: geometry.pinned, backgroundColor: '#faf9f5',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false },
    });
    this.lastGeometry.set(window, { ...position, width, height, pinned: geometry.pinned });
    // No remote.enable / main-process code is needed in the child renderer.
    try {
      await window.loadURL(url);
      // Windows can report frame padding beyond the constructor size. Calibrate
      // per window so restoring its saved dimensions does not compound that gap.
      this.control('读取窗口尺寸', () => {
        const bounds = window.getBounds();
        this.sizeOffsets.set(window, { width: bounds.width - width, height: bounds.height - height });
      });
      return window;
    } catch (error) { if (!window.isDestroyed()) window.destroy(); throw error; }
  }
  geometry(window: NativeWindow): Geometry {
    const geometry = { ...this.lastGeometry.get(window)!, open: true };
    this.control('读取窗口位置与尺寸', () => {
      const bounds = window.getBounds(), offset = this.sizeOffsets.get(window);
      Object.assign(geometry, bounds, { width: bounds.width - (offset?.width ?? 0), height: bounds.height - (offset?.height ?? 0) });
    });
    this.control('读取窗口置顶状态', () => { geometry.pinned = window.isAlwaysOnTop(); });
    this.lastGeometry.set(window, geometry);
    return geometry;
  }
  focus(window: NativeWindow): void {
    this.control('还原窗口', () => { if (window.isMinimized()) window.restore(); });
    this.control('显示窗口', () => window.show());
    this.control('聚焦窗口', () => window.focus());
  }
  private control(action: string, work: () => void): void {
    try { work(); }
    catch (error) {
      if (this.warnings.has(action)) return;
      this.warnings.add(action);
      this.report(`当前桌面环境无法${action}：${message(error)}。正文仍可编辑保存。`);
    }
  }
}
