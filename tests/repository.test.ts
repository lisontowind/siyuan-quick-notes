import { describe, it, expect } from 'vitest';
import { createNote } from '../src/core/identity';
import { defaults } from '../src/core/settings';
import { ConflictError, NoteRepository, unwrapMarkdown, unwrapNoteMarkdown, wrapMarkdown } from '../src/services/repository';
import { FakeKernel } from './fake-kernel';

describe('kernel-backed notes', () => {
  it('converts an old horizontal container to a native callout in place and preserves neighboring content', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const sourceDoc = '20261010000000-doc0001', otherBlock = '20261010000000-other01';
    const note = { ...createNote(), docId: sourceDoc, title: '旧标题', text: '旧正文',
      docPath: '/旧目录/共享文档', target: { notebook: api.notebook, path: '/旧目录/共享文档' }, baseline: '' };
    const sourceBlock = note.blockId;
    note.baseline = `{{{col\n# 旧标题\n\n旧正文\n}}}\n{: id="${note.blockId}" custom-quick-note="${note.id}" custom-quick-note-titled="1"}`;
    api.docs.set(note.target.path, sourceDoc);
    api.blocks.set(sourceBlock, { raw: note.baseline, root_id: sourceDoc });
    api.blocks.set(otherBlock, { raw: '其他便签', root_id: sourceDoc });
    expect(await repo.reload(note)).toMatchObject({ title: undefined, text: '# 旧标题\n\n旧正文' });
    note.text = '新正文';
    await repo.save(note, async () => {});
    expect(note.target.path).toBe('/旧目录/共享文档');
    expect(note.storage).toBe('callout'); expect(note.docId).toBe(sourceDoc);
    expect(note.blockId).toBe(sourceBlock); expect(note.docPath).toBe(note.target.path);
    expect(api.blocks.get(sourceBlock)?.raw).toMatch(/^> \[!NOTE\]\n/); expect(api.blocks.get(otherBlock)?.raw).toBe('其他便签');
    expect(unwrapNoteMarkdown(note.baseline!)).toMatchObject({ title: undefined, text: '# 旧标题\n\n新正文' });
    note.text = '# 新标题\n\n新正文'; await repo.save(note, async () => {});
    expect(api.docs.size).toBe(1); expect(api.blocks.get(otherBlock)?.raw).toBe('其他便签');
    expect(api.calls.some(call => call.path.endsWith('deleteBlock') || call.path.endsWith('appendBlock'))).toBe(false);
  });
  it.each(['caption', 'calloutType'] as const)('detects external changes to callout %s even when the body is unchanged', async field => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), text: 'body', caption: 'original title', calloutType: 'NOTE' as const };
    await repo.save(note, async () => {}); const baseline = note.baseline;
    const external = { ...note, ...(field === 'caption' ? { caption: 'external title' } : { calloutType: 'CAUTION' as const }) };
    api.blocks.get(note.blockId)!.raw = wrapMarkdown(external);
    await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError); expect(note.baseline).toBe(baseline);
    const reloaded = await repo.reload(note); expect(reloaded[field]).toBe(external[field]); expect(reloaded.text).toBe('body');
    expect(reloaded.storage).toBe('callout');
  });
  it('rejects category changes made after writing, retaining the original baseline for retry', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), note = { ...createNote(), text: 'before', calloutType: 'NOTE' as const };
    await repo.save(note, async () => {}); const baseline = note.baseline, original = api.post.bind(api);
    api.post = async <T>(path: string, body?: any): Promise<T> => {
      const result = await original<T>(path, body);
      if (path.endsWith('updateBlock')) api.blocks.get(note.blockId)!.raw = wrapMarkdown({ ...note, calloutType: 'WARNING' });
      return result;
    };
    note.text = 'after'; await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError); expect(note.baseline).toBe(baseline);
  });
  it('stops container updates when the shared source has external changes', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), docId: '20261010000000-doc0001', text: 'local', baseline: 'original snapshot' };
    const raw = `{{{col\nexternal\n}}}\n{: id="${note.blockId}" custom-quick-note="${note.id}"}`;
    api.blocks.set(note.blockId, { raw, root_id: note.docId });
    await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError);
    expect(api.docs.size).toBe(0); expect(api.blocks.get(note.blockId)?.raw).toBe(raw);
  });
  it('folds an old literal title into the body once and lets the body heading be removed', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), title: '标题 # * [链接](url) & $x$ \\ "引号"', text: '# 正文标题\n\n正文' };
    await repo.save(note, async () => {});
    const raw = api.blocks.get(note.blockId)!.raw;
    expect(raw).toMatch(/^> \[!NOTE\]\n>\n> # /); expect(raw).not.toContain('{{{col');
    expect(note.docId).not.toBe(note.blockId); expect(note.target?.path).not.toContain('标题');
    expect(note.title).toBeUndefined(); expect(raw).not.toContain('custom-quick-note-titled');
    expect(unwrapNoteMarkdown(raw)).toMatchObject({ title: undefined, text: note.text });
    expect(await repo.reload({ ...note, text: '' })).toMatchObject({ title: undefined, text: note.text });
    note.text = '# 正文标题\n\n正文'; await repo.save(note, async () => {});
    expect(unwrapNoteMarkdown(api.blocks.get(note.blockId)!.raw)).toMatchObject({ title: undefined, text: note.text });
  });
  it('keeps legacy body headings as body and reads externally edited titled headings', () => {
    const note = { ...createNote(), text: '# Existing heading\n\nbody' };
    expect(unwrapNoteMarkdown(wrapMarkdown(note))).toMatchObject({ title: undefined, text: note.text });
    const raw = wrapMarkdown({ ...note, title: 'old title' }).replace('# old title', '# 新标题');
    expect(unwrapNoteMarkdown(raw)).toMatchObject({ title: undefined, text: `# 新标题\n\n${note.text}` });
    expect(unwrapNoteMarkdown(wrapMarkdown({ ...note, title: 'only title', text: '' }))).toMatchObject({ title: undefined, text: '# only title' });
  });
  it('reads the current document title after a rename and falls back without showing a path', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), text: 'body', title: '便签标题', docId: undefined as string | undefined, docPath: undefined as string | undefined };
    await repo.save(note, async () => {}); expect(note.docPath).toBe(note.target?.path);
    api.docPaths.set(note.docId!, '/移动后的目录/编号文档'); api.docTitles.set(note.docId!, '文档已重命名');
    const reloaded = await repo.reload(note);
    expect(reloaded).toMatchObject({ docPath: '/移动后的目录/编号文档', docTitle: '文档已重命名', title: undefined, text: '# 便签标题\n\nbody' });
    api.fail = '/api/attr/getBlockAttrs'; reloaded.text = 'updated'; await repo.save(reloaded, async () => {});
    expect(reloaded.baseline).toContain('updated'); expect(reloaded.docTitle).toBe('文档已重命名');
    const fresh = { ...createNote(), text: 'body', target: { notebook: api.notebook, path: '/闪念速记/新文档' } };
    await repo.save(fresh, async () => {}); expect(fresh.docTitle).toBe('新文档');
  });
  it('recovers an unsaved whole-document intent without requiring a nonexistent source', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), storage: 'document' as const, text: '草稿正文',
      target: { notebook: api.notebook, path: '/Old/Independent' } };
    await repo.save(note, async () => {});
    expect(note.storage).toBe('callout'); expect(note.target.path).toBe('/闪念速记/20261010035000');
    expect(api.blocks.get(note.blockId)?.raw).toMatch(/^> \[!NOTE\]\n>\n> 草稿正文/);
    expect(api.docs.size).toBe(1);
  });
  it('keeps a deleted whole-document source deleted and retains the local content', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), storage: 'document' as const, text: '保留草稿', baseline: '旧正文' };
    await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError);
    expect(note.text).toBe('保留草稿'); expect(api.docs.size).toBe(0);
  });
  it('cleans real kernel list-item attributes without changing fenced examples or inline text', () => {
    const text = '- {: id="20261010025033-kkas87n" updated="20261010025033"}列表一\n  {: id="20261010025033-1sez5ou"}\n1. {: id="20261010025033-qt85wa1"}编号项\n\n```md\n- {: id="20261010025033-qt85wa1"}代码示例\n```\n正文 {: id="20261010025033-qt85wa1"}';
    expect(unwrapMarkdown(wrapMarkdown({ ...createNote(), text }))).toBe('- 列表一\n1. 编号项\n\n```md\n- {: id="20261010025033-qt85wa1"}代码示例\n```\n正文 {: id="20261010025033-qt85wa1"}');
  });
  it('uses the kernel template resolver and freezes the target', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook, directory: '/Quick Notes/{{now | date "2006/01"}}' })), note = createNote();
    note.text = 'first'; await repo.save(note, async () => {});
    note.text = 'second'; await repo.save(note, async () => {});
    expect(api.calls.filter(c => c.path.endsWith('renderSprig'))).toHaveLength(1);
    expect(api.calls.some(c => c.path.endsWith('getShorthandSavePath'))).toBe(false);
    expect(note.target?.path).toBe('/Quick Notes/2026/10');
    expect(api.calls.filter(c => c.path.endsWith('createDocWithMd')).map(c => c.body.path)).toEqual([note.target?.path]);
    expect(unwrapMarkdown(api.blocks.get(note.blockId)!.raw)).toBe('second');
  });
  it('shares a template document while keeping each note in its own vertical container', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const notes = Array.from({ length: 2 }, (_, i) => ({ ...createNote(), text: `note ${i}` }));
    await Promise.all(notes.map(note => repo.save(note, async () => {})));
    expect([...api.docs.keys()]).toEqual(['/闪念速记/20261010035000']);
    expect(api.calls.filter(c => c.path.endsWith('createDocWithMd'))).toHaveLength(1);
    expect(notes[0].docId).toBe(notes[1].docId);
    expect(notes[0].blockId).not.toBe(notes[1].blockId);
    notes[0].text = 'updated'; await repo.save(notes[0], async () => {});
    expect(unwrapMarkdown(api.blocks.get(notes[0].blockId)!.raw)).toBe('updated');
    expect(unwrapMarkdown(api.blocks.get(notes[1].blockId)!.raw)).toBe('note 1');
  });
  it('appends a container to an existing document and preserves all existing content', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const docId = '20261010000000-doc0001', existingBlock = '20261010000000-block01';
    api.docs.set('/闪念速记/20261010035000', docId);
    api.blocks.set(existingBlock, { raw: 'existing content', root_id: docId });
    const note = { ...createNote(), text: 'new note', target: { notebook: api.notebook, path: '/闪念速记/20261010035000' } };
    await repo.save(note, async () => {});
    expect(note.docId).toBe(docId);
    expect(note.target.path).toBe('/闪念速记/20261010035000');
    expect(api.calls.filter(c => c.path.endsWith('createDocWithMd'))).toHaveLength(0);
    expect(api.blocks.get(existingBlock)?.raw).toBe('existing content');
    expect(unwrapMarkdown(api.blocks.get(note.blockId)!.raw)).toBe('new note');
  });
  it('serializes shared destinations while keeping each note in its own container', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const notes = Array.from({ length: 5 }, (_, i) => ({ ...createNote(), text: `note ${i}`, target: { notebook: api.notebook, path: '/Inbox' } }));
    await Promise.all(notes.map(note => repo.save(note, async () => {})));
    expect(api.docs.size).toBe(1); expect(api.blocks.size).toBe(5);
    expect(new Set(notes.map(note => note.docId)).size).toBe(1);
    for (const [i, note] of notes.entries()) expect(unwrapMarkdown(api.blocks.get(note.blockId)!.raw)).toBe(`note ${i}`);
  });
  it.each(['', '/', 'relative/path', '/../escape', '/a/./b', '/a\n/b', '/a/{{unknown}}'])('rejects invalid rendered directories before writing: %s', async rendered => {
    const api = new FakeKernel(), original = api.post.bind(api);
    api.post = async <T>(path: string, body?: any): Promise<T> => path.endsWith('renderSprig') ? rendered as T : original<T>(path, body);
    const repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook, directory: '/{{now}}' }));
    await expect(repo.save({ ...createNote(), text: 'keep me' }, async () => {})).rejects.toThrow('模板');
    expect(api.docs.size).toBe(0); expect(api.blocks.size).toBe(0);
  });
  it('preserves existing targets and avoids template evaluation for plain directories', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook, directory: '/Quick Notes' }));
    const note = { ...createNote(), text: 'old note', target: { notebook: api.notebook, path: '/Old/Existing' } };
    await repo.save(note, async () => {});
    expect(note.target.path).toBe('/Old/Existing');
    const fresh = { ...createNote(), text: 'new note' }; await repo.save(fresh, async () => {});
    expect(fresh.target?.path.startsWith('/Quick Notes/')).toBe(true);
    expect(fresh.target?.path.endsWith(fresh.id.slice(0, 8))).toBe(true);
    expect(api.calls.some(call => call.path.endsWith('renderSprig') || call.path.endsWith('getShorthandSavePath'))).toBe(false);
  });
  it('keeps an older template child destination after settings change', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), text: 'old note', target: { notebook: api.notebook, path: '/闪念速记/20261010035000/old-child' } };
    await repo.save(note, async () => {});
    expect(note.target.path).toBe('/闪念速记/20261010035000/old-child');
    expect(api.calls.some(c => c.path.endsWith('renderSprig'))).toBe(false);
  });
  it('does not create a document when kernel template parsing fails', async () => {
    const api = new FakeKernel(); api.fail = '/api/template/renderSprig';
    const repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook, directory: '/{{broken}}' }));
    await expect(repo.save({ ...createNote(), text: 'keep me' }, async () => {})).rejects.toThrow('offline');
    expect(api.docs.size).toBe(0);
  });
  it.each(['lostCreate', 'lostAppend'] as const)('reconciles %s without duplicate documents or containers', async flag => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), note = { ...createNote(), text: 'keep me' };
    api[flag] = true;
    await expect(repo.save(note, async () => {})).rejects.toThrow();
    await repo.save(note, async () => {});
    expect(api.docs.size).toBe(1); expect(api.blocks.size).toBe(1);
  });
  it('reconciles a successful update whose response was lost', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), note = { ...createNote(), text: 'before' };
    await repo.save(note, async () => {}); note.text = 'after'; api.lostUpdate = true;
    await expect(repo.save(note, async () => {})).rejects.toThrow();
    await repo.save(note, async () => {});
    expect(unwrapMarkdown(note.baseline!)).toBe('after');
    expect(api.calls.filter(c => c.path.endsWith('updateBlock'))).toHaveLength(1);
  });
  it('refuses to overwrite external edits and reloads them', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), note = { ...createNote(), text: 'before' };
    await repo.save(note, async () => {});
    api.blocks.get(note.blockId)!.raw = wrapMarkdown({ ...note, text: 'external' }); note.text = 'local';
    await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.reload(note)).text).toBe('external');
  });
  it('does not recreate a deleted existing block', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), note = { ...createNote(), text: 'first' };
    await repo.save(note, async () => {}); api.blocks.delete(note.blockId); note.text = 'second';
    await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError);
  });
  it('keeps source code containing IAL-looking text and nested superblocks', () => {
    const note = { ...createNote(), text: '```md\n{: id="literal"}\n}}}\n```\n\n{{{row\nnested\n}}}' };
    expect(unwrapMarkdown(wrapMarkdown(note))).toBe(note.text);
    expect(() => wrapMarkdown({ ...note, text: '}}}' })).toThrow();
    expect(() => wrapMarkdown({ ...note, text: '{{{row\nunclosed' })).toThrow();
    expect(unwrapMarkdown(wrapMarkdown({ ...note, text: 'line with trailing spaces  ' }))).toBe('line with trailing spaces  ');
  });
  it('rejects missing independent notebook selection before creating a document', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => (defaults));
    await expect(repo.save({ ...createNote(), text: 'test' }, async () => {})).rejects.toThrow('选择');
    expect(api.docs.size).toBe(0);
  });
  it('rejects external changes made between writing and the verification read without adopting their baseline', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), note = { ...createNote(), text: 'before' };
    await repo.save(note, async () => {}); const baseline = note.baseline;
    const original = api.post.bind(api);
    api.post = async <T>(path: string, body?: any): Promise<T> => {
      const result = await original<T>(path, body);
      if (path.endsWith('updateBlock')) api.blocks.get(note.blockId)!.raw = wrapMarkdown({ ...note, text: 'external after write' });
      return result;
    };
    note.text = 'my changes'; await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError);
    expect(note.baseline).toBe(baseline);
    await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError);
    expect(api.calls.filter(call => call.path.endsWith('updateBlock'))).toHaveLength(1);
  });
  it.each(['中文\n\n第二段', '- one\n- two', '```ts\nconst text = "你好";\n```', '| a | b |\n| --- | --- |\n| 1 | 2 |', '{{{row\nnested\n}}}'])('verifies body round trips: %s', async text => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook })), note = { ...createNote(), text };
    await repo.save(note, async () => {}); expect(unwrapMarkdown(note.baseline!)).toBe(text);
  });
  it('retains an uncertain write if normalization fails', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }), () => { throw new Error('normalizer unavailable'); });
    const note = { ...createNote(), text: 'keep draft' };
    await expect(repo.save(note, async () => {})).rejects.toThrow('正文核对失败'); expect(note.baseline).toBeUndefined();
  });
});
