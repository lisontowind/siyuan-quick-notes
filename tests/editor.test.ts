import { describe, it, expect } from 'vitest';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { editorAccess } from '../src/window/editor';

describe('CodeMirror snapshot freeze', () => {
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
