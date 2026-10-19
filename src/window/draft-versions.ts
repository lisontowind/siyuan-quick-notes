import type { DraftVersionsData } from '../core/recent';
import { t } from '../core/i18n';

export class DraftVersionsPanel {
  private root = document.createElement('div');
  private select = document.createElement('select');
  private preview = document.createElement('textarea');
  private status = document.createElement('p');
  private metadata = document.createElement('p');
  private copy = document.createElement('button');
  private reload = document.createElement('button');
  private data?: DraftVersionsData;
  private id?: string;
  private busy = false;
  private connected = true;
  private visible = false;
  private generation = 0;
  constructor(parent: HTMLElement, private actions: { load(id?: string): Promise<DraftVersionsData>; choose(id: string | undefined, version: string, token: string, copy: boolean): Promise<void> }, private tr = t, private onClose?: () => void) {
    this.root.className = 'draft-versions draft-versions-panel'; this.root.setAttribute('aria-label', tr('其他设备草稿')); this.root.hidden = true;
    const help = document.createElement('p'); help.textContent = tr('其他设备草稿仅供查看，请复制到本设备后编辑。仅显示已同步到当前工作空间的内容。');
    this.select.setAttribute('aria-label', tr('选择草稿')); this.preview.readOnly = true; this.preview.setAttribute('aria-label', tr('版本正文预览'));
    this.select.onchange = () => this.render(); this.status.setAttribute('role', 'status');
    this.copy.textContent = tr('复制到本设备'); this.copy.setAttribute('aria-label', tr('复制到本设备'));
    this.reload.textContent = tr('刷新');
    this.copy.onclick = () => { void this.choose(); };
    this.reload.onclick = () => { void this.load(); };
    const controls = document.createElement('div'); controls.className = 'draft-version-actions'; controls.append(this.reload, this.copy);
    this.root.append(help, this.select, this.metadata, this.preview, this.status, controls); parent.append(this.root);
  }
  async show(id?: string): Promise<void> {
    if (this.visible && this.id === id && this.busy) return;
    if (this.id !== id) { this.generation++; this.busy = false; }
    this.id = id; this.root.setAttribute('aria-label', this.tr(id ? '恢复本机草稿' : '其他设备草稿'));
    this.visible = true; this.root.hidden = false;
    await this.load();
  }
  setConnected(value: boolean): void { this.connected = value; this.render(); }
  close(): void {
    this.visible = false; this.generation++; this.busy = false;
    this.root.hidden = true;
  }
  private dismiss(): void { this.close(); this.onClose?.(); }
  dispose(): void { this.close(); this.root.remove(); }
  private async load(): Promise<void> {
    if (this.busy || !this.connected || !this.visible) return;
    const generation = ++this.generation;
    this.busy = true; this.data = undefined; this.select.replaceChildren(); this.status.textContent = ''; this.render();
    try {
      const data = await this.actions.load(this.id);
      if (generation !== this.generation) return;
      this.data = data; this.select.replaceChildren();
      for (const [index, version] of this.data.versions.entries()) {
        const option = document.createElement('option'); option.value = version.version;
        option.textContent = `${index + 1}. ${version.device ? `${this.tr('设备')} ${version.device.slice(0, 8)} · ` : ''}${version.legacy ? `${this.tr('历史共享草稿')} · ` : ''}${version.summary} · ${new Date(version.updatedAt).toLocaleString()}`; this.select.append(option);
      }
      if (!this.data.versions.length) this.status.textContent = this.tr('暂无其他设备草稿，请等待思源同步后刷新');
    } catch (error) { if (generation === this.generation) this.status.textContent = error instanceof Error ? this.tr(error.message) : String(error); }
    finally { if (generation === this.generation) { this.busy = false; this.render(); } }
  }
  private render(): void {
    this.select.disabled = this.reload.disabled = this.busy || !this.connected;
    const selected = this.data?.versions.find(value => value.version === this.select.value);
    const text = selected?.text ?? ''; if (this.preview.value !== text) this.preview.value = text;
    this.metadata.textContent = selected ? `${selected.device ? `${this.tr('设备')} ${selected.device} · ` : ''}${new Date(selected.updatedAt).toLocaleString()}` : '';
    this.copy.disabled = this.busy || !this.connected || !selected;
    if (!this.connected) this.status.textContent = this.tr('与插件失去连接，请重新打开列表。');
  }
  private async choose(): Promise<void> {
    if (this.busy || !this.connected || !this.data) return;
    const generation = this.generation;
    this.busy = true; this.status.textContent = ''; this.render();
    try { await this.actions.choose(this.id, this.select.value, this.data.token, true); if (generation === this.generation && this.root.isConnected && this.visible) this.dismiss(); }
    catch (error) { if (generation === this.generation) this.status.textContent = error instanceof Error ? this.tr(error.message) : String(error); }
    finally { if (generation === this.generation) { this.busy = false; this.render(); } }
  }
}
