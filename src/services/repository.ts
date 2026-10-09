import type { KernelTransport, NoteRecord, Settings, Target } from '../types';
import { SerialQueue } from '../core/serial';
import { timestamp } from '../core/identity';
import { normalizeDirectoryInput, normalizeResolvedDirectory } from '../core/directory';

export class ConflictError extends Error {}
export class UncertainWriteError extends Error {}
export interface Notebook { id: string; name: string; closed: boolean; encrypted?: boolean }
export function wrapMarkdown(note: NoteRecord): string {
  let depth = 0, fence = '';
  for (const line of note.text.split('\n')) {
    const code = /^\s*(`{3,}|~{3,})/.exec(line);
    if (code) { if (!fence) fence = code[1]; else if (code[1][0] === fence[0] && code[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(line)) fence = ''; continue; }
    if (fence) continue;
    if (/^\{\{\{(?:row|col)?\s*$/.test(line)) depth++;
    if (/^\}\}\}\s*$/.test(line) && --depth < 0) throw new Error('独立的 }}} 会结束速记容器，请将其放入代码块');
  }
  if (depth) throw new Error('Markdown 中的超级块未闭合，请补全或放入代码块');
  if (fence) throw new Error('Markdown 代码块未闭合，请补全后保存');
  // Outer block has a deterministic kernel ID so a lost response can be reconciled.
  return `{{{col\n${note.text || '\u200b'}\n}}}\n{: id="${note.blockId}" custom-quick-note="${note.id}"}\n`;
}
export function unwrapMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let fence = '';
  const clean = lines.flatMap(line => {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(line)) fence = '';
      return [line];
    }
    if (fence) return [line];
    if (/^\s*\{:\s.*\}\s*$/.test(line)) return [];
    // The real kernel also emits list-item IAL immediately after the marker.
    // Only remove that generated prefix; code fences and ordinary inline text stay literal.
    return [line.replace(/^(\s*(?:[-+*]|\d+[.)])\s+)\{:\s+[^}\n]*\bid="\d{14}-[a-z0-9]{7}"[^}\n]*\}\s*/, '$1')];
  });
  while (clean.length && !clean[clean.length - 1].trim()) clean.pop();
  if (clean[0]?.match(/^\{\{\{(?:col|row)$/) && clean[clean.length - 1] === '}}}') { clean.shift(); clean.pop(); }
  return clean.join('\n').replace(/^\u200b$/, '');
}
export function validBlockId(id: string): boolean { return /^\d{14}-[a-z0-9]{7}$/.test(id); }

export class NoteRepository {
  private queue = new SerialQueue();
  constructor(private api: KernelTransport, private settings: () => Settings,
    private normalize: (text: string) => string = text => text.replace(/\r\n/g, '\n').replace(/\n+$/, '')) {}
  private sameContent(raw: string, note: NoteRecord): boolean {
    try { return this.normalize(unwrapMarkdown(raw)) === this.normalize(unwrapMarkdown(wrapMarkdown(note))); }
    catch (error) { throw new UncertainWriteError(`正文核对失败，草稿已保留：${error instanceof Error ? error.message : String(error)}`); }
  }
  private hasContainer(raw: string, note: Pick<NoteRecord, 'id' | 'blockId'>): boolean {
    const lines = raw.replace(/\r\n/g, '\n').trimEnd().split('\n');
    const attributes = lines.at(-1) ?? '';
    return /^\{\{\{(?:col|row)\s*$/.test(lines[0]) && lines.at(-2)?.trim() === '}}}'
      && /^\{:\s.*\}$/.test(attributes) && attributes.includes(` id="${note.blockId}"`)
      && attributes.includes(` custom-quick-note="${note.id}"`);
  }
  async notebooks(): Promise<Notebook[]> {
    const data = await this.api.post<{ notebooks: Notebook[] }>('/api/notebook/lsNotebooks');
    return data.notebooks.filter(n => !n.closed && !n.encrypted);
  }
  async resolveTarget(note: NoteRecord, settings = this.settings()): Promise<Target> {
    if (note.target) return note.target;
    if (!validBlockId(settings.notebook)) throw new Error('请在插件设置中选择目标笔记本');
    const input = normalizeDirectoryInput(settings.directory);
    const hasTemplate = input.includes('{{') || input.includes('}}');
    const resolved = hasTemplate
      ? await this.api.post<string>('/api/template/renderSprig', { template: input }) : input;
    const directory = normalizeResolvedDirectory(resolved);
    if (hasTemplate) {
      if (directory === '/') throw new Error('保存目录模板解析结果无效：请包含文档名');
      return { notebook: settings.notebook, path: directory };
    }
    return { notebook: settings.notebook, path: `${directory === '/' ? '' : directory}/${timestamp(note.createdAt, '-')}-${note.id.slice(0, 8)}` };
  }
  async read(blockId: string): Promise<string> {
    const data = await this.api.post<{ kramdown: string }>('/api/block/getBlockKramdown', { id: blockId });
    if (typeof data?.kramdown !== 'string') throw new Error('速记内容块不存在或不可访问');
    return data.kramdown;
  }
  private async lookup(blockId: string): Promise<{ id: string; root_id: string } | undefined> {
    if (!validBlockId(blockId)) throw new Error('无效的内容块 ID');
    return (await this.api.post<Array<{ id: string; root_id: string }>>('/api/query/sql', { stmt: `SELECT id, root_id FROM blocks WHERE id = '${blockId}' LIMIT 1` }))[0];
  }
  async save(note: NoteRecord, persistIntent: () => Promise<void>): Promise<void> {
    wrapMarkdown(note);
    note.target ??= await this.resolveTarget(note);
    await persistIntent();
    const target = note.target;
    await this.queue.run(`${target.notebook}:${target.path}`, async () => {
      if (!note.docId) {
        const ids = await this.api.post<string[]>('/api/filetree/getIDsByHPath', { notebook: target.notebook, path: target.path });
        if (ids.length > 1) throw new Error('目标路径匹配多个文档，请调整保存位置');
        if (ids[0]) note.docId = ids[0];
        else {
          // Create an empty destination first. No note body is overwritten on retry.
          note.docId = await this.api.post<string>('/api/filetree/createDocWithMd', { notebook: target.notebook, path: target.path, markdown: '' });
        }
        await persistIntent();
      }
      const existing = await this.lookup(note.blockId);
      if (existing) {
        if (existing.root_id !== note.docId) throw new ConflictError('内容块已被移动，请从思源检查原文');
        const raw = await this.read(note.blockId);
        if (!this.hasContainer(raw, note)) throw new ConflictError('内容块标识不匹配，已停止保存');
        if (note.baseline !== undefined && note.baseline !== raw) {
          // A previous response may have been lost after a successful write.
          if (this.sameContent(raw, note)) { note.baseline = raw; return; }
          throw new ConflictError('原文已在其他位置修改，请重新载入或另存速记');
        }
        if (note.baseline === undefined) {
          if (!this.sameContent(raw, note)) throw new ConflictError('发现已存在的内容，请重新载入后继续编辑');
          note.baseline = raw;
          return;
        }
        await this.api.post('/api/block/updateBlock', { id: note.blockId, dataType: 'markdown', data: wrapMarkdown(note) });
      } else {
        if (note.baseline !== undefined) throw new ConflictError('原内容块已删除，已停止自动保存');
        await this.api.post('/api/block/appendBlock', { parentID: note.docId, dataType: 'markdown', data: wrapMarkdown(note) });
      }
      const raw = await this.read(note.blockId);
      if (!this.hasContainer(raw, note)) throw new UncertainWriteError('内核未保留速记容器标识，草稿已保留');
      if (!this.sameContent(raw, note)) throw new ConflictError('写入后正文与提交内容不一致，草稿已保留，请重新载入或另存速记');
      note.baseline = raw;
    });
  }
  async reload(note: NoteRecord): Promise<NoteRecord> {
    const raw = await this.read(note.blockId);
    if (!this.hasContainer(raw, note)) throw new ConflictError('内容块标识不匹配，已停止重新载入');
    return { ...note, text: unwrapMarkdown(raw), baseline: raw, revision: note.revision + 1, savedRevision: note.revision + 1, updatedAt: Date.now() };
  }
  async delete(note: Pick<NoteRecord, 'id' | 'blockId' | 'docId' | 'target'>): Promise<void> {
    await this.queue.run(note.target ? `${note.target.notebook}:${note.target.path}` : note.id, async () => {
      await this.api.post('/api/sqlite/flushTransaction');
      const existing = await this.lookup(note.blockId);
      if (!existing) return;
      if (note.docId && existing.root_id !== note.docId) throw new ConflictError('速记已被移动，未删除，请在思源检查原文');
      const raw = await this.read(note.blockId);
      if (!this.hasContainer(raw, note)) throw new ConflictError('内容块标识不匹配，未删除');
      // Remove only our container; older notes can share a document with other content.
      try { await this.api.post('/api/block/deleteBlock', { id: note.blockId }); }
      catch (error) {
        await this.api.post('/api/sqlite/flushTransaction');
        if (await this.lookup(note.blockId)) throw error;
        return; // The response was lost, but deletion committed.
      }
      await this.api.post('/api/sqlite/flushTransaction');
      if (await this.lookup(note.blockId)) throw new UncertainWriteError('未确认速记已删除，草稿和记录保留，请重试');
    });
  }
}
