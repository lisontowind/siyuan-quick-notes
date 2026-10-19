export const calloutTypes = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
export type CalloutType = typeof calloutTypes[number];
export const calloutNames: Record<CalloutType, string> = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };
export const calloutIcons: Record<CalloutType, string> = { NOTE: '✏️', TIP: '💡', IMPORTANT: '❗', WARNING: '⚠️', CAUTION: '🚨' };
export const calloutLabels: Record<CalloutType, string> = { NOTE: '笔记', TIP: '技巧', IMPORTANT: '重要', WARNING: '警告', CAUTION: '注意' };
export const validCalloutType = (value: unknown): value is CalloutType => typeof value === 'string' && (calloutTypes as readonly string[]).includes(value);
