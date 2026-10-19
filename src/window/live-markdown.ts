import { StateEffect, StateField, EditorState, EditorSelection, Transaction, type ChangeSpec, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type { SyntaxNode } from '@lezer/common';
import { t } from '../core/i18n';
import { formatSpans } from './markdown-spans';
import { previewSource } from './image-preview';

const viewport = StateEffect.define<{ from: number; to: number }>();
const hide = Decoration.replace({ atomic: true });
export class TaskWidget extends WidgetType {
  constructor(readonly from: number, readonly checked: boolean, readonly disabled: boolean) { super(); }
  eq(other: TaskWidget): boolean { return this.from === other.from && this.checked === other.checked && this.disabled === other.disabled; }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'qn-task';
    input.checked = this.checked; input.disabled = this.disabled; input.setAttribute('aria-label', t('切换待办状态'));
    input.addEventListener('mousedown', event => event.preventDefault());
    input.addEventListener('change', () => {
      if (view.state.readOnly || view.composing || !/^\[[ xX]\]$/.test(view.state.sliceDoc(this.from, this.from + 3))) { input.checked = this.checked; return; }
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? ' ' : 'x' },
        annotations: isolateHistory.of('full') });
    });
    return input;
  }
  ignoreEvent(): boolean { return true; }
}
class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string) { super(); }
  eq(other: TextWidget): boolean { return this.text === other.text && this.className === other.className; }
  toDOM(): HTMLElement { const span = document.createElement('span'); span.textContent = this.text; span.className = this.className; return span; }
}
export interface TableRow { cells: string[]; header: boolean }
export class TableWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly rows: TableRow[], readonly text: string) { super(); }
  eq(other: TableWidget): boolean { return this.from === other.from && this.to === other.to && this.text === other.text; }
  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div'); wrapper.className = 'qn-live-table';
    const table = document.createElement('table');
    for (const row of this.rows) {
      const tr = document.createElement('tr');
      for (const cell of row.cells) { const td = document.createElement(row.header ? 'th' : 'td'); td.textContent = cell.replace(/\\\|/g, '|'); tr.append(td); }
      table.append(tr);
    }
    wrapper.append(table); return wrapper;
  }
  ignoreEvent(): boolean { return true; }
  get estimatedHeight(): number { return this.rows.length * 30 + 32; }
}
function tableRows(state: EditorState, node: SyntaxNode): TableRow[] {
  const rows: TableRow[] = [];
  for (let row = node.firstChild; row; row = row.nextSibling) {
    if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue;
    rows.push({ header: row.name === 'TableHeader', cells: row.getChildren('TableCell').map(cell => state.sliceDoc(cell.from, cell.to)) });
  }
  return rows;
}
export function liveDecorations(state: EditorState, from = 0, to = Math.min(state.doc.length, 10000)): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const spans = formatSpans(state, from, to);
  const replace = (a: number, b: number, decoration = hide) => { if (b > a) ranges.push(decoration.range(a, b)); };
  const mark = (a: number, b: number, className: string, attributes?: Record<string, string>) => {
    if (b > a) ranges.push(Decoration.mark({ class: className, attributes }).range(a, b));
  };
  const line = (position: number, className: string) => ranges.push(Decoration.line({ class: className }).range(state.doc.lineAt(position).from));
  syntaxTree(state).iterate({ from, to, enter(ref) {
    const node = ref.node, name = node.name;
    if (name === 'HTMLBlock' || name === 'HTMLTag') return false;
    if (name === 'Table') {
      // Keep exceptionally large tables as source instead of building an unbounded DOM widget.
      if (node.to - node.from <= 50000) replace(node.from, node.to, Decoration.replace({ atomic: true, block: true, widget: new TableWidget(node.from, node.to, tableRows(state, node), state.sliceDoc(node.from, node.to)) }));
      return false;
    }
    if (name === 'FencedCode' || name === 'CodeBlock') {
      for (let position = state.doc.lineAt(Math.max(from, node.from)).from; position <= Math.min(to, node.to);) {
        line(position, 'qn-live-code'); const next = state.doc.lineAt(position).to + 1; if (next > state.doc.length) break; position = next;
      }
      for (const child of [...node.getChildren('CodeMark'), ...node.getChildren('CodeInfo')]) replace(child.from, child.to);
      return false;
    }
    if (/^(ATX|Setext)Heading[1-6]$/.test(name)) {
      line(node.from, `qn-live-h${name.at(-1)}`);
      for (const child of node.getChildren('HeaderMark')) {
        const next = child.to < node.to && state.sliceDoc(child.to, child.to + 1) === ' ' ? child.to + 1 : child.to;
        replace(child.from, next);
      }
    }
    if (name === 'Blockquote') {
      for (let position = state.doc.lineAt(Math.max(from, node.from)).from; position <= Math.min(to, node.to);) {
        line(position, 'qn-live-quote');
        const next = state.doc.lineAt(position).to + 1; if (next > state.doc.length) break; position = next;
      }
    }
    if (name === 'QuoteMark') replace(node.from, node.to);
    if (name === 'ListMark' && /^[-+*]$/.test(state.sliceDoc(node.from, node.to))) replace(node.from, node.to, Decoration.replace({ atomic: true, widget: new TextWidget('•', 'qn-live-bullet') }));
    if (name === 'TaskMarker') replace(node.from, node.to, Decoration.replace({ atomic: true, widget: new TaskWidget(node.from, state.sliceDoc(node.from + 1, node.from + 2).toLowerCase() === 'x', state.readOnly) }));
    if (name === 'HorizontalRule' && !spans.some(span => span.from <= node.from && span.to >= node.to)) replace(node.from, node.to, Decoration.replace({ atomic: true, widget: new TextWidget('', 'qn-live-rule') }));
    if (name === 'InlineCode' || name === 'Link') return false;
    if (name === 'Image') {
      const url = node.getChild('URL');
      if (url && previewSource(state.sliceDoc(url.from, url.to))) replace(node.from, node.to);
      return false;
    }
  } });
  const styles = { bold: 'qn-live-strong', italic: 'qn-live-em', underline: 'qn-live-underline', strike: 'qn-live-strike', code: 'qn-live-inline-code', link: 'qn-live-link' };
  for (const span of spans) {
    if (span.kind === 'fence') continue;
    // Tables own their cell contents; do not place decorations inside a replaced block.
    let parent = syntaxTree(state).resolveInner(span.from, 1);
    while (parent.parent && parent.name !== 'Table') parent = parent.parent;
    if (parent.name === 'Table' && parent.to - parent.from <= 50000) continue;
    mark(span.from, span.to, styles[span.kind]); replace(span.from, span.contentFrom); replace(span.contentTo, span.to);
  }
  return Decoration.set(ranges, true);
}
export const liveMarkdownField = StateField.define<{ from: number; to: number; decorations: DecorationSet }>({
  create(state) { const to = Math.min(state.doc.length, 10000); return { from: 0, to, decorations: liveDecorations(state, 0, to) }; },
  update(value, transaction) {
    let { from, to } = value, changed = false;
    for (const effect of transaction.effects) if (effect.is(viewport)) { from = effect.value.from; to = effect.value.to; changed = true; }
    from = Math.min(from, transaction.state.doc.length); to = Math.min(to, transaction.state.doc.length);
    if (transaction.docChanged) { from = transaction.changes.mapPos(value.from); to = transaction.changes.mapPos(value.to, 1); }
    return changed || transaction.docChanged || transaction.effects.length || transaction.reconfigured || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
      ? { from, to, decorations: liveDecorations(transaction.state, from, to) } : value;
  },
  provide: field => [EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).decorations.update({ filter: (_from, _to, decoration) => !!decoration.spec.atomic }))],
});
const viewportObserver = ViewPlugin.fromClass(class {
  private frame = 0;
  constructor(private view: EditorView) { this.schedule(); }
  update(update: import('@codemirror/view').ViewUpdate) { if (update.viewportChanged) this.schedule(); }
  private schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const { from, to } = this.view.viewport, current = this.view.state.field(liveMarkdownField);
      if (from !== current.from || to !== current.to) this.view.dispatch({ effects: viewport.of({ from, to }) });
    });
  }
  destroy() { cancelAnimationFrame(this.frame); }
});
export function removeFormatBoundary(view: Pick<EditorView, 'state' | 'dispatch'>, backwards: boolean): boolean {
  if (view.state.readOnly || !view.state.selection.main.empty) return false;
  const position = view.state.selection.main.head;
  const span = formatSpans(view.state, Math.max(0, position - 1), Math.min(view.state.doc.length, position + 1))
    .filter(span => backwards ? position === span.contentFrom || position === span.to : position === span.contentTo || position === span.from)
    .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
  if (!span) return false;
  const changes = view.state.changes([{ from: span.from, to: span.contentFrom }, { from: span.contentTo, to: span.to }]);
  view.dispatch({ changes, selection: EditorSelection.cursor(changes.mapPos(position)), annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.format')] }); return true;
}
export const repairDeletedPairs = EditorState.transactionFilter.of(transaction => {
  if (!transaction.docChanged || !transaction.isUserEvent('input') || transaction.isUserEvent('input.format')) return transaction;
  const repairs = new Map<string, { from: number; to: number }>();
  transaction.changes.iterChangedRanges((from, to) => {
    if (from === to) return;
    for (const span of formatSpans(transaction.startState, from, to)) {
      const opening = from < span.contentFrom && to > span.from, closing = from < span.to && to > span.contentTo;
      if (opening === closing) continue;
      for (const [start, end] of [[span.from, span.contentFrom], [span.contentTo, span.to]]) {
        const a = transaction.changes.mapPos(start, 1), b = transaction.changes.mapPos(end, -1);
        if (b > a) repairs.set(`${a}:${b}`, { from: a, to: b });
      }
    }
  });
  return repairs.size ? [transaction, { changes: [...repairs.values()] as ChangeSpec[], sequential: true }] : transaction;
});
export const liveMarkdown = [liveMarkdownField, viewportObserver, repairDeletedPairs, keymap.of([
  { key: 'Backspace', run: view => !view.composing && removeFormatBoundary(view, true) },
  { key: 'Delete', run: view => !view.composing && removeFormatBoundary(view, false) },
])];
