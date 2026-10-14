import { describe, it, expect } from 'vitest';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { editorAccess, QuickNoteEditor } from '../src/window/editor';

describe('CodeMirror snapshot freeze', () => {
  it('inserts images at the captured selection as one undo step even if selection moves during upload', () => {
    let state = EditorState.create({ doc: 'before selected after', selection: { anchor: 7, head: 15 }, extensions: [history()] });
    const target = {
      enabled: true, getText: () => state.doc.toString(), focus() {},
      view: { get state() { return state; }, posAtCoords: () => 0,
        dispatch: (spec: import('@codemirror/state').TransactionSpec) => { state = state.update(spec).state; } },
    };
    const insert = QuickNoteEditor.prototype.prepareImageInsertion.call(target as unknown as QuickNoteEditor);
    state = state.update({ selection: { anchor: 0 } }).state;
    insert('![image](assets/image.png)');
    expect(state.doc.toString()).toBe('before \n\n![image](assets/image.png)\n\n after');
    undo({ get state() { return state; }, dispatch: transaction => { state = transaction.state; } });
    expect(state.doc.toString()).toBe('before selected after');
    const drop = QuickNoteEditor.prototype.prepareImageInsertion.call(target as unknown as QuickNoteEditor, { x: 1, y: 2 });
    drop('![drop](assets/drop.png)');
    expect(state.doc.toString()).toBe('![drop](assets/drop.png)\n\nbefore selected after');
  });
  it('rejects insertion into changed, frozen or oversized content', () => {
    let text = 'original';
    const target = { enabled: true, getText: () => text, view: { state: EditorState.create({ doc: text }) } };
    const prepare = () => QuickNoteEditor.prototype.prepareImageInsertion.call(target as unknown as QuickNoteEditor);
    const insert = prepare(); text = 'new document';
    expect(() => insert('image')).toThrow('正文已变化');
    text = 'original'; target.enabled = false;
    expect(() => insert('image')).toThrow('正文已变化');
    target.enabled = true; text = 'a'.repeat(2_000_000);
    expect(() => prepare()('image')).toThrow('200 万字符');
  });
  it('blocks undo/redo while frozen and restores them when editing resumes', () => {
    const access = new Compartment();
    let state = EditorState.create({ doc: '原文', extensions: [history(), access.of(editorAccess(true))] });
    state = state.update({ changes: { from: 2, insert: '最新输入' } }).state;
    const target = () => ({ state, dispatch: (transaction: import('@codemirror/state').Transaction) => { state = transaction.state; } });
    state = state.update({ effects: access.reconfigure(editorAccess(false)) }).state;
    expect(state.facet(EditorView.editable)).toBe(false);
    expect(undo(target())).toBe(false); expect(state.doc.toString()).toBe('原文最新输入');
    state = state.update({ effects: access.reconfigure(editorAccess(true)) }).state;
    expect(undo(target())).toBe(true); expect(state.doc.toString()).toBe('原文');
    state = state.update({ effects: access.reconfigure(editorAccess(false)) }).state;
    expect(redo(target())).toBe(false); expect(state.doc.toString()).toBe('原文');
    state = state.update({ effects: access.reconfigure(editorAccess(true)) }).state;
    expect(redo(target())).toBe(true); expect(state.doc.toString()).toBe('原文最新输入');
  });
});
