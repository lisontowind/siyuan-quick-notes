import type { Request } from '../types';
import { validNoteTitle } from './identity';
const actions = new Set(['ready', 'heartbeat', 'collected', 'edit', 'save', 'close', 'close-draft', 'pin', 'minimize', 'new', 'open', 'recent', 'reload', 'copy-note', 'delete']);
export function validRequest(value: unknown, session: string): value is Request {
  if (!value || typeof value !== 'object') return false;
  const x = value as Request;
  return x.session === session && typeof x.windowId === 'string' && x.windowId.length <= 80
    && typeof x.requestId === 'string' && x.requestId.length <= 80 && actions.has(x.action)
    && (x.error === undefined || (typeof x.error === 'string' && x.error.length <= 500))
    && validNoteTitle(x.title)
    && (x.action !== 'edit' && x.action !== 'collected' || (x.action === 'collected' && !!x.error)
      || (typeof x.text === 'string' && x.text.length <= 2_000_000 && Number.isSafeInteger(x.revision) && x.revision! >= 0));
}
