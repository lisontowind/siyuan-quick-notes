import type { HistoryRecord } from './windows';
import { validNoteReference } from '../platform/drafts';
import { noteReference, noteSummary } from './identity';

export function parseHistory(value: unknown, limit: number): HistoryRecord[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<string, HistoryRecord>();
  for (const item of value) {
    if (!validNoteReference(item) || records.has(item.id)) continue;
    const summary = (item as HistoryRecord).summary;
    records.set(item.id, { ...noteReference(item),
      ...(typeof summary === 'string' ? { summary: noteSummary(summary, 80, '') } : {}),
      ...(typeof (item as HistoryRecord).bodySummary === 'string' ? { bodySummary: noteSummary((item as HistoryRecord).bodySummary!, 120, '') } : {}) });
    if (records.size >= limit) break;
  }
  return [...records.values()];
}
