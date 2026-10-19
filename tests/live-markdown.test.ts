import { describe, expect, it } from 'vitest';
import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { liveDecorations, liveMarkdownField, TableWidget, TaskWidget } from '../src/window/live-markdown';

function state(text: string, position = text.length) {
  return EditorState.create({ doc: text, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage }), history(), liveMarkdownField] });
}
function decorations(value: EditorState, from = 0, to = value.doc.length) {
  // EditorState's initial parser has a small time budget. Finish it explicitly
  // so parallel test load cannot turn an incomplete tree into a false failure.
  expect(ensureSyntaxTree(value, value.doc.length, 1000)).not.toBeNull();
  const result: Array<{ from: number; to: number; value: any }> = [];
  liveDecorations(value, from, to).between(0, value.doc.length, (from, to, value) => { result.push({ from, to, value }); }); return result;
}
describe('Markdown live rendering', () => {
  it('renders common Markdown while leaving document bytes and revisions untouched', () => {
    const text = '# 标题\n\n**粗体** *斜体* ~~删除~~ `code` [link](https://example.com)\n\n> 引用\n\n- 列表\n\n- [ ] 待办\n\n---\n\nfocus';
    const value = state(text), specs = decorations(value);
    for (const className of ['qn-live-h1', 'qn-live-strong', 'qn-live-em', 'qn-live-strike', 'qn-live-inline-code', 'qn-live-link', 'qn-live-quote']) expect(specs.some(item => item.value.spec.class === className), className).toBe(true);
    expect(specs.some(item => item.value.spec.widget instanceof TaskWidget)).toBe(true); expect(value.doc.toString()).toBe(text);
  });
  it('keeps formatting hidden when the cursor or selection enters a paragraph', () => {
    const text = '**one**\ncontinued *two*\n\n# three\n\nfocus';
    const value = state(text, 4); expect(decorations(value).some(item => item.value.spec.class === 'qn-live-strong')).toBe(true);
    const selection = value.update({ selection: { anchor: 1, head: text.indexOf('three') + 2 } }).state;
    expect(decorations(selection).some(item => item.value.spec.class === 'qn-live-h1')).toBe(true);
  });
  it('does not interpret code examples, HTML or SiYuan extensions as executable HTML', () => {
    const text = '```md\n**literal** [ ] |table|\n```\n\n<div onclick="bad()">text</div>\n\n{{{row\n((20261010000000-aaaaaaa))\n}}}\n\nfocus';
    const value = state(text), specs = decorations(value);
    expect(specs.some(item => item.value.spec.class === 'qn-live-code')).toBe(true);
    expect(specs.some(item => item.value.spec.class === 'qn-live-strong')).toBe(false);
    expect(specs.some(item => item.value.spec.widget instanceof TableWidget || item.value.spec.widget instanceof TaskWidget)).toBe(false);
    expect(value.doc.toString()).toBe(text);
  });
  it('keeps tables rendered when the cursor enters their document range', () => {
    const text = '| a | b |\n|---|---|\n| c | d |\n\nfocus', value = state(text);
    const widget = decorations(value).find(item => item.value.spec.widget instanceof TableWidget)!.value.spec.widget as TableWidget;
    expect(widget.rows).toEqual([{ header: true, cells: ['a', 'b'] }, { header: false, cells: ['c', 'd'] }]);
    expect(decorations(state(text, 22)).some(item => item.value.spec.widget instanceof TableWidget)).toBe(true);
  });
  it('refreshes read-only task widgets and does not alter text when rendering is removed', () => {
    const mode = new Compartment(), text = '- [x] task\n\nfocus';
    let value = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [markdown({ base: markdownLanguage }), mode.of(liveMarkdownField)] });
    const widget = () => { let task: TaskWidget | undefined; value.field(liveMarkdownField).decorations.between(0, value.doc.length, (_a, _b, decoration) => { if (decoration.spec.widget instanceof TaskWidget) task = decoration.spec.widget; }); return task!; };
    expect(widget().disabled).toBe(false);
    value = value.update({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }).state;
    expect(widget().disabled).toBe(true);
    value = value.update({ effects: mode.reconfigure([]) }).state; expect(value.doc.toString()).toBe(text);
  });
  it('limits decoration traversal to the requested visible range and keeps undo history intact', () => {
    let value = state('**old**\n\n# heading\n\nfocus');
    expect(decorations(value, 10, 20).some(item => item.value.spec.class === 'qn-live-strong')).toBe(false);
    value = value.update({ changes: { from: 2, to: 5, insert: 'new' } }).state;
    undo({ get state() { return value; }, dispatch: transaction => { value = transaction.state; } });
    expect(value.doc.toString()).toContain('**old**');
  });
});
