export interface Settings {
  trayEnabled: boolean;
  shortcutBehavior: 'new' | 'recent'; width: number; height: number;
  alwaysOnTop: boolean; rememberPosition: boolean; restoreWindows: boolean;
  notebook: string; directory: string;
  debounceMs: number; showSaved: boolean; maxWindows: number; historyLimit: number;
}
export interface Target { notebook: string; path: string }
export interface NoteRecord {
  id: string; blockId: string; createdAt: number; updatedAt: number;
  text: string; revision: number; savedRevision: number;
  target?: Target; docId?: string; baseline?: string;
}
export interface Geometry { x?: number; y?: number; width: number; height: number; pinned: boolean; open?: boolean }
export type NoteReference = Pick<NoteRecord, 'id' | 'blockId' | 'docId' | 'target' | 'createdAt' | 'updatedAt'>;
export interface WindowRecoveryState extends Geometry { note?: NoteReference }
export interface Draft { note: NoteRecord; geometry?: Geometry }
export type SavePhase = 'empty' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict' | 'local';
export interface WindowState {
  revision: number; savedRevision: number; docId?: string; title: string;
  phase: SavePhase; error?: string; localRevision: number; pinned: boolean; dark: boolean; showSaved: boolean;
}
export interface NoteContent { text: string; revision: number }
export interface Request {
  session: string; windowId: string; requestId: string;
  action: 'ready' | 'heartbeat' | 'collected' | 'edit' | 'save' | 'close' | 'close-draft' | 'pin' | 'minimize' | 'new' | 'open' | 'recent' | 'reload' | 'copy-note' | 'delete';
  text?: string; revision?: number; error?: string;
}
export interface Response {
  session: string; windowId: string; requestId?: string; state?: WindowState; content?: NoteContent;
  heartbeat?: { revision: number; localRevision: number }; durable?: { revision: number };
  focus?: boolean; flush?: boolean; collect?: boolean; resume?: boolean; stopped?: string;
}
export interface KernelTransport { post<T>(path: string, body?: unknown): Promise<T> }
export interface DraftStore {
  write(draft: Draft): Promise<void>; remove(id: string): Promise<void>; list(): Promise<Draft[]>;
}
