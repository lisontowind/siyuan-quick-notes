import { toolbarActions, parseToolbarLayout, toolbarCapacity, moveToolbarAction, type ToolbarAction, type ToolbarLayout } from '../core/toolbar';
import { t } from '../core/i18n';
import { icon } from './icons';
import type { HeadingLevel } from './formatting';

const labels: Record<ToolbarAction, string> = { bold: '加粗', italic: '斜体', underline: '下划线', strike: '删除线', heading: '标题', unordered: '无序列表', ordered: '有序列表', task: '待办', quote: '引用', code: '行内代码', link: '链接', image: '插入图片' };
const icons: Record<ToolbarAction, string> = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough', heading: 'heading', unordered: 'list', ordered: 'list-ordered', task: 'list-todo', quote: 'quote', code: 'code', link: 'link', image: 'image' };

export class FormatToolbar {
  private order = [...toolbarActions] as ToolbarAction[];
  private saved = parseToolbarLayout(undefined);
  private buttons = new Map<ToolbarAction, HTMLButtonElement>();
  private more = document.createElement('button');
  private popup = document.createElement('div');
  private enabled = false;
  private busy = false;
  private mode?: 'more' | 'heading' | 'sort';
  private anchor?: HTMLElement;
  private observer: ResizeObserver;
  private drag?: { id: ToolbarAction; x: number; y: number; active: boolean; origin: ToolbarAction[]; target: HTMLElement };
  private suppressClick = false;
  constructor(private root: HTMLElement, private run: (action: ToolbarAction) => void, private heading: (level: HeadingLevel) => void,
    private save: (layout: ToolbarLayout) => Promise<ToolbarLayout>, private error: (text: string) => void) {
    root.replaceChildren();
    for (const id of toolbarActions) {
      const button = document.createElement('button'); button.id = `format-${id}`; button.dataset.format = id;
      button.title = t(labels[id]); button.setAttribute('aria-label', t(labels[id])); button.append(icon(icons[id]));
      if (id === 'heading') { button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); }
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => this.activate(id, button));
      this.bindDrag(button, id); this.buttons.set(id, button);
    }
    this.more.id = 'format-more'; this.more.title = t('更多格式'); this.more.setAttribute('aria-label', t('更多格式'));
    this.more.setAttribute('aria-haspopup', 'menu'); this.more.setAttribute('aria-expanded', 'false'); this.more.append(icon('ellipsis'));
    this.more.addEventListener('mousedown', event => event.preventDefault());
    this.more.onclick = () => this.mode === 'more' ? this.close() : this.open('more', this.more);
    this.popup.className = 'format-popup'; this.popup.hidden = true; this.popup.setAttribute('role', 'menu'); document.body.append(this.popup);
    this.observer = new ResizeObserver(() => { if (!this.drag?.active) this.render(); }); this.observer.observe(root);
    document.addEventListener('pointerdown', this.outside, true); document.addEventListener('keydown', this.keyboard);
    window.addEventListener('blur', this.blur); window.addEventListener('resize', this.position);
    this.render();
  }
  update(layout: ToolbarLayout): void {
    this.saved = parseToolbarLayout(layout);
    if (!this.busy && !this.drag) { this.order = [...this.saved.order]; this.render(); }
  }
  setEnabled(value: boolean): void { this.enabled = value; if (!value) this.close(); this.render(); }
  close(): void {
    this.mode = undefined; this.popup.hidden = true; this.anchor?.setAttribute('aria-expanded', 'false');
    this.more.setAttribute('aria-expanded', 'false'); this.buttons.get('heading')?.setAttribute('aria-expanded', 'false');
  }
  private activate(id: ToolbarAction, anchor: HTMLElement): void {
    if (this.suppressClick) { this.suppressClick = false; return; }
    if (!this.enabled || this.busy) return;
    if (id === 'heading') { this.mode === 'heading' ? this.close() : this.open('heading', anchor); return; }
    this.close(); this.run(id);
  }
  private render(): void {
    const capacity = toolbarCapacity(this.root.clientWidth);
    this.root.replaceChildren(...this.order.slice(0, capacity).map(id => this.buttons.get(id)!), this.more);
    for (const button of this.buttons.values()) button.disabled = !this.enabled || this.busy;
    this.more.disabled = !this.enabled || this.busy;
    if (this.mode) this.renderPopup();
  }
  private open(mode: 'more' | 'heading' | 'sort', anchor: HTMLElement): void {
    this.close(); this.mode = mode; this.anchor = anchor; anchor.setAttribute('aria-expanded', 'true');
    this.popup.hidden = false; this.renderPopup(); this.popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  private row(text: string, name: string, click: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    button.append(icon(name), document.createTextNode(t(text))); button.onclick = click;
    button.addEventListener('mousedown', event => event.preventDefault()); return button;
  }
  private renderPopup(): void {
    this.popup.replaceChildren(); this.popup.classList.toggle('format-sort', this.mode === 'sort');
    this.popup.setAttribute('aria-label', t(this.mode === 'heading' ? '标题' : this.mode === 'sort' ? '调整顺序' : '更多格式'));
    if (this.mode === 'heading') {
      for (let level = 0; level <= 6; level++) {
        const label = level ? `${t('标题')} ${level} (H${level})` : t('正文');
        const button = this.row(label, 'heading', () => { if (this.enabled && !this.busy) { this.close(); this.heading(level as HeadingLevel); } });
        button.dataset.level = String(level); this.popup.append(button);
      }
    } else if (this.mode === 'more') {
      for (const id of this.order.slice(toolbarCapacity(this.root.clientWidth))) {
        const button = this.row(labels[id], icons[id], () => this.activate(id, this.more));
        button.dataset.format = id; this.popup.append(button);
      }
      this.popup.append(this.row('调整顺序', 'grip-vertical', () => this.open('sort', this.more)));
    } else if (this.mode === 'sort') {
      for (const id of this.order) {
        const row = document.createElement('div'); row.className = 'sort-row'; row.dataset.format = id;
        const button = this.row(labels[id], 'grip-vertical', () => {}); button.dataset.format = id;
        button.setAttribute('aria-label', `${t(labels[id])} · ${t('按住拖动，或使用左右按钮调整顺序')}`); this.bindDrag(button, id);
        button.addEventListener('keydown', event => {
          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); this.shift(id, event.key === 'ArrowUp' ? -1 : 1); }
        });
        row.append(button);
        for (const direction of [-1, 1]) {
          const move = this.row(direction < 0 ? '向前移动' : '向后移动', direction < 0 ? 'chevron-left' : 'chevron-right', () => this.shift(id, direction));
          move.className = 'sort-move'; move.setAttribute('aria-label', `${t(labels[id])} · ${t(direction < 0 ? '向前移动' : '向后移动')}`);
          move.disabled = this.busy || this.order.indexOf(id) + direction < 0 || this.order.indexOf(id) + direction >= this.order.length;
          row.append(move);
        }
        this.popup.append(row);
      }
      const reset = this.row('恢复默认顺序', 'keyboard', () => { this.order = [...toolbarActions]; void this.commit(); }); reset.disabled = this.busy; this.popup.append(reset);
    }
    this.position();
  }
  private shift(id: ToolbarAction, delta: number): void {
    if (this.busy) return;
    const to = this.order[this.order.indexOf(id) + delta]; if (!to) return;
    this.order = moveToolbarAction(this.order, id, to); void this.commit(id);
  }
  private async commit(focus?: ToolbarAction): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.render();
    try { this.saved = parseToolbarLayout(await this.save({ order: [...this.order] })); }
    catch (error) { this.error(`${t('工具栏顺序未保存')}：${error instanceof Error ? error.message : String(error)}`); }
    finally {
      this.busy = false; this.order = [...this.saved.order]; this.render();
      if (focus && this.mode === 'sort') this.popup.querySelector<HTMLButtonElement>(`button[data-format="${focus}"]`)?.focus({ preventScroll: true });
    }
  }
  private bindDrag(button: HTMLButtonElement, id: ToolbarAction): void {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.enabled || this.busy) return;
      this.drag = { id, x: event.clientX, y: event.clientY, active: false, origin: [...this.order], target: button };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      const drag = this.drag; if (!drag || drag.target !== button) return;
      if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.active = true; this.suppressClick = true; button.classList.add('dragging');
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-format]');
      if (target?.dataset.format && target.dataset.format !== id) {
        this.order = moveToolbarAction(this.order, id, target.dataset.format as ToolbarAction);
        // Keep the captured element mounted until pointerup; reorder existing nodes.
        if (this.mode === 'sort') {
          const rows = new Map([...this.popup.querySelectorAll<HTMLElement>('.sort-row')].map(row => [row.dataset.format, row]));
          const reset = this.popup.lastElementChild; for (const action of this.order) this.popup.insertBefore(rows.get(action)!, reset);
        } else {
          for (const action of this.order.slice(0, toolbarCapacity(this.root.clientWidth))) this.root.insertBefore(this.buttons.get(action)!, this.more);
        }
      }
    });
    const end = (event: PointerEvent) => {
      const drag = this.drag; if (!drag || drag.target !== button) return;
      this.drag = undefined; button.classList.remove('dragging');
      if (event.type === 'pointercancel') { this.suppressClick = false; this.order = drag.origin; this.render(); }
      else if (drag.active) { void this.commit(); setTimeout(() => { this.suppressClick = false; }, 0); }
    };
    button.addEventListener('pointerup', end); button.addEventListener('pointercancel', end);
  }
  private position = (): void => {
    if (!this.mode) return;
    const anchor = (this.anchor?.isConnected ? this.anchor : this.more).getBoundingClientRect();
    const popup = this.popup.getBoundingClientRect();
    this.popup.style.left = `${Math.max(6, Math.min(anchor.left, innerWidth - popup.width - 6))}px`;
    this.popup.style.top = `${Math.max(6, Math.min(anchor.top - popup.height - 4, innerHeight - popup.height - 6))}px`;
  };
  private outside = (event: Event): void => {
    const target = event.target as Node; if (!this.popup.contains(target) && !this.root.contains(target)) this.close();
  };
  private blur = (): void => this.close();
  private keyboard = (event: KeyboardEvent): void => {
    if (!this.mode) return;
    if (event.key === 'Escape') { event.preventDefault(); const anchor = this.anchor; this.close(); (anchor?.isConnected ? anchor : this.more)?.focus(); return; }
    if (event.altKey || !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
    if (event.key === 'Tab') { this.close(); return; }
    const buttons = [...this.popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[index]?.focus();
  };
  destroy(): void { this.observer.disconnect(); document.removeEventListener('pointerdown', this.outside, true); document.removeEventListener('keydown', this.keyboard); window.removeEventListener('blur', this.blur); window.removeEventListener('resize', this.position); this.popup.remove(); }
}
