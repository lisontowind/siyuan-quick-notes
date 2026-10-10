import { describe, it, expect } from 'vitest';
import { presentStatus } from '../src/window/status';
import type { WindowState } from '../src/types';
const state: WindowState = { title: 'Inbox', revision: 1, savedRevision: 1, phase: 'saved', localRevision: -1, pinned: false, dark: false, showSaved: false };
describe('window save status', () => {
  it('shows only save status and errors even when a document title is available', () => {
    const destination = { ...state, docTitle: '20261010035000' };
    expect(presentStatus(destination, 1, false)).toMatchObject({ hidden: true, text: '已保存到思源' });
    expect(presentStatus({ ...destination, showSaved: true }, 1, false)).toMatchObject({ hidden: false, text: '已保存到思源' });
    expect(presentStatus(destination, 2, true).text).toBe('正在编辑…');
    expect(presentStatus({ ...destination, phase: 'error', error: 'offline' }, 2, true).text).toBe('保存失败：offline');
  });
  it('hides only a current successful save and shows new or unsent edits', () => {
    expect(presentStatus(state, 1, false).hidden).toBe(true);
    expect(presentStatus(state, 2, false)).toMatchObject({ hidden: false, phase: 'dirty' });
    expect(presentStatus(state, 1, true).hidden).toBe(false);
  });
  it('keeps failures visible even when newer input exists', () => {
    expect(presentStatus({ ...state, phase: 'conflict', error: 'external edit' }, 2, true)).toMatchObject({ hidden: false, phase: 'conflict' });
  });
});
