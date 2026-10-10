import type { KernelTransport, NoteRecord, Settings, Target } from '../types';
import { SerialQueue } from '../core/serial';
import { createNote, timestamp, validNoteTitle, noteBody, migrateNoteTitle } from '../core/identity';
import { normalizeDirectoryInput, normalizeResolvedDirectory } from '../core/directory';

export class ConflictError extends Error {}
export class UncertainWriteError extends Error {}
export interface Notebook { id: string; name: string; closed: boolean; encrypted?: boolean }

// SiYuan's row superblock stacks its children vertically; col places them side by side.
export function wrapMarkdown(note: NoteRecord): string {
  if (!validNoteTitle(note.title)) throw new Error('速记标题须为不超过 200 字符的单行文本');
  let depth = 0, fence = '';
  const text = noteBody(note);
  for (const line of text.split('\n')) {
    const code = /^\s*(`{3,}|~{3,})/.exec(line);
    if (code) { if (!fence) fence = code[1]; else if (code[1][0] === fence[0] && code[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(line)) fence = ''; continue; }
    if (fence) continue;
    if (/^\{\{\{(?:row|col)?\s*$/.test(line)) depth++;
    if (/^\}\}\}\s*$/.test(line) && --depth < 0) throw new Error('独立的 }}} 不是有效超级块，请将其放入代码块');
  }
  if (depth) throw new Error('Markdown 中的超级块未闭合，请补全或放入代码块');
  if (fence) throw new Error('Markdown 代码块未闭合，请补全后保存');
  return `{{{row\n${text || '\u200b'}\n}}}\n{: id="${note.blockId}" custom-quick-note="${note.id}"}\n`;
}
export function unwrapMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const attributes = [...lines].reverse().find(line => /^\{:\s.*\}\s*$/.test(line)) ?? '';
  const legacy = attributes.includes(' custom-quick-note="') && !attributes.includes(' type="doc"');
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
    return [line.replace(/^(\s*(?:[-+*]|\d+[.)])\s+)\{:\s+[^}\n]*\bid="\d{14}-[a-z0-9]{7}"[^}\n]*\}\s*/, '$1')];
  });
  while (clean.length && !clean[clean.length - 1].trim()) clean.pop();
  if (legacy && /^\{\{\{(?:col|row)\s*$/.test(clean[0]) && clean.at(-1)?.trim() === '}}}') { clean.shift(); clean.pop(); }
  return clean.join('\n').replace(/\n+$/, '').replace(/^\u200b$/, '');
}
export function validBlockId(id: string): boolean { return /^\d{14}-[a-z0-9]{7}$/.test(id); }
export function unwrapNoteMarkdown(raw: string): { text: string; title: undefined } {
  return { text: unwrapMarkdown(raw), title: undefined };
}

export class NoteRepository {
  private queue = new SerialQueue();
  constructor(private api: KernelTransport, private settings: () => Settings,
    private normalize: (text: string) => string = text => text.replace(/\r\n/g, '\n').replace(/\n+$/, '')) {}
  private sameContent(raw: string, note: NoteRecord): boolean {
    try {
      return this.normalize(unwrapMarkdown(raw)) === this.normalize(unwrapMarkdown(wrapMarkdown(note)));
    } catch (error) { throw new UncertainWriteError(`正文核对失败，草稿已保留：${error instanceof Error ? error.message : String(error)}`); }
  }
  private hasContainer(raw: string, note: NoteRecord): boolean {
    const lines = raw.replace(/\r\n/g, '\n').trimEnd().split('\n');
    const attributes = lines.at(-1) || '';
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
    const resolved = hasTemplate ? await this.api.post<string>('/api/template/renderSprig', { template: input }) : input;
    const directory = normalizeResolvedDirectory(resolved);
    if (hasTemplate) {
      if (directory === '/') throw new Error('保存目录模板解析结果无效：请包含文档名');
      return { notebook: settings.notebook, path: directory };
    }
    return { notebook: settings.notebook, path: `${directory === '/' ? '' : directory}/${timestamp(note.createdAt, '-')}-${note.id.slice(0, 8)}` };
  }
  async read(blockId: string): Promise<string> {
    const data = await this.api.post<{ kramdown: string }>('/api/block/getBlockKramdown', { id: blockId });
    if (typeof data?.kramdown !== 'string') throw new Error('速记文档不存在或不可访问');
    return data.kramdown;
  }
  private async lookup(id: string): Promise<{ id: string; root_id: string } | undefined> {
    if (!validBlockId(id)) throw new Error('无效的文档 ID');
    return (await this.api.post<Array<{ id: string; root_id: string }>>('/api/query/sql', { stmt: `SELECT id, root_id FROM blocks WHERE id = '${id}' LIMIT 1` }))[0];
  }
  async save(note: NoteRecord, persistIntent: () => Promise<void>): Promise<void> {
    Object.assign(note, migrateNoteTitle(note));
    wrapMarkdown(note);
    if (note.storage === 'document') {
      // Copy 0.1.17's whole-document note to a container, preserving the source document.
      if (note.docId && note.docId !== note.blockId) throw new ConflictError('原文档标识不匹配，已停止保存');
      await this.api.post('/api/sqlite/flushTransaction');
      const source = await this.lookup(note.blockId);
      if (source) {
        if (source.id !== source.root_id) throw new ConflictError('原文档标识不匹配，已停止保存');
        const old = await this.read(note.blockId);
        if (note.baseline !== undefined && note.baseline !== old && !this.sameContent(old, note)) throw new ConflictError('原文已在其他位置修改，请重新载入或另存速记');
        if (note.baseline === undefined && !this.sameContent(old, note)) throw new ConflictError('发现已存在的内容，请重新载入后继续编辑');
        note.blockId = createNote(note.createdAt).blockId;
      } else if (note.docId || note.baseline !== undefined) {
        throw new ConflictError('原文档已删除，已停止保存');
      }
      note.target = undefined;
      note.docId = undefined; note.baseline = undefined; note.docPath = undefined; note.docTitle = undefined;
    }
    note.storage = 'superblock';
    note.target ??= await this.resolveTarget(note);
    await persistIntent();
    const markdown = wrapMarkdown(note);
    await this.queue.run(`${note.target.notebook}:${note.target.path}`, async () => {
      if (!note.docId) {
        const ids = await this.api.post<string[]>('/api/filetree/getIDsByHPath', { notebook: note.target!.notebook, path: note.target!.path });
        if (ids.length > 1) throw new Error('目标路径匹配多个文档，请调整保存位置');
        if (ids[0]) note.docId = ids[0];
        else note.docId = await this.api.post<string>('/api/filetree/createDocWithMd', {
          notebook: note.target!.notebook, path: note.target!.path, markdown: '',
        });
        await persistIntent();
      }
      await this.api.post('/api/sqlite/flushTransaction');
      const existing = await this.lookup(note.blockId);
      if (existing) {
        if (existing.root_id !== note.docId || existing.id === existing.root_id) throw new ConflictError('速记内容块已被移动或标识不匹配，已停止保存');
        const raw = await this.read(note.blockId);
        if (!this.hasContainer(raw, note)) throw new ConflictError('速记容器标识不匹配，已停止保存');
        if (note.baseline !== undefined && note.baseline !== raw && !this.sameContent(raw, note)) throw new ConflictError('原文已在其他位置修改，请重新载入或另存速记');
        if (note.baseline === undefined && !this.sameContent(raw, note)) throw new ConflictError('发现已存在的内容，请重新载入后继续编辑');
        if (!this.sameContent(raw, note) || !/^\{\{\{row\s*\n/.test(raw)) {
          await this.api.post('/api/block/updateBlock', { id: note.blockId, dataType: 'markdown', data: markdown });
        }
      } else {
        if (note.baseline !== undefined) throw new ConflictError('原内容块已删除，已停止自动保存');
        await this.api.post('/api/block/appendBlock', { parentID: note.docId, dataType: 'markdown', data: markdown });
      }
      const raw = await this.read(note.blockId);
      if (!this.hasContainer(raw, note) || !/^\{\{\{row\s*\n/.test(raw)) throw new UncertainWriteError('内核未保留竖向速记容器标识，草稿已保留');
      if (!this.sameContent(raw, note)) throw new ConflictError('写入后正文与提交内容不一致，草稿已保留，请重新载入或另存速记');
      note.baseline = raw;
    });
    note.docPath = await this.documentPath(note);
    note.docTitle = await this.documentTitle(note);
  }
  private async documentTitle(note: NoteRecord): Promise<string | undefined> {
    try {
      const attrs = await this.api.post<Record<string, string>>('/api/attr/getBlockAttrs', { id: note.docId });
      if (typeof attrs?.title === 'string' && attrs.title.trim()) return attrs.title;
    } catch { /* A title lookup failure does not invalidate a confirmed content save. */ }
    return note.docTitle || (note.docPath || note.target?.path)?.split('/').pop();
  }
  private async documentPath(note: NoteRecord): Promise<string | undefined> {
    try {
      const path = await this.api.post<string>('/api/filetree/getHPathByID', { id: note.docId });
      if (typeof path === 'string' && path.startsWith('/')) return path;
    } catch { /* Path lookup must not turn a confirmed body save into a failure. */ }
    return note.docPath || note.target?.path;
  }
  async reload(note: NoteRecord): Promise<NoteRecord> {
    const raw = await this.read(note.storage === 'document' ? note.docId! : note.blockId);
    if (note.storage !== 'document' && !this.hasContainer(raw, note)) throw new ConflictError('速记容器标识不匹配，已停止重新载入');
    return { ...note, ...unwrapNoteMarkdown(raw), docPath: await this.documentPath(note), docTitle: await this.documentTitle(note), baseline: raw,
      revision: note.revision + 1, savedRevision: note.revision + 1, updatedAt: Date.now() };
  }
}
