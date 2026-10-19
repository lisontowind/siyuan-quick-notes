import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link';
export interface FormatSpan { kind: InlineFormat | 'fence'; from: number; to: number; contentFrom: number; contentTo: number }
export const pendingFormat = StateEffect.define<FormatSpan>();
export const pendingFormats = StateField.define<FormatSpan[]>({
  create: () => [],
  update(spans, transaction) {
    const next = spans.map(span => ({ ...span, from: transaction.changes.mapPos(span.from, -1), to: transaction.changes.mapPos(span.to, 1),
      contentFrom: transaction.changes.mapPos(span.contentFrom, -1), contentTo: transaction.changes.mapPos(span.contentTo, 1) }))
      .filter((span, index) => span.contentFrom > span.from && span.to > span.contentTo
        && transaction.state.sliceDoc(span.from, span.contentFrom) === transaction.startState.sliceDoc(spans[index].from, spans[index].contentFrom)
        && transaction.state.sliceDoc(span.contentTo, span.to) === transaction.startState.sliceDoc(spans[index].contentTo, spans[index].to));
    for (const effect of transaction.effects) if (effect.is(pendingFormat)) next.push(effect.value);
    return next;
  },
});
export function formatSpans(state: EditorState, from = 0, to = state.doc.length): FormatSpan[] {
  const tree = syntaxTree(state);
  const container = (position: number) => {
    let node = tree.resolveInner(position, 1);
    while (node.parent && !['Paragraph', 'Task', 'TableCell', 'FencedCode'].includes(node.name) && !/Heading\d$/.test(node.name)) node = node.parent;
    return node.name === 'Document' ? undefined : node;
  };
  from = Math.min(from, container(from)?.from ?? from); to = Math.max(to, container(to)?.to ?? to);
  const spans: FormatSpan[] = [], underlines = new Map<number, number[]>();
  tree.iterate({ from, to, enter(ref) {
    const node = ref.node;
    if (node.name === 'FencedCode') {
      const marks = node.getChildren('CodeMark');
      if (marks.length === 2) spans.push({ kind: 'fence', from: node.from, to: node.to, contentFrom: state.doc.lineAt(marks[0].to).to + 1, contentTo: state.doc.lineAt(marks[1].from).from });
      return false;
    }
    if (['CodeBlock', 'HTMLBlock'].includes(node.name)) return false;
    const kind: Partial<Record<string, InlineFormat>> = { StrongEmphasis: 'bold', Emphasis: 'italic', Strikethrough: 'strike', InlineCode: 'code', Link: 'link' };
    if (kind[node.name]) {
      const marks = [...node.getChildren('EmphasisMark'), ...node.getChildren('StrikethroughMark'), ...node.getChildren('CodeMark'), ...node.getChildren('LinkMark')].sort((a, b) => a.from - b.from);
      if (marks.length >= 2) {
        const close = node.name === 'Link' ? marks.find(mark => state.sliceDoc(mark.from, mark.to) === ']') : marks.at(-1);
        if (close) spans.push({ kind: kind[node.name]!, from: node.from, to: node.to, contentFrom: marks[0].to, contentTo: close.from });
      }
      if (node.name === 'InlineCode') return false;
    }
    if (node.name === 'HTMLTag') {
      const tag = state.sliceDoc(node.from, node.to);
      if (!/^<\/?u>$/i.test(tag)) return false;
      const key = node.parent?.from ?? 0, stack = underlines.get(key) ?? [];
      if (/^<u>$/i.test(tag)) stack.push(node.from);
      else if (stack.length) { const start = stack.pop()!; spans.push({ kind: 'underline', from: start, to: node.to, contentFrom: start + 3, contentTo: node.from }); }
      underlines.set(key, stack);
    }
  } });
  const pending = state.field(pendingFormats, false) ?? [];
  return [...spans.filter(span => !pending.some(other => other.from === span.from && other.to === span.to)), ...pending.filter(span => span.to >= from && span.from <= to)];
}
