import { Setting } from 'siyuan';
import type { Settings, Target } from '../types';
import type { Notebook } from '../services/repository';
import { parseSettings } from '../core/settings';
import { normalizeDirectoryInput } from '../core/directory';
import { message } from '../services/autosave';

export function createSettings(settings: Settings, notebooks: Notebook[], save: (value: Settings) => Promise<void>, shortcuts: () => void, recent: () => void, report: (text: string) => void, preview: (value: Settings) => Promise<Target>): Setting {
  let draft = { ...settings };
  let previewVersion = 0, saving = false;
  const previewResult = document.createElement('p'); previewResult.className = 'qn-directory-preview'; previewResult.setAttribute('role', 'status');
  previewResult.textContent = '预览当前笔记本和目录，不创建文档。时间模板以预览时刻计算。';
  const validated = () => {
    const directory = normalizeDirectoryInput(draft.directory);
    if (!notebooks.some(notebook => notebook.id === draft.notebook)) throw new Error('请先选择一个已打开的普通笔记本');
    return parseSettings({ ...draft, directory });
  };
  async function commit(): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      const value = validated();
      await preview(value); // Validate template syntax and its rendered path before persisting settings.
      await save(value);
    } catch (error) { report(`设置未保存：${message(error)}`); }
    finally { saving = false; }
  }
  const panel = new Setting({ width: '660px', confirmCallback: () => { void commit(); } });
  function field(key: keyof Settings, title: string, element: HTMLInputElement | HTMLSelectElement, description?: string) {
    if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = !!draft[key];
    else element.value = String(draft[key]);
    element.classList.add(element instanceof HTMLInputElement && element.type === 'checkbox' ? 'b3-switch' : 'b3-text-field');
    element.addEventListener(element instanceof HTMLInputElement ? 'input' : 'change', () => {
      const value = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element instanceof HTMLInputElement && element.type === 'number' ? Number(element.value) : element.value;
      draft = { ...draft, [key]: value };
      if (key === 'directory' || key === 'notebook') {
        previewVersion++;
        try { validated(); previewResult.textContent = '保存位置已更改，请重新预览。'; }
        catch (error) { previewResult.textContent = message(error); }
      }
    });
    panel.addItem({ title, description, actionElement: element });
  }
  function select(options: Array<[string, string]>): HTMLSelectElement {
    const element = document.createElement('select');
    for (const [value, label] of options) element.add(new Option(label, value));
    return element;
  }
  function input(type: string, min?: number, max?: number): HTMLInputElement {
    const element = document.createElement('input'); element.type = type;
    if (min !== undefined) element.min = String(min); if (max !== undefined) element.max = String(max);
    return element;
  }
  function button(title: string, caption: string, action: () => void, description?: string) {
    const element = document.createElement('button'); element.className = 'b3-button b3-button--outline'; element.textContent = caption;
    element.onclick = action; panel.addItem({ title, description, actionElement: element });
  }
  button('全局快捷键', '打开思源快捷键设置', shortcuts, '默认 Ctrl + Alt + N。在思源快捷键设置中搜索“新建悬浮速记”，统一管理绑定。');
  field('shortcutBehavior', '快捷键行为', select([['new', '新建速记'], ['recent', '唤醒最近窗口']]));
  field('trayEnabled', '显示独立速记托盘图标', input('checkbox'), '左键新建速记；右键打开最近记录、窗口管理和设置，也可关闭此图标。关闭后可在这里重新开启。不修改思源原有托盘。');
  field('notebook', '目标笔记本', select([['', '请选择笔记本'], ...notebooks.map(n => [n.id, n.name] as [string, string])]));
  field('directory', '保存目录（支持模板变量）', input('text'), '默认模板：<code class="qn-template-example">/闪念速记/{{now | date "20060102150405"}}</code>。模板结果直接作为文档路径，同一路径的便签以各自的竖向超级块追加保存。不含模板变量时，在目录下生成时间与编号文档名。左上角显示文档标题。首次输入时确定路径，修改设置只影响新速记。');
  const previewRow = document.createElement('div'); previewRow.className = 'qn-preview-row';
  const previewButton = document.createElement('button'); previewButton.className = 'b3-button b3-button--outline'; previewButton.textContent = '预览保存位置';
  previewButton.onclick = () => {
    const version = ++previewVersion;
    previewResult.textContent = '正在解析保存位置…';
    void (async () => {
      try {
        const value = validated();
        const target = await preview(value);
        if (version !== previewVersion) return;
        const name = notebooks.find(notebook => notebook.id === target.notebook)?.name || target.notebook;
        previewResult.textContent = `${name} · ${target.path}`;
      } catch (error) { if (version === previewVersion) previewResult.textContent = `无法预览：${message(error)}`; }
    })();
  };
  previewRow.append(previewButton, previewResult);
  panel.addItem({ title: '保存位置预览', actionElement: previewRow });
  field('width', '默认窗口宽度', input('number', 300, 1600));
  field('height', '默认窗口高度', input('number', 220, 1200));
  field('alwaysOnTop', '新窗口默认置顶', input('checkbox'));
  field('rememberPosition', '记忆窗口位置、大小与置顶', input('checkbox'));
  field('restoreWindows', '重启后恢复上次打开的窗口', input('checkbox'), '默认关闭；未保存草稿始终保留恢复入口。');
  field('debounceMs', '自动保存防抖（毫秒）', input('number', 100, 10000));
  field('maxWindows', '最多同时打开的便签', input('number', 1, 50), '默认 10 个，可设 1–50 个。达到上限后请先关闭一个便签；调小上限不会关闭已打开的便签。');
  field('historyLimit', '最近速记记忆条数', input('number', 1, 200), '默认 50 条，可设 1–200 条。调小后只保留最近记录，不删除思源正文或本机恢复草稿；调大不能找回已移出的记录。');
  field('showSaved', '显示保存成功状态', input('checkbox'), '保存失败与冲突始终显示。');
  button('历史与恢复', '打开最近速记', recent);
  return panel;
}
