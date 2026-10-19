import { describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { history, undo, redo } from '@codemirror/commands';
import { formatTransaction, headingTransaction, type FormatAction, type HeadingLevel } from '../src/window/formatting';
import { pendingFormats } from '../src/window/markdown-spans';
import { liveDecorations, removeFormatBoundary, repairDeletedPairs } from '../src/window/live-markdown';

function state(doc: string, from = 0, to = doc.length) { return EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [markdown({ base: markdownLanguage }), pendingFormats, history(), repairDeletedPairs] }); }
function apply(value: EditorState, action: FormatAction) { return value.update(formatTransaction(value, action)!).state; }
describe('format toolbar commands', () => {
  it.each([1, 2, 3, 4, 5, 6] as HeadingLevel[])('sets heading level %s and converts it without toggling to paragraph', level => {
    let value = state('## one\nplain');
    value = value.update(headingTransaction(value, level)!).state;
    expect(value.doc.toString()).toBe(`${'#'.repeat(level)} one\n${'#'.repeat(level)} plain`);
    expect(headingTransaction(value, level)).toBeUndefined();
    value = value.update(headingTransaction(value, 0)!).state;
    expect(value.doc.toString()).toBe('one\nplain');
  });
  it('preserves reverse selections and excludes an unselected next line, with one-step undo', () => {
    let value = EditorState.create({ doc: '# one\ntwo\nnext', selection: { anchor: 10, head: 2 }, extensions: [history()] });
    // Select through the start of next, excluding next itself.
    value = value.update({ selection: { anchor: 10, head: 2 } }).state;
    value = value.update(headingTransaction(value, 3)!).state;
    expect(value.doc.toString()).toBe('### one\n### two\nnext');
    expect(value.selection.main.anchor).toBeGreaterThan(value.selection.main.head);
    undo({ get state() { return value; }, dispatch: transaction => { value = transaction.state; } });
    expect(value.doc.toString()).toBe('# one\ntwo\nnext');
    const locked = EditorState.create({ doc: '# fixed', extensions: [EditorState.readOnly.of(true)] });
    expect(headingTransaction(locked, 0)).toBeUndefined();
  });
  it.each([['bold', '**text**'], ['italic', '*text*'], ['underline', '<u>text</u>'], ['strike', '~~text~~'], ['code', '`text`'], ['link', '[text](<https://>)']] as const)('applies and removes %s without losing the selection', (kind, expected) => {
    const formatted = apply(state('text'), kind); expect(formatted.doc.toString()).toBe(expected);
    expect(apply(formatted, kind).doc.toString()).toBe('text');
  });
  it.each(['heading', 'unordered', 'ordered', 'task', 'quote'] as const)('applies and removes %s over multiple lines', kind => {
    const formatted = apply(state('one\ntwo'), kind); expect(formatted.doc.toString()).not.toBe('one\ntwo');
    expect(apply(formatted, kind).doc.toString()).toBe('one\ntwo');
  });
  it('formats paragraphs separately and undoes one toolbar action in one step', () => {
    let value = apply(state('one\n\ntwo'), 'bold'); expect(value.doc.toString()).toBe('**one**\n\n**two**');
    undo({ get state() { return value; }, dispatch: transaction => { value = transaction.state; } }); expect(value.doc.toString()).toBe('one\n\ntwo');
    redo({ get state() { return value; }, dispatch: transaction => { value = transaction.state; } }); expect(value.doc.toString()).toBe('**one**\n\n**two**');
  });
  it('removes a format only from the selected word while preserving surrounding formatted text', () => {
    const result = apply(state('**one two three**', 6, 9), 'bold');
    expect(result.doc.toString()).toBe('**one** two **three**'); expect(result.sliceDoc(result.selection.main.from, result.selection.main.to)).toBe('two');
  });
  it('keeps surrounding whitespace outside emphasis markers so the result remains valid Markdown', () => {
    const result = apply(state(' word '), 'bold'); expect(result.doc.toString()).toBe(' **word** ');
    expect(apply(result, 'bold').doc.toString()).toBe(' word ');
  });
  it('keeps an empty format insertion editable and renders the resulting content', () => {
    let value = apply(state('', 0, 0), 'bold'); expect(value.selection.main.head).toBe(2);
    value = value.update({ changes: { from: 2, insert: '中文' }, selection: { anchor: 4 } }).state;
    expect(value.doc.toString()).toBe('**中文**');
    let bold = false; liveDecorations(value).between(0, value.doc.length, (_from, _to, decoration) => { bold ||= decoration.spec.class === 'qn-live-strong'; }); expect(bold).toBe(true);
  });
  it('removes paired delimiters on backspace/delete at hidden boundaries', () => {
    for (const [position, backwards] of [[2, true], [5, false]] as const) {
      let value = state('**abc**', position, position);
      expect(removeFormatBoundary({ get state() { return value; }, dispatch: spec => { value = value.update(spec as any).state; } }, backwards)).toBe(true);
      expect(value.doc.toString()).toBe('abc');
    }
  });
  it.each([['<u>abc</u>', 6, false], ['```js\nabc\n```', 6, true]] as const)('removes both sides of %s at a hidden boundary', (text, position, backwards) => {
    let value = state(text, position, position);
    expect(removeFormatBoundary({ get state() { return value; }, dispatch: spec => { value = value.update(spec as any).state; } }, backwards)).toBe(true);
    expect(value.doc.toString()).toMatch(/^abc\n?$/);
  });
  it('repairs both delimiters if a user selection deletes only one side of a format', () => {
    const value = state('**abc**').update({ changes: { from: 0, to: 3 }, annotations: Transaction.userEvent.of('input.delete') }).state;
    expect(value.doc.toString()).toBe('bc');
  });
  it('renders only safe paired underline tags and does not execute arbitrary HTML', () => {
    const value = state('<u>safe</u> <u class="unsafe">raw</u> ` <u>literal</u> `'); let underlines = 0;
    liveDecorations(value).between(0, value.doc.length, (_from, _to, decoration) => { if (decoration.spec.class === 'qn-live-underline') underlines++; }); expect(underlines).toBe(1);
  });
  it('refuses formatting read-only content', () => {
    const value = EditorState.create({ doc: 'fixed', extensions: [EditorState.readOnly.of(true)] }); expect(formatTransaction(value, 'bold')).toBeUndefined();
  });
});
