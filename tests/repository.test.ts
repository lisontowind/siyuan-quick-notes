import { describe, it, expect } from 'vitest';
import { createNote } from '../src/core/identity';
import { defaults } from '../src/core/settings';
import { ConflictError, NoteRepository, unwrapMarkdown, wrapMarkdown } from '../src/services/repository';
import { FakeKernel } from './fake-kernel';

describe('kernel-backed notes', () => {
  it('deletes only the matching container and reconciles a lost delete response', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const notes = Array.from({ length: 2 }, () => ({ ...createNote(), text: 'keep separate', target: { notebook: api.notebook, path: '/Shared' } }));
    for (const note of notes) await repo.save(note, async () => {});
    api.lostDelete = true; await repo.delete(notes[0]); await repo.delete(notes[0]);
    expect(api.blocks.has(notes[0].blockId)).toBe(false); expect(api.blocks.has(notes[1].blockId)).toBe(true);
    expect(api.docs.size).toBe(1);
  });
  it('refuses deletion on mismatched ownership or a moved container', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const note = { ...createNote(), text: 'keep me' }; await repo.save(note, async () => {});
    await expect(repo.delete({ ...note, id: crypto.randomUUID() })).rejects.toThrow('标识');
    await expect(repo.delete({ ...note, docId: '20261010000000-other01' })).rejects.toThrow('移动');
    expect(api.blocks.has(note.blockId)).toBe(true);
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
    expect(api.calls.filter(c => c.path.endsWith('createDocWithMd')).map(c => c.body.path)).toEqual(['/Quick Notes/2026/10']);
    expect(unwrapMarkdown(api.blocks.get(note.blockId)!.raw)).toBe('second');
  });
  it('uses the default template as the document path without adding a child document', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const notes = Array.from({ length: 2 }, (_, i) => ({ ...createNote(), text: `note ${i}` }));
    await Promise.all(notes.map(note => repo.save(note, async () => {})));
    expect([...api.docs.keys()]).toEqual(['/闪念速记/20261010035000']);
    expect(api.calls.filter(c => c.path.endsWith('createDocWithMd'))).toHaveLength(1);
    expect(notes[0].docId).toBe(notes[1].docId);
    notes[0].text = 'updated'; await repo.save(notes[0], async () => {});
    expect(unwrapMarkdown(api.blocks.get(notes[0].blockId)!.raw)).toBe('updated');
    expect(unwrapMarkdown(api.blocks.get(notes[1].blockId)!.raw)).toBe('note 1');
  });
  it('appends to an existing template document without overwriting its other content', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const docId = '20261010000000-doc0001', existingBlock = '20261010000000-block01';
    api.docs.set('/闪念速记/20261010035000', docId);
    api.blocks.set(existingBlock, { raw: 'existing content', root_id: docId });
    const note = { ...createNote(), text: 'new note' }; await repo.save(note, async () => {});
    expect(note.docId).toBe(docId);
    expect(api.calls.some(c => c.path.endsWith('createDocWithMd'))).toBe(false);
    expect(api.blocks.get(existingBlock)?.raw).toBe('existing content');
    expect(unwrapMarkdown(api.blocks.get(note.blockId)!.raw)).toBe('new note');
  });
  it('serializes shared destinations while keeping each note in its own container', async () => {
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }));
    const notes = Array.from({ length: 5 }, (_, i) => ({ ...createNote(), text: `note ${i}`, target: { notebook: api.notebook, path: '/Inbox' } }));
    await Promise.all(notes.map(note => repo.save(note, async () => {})));
    expect(api.docs.size).toBe(1); expect(api.blocks.size).toBe(5);
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
  it.each(['lostCreate', 'lostAppend'] as const)('reconciles %s without duplicate documents or blocks', async flag => {
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
