import type { Geometry } from '../types';

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
  constructor(private remote: any) {
    if (!remote?.BrowserWindow || !remote?.screen) throw new Error('宿主未提供 @electron/remote 原生窗口能力');
  }
  async create(url: string, geometry: Geometry): Promise<NativeWindow> {
    const { screen } = this.remote;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(Math.max(300, geometry.width), Math.max(300, area.width));
    const height = Math.min(Math.max(220, geometry.height), Math.max(220, area.height));
    const visible = screen.getAllDisplays().some((d: any) => geometry.x !== undefined && geometry.y !== undefined && geometry.x + 80 > d.workArea.x && geometry.x < d.workArea.x + d.workArea.width - 80 && geometry.y >= d.workArea.y && geometry.y < d.workArea.y + d.workArea.height - 60);
    const window: NativeWindow = new this.remote.BrowserWindow({
      title: '悬浮速记', width, height, minWidth: 300, minHeight: 220,
      x: visible ? geometry.x : area.x + Math.round((area.width - width) / 2),
      y: visible ? geometry.y : area.y + Math.round((area.height - height) / 2),
      show: false, frame: false, resizable: true, minimizable: true, maximizable: false,
      alwaysOnTop: geometry.pinned, backgroundColor: '#faf9f5',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false },
    });
    // No remote.enable / main-process code is needed in the child renderer.
    try {
      await window.loadURL(url);
      // Windows can report frame padding beyond the constructor size. Calibrate
      // per window so restoring its saved dimensions does not compound that gap.
      const bounds = window.getBounds();
      this.sizeOffsets.set(window, { width: bounds.width - width, height: bounds.height - height });
      return window;
    } catch (error) { if (!window.isDestroyed()) window.destroy(); throw error; }
  }
  geometry(window: NativeWindow): Geometry {
    const bounds = window.getBounds(), offset = this.sizeOffsets.get(window);
    return { ...bounds, width: bounds.width - (offset?.width ?? 0), height: bounds.height - (offset?.height ?? 0),
      pinned: window.isAlwaysOnTop(), open: true };
  }
  focus(window: NativeWindow): void { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
}
