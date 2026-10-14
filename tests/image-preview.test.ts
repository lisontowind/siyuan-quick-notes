import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { history, isolateHistory, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { collectImagePreviews, imagePreviews, ImagePreviewWidget, previewSource } from '../src/window/image-preview';

const createState = (doc: string) => EditorState.create({ doc, extensions: [markdown(), imagePreviews, history()] });
afterEach(() => vi.unstubAllGlobals());
describe('inline image preview', () => {
  it('resolves workspace resources from the origin root, including escaped names', () => {
    expect(previewSource('assets/a.png')).toBe('/assets/a.png');
    expect(previewSource('/assets/folder/图%28片%29.JPG')).toBe('/assets/folder/%E5%9B%BE%28%E7%89%87%29.JPG');
    expect(previewSource('<assets/a.gif>')).toBe('/assets/a.gif');
    expect(previewSource('assets/a\\(b\\).png')).toBe('/assets/a%28b%29.png');
  });
  it('never loads external URLs, local files, traversal or executable resources', () => {
    for (const source of ['https://example.com/a.png', '//example.com/a.png', 'file:///a.png', 'data:image/png;base64,x', 'javascript:x',
      'assets/../x.png', 'assets/%2e%2e/x.png', 'assets/%252e%252e/x.png', 'assets/a%5cb.png', 'assets/a%00.png',
      'assets//a.png', 'assets/a.png?x=1', 'assets/a.png#x', 'assets/a.svg', 'assets/a.html', 'assets/%broken.png']) {
      expect(previewSource(source), source).toBeUndefined();
    }
  });
  it('previews parsed Markdown images while excluding literal code, escaped syntax and HTML', () => {
    const state = createState('![a\\]b](assets/a.png "title") inline ![two](assets/two.webp)\n\n`![code](assets/code.png)`\n\n```md\n![fenced](assets/fenced.png)\n```\n\n\\![escaped](assets/escaped.png)\n\n<img src="assets/html.png">\n\n![remote](https://example.com/a.png)');
    const previews = collectImagePreviews(state);
    expect(previews.map(image => [image.alt, image.src])).toEqual([['a]b', '/assets/a.png'], ['two', '/assets/two.webp']]);
    expect(previews[0].lineEnd).toBe(previews[1].lineEnd);
    expect(state.doc.toString()).toContain('![a\\]b]');
    expect(state.field(imagePreviews).size).toBe(2);
  });
  it('updates previews on edits, undo, deletion and document reload without changing the source', () => {
    let state = createState('![original](assets/original.png)');
    const original = state.doc.toString();
    state = state.update({ changes: { from: 0, insert: 'prefix\n' } }).state;
    expect(collectImagePreviews(state)[0].from).toBe(7);
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: 'no image' }, annotations: isolateHistory.of('full') }).state;
    expect(state.field(imagePreviews).size).toBe(0);
    undo({ get state() { return state; }, dispatch: transaction => { state = transaction.state; } });
    expect(state.field(imagePreviews).size).toBe(1);
    expect(state.doc.toString()).toBe('prefix\n' + original);
    expect(createState('![restored](assets/restored.png)').field(imagePreviews).size).toBe(1);
    expect(createState('new text').field(imagePreviews).size).toBe(0);
  });
  it('keeps decorations across selection-only and readonly transactions', () => {
    let state = createState('![image](assets/a.png)');
    const before = state.field(imagePreviews);
    state = state.update({ selection: { anchor: 4 } }).state;
    expect(state.field(imagePreviews)).toBe(before);
    expect(state.doc.toString()).toBe('![image](assets/a.png)');
    expect(collectImagePreviews(state)[0].alt).toBe('image');
  });
  it('renders text safely, measures loaded images, reports failure and selects the source for editing', () => {
    class Element {
      className = ''; contentEditable = ''; textContent = ''; alt = ''; src = ''; loading = ''; decoding = ''; hidden = false;
      dataset: Record<string, string> = {}; children: Element[] = []; listeners = new Map<string, () => void>();
      append(...elements: Element[]) { this.children.push(...elements); }
      addEventListener(event: string, fn: () => void) { this.listeners.set(event, fn); }
      setAttribute() {}
    }
    vi.stubGlobal('document', { createElement: () => new Element() });
    const dispatch = vi.fn(), focus = vi.fn(), requestMeasure = vi.fn();
    const description = { from: 1, to: 20, lineEnd: 20, src: '/assets/test.png', alt: '<script>literal</script>' };
    const widget = new ImagePreviewWidget(description);
    const figure = widget.toDOM({ dispatch, focus, requestMeasure } as unknown as EditorView) as unknown as Element;
    const [image, caption] = figure.children, [message, edit] = caption.children;
    expect(image.src).toBe('/assets/test.png'); expect(image.alt).toBe('<script>literal</script>');
    expect(message.textContent).toContain('加载中');
    image.listeners.get('load')!(); expect(message.textContent).toBe('<script>literal</script>');
    image.listeners.get('error')!(); expect(image.hidden).toBe(true); expect(message.textContent).toContain('无法加载');
    expect(requestMeasure).toHaveBeenCalledTimes(2);
    edit.listeners.get('click')!(); expect(dispatch).toHaveBeenCalledWith({ selection: { anchor: 1, head: 20 }, scrollIntoView: true });
    expect(focus).toHaveBeenCalledOnce();
    expect(widget.eq(new ImagePreviewWidget({ ...description }))).toBe(true);
    expect(widget.eq(new ImagePreviewWidget({ ...description, from: 2 }))).toBe(false);
  });
});
