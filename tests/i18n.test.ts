import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostLocale, resolveLocale, translate } from '../src/core/i18n';
import { presentStatus } from '../src/window/status';
import type { WindowState } from '../src/types';

afterEach(() => vi.unstubAllGlobals());
describe('note window language', () => {
  it('accepts SiYuan language names and keeps the existing Chinese fallback', () => {
    for (const value of ['en_US', 'en-US', 'en', 'EN_us']) expect(resolveLocale(value)).toBe('en-US');
    for (const value of ['zh_CN', 'zh-CN', '', 'unknown', undefined]) expect(resolveLocale(value)).toBe('zh-CN');
    vi.stubGlobal('window', { siyuan: { config: { lang: 'en_US' } } });
    expect(hostLocale()).toBe('en-US');
  });
  it('translates nested plugin failures while preserving external diagnostic details', () => {
    expect(translate('图片未插入：图片上传 HTTP 503', 'en-US')).toBe('Images were not inserted: Image upload HTTP 503');
    expect(translate('本机草稿保存失败：EACCES: /notes/中文.json', 'en-US')).toBe('Could not save the local draft: EACCES: /notes/中文.json');
    expect(translate('Unknown kernel message: 原文', 'en-US')).toBe('Unknown kernel message: 原文');
    expect(translate('已保存到思源', 'zh-CN')).toBe('已保存到思源');
  });
  it('keeps English save, editing and conflict statuses accurate across revisions', () => {
    const state: WindowState = { title: '我的想法', revision: 1, savedRevision: 1, phase: 'saved', localRevision: 1, pinned: false, dark: false, showSaved: false };
    expect(presentStatus(state, 1, false, 'en-US')).toMatchObject({ text: 'Saved to SiYuan', hidden: true });
    expect(presentStatus(state, 2, true, 'en-US')).toMatchObject({ text: 'Editing…', hidden: false });
    expect(presentStatus({ ...state, phase: 'conflict', error: '原文已在其他位置修改，请重新载入或另存速记' }, 2, true, 'en-US'))
      .toMatchObject({ phase: 'conflict', hidden: false, text: 'Original content changed: The original was edited elsewhere. Reload it or save as a new note.' });
  });
});
