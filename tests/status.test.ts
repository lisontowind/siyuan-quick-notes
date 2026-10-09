import { describe, it, expect } from 'vitest';
import { presentStatus } from '../src/window/status';
import type { WindowState } from '../src/types';
const state: WindowState = { title: 'Inbox', revision: 1, savedRevision: 1, phase: 'saved', localRevision: -1, pinned: false, dark: false, showSaved: false };
describe('window save status', () => {
  it('hides only a current successful save and shows new or unsent edits', () => {
    expect(presentStatus(state, 1, false).hidden).toBe(true);
    expect(presentStatus(state, 2, false)).toMatchObject({ hidden: false, phase: 'dirty' });
    expect(presentStatus(state, 1, true).hidden).toBe(false);
  });
  it('keeps failures visible even when newer input exists', () => {
    expect(presentStatus({ ...state, phase: 'conflict', error: 'external edit' }, 2, true)).toMatchObject({ hidden: false, phase: 'conflict' });
  });
});
