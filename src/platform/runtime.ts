export type DesktopPlatform = 'windows' | 'darwin' | 'linux';

export function isDesktopPlatform(backend: string): backend is DesktopPlatform {
  return backend === 'windows' || backend === 'darwin' || backend === 'linux';
}

export function shortcutLabel(platform: DesktopPlatform): string {
  return platform === 'darwin' ? 'Option + Command + N' : 'Ctrl + Alt + N';
}

export function trayIconName(platform: DesktopPlatform): string {
  return platform === 'windows' ? 'tray.ico' : platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
}
