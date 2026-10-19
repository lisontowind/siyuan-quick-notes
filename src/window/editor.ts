import { t } from '../core/i18n';
import { Compartment, EditorState, EditorSelection } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { imagePreviews } from './image-preview';
import { liveMarkdown } from './live-markdown';
import { pendingFormats } from './markdown-spans';
import { liveMarkdownField } from './live-markdown';
import { formatTransaction, headingTransaction, type HeadingLevel, type FormatAction } from './formatting';

export interface EditorAdapter { getText(): string; setText(text: string): void; setEditable(value: boolean): void; focus(): void; destroy(): void; readonly composing: boolean }
export function editorAccess(enabled: boolean): import('@codemirror/state').Extension {
  return [EditorView.editable.of(enabled), EditorState.readOnly.of(!enabled)];
}
export class QuickNoteEditor implements EditorAdapter {
  private view: EditorView;
  private replacing = false;
  private editable = new Compartment();
  private rendering = new Compartment();
  private rendered = true;
  private enabled = false;
  private extensions: import('@codemirror/state').Extension;
  get composing(): boolean { return this.view.composing; }
  constructor(parent: HTMLElement, changed: () => void, compositionEnded: () => void, save: () => void) {
    this.extensions = [
      this.editable.of(editorAccess(false)),
      markdown({ base: markdownLanguage }), pendingFormats, this.rendering.of([...liveMarkdown, imagePreviews]), history(), keymap.of([{ key: 'Mod-s', run: () => { save(); return true; } }, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping, drawSelection(), placeholder(t('写下此刻的想法…')),
      EditorView.contentAttributes.of({ 'aria-label': t('Markdown 速记'), spellcheck: 'false' }),
      EditorView.updateListener.of(update => { if (update.docChanged && !this.replacing) changed(); }),
      EditorView.domEventHandlers({ compositionend: () => { setTimeout(compositionEnded, 0); } }),
      EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent', color: 'inherit' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' }, '.cm-content': { padding: '14px 14px 40px', minHeight: '100%', caretColor: 'var(--text)' }, '&.cm-focused': { outline: 'none' }, '.cm-line': { padding: '0', lineHeight: '1.65' }, '.cm-cursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--text-selection)' } }),
    ];
    this.view = new EditorView({ parent, state: EditorState.create({ extensions: this.extensions }) });
  }
  getText(): string { return this.view.state.doc.toString(); }
  prepareImageInsertion(point?: { x: number; y: number }): (markdown: string) => void {
    const original = this.getText();
    const position = point && this.view.posAtCoords(point);
    const { from, to } = position != null ? { from: position, to: position } : this.view.state.selection.main;
    return markdown => {
      if (!this.enabled || this.getText() !== original) throw new Error(t('正文已变化，请重新插入图片'));
      const insert = `${from > 0 && original[from - 1] !== '\n' ? '\n\n' : ''}${markdown}${to < original.length && original[to] !== '\n' ? '\n\n' : '\n'}`;
      if (original.length - (to - from) + insert.length > 2_000_000) throw new Error(t('插入图片后超过 200 万字符，请拆分便签'));
      this.view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
      this.focus();
    };
  }
  setText(text: string): void {
    if (text === this.getText()) return;
    this.replacing = true;
    // Loading/reloading starts a new undo history; it must not expose the previous note.
    this.view.setState(EditorState.create({ doc: text, extensions: this.extensions }));
    this.setEditable(this.enabled);
    this.setLiveRendering(this.rendered);
    this.replacing = false;
  }
  setEditable(value: boolean): void { this.enabled = value; this.view.dispatch({ effects: this.editable.reconfigure(editorAccess(value)) }); }
  setLiveRendering(value: boolean): void {
    this.rendered = value; this.view.dispatch({ effects: this.rendering.reconfigure(value ? [...liveMarkdown, imagePreviews] : []) });
    if (!value) return;
    const decorations = this.view.state.field(liveMarkdownField).decorations;
    const snap = (position: number) => {
      let result = position;
      decorations.between(position, position, (from, to, decoration) => { if (decoration.spec.atomic && position > from && position < to) result = position - from < to - position ? from : to; });
      return result;
    };
    const selection = EditorSelection.create(this.view.state.selection.ranges.map(range => EditorSelection.range(snap(range.anchor), snap(range.head))), this.view.state.selection.mainIndex);
    if (!selection.eq(this.view.state.selection)) this.view.dispatch({ selection });
  }
  format(action: FormatAction): void {
    if (!this.enabled || this.composing) return;
    const transaction = formatTransaction(this.view.state, action);
    if (transaction) this.view.dispatch(transaction);
    this.focus();
  }
  setHeading(level: HeadingLevel): void {
    if (!this.enabled || this.composing) return;
    const transaction = headingTransaction(this.view.state, level);
    if (transaction) this.view.dispatch(transaction);
    this.focus();
  }
  prepareLinkInsertion(): (url: string) => void {
    const original = this.getText(), selection = this.view.state.selection;
    return url => {
      if (!this.enabled || this.composing || this.getText() !== original) throw new Error(t('正文已变化，请重新插入链接'));
      const state = this.view.state.update({ selection: EditorSelection.create(selection.ranges, selection.mainIndex) }).state;
      const transaction = formatTransaction(state, 'link', url);
      if (transaction) this.view.dispatch(transaction);
      this.focus();
    };
  }
  focus(): void { this.view.focus(); }
  destroy(): void { this.view.destroy(); }
}
