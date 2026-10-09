import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { LocalDraftStore } from '../src/platform/drafts';
import { createNote, noteReference } from '../src/core/identity';

describe('device-local draft files', () => {
  it('keeps legacy geometry and validates independent note references by their owning window ID', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-state-'));
    try {
      const store = new LocalDraftStore(fs, path, directory);
      const a = { ...createNote(), docId: '20261010000000-doc0001' }, b = createNote(), c = createNote();
      const geometry = { width: 320, height: 320, pinned: false, open: true };
      await store.saveWindowState({ [a.id]: { ...geometry, note: noteReference(a) }, [b.id]: geometry,
        [c.id]: { ...geometry, note: noteReference(a) } });
      const state = await store.loadWindowState();
      expect(state[a.id].note?.blockId).toBe(a.blockId);
      expect(state[b.id]).toEqual(geometry);
      expect(state[c.id]).toEqual(geometry);
      await fs.writeFile(path.join(directory, 'windows.json'), JSON.stringify({ [a.id]: { ...geometry, note: { ...noteReference(a), target: null } } }));
      expect((await store.loadWindowState())[a.id]).toEqual(geometry);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('atomically replaces snapshots, rejects traversal, and retains corrupt files', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-test-'));
    try {
      const store = new LocalDraftStore(fs, path, directory), note = createNote();
      note.text = 'first'; note.revision = 1; await store.write({ note });
      note.text = 'second'; note.revision = 2; await store.write({ note });
      expect((await store.list())[0].note.text).toBe('second');
      expect((await fs.readdir(directory)).filter(name => name.endsWith('.tmp'))).toHaveLength(0);
      await expect(store.remove('../outside')).rejects.toThrow();
      const badId = crypto.randomUUID(); await fs.writeFile(path.join(directory, `${badId}.json`), '{broken');
      expect(await store.list()).toHaveLength(1); expect(store.warnings).toHaveLength(1);
      expect(await fs.readFile(path.join(directory, `${badId}.json`), 'utf8')).toBe('{broken');
      await fs.writeFile(path.join(directory, 'windows.json'), JSON.stringify({ [note.id]: { width: 420, height: 320, pinned: false }, invalid: { width: null, height: 0 } }));
      expect(Object.keys(await store.loadWindowState())).toEqual([note.id]);
      await store.remove(note.id); expect(await store.list()).toHaveLength(0);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
