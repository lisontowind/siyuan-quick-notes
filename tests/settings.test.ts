import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Settings } from '../src/types';
const panels = vi.hoisted(() => [] as Array<{ options: { confirmCallback: () => void }; items: Array<{ title: string; actionElement: Element }> }>);
vi.mock('siyuan', () => ({ Setting: class {
  items: Array<{ title: string; actionElement: Element }> = [];
  constructor(public options: { confirmCallback: () => void }) { panels.push(this); }
  addItem(item: { title: string; actionElement: Element }) { this.items.push(item); }
} }));
import { createSettings } from '../src/components/settings';
import { defaults } from '../src/core/settings';
import { validateSettingsDraft } from '../src/core/settings';
import { NoteRepository } from '../src/services/repository';
import { createNote } from '../src/core/identity';
import { FakeKernel } from './fake-kernel';

class Element {
  textContent = ''; className = ''; value = ''; type = ''; checked = false;
  min = ''; max = ''; children: Element[] = []; onclick?: () => void;
  classList = { add() {} }; listeners = new Map<string, () => void>();
  setAttribute() {} append(...children: Element[]) { this.children.push(...children); }
  addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
}
class Input extends Element {}
class Select extends Element { add() {} }
beforeEach(() => {
  panels.length = 0;
  vi.stubGlobal('HTMLInputElement', Input);
  vi.stubGlobal('Option', class {});
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'input' ? new Input() : tag === 'select' ? new Select() : new Element() });
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const api = new FakeKernel(), value = { ...defaults, notebook: api.notebook };
  const repo = new NoteRepository(api, () => value), save = vi.fn().mockResolvedValue(undefined), report = vi.fn();
  const preview = vi.fn((settings: Settings) => repo.resolveTarget(createNote(), settings));
  createSettings(value, [{ id: api.notebook, name: '测试笔记本', closed: false }], save, () => {}, () => {}, report, preview);
  const panel = panels.at(-1)!;
  const field = (title: string) => panel.items.find(item => item.title === title)!.actionElement;
  const directory = field('保存目录（支持模板变量）'), row = field('保存位置预览');
  const editDirectory = (text: string) => { directory.value = text; directory.listeners.get('input')!(); };
  return { api, value, save, report, preview, panel, editDirectory, button: row.children[0], output: row.children[1] };
}

describe('settings validation and destination preview', () => {
  it('validates window settings against available notebooks and rejects malformed payloads before storage', () => {
    expect(validateSettingsDraft({ ...defaults, notebook: 'available' }, ['available']).notebook).toBe('available');
    expect(() => validateSettingsDraft({ ...defaults, notebook: 'closed' }, ['available'])).toThrow('普通笔记本');
    expect(() => validateSettingsDraft({ ...defaults, notebook: 'available', directory: '/../bad' }, ['available'])).toThrow('保存目录无效');
    expect(() => validateSettingsDraft({ ...defaults, notebook: 'available', width: '320' }, ['available'])).toThrow('设置格式无效');
  });
  it('shows a default cap of ten and saves a user limit as low as one', async () => {
    const h = setup();
    const limit = h.panel.items.find(item => item.title === '最多同时打开的便签')!.actionElement;
    expect(limit.value).toBe('10'); expect(limit.min).toBe('1'); expect(limit.max).toBe('50');
    limit.value = '1'; limit.listeners.get('input')!(); h.panel.options.confirmCallback();
    await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save.mock.calls[0][0].maxWindows).toBe(1);
  });
  it('previews draft settings without creating documents or changing active settings', async () => {
    const h = setup(); h.editDirectory('/预览/{{now | date "2006/01"}}'); h.button.onclick!();
    await vi.waitFor(() => expect(h.output.textContent).toBe('测试笔记本 · /预览/2026/10'));
    expect(h.value.directory).toBe(defaults.directory); expect(h.save).not.toHaveBeenCalled();
    expect(h.api.calls.every(call => call.path === '/api/template/renderSprig')).toBe(true);
    expect(h.api.docs.size).toBe(0);
    h.panel.options.confirmCallback(); await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save.mock.calls[0][0].directory).toBe('/预览/{{now | date "2006/01"}}');
  });
  it.each(['../bad', '/../escape', '/a/./b', '/a//b', '/a\n/b'])('rejects invalid input without silently saving a default directory: %s', async directory => {
    const h = setup(); h.editDirectory(directory); h.panel.options.confirmCallback();
    await vi.waitFor(() => expect(h.report).toHaveBeenCalledWith(expect.stringContaining('设置未保存')));
    expect(h.save).not.toHaveBeenCalled(); expect(h.api.calls).toHaveLength(0);
  });
  it('rejects template parsing failures and invalid rendered paths before saving', async () => {
    const h = setup(); h.editDirectory('/{{broken}}'); h.api.fail = '/api/template/renderSprig';
    h.button.onclick!(); await vi.waitFor(() => expect(h.output.textContent).toContain('无法预览'));
    h.panel.options.confirmCallback(); await vi.waitFor(() => expect(h.report).toHaveBeenCalled());
    expect(h.save).not.toHaveBeenCalled(); expect(h.api.docs.size).toBe(0);
    h.api.fail = undefined; h.api.post = async <T>() => '/../escape' as T;
    h.report.mockClear(); h.panel.options.confirmCallback();
    await vi.waitFor(() => expect(h.report).toHaveBeenCalledWith(expect.stringContaining('模板解析结果无效')));
    expect(h.save).not.toHaveBeenCalled();
  });
  it('ignores a late preview after the user changes the destination', async () => {
    const h = setup(); let release!: (value: { notebook: string; path: string }) => void;
    h.preview.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    h.button.onclick!(); h.editDirectory('/Updated');
    release({ notebook: h.api.notebook, path: '/old' });
    await Promise.resolve(); await Promise.resolve();
    expect(h.output.textContent).toBe('保存位置已更改，请重新预览。');
  });
});
