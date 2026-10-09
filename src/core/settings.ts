import type { Settings } from '../types';
import { normalizeDirectoryInput } from './directory';
export const defaults: Settings = {
  trayEnabled: true,
  shortcutBehavior: 'new', width: 320, height: 320, alwaysOnTop: false,
  rememberPosition: true, restoreWindows: false,
  notebook: '', directory: '/闪念速记/{{now | date "20060102150405"}}', debounceMs: 800, showSaved: true, maxWindows: 10, historyLimit: 50,
};
export function parseSettings(value: unknown): Settings {
  const x = value && typeof value === 'object' ? value as Partial<Settings> : {};
  const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : fallback;
  const bool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;
  const rawDirectory = typeof x.directory === 'string' ? x.directory.trim() : defaults.directory;
  // Persisted legacy/corrupt configuration may fall back; interactive saves validate first.
  let directory = defaults.directory;
  try { directory = normalizeDirectoryInput(rawDirectory); } catch { /* Recover old configuration with safe defaults. */ }
  return {
    trayEnabled: bool(x.trayEnabled, true),
    shortcutBehavior: x.shortcutBehavior === 'recent' ? 'recent' : 'new',
    width: number(x.width, 320, 300, 1600), height: number(x.height, 320, 220, 1200),
    alwaysOnTop: bool(x.alwaysOnTop, false), rememberPosition: bool(x.rememberPosition, true),
    restoreWindows: bool(x.restoreWindows, false),
    notebook: typeof x.notebook === 'string' ? x.notebook : '',
    directory,
    debounceMs: number(x.debounceMs, 800, 100, 10000), showSaved: bool(x.showSaved, true), maxWindows: number(x.maxWindows, defaults.maxWindows, 1, 50),
    historyLimit: number(x.historyLimit, 50, 1, 200),
  };
}
