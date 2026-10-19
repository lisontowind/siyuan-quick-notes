import type { Draft, NoteRecord, NoteReference, Settings, Target } from '../types';
import { validCalloutType, type CalloutType } from './callout';
import { validSettingsInput } from './settings';
import type { DesktopPlatform } from '../platform/runtime';
import type { HistoryRecord } from './windows';
import { isSavedToSiYuan, noteLabel, noteSummary } from './identity';
import type { CleanupSnapshot, CleanupSelection, CleanupProgress } from '../services/cleanup';

export interface RecentItem {
  id: string; summary: string; path: string; updatedAt: number; draft: boolean; open: boolean; removed?: boolean; siyuanSaved: boolean;
  versions?: number; calloutType?: CalloutType; title?: string; bodySummary?: string;
}
export interface DraftVersionsData { token: string; removed: boolean; versions: Array<{ version: string; device?: string; legacy?: boolean; summary: string; text: string; updatedAt: number }> }
export function noteListDetails(note: NoteReference & { text?: string; summary?: string; bodySummary?: string }): { title: string; bodySummary?: string } {
  const title = note.caption?.trim() || note.docTitle || note.target?.path.split('/').pop() || '';
  const bodySummary = typeof note.text === 'string' ? noteSummary(note.text, 120, '') : note.bodySummary
    ?? (note.summary && note.summary !== note.caption ? note.summary : undefined);
  return { title, bodySummary };
}
export function recentItems(history: HistoryRecord[], drafts: Draft[], active: NoteRecord[]): RecentItem[] {
  const items = new Map<string, RecentItem>();
  const put = (note: NoteReference, summary: string, draft: boolean, open: boolean) => {
    const previous = items.get(note.id);
    items.set(note.id, { id: note.id, summary, ...noteListDetails(note), path: note.target?.path || note.docPath || '', updatedAt: note.updatedAt,
      draft: draft || !!previous?.draft, open: open || !!previous?.open, siyuanSaved: isSavedToSiYuan(note),
      calloutType: validCalloutType(note.calloutType) ? note.calloutType : 'NOTE' });
  };
  for (const note of history) put(note, note.caption || note.summary || note.docTitle || '速记', false, false);
  for (const { note, variants } of drafts) { put(note, noteLabel(note, 80), true, false); items.get(note.id)!.versions = variants?.length ?? 1; }
  for (const note of active) {
    // An active saved note supersedes a stale disk snapshot awaiting removal.
    const versions = items.get(note.id)?.versions; items.delete(note.id);
    put(note, noteLabel(note, 80), note.revision > note.savedRevision, true);
    items.get(note.id)!.versions = versions;
  }
  return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
export type RecentPage = 'notes' | 'settings' | 'cleanup';
export interface RecentSettingsData { settings: Settings; notebooks: Array<{ id: string; name: string }>; platform: DesktopPlatform; shortcut: string }
export type RecentAction = 'ready' | 'heartbeat' | 'refresh' | 'open' | 'siyuan' | 'delete' | 'new' | 'pin' | 'minimize' | 'close'
  | 'notes' | 'settings' | 'save-settings' | 'preview-settings' | 'shortcuts' | 'cleanup' | 'cleanup-start' | 'cleanup-cancel' | 'cleanup-snooze' | 'draft-versions' | 'choose-draft-version';
export interface RecentRequest { session: string; windowId: 'recent'; requestId: string; action: RecentAction; id?: string; settings?: Settings;
  mode?: 'archive' | 'clear'; selections?: CleanupSelection[]; discard?: boolean; version?: string; token?: string; copy?: boolean }
export interface RecentResponse {
  session: string; windowId: 'recent'; requestId?: string; items?: RecentItem[]; pinned?: boolean; dark?: boolean; error?: string;
  page?: RecentPage; settingsData?: RecentSettingsData; savedSettings?: Settings; settingsWarning?: string; preview?: Target;
  settingsChanged?: boolean;
  cleanup?: CleanupSnapshot; cleanupProgress?: CleanupProgress;
  draftVersions?: DraftVersionsData;
}
export function validRecentRequest(value: unknown, session: string): value is RecentRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as RecentRequest;
  return request.session === session && request.windowId === 'recent' && typeof request.requestId === 'string'
    && request.requestId.length > 0 && request.requestId.length <= 80
    && ['ready', 'heartbeat', 'refresh', 'open', 'siyuan', 'delete', 'new', 'pin', 'minimize', 'close', 'notes', 'settings', 'save-settings', 'preview-settings', 'shortcuts', 'cleanup', 'cleanup-start', 'cleanup-cancel', 'cleanup-snooze', 'draft-versions', 'choose-draft-version'].includes(request.action)
    && (request.id === undefined || typeof request.id === 'string' && /^[a-f0-9-]{36}$/.test(request.id))
    && (!['open', 'siyuan', 'delete'].includes(request.action) || request.id !== undefined)
    && (request.action !== 'choose-draft-version' || request.copy === true && typeof request.token === 'string' && /^[a-f0-9-]{36}$/.test(request.token)
      && typeof request.version === 'string' && (request.version === 'local' || /^[a-f0-9-]{36}$/.test(request.version)))
    && (!['save-settings', 'preview-settings'].includes(request.action) || validSettingsInput(request.settings))
    && (request.action !== 'cleanup-start' || (request.mode === 'archive' || request.mode === 'clear')
      && typeof request.discard === 'boolean' && Array.isArray(request.selections) && request.selections.length > 0 && request.selections.length <= 100000
      && request.selections.every(item => item && typeof item.id === 'string' && /^[a-f0-9-]{36}$/.test(item.id) && typeof item.version === 'string' && /^[a-f0-9-]{36}$/.test(item.version)));
}
