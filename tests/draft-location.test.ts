import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { loadDeviceId, migrateLegacyDrafts } from '../src/platform/draft-location';
import { LocalDraftStore } from '../src/platform/drafts';
import { createNote, noteReference } from '../src/core/identity';

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-location-'));
  try { await run(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

describe('workspace draft storage and device ownership', () => {
  it('reuses a local identity across concurrent workspace loads and restarts', () => temporary(async directory => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => loadDeviceId(fs, path, crypto, directory)));
    expect(new Set(ids).size).toBe(1);
    expect(await loadDeviceId(fs, path, crypto, directory)).toBe(ids[0]);
  }));

  it('keeps drafts and window state separate when two devices share plugin data', () => temporary(async directory => {
    const a = await loadDeviceId(fs, path, crypto, path.join(directory, 'home-a'));
    const b = await loadDeviceId(fs, path, crypto, path.join(directory, 'home-b'));
    expect(a).not.toBe(b);
    const shared = path.join(directory, 'workspace', 'data', 'storage', 'petal', 'siyuan-quick-notes', 'drafts');
    const first = new LocalDraftStore(fs, path, path.join(shared, a));
    const second = new LocalDraftStore(fs, path, path.join(shared, b));
    const note = createNote(); note.text = 'only on device A'; note.revision = 1;
    await first.write({ note });
    await first.saveWindowState({ [note.id]: { width: 320, height: 240, x: 900, pinned: true, open: true } });
    expect(await second.list()).toEqual([]); expect(await second.loadWindowState()).toEqual({});
    await second.remove(note.id);
    expect((await first.list())[0].note.text).toBe(note.text);
    expect((await first.loadWindowState())[note.id].x).toBe(900);
  }));

  it('refuses to replace a damaged identity or use a relative home directory', () => temporary(async directory => {
    await loadDeviceId(fs, path, crypto, directory);
    const file = path.join(directory, '.siyuan', 'quick-notes-device-id');
    await fs.writeFile(file, 'damaged');
    await expect(loadDeviceId(fs, path, crypto, directory)).rejects.toThrow('本机设备标识');
    expect(await fs.readFile(file, 'utf8')).toBe('damaged');
    await expect(loadDeviceId(fs, path, crypto, 'relative')).rejects.toThrow('目录');
  }));

  it('copies and verifies legacy drafts, window references, and corrupt originals without deleting them', () => temporary(async directory => {
    const legacyDirectory = path.join(directory, 'legacy'), destination = path.join(directory, 'new');
    const legacy = new LocalDraftStore(fs, path, legacyDirectory), note = createNote();
    note.text = '旧草稿'; note.revision = 1;
    await legacy.write({ note });
    await legacy.saveWindowState({ [note.id]: { width: 320, height: 240, pinned: true, open: true, note: noteReference(note) } });
    const brokenName = crypto.randomUUID() + '.json';
    await fs.writeFile(path.join(legacyDirectory, brokenName), '{broken');
    await fs.writeFile(path.join(legacyDirectory, 'unrelated.json'), 'do not import');
    await fs.writeFile(path.join(legacyDirectory, note.id + '.json.partial.tmp'), 'incomplete');
    await migrateLegacyDrafts(fs, path, crypto, destination, legacyDirectory);
    const current = new LocalDraftStore(fs, path, destination);
    expect((await current.list())[0].note.text).toBe('旧草稿'); expect(current.warnings).toHaveLength(1);
    expect(await current.loadWindowState()).toEqual(await legacy.loadWindowState());
    for (const name of [note.id + '.json', 'windows.json', brokenName]) {
      expect(await fs.readFile(path.join(destination, name))).toEqual(await fs.readFile(path.join(legacyDirectory, name)));
    }
    expect(await fs.readdir(destination)).not.toContain('unrelated.json');
    expect((await fs.readdir(destination)).some(name => name.endsWith('.tmp'))).toBe(false);
    await current.remove(note.id);
    await migrateLegacyDrafts(fs, path, crypto, destination, legacyDirectory);
    expect(await current.list()).toEqual([]); // The retained backup must not reappear.
  }));

  it('keeps newer destination data when retrying a migration', () => temporary(async directory => {
    const legacyDirectory = path.join(directory, 'legacy'), destination = path.join(directory, 'new');
    const legacy = new LocalDraftStore(fs, path, legacyDirectory), current = new LocalDraftStore(fs, path, destination);
    const note = createNote(); note.text = 'old'; note.revision = 1; await legacy.write({ note });
    note.text = 'new'; note.revision = 2; await current.write({ note });
    await migrateLegacyDrafts(fs, path, crypto, destination, legacyDirectory);
    expect((await current.list())[0].note.text).toBe('new');
  }));

  it('retains the source and retries after a failed copy without marking migration complete', () => temporary(async directory => {
    const legacyDirectory = path.join(directory, 'legacy'), destination = path.join(directory, 'new');
    const legacy = new LocalDraftStore(fs, path, legacyDirectory), note = createNote();
    note.text = 'must survive'; note.revision = 1; await legacy.write({ note });
    const failing = { ...fs, rename: async () => { throw new Error('disk failure'); } } as typeof fs;
    await expect(migrateLegacyDrafts(failing, path, crypto, destination, legacyDirectory)).rejects.toThrow('disk failure');
    expect(await fs.readdir(destination)).toEqual([]);
    expect((await legacy.list())[0].note.text).toBe('must survive');
    await migrateLegacyDrafts(fs, path, crypto, destination, legacyDirectory);
    expect((await new LocalDraftStore(fs, path, destination).list())[0].note.text).toBe('must survive');
  }));

  it('initializes without a Windows legacy directory and rejects unreadable migration state', () => temporary(async directory => {
    const destination = path.join(directory, 'new');
    await migrateLegacyDrafts(fs, path, crypto, destination);
    await fs.writeFile(path.join(destination, '.legacy-migration-v1'), 'damaged');
    await expect(migrateLegacyDrafts(fs, path, crypto, destination)).rejects.toThrow('迁移记录损坏');
  }));
});
