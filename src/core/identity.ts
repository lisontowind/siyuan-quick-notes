import type { NoteRecord, NoteReference } from '../types';

export function noteSummary(text: string, limit = 80, fallback = '空白速记'): string {
  return text.split('\n').find(line => line.trim())?.trim().slice(0, limit) || fallback;
}
export function noteLabel(note: Pick<NoteRecord, 'text' | 'title'>, limit = 80, fallback = '空白速记'): string {
  return note.title?.trim().slice(0, limit) || noteSummary(note.text, limit, fallback);
}
export function validNoteTitle(title: unknown): title is string | undefined {
  return title === undefined || (typeof title === 'string' && title.length <= 200 && !/[\u0000-\u001f\u007f]/.test(title));
}
// Keep titles written by older versions as editable Markdown when removing the title field.
export function noteBody(note: Pick<NoteRecord, 'text' | 'title'>): string {
  const title = note.title?.trim();
  return title ? `# ${title.replace(/[\\`*{}\[\]()#+.!_<>~|$=&-]/g, '\\$&')}${note.text ? `\n\n${note.text}` : ''}` : note.text;
}
export function migrateNoteTitle(note: NoteRecord): NoteRecord {
  return note.title === undefined ? note : { ...note, text: noteBody(note), title: undefined };
}
export function noteReference(note: NoteReference): NoteReference {
  return { id: note.id, blockId: note.blockId, docId: note.docId, target: note.target,
    ...(note.title !== undefined ? { title: note.title } : {}), ...(note.docPath !== undefined ? { docPath: note.docPath } : {}),
    ...(note.storage !== undefined ? { storage: note.storage } : {}),
    ...(note.docTitle !== undefined ? { docTitle: note.docTitle } : {}),
    createdAt: note.createdAt, updatedAt: note.updatedAt };
}
export function timestamp(time: number, separator = ''): string {
  const d = new Date(time);
  const parts = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].map((n, i) => i === 0 ? String(n) : String(n).padStart(2, '0'));
  return separator ? `${parts.slice(0, 3).join('-')} ${parts.slice(3).join(separator)}` : parts.join('');
}
export function createNote(now = Date.now()): NoteRecord {
  const id = crypto.randomUUID();
  return { id, blockId: `${timestamp(now)}-${id.replaceAll('-', '').slice(0, 7)}`, createdAt: now, updatedAt: now, text: '', revision: 0, savedRevision: 0 };
}
