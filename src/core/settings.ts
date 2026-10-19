import type { Settings } from '../types';
import { normalizeDirectoryInput } from './directory';
export const defaults: Settings = {
  trayEnabled: true,
  trayClickAction: 'new',
  shortcutBehavior: 'new', width: 320, height: 320, alwaysOnTop: false,
  rememberPosition: true, restoreWindows: false,
  notebook: '', directory: '/闪念速记/{{now | date "20060102150405"}}', debounceMs: 800, showSaved: true, maxWindows: 10, historyLimit: 50,
  cleanupReminder: true, cleanupThreshold: 100, archiveDays: 30,
};
/** Interactive settings never silently replace malformed fields with defaults. */
export function validSettingsInput(value: unknown): value is Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Settings;
  return Object.entries(defaults).every(([key, fallback]) => {
    const field = input[key as keyof Settings];
    return typeof field === typeof fallback && (typeof field !== 'number' || Number.isFinite(field));
  }) && ['new', 'recent'].includes(input.trayClickAction) && ['new', 'recent', 'list'].includes(input.shortcutBehavior)
    && input.notebook.length <= 128 && input.directory.length <= 10000;
}
export function validateSettingsDraft(value: unknown, notebookIds: readonly string[]): Settings {
  if (!validSettingsInput(value)) throw new Error('设置格式无效，请检查输入');
  const directory = normalizeDirectoryInput(value.directory);
  if (value.notebook && !notebookIds.includes(value.notebook)) throw new Error('请先选择一个已打开的普通笔记本');
  return parseSettings({ ...value, directory });
}
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
    trayClickAction: x.trayClickAction === 'recent' ? 'recent' : 'new',
    shortcutBehavior: x.shortcutBehavior === 'list' ? 'list' : x.shortcutBehavior === 'recent' ? 'recent' : 'new',
    width: number(x.width, 320, 300, 1600), height: number(x.height, 320, 220, 1200),
    alwaysOnTop: bool(x.alwaysOnTop, false), rememberPosition: bool(x.rememberPosition, true),
    restoreWindows: bool(x.restoreWindows, false),
    notebook: typeof x.notebook === 'string' ? x.notebook : '',
    directory,
    debounceMs: number(x.debounceMs, 800, 100, 10000), showSaved: bool(x.showSaved, true), maxWindows: number(x.maxWindows, defaults.maxWindows, 1, 50),
    historyLimit: number(x.historyLimit, 50, 1, 200),
    cleanupReminder: bool(x.cleanupReminder, true), cleanupThreshold: number(x.cleanupThreshold, 100, 1, 100000),
    archiveDays: number(x.archiveDays, defaults.archiveDays, 1, 3650),
  };
}
