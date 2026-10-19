import { EditorSelection, Transaction, type EditorState, type TransactionSpec, type ChangeSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { formatSpans, pendingFormat, type InlineFormat } from './markdown-spans';

export type FormatAction = InlineFormat | 'heading' | 'unordered' | 'ordered' | 'task' | 'quote';
const wrappers: Record<InlineFormat, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strike: ['~~', '~~'], code: ['`', '`'], link: ['[', '](https://)'] };
export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export function headingTransaction(state: EditorState, level: HeadingLevel): TransactionSpec | undefined {
  if (state.readOnly || !Number.isInteger(level) || level < 0 || level > 6) return;
  const { from, to } = state.selection.main, changes: ChangeSpec[] = [];
  const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to).number;
  for (let n = state.doc.lineAt(from).number; n <= last; n++) {
    const line = state.doc.line(n), prefix = /^( {0,3})(#{1,6})[ \t]+/.exec(line.text);
    const start = line.from + (prefix?.[1].length ?? 0), end = line.from + (prefix?.[0].length ?? 0);
    const insert = level ? '#'.repeat(level) + ' ' : '';
    if (state.sliceDoc(start, end) !== insert) changes.push({ from: start, to: end, insert });
  }
  if (!changes.length) return;
  const changeSet = state.changes(changes);
  return { changes: changeSet, selection: state.selection.map(changeSet), scrollIntoView: true,
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.format')] };
}
export function formatTransaction(state: EditorState, action: FormatAction, url = 'https://'): TransactionSpec | undefined {
  if (state.readOnly) return;
  const { from, to } = state.selection.main;
  const changes: ChangeSpec[] = [];
  let caret: number | undefined;
  if (action in wrappers) {
    const kind = action as InlineFormat, [open, defaultClose] = wrappers[kind];
    const close = kind === 'link' ? `](<${url.replace(/[<>\r\n]/g, '').replaceAll(' ', '%20')}>)` : defaultClose;
    const spans = formatSpans(state, Math.max(0, from - 1), Math.min(state.doc.length, to + 1));
    const existing = spans.filter(span => span.kind === kind && span.from <= from && span.to >= to).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    if (existing) {
      if (from < to && from >= existing.contentFrom && to <= existing.contentTo && (from > existing.contentFrom || to < existing.contentTo)) {
        const existingOpen = state.sliceDoc(existing.from, existing.contentFrom), existingClose = state.sliceDoc(existing.contentTo, existing.to);
        const keep = (text: string) => {
          const body = text.trim(); if (!body) return text;
          const left = text.length - text.trimStart().length, right = text.trimEnd().length;
          return text.slice(0, left) + existingOpen + body + existingClose + text.slice(right);
        };
        const before = keep(state.sliceDoc(existing.contentFrom, from)), selected = state.sliceDoc(from, to), after = keep(state.sliceDoc(to, existing.contentTo));
        const start = existing.from + before.length, end = start + selected.length;
        return { changes: { from: existing.from, to: existing.to, insert: before + selected + after },
          selection: EditorSelection.range(state.selection.main.anchor <= state.selection.main.head ? start : end, state.selection.main.anchor <= state.selection.main.head ? end : start),
          scrollIntoView: true, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.format')] };
      }
      changes.push({ from: existing.from, to: existing.contentFrom }, { from: existing.contentTo, to: existing.to });
      if (from === to) caret = Math.max(existing.contentFrom, Math.min(existing.contentTo, from));
    } else if (from === to) {
      changes.push({ from, insert: open + close }); caret = from;
    } else {
      const selected = state.sliceDoc(from, to), pattern = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
      for (const match of selected.matchAll(pattern)) {
        if (!match[0].trim()) continue;
        const start = from + match.index! + match[0].length - match[0].trimStart().length;
        const end = from + match.index! + match[0].trimEnd().length;
        const wrapped = spans.find(span => span.kind === kind && span.from === start && span.to === end);
        if (wrapped) changes.push({ from: wrapped.from, to: wrapped.contentFrom }, { from: wrapped.contentTo, to: wrapped.to });
        else changes.push({ from: start, insert: open }, { from: end, insert: close });
      }
    }
    const changeSet = state.changes(changes);
    if (changeSet.empty) return;
    const selection = caret === undefined ? state.selection.map(changeSet) : EditorSelection.cursor(existing ? changeSet.mapPos(caret, 1) : from + open.length);
    return { changes: changeSet, selection, scrollIntoView: true,
      effects: from === to && !existing ? pendingFormat.of({ kind, from, to: from + open.length + close.length, contentFrom: from + open.length, contentTo: from + open.length }) : undefined,
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.format')] };
  }
  const prefixes = { heading: '## ', unordered: '- ', ordered: '1. ', task: '- [ ] ', quote: '> ' };
  const block = action as keyof typeof prefixes;
  const patterns = { heading: /^#{1,6} /, unordered: /^[-+*] (?!\[[ xX]\] )/, ordered: /^\d+\. /, task: /^[-+*] \[[ xX]\] /, quote: /^> / };
  const lines = [];
  for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to).number; number++) lines.push(state.doc.line(number));
  const remove = lines.every(line => patterns[block].test(line.text));
  for (const line of lines) {
    const match = patterns[block].exec(line.text);
    if (remove) changes.push({ from: line.from, to: line.from + match![0].length });
    else if (!match) changes.push({ from: line.from, insert: prefixes[block] });
  }
  const changeSet = state.changes(changes);
  return { changes: changeSet, selection: state.selection.map(changeSet), scrollIntoView: true, annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.format')] };
}
