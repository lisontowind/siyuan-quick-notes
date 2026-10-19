import type { Request } from '../types';
import { validCalloutType } from './callout';
import { validNoteTitle } from './identity';
import { validImages } from './images';
import { validToolbarLayout } from './toolbar';
const actions = new Set(['ready', 'heartbeat', 'collected', 'edit', 'save', 'close', 'close-draft', 'pin', 'minimize', 'new', 'open', 'recent', 'reload', 'copy-note', 'delete', 'upload-images', 'cleanup', 'cleanup-snooze']);
export function validRequest(value: unknown, session: string): value is Request {
  if (!value || typeof value !== 'object') return false;
  const x = value as Request;
  return x.session === session && typeof x.windowId === 'string' && x.windowId.length <= 80
    && typeof x.requestId === 'string' && x.requestId.length <= 80 && (actions.has(x.action) || x.action === 'save-toolbar')
    && (x.action !== 'save-toolbar' || validToolbarLayout(x.toolbarLayout))
    && (x.error === undefined || (typeof x.error === 'string' && x.error.length <= 500))
    && (x.calloutType === undefined || validCalloutType(x.calloutType)) && validNoteTitle(x.title) && validNoteTitle(x.caption)
    && (x.action !== 'upload-images' || validImages(x.images))
    && (x.action !== 'edit' && x.action !== 'collected' || (x.action === 'collected' && !!x.error)
      || (typeof x.text === 'string' && x.text.length <= 2_000_000 && Number.isSafeInteger(x.revision) && x.revision! >= 0));
}
