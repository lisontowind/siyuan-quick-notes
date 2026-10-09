import type { WindowState } from '../types';
export function presentStatus(state: WindowState, revision: number, unsent: boolean): { text: string; phase: string; hidden: boolean } {
  const labels: Record<string, string> = { empty: '新速记 · 输入后自动保存', dirty: '待保存', saving: '保存中…', saved: '已保存到思源', error: '保存失败', conflict: '原文已变化', local: '仅保存到本机' };
  if (state.error) return { text: `${labels[state.phase]}：${state.error}`, phase: state.phase, hidden: false };
  if (unsent || state.revision < revision) return { text: '正在编辑…', phase: 'dirty', hidden: false };
  return { text: labels[state.phase], phase: state.phase,
    hidden: state.phase === 'saved' && state.savedRevision >= revision && !state.showSaved };
}
