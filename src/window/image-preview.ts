import { t } from '../core/i18n';
import { StateField, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

export interface ImagePreview { from: number; to: number; lineEnd: number; alt: string; src: string }
const unescapeMarkdown = (text: string) => text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');

export function previewSource(value: string): string | undefined {
  let path = unescapeMarkdown(value);
  if (path.startsWith('<') && path.endsWith('>')) path = path.slice(1, -1);
  try { path = decodeURIComponent(path); } catch { return; }
  if (path.startsWith('/')) path = path.slice(1);
  if (!path.startsWith('assets/') || path.length > 1024 || /[\\%?#<>\u0000-\u0020\u007f]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')
    || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(path)) return;
  return '/' + path.split('/').map(part => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
}

export function collectImagePreviews(state: EditorState): ImagePreview[] {
  const images: ImagePreview[] = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== 'Image') return;
    const url = node.node.getChild('URL');
    if (!url) return false;
    const src = previewSource(state.sliceDoc(url.from, url.to));
    if (!src) return false;
    const closing = node.node.getChildren('LinkMark').find(mark => state.sliceDoc(mark.from, mark.to) === ']');
    const alt = unescapeMarkdown(state.sliceDoc(node.from + 2, closing?.from ?? node.from + 2));
    images.push({ from: node.from, to: node.to, lineEnd: state.doc.lineAt(node.to).to, alt, src });
    return false;
  } });
  return images;
}

export class ImagePreviewWidget extends WidgetType {
  constructor(readonly image: ImagePreview) { super(); }
  eq(other: ImagePreviewWidget): boolean {
    return this.image.src === other.image.src && this.image.alt === other.image.alt
      && this.image.from === other.image.from && this.image.to === other.image.to;
  }
  toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement('figure');
    figure.className = 'qn-image-preview'; figure.contentEditable = 'false';
    const image = document.createElement('img');
    image.alt = this.image.alt || t('图片预览'); image.loading = 'lazy'; image.decoding = 'async';
    image.draggable = false;
    const caption = document.createElement('figcaption');
    const message = document.createElement('span');
    message.textContent = t('图片加载中…'); message.setAttribute('role', 'status');
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = t('编辑图片链接');
    edit.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: this.image.from, head: this.image.to }, scrollIntoView: true });
      view.focus();
    });
    image.addEventListener('load', () => { message.textContent = this.image.alt || t('图片'); view.requestMeasure(); });
    image.addEventListener('error', () => {
      image.hidden = true; message.textContent = t('图片无法加载，请检查资源或链接');
      figure.dataset.failed = 'true'; view.requestMeasure();
    });
    image.src = this.image.src;
    caption.append(message, edit); figure.append(image, caption);
    return figure;
  }
  get estimatedHeight(): number { return 160; }
  ignoreEvent(): boolean { return true; }
}

function decorations(state: EditorState): DecorationSet {
  return Decoration.set(collectImagePreviews(state).map(image =>
    Decoration.widget({ widget: new ImagePreviewWidget(image), block: true, side: 1 }).range(image.lineEnd)), true);
}
export const imagePreviews = StateField.define<DecorationSet>({
  create: decorations,
  update(value, transaction) {
    return transaction.docChanged || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
      ? decorations(transaction.state) : value;
  },
  provide: field => EditorView.decorations.from(field),
});
