import type { WindowState } from '../types';
import { translate, windowLocale, type Locale } from '../core/i18n';
export function presentStatus(state: WindowState, revision: number, unsent: boolean, locale: Locale = windowLocale()): { text: string; phase: string; hidden: boolean } {
  const labels: Record<string, string> = { empty: '新速记 · 输入后自动保存到插件', dirty: '待保存', saving: '保存中…', saved: '已保存到思源', error: '保存失败', conflict: '原文已变化', local: '已保存到插件' };
  if (state.error) return { text: `${translate(labels[state.phase], locale)}${locale === 'en-US' ? ': ' : '：'}${translate(state.error, locale)}`, phase: state.phase, hidden: false };
  if (unsent || state.revision < revision) return { text: translate('正在编辑…', locale), phase: 'dirty', hidden: false };
  const hideSaved = state.phase === 'saved' && state.savedRevision >= revision && !state.showSaved;
  return { text: translate(labels[state.phase], locale), phase: state.phase, hidden: hideSaved };
}
