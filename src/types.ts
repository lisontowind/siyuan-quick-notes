export interface Settings {
  trayEnabled: boolean;
  trayClickAction: 'new' | 'recent';
  shortcutBehavior: 'new' | 'recent' | 'list'; width: number; height: number;
  alwaysOnTop: boolean; rememberPosition: boolean; restoreWindows: boolean;
  notebook: string; directory: string;
  debounceMs: number; showSaved: boolean; maxWindows: number; historyLimit: number;
  cleanupReminder: boolean; cleanupThreshold: number; archiveDays: number;
}
export interface Target { notebook: string; path: string }
export interface NoteRecord {
  id: string; blockId: string; createdAt: number; updatedAt: number;
  text: string; title?: string; // title is read only for compatibility with older records.
  caption?: string; // Native callout title; independent of the document name.
  calloutType?: import('./core/callout').CalloutType;
  docPath?: string; docTitle?: string; revision: number; savedRevision: number;
  target?: Target; docId?: string; baseline?: string;
  siyuanSaved?: boolean;
  storage?: 'document' | 'superblock' | 'callout';
  draftSync?: { version: string; clock: Record<string, number> };
}
export interface Geometry { x?: number; y?: number; width: number; height: number; pinned: boolean; open?: boolean }
export type NoteReference = Pick<NoteRecord, 'id' | 'blockId' | 'docId' | 'target' | 'createdAt' | 'updatedAt' | 'title' | 'caption' | 'calloutType' | 'docPath' | 'docTitle' | 'storage' | 'siyuanSaved'>;
export interface WindowRecoveryState extends Geometry { note?: NoteReference }
export interface DraftVersion { version: string; device: string; note: NoteRecord; legacy?: boolean }
export interface Draft { note: NoteRecord; geometry?: Geometry; syncActor?: string; syncPending?: boolean; variants?: DraftVersion[] }
export type MissingSourceChoice = 'restore' | 'delete' | 'cancel';
export type SavePhase = 'empty' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict' | 'local';
export interface WindowState {
  revision: number; savedRevision: number; docId?: string; docTitle?: string; title: string; caption?: string; calloutType?: import('./core/callout').CalloutType;
  phase: SavePhase; error?: string; localRevision: number; pinned: boolean; dark: boolean; showSaved: boolean;
  removed?: boolean;
  siyuanSaved?: boolean;
}
export interface NoteContent { text: string; revision: number; caption?: string; calloutType?: import('./core/callout').CalloutType }
export interface ImageInput { name: string; data: ArrayBuffer }
export interface Request {
  session: string; windowId: string; requestId: string;
  action: 'ready' | 'heartbeat' | 'collected' | 'edit' | 'save' | 'close' | 'close-draft' | 'pin' | 'minimize' | 'new' | 'open' | 'recent' | 'reload' | 'copy-note' | 'delete' | 'upload-images' | 'save-toolbar' | 'cleanup' | 'cleanup-snooze';
  toolbarLayout?: import('./core/toolbar').ToolbarLayout;
  text?: string; title?: string; caption?: string; calloutType?: import('./core/callout').CalloutType; revision?: number; error?: string;
  images?: ImageInput[];
}
export interface Response {
  session: string; windowId: string; requestId?: string; state?: WindowState; content?: NoteContent;
  heartbeat?: { revision: number; localRevision: number }; durable?: { revision: number };
  focus?: boolean; flush?: boolean; collect?: boolean; resume?: boolean; stopped?: string;
  imageUpload?: { markdown?: string; error?: string };
  toolbarLayout?: import('./core/toolbar').ToolbarLayout;
  toolbarError?: string;
  cleanupReminder?: boolean;
}
export interface KernelTransport { post<T>(path: string, body?: unknown): Promise<T> }
export interface DraftStore {
  write(draft: Draft): Promise<void>; remove(id: string): Promise<void>; list(): Promise<Draft[]>;
  backup?(draft: Draft): Promise<void>;
  readBackup?(id: string): Promise<Draft | undefined>;
  removeBackup?(id: string): Promise<void>;
  assertWritable?(note: NoteRecord): Promise<void>;
}
