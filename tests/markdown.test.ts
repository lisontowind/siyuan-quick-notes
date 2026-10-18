import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createMarkdownNormalizer, type MarkdownEngine } from '../src/services/markdown';
import { NoteRepository, unwrapMarkdown, unwrapNoteMarkdown, wrapMarkdown, ConflictError } from '../src/services/repository';
import { createNote } from '../src/core/identity';
import { defaults } from '../src/core/settings';
import { FakeKernel } from './fake-kernel';

// Optional integration with the user's installed parser; never starts SiYuan or writes its workspace.
const enginePath = process.env.SIYUAN_LUTE_PATH ?? (process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:/Program Files', 'SiYuan/resources/stage/protyle/js/lute/lute.min.js') : undefined);
describe.skipIf(!enginePath || !existsSync(enginePath))('installed SiYuan Markdown engine (read-only; skipped if unavailable, set SIYUAN_LUTE_PATH)', () => {
  it.each(['正文\n\n# 正文自己的标题', ''])('keeps old title text as a normal heading through the installed parser: %s', async text => {
    const parser = engine() as MarkdownEngine & { BlockDOM2Md(dom: string): string };
    const api = new FakeKernel(), repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }), createMarkdownNormalizer(parser));
    const note = { ...createNote(), title: '中文 # * [链接](url) & $x$ \\ "引号"', text };
    expect(parser.Md2BlockDOM(wrapMarkdown(note))).toContain('data-type="NodeSuperBlock"');
    expect(parser.Md2BlockDOM(wrapMarkdown(note))).toContain('data-sb-layout="row"');
    const original = api.post.bind(api);
    api.post = async <T>(path: string, body?: any): Promise<T> => {
      const result = await original<T>(path, body);
      if (path.endsWith('getBlockKramdown')) {
        const raw = parser.BlockDOM2Md(parser.Md2BlockDOM(api.blocks.get(note.blockId)!.raw));
        api.blocks.get(note.blockId)!.raw = raw;
        return { kramdown: raw } as T;
      }
      return result;
    };
    await repo.save(note, async () => {});
    const normalize = createMarkdownNormalizer(parser);
    expect(note.title).toBeUndefined();
    expect(normalize(unwrapNoteMarkdown(note.baseline!).text)).toBe(normalize(note.text));
    const reloaded = await repo.reload(note);
    expect(reloaded.title).toBeUndefined(); expect(normalize(reloaded.text)).toBe(normalize(note.text));
  });
  function engine(): MarkdownEngine {
    const context = createContext({ console, TextEncoder, TextDecoder, setTimeout, clearTimeout });
    runInContext('window = globalThis', context);
    runInContext(readFileSync(enginePath!, 'utf8'), context);
    return (context.Lute as { New(): MarkdownEngine }).New();
  }
  it.each([
    ['中文\n\n第二段', '中文\r\n\r\n第二段\r\n'],
    ['- one\n- two', '* one\n* two\n'],
    ['~~~ts\nconst text = "你好";\n~~~', '```ts\nconst text = "你好";\n```'],
    ['| a | b |\n| --- | --- |\n| 1 | 2 |', '| a | b |\n| ---- | ---- |\n| 1 | 2 |\n'],
    ['{{{row\nnested\n}}}', '{{{row\n\nnested\n\n}}}\n'],
  ])('recognizes equivalent Markdown without ignoring changed text: %s', (source, normalized) => {
    const normalize = createMarkdownNormalizer(engine());
    expect(normalize(source)).toBe(normalize(normalized));
    expect(normalize(source)).not.toBe(normalize(`${normalized}\nchanged`));
  });
  it('preserves superblock layout and literal code when comparing bodies', () => {
    const normalize = createMarkdownNormalizer(engine());
    expect(normalize('{{{row\nnested\n}}}')).not.toBe(normalize('{{{col\nnested\n}}}'));
    expect(normalize('a\n\n{{{row\nb\n}}}\n\nc')).not.toBe(normalize('{{{row\na\n}}}\n\nb\n\nc'));
    const text = '```md\n{: id="literal"}\n}}}\n```';
    expect(unwrapMarkdown(wrapMarkdown({ ...createNote(), text }))).toBe(text);
    expect(normalize(text)).not.toBe(normalize(text.replace('literal', 'other')));
  });
  it('accepts a parser-normalized verification read but rejects an actual post-write edit', async () => {
    const api = new FakeKernel(), parser = engine(), normalize = createMarkdownNormalizer(parser);
    const repo = new NoteRepository(api, () => ({ ...defaults, notebook: api.notebook }), normalize), note = { ...createNote(), text: '- 中文\n- two' };
    const original = api.post.bind(api); let changed = false;
    api.post = async <T>(path: string, body?: any): Promise<T> => {
      const result = await original<T>(path, body);
      if (path.endsWith('getBlockKramdown')) {
        const raw = wrapMarkdown({ ...note, text: changed ? 'external' : parser.BlockDOM2StdMd(parser.Md2BlockDOM(note.text)) });
        api.blocks.get(note.blockId)!.raw = raw;
        return { kramdown: raw } as T;
      }
      return result;
    };
    await repo.save(note, async () => {}); expect(note.baseline).toBeDefined();
    note.text = 'next'; changed = true;
    await expect(repo.save(note, async () => {})).rejects.toBeInstanceOf(ConflictError);
  });
});
