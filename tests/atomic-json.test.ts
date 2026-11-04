import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { writeAtomicJson } from '../src/platform/atomic-json';

describe('durable JSON replacement', () => {
  it.each(['write', 'sync', 'close', 'rename'])('preserves the confirmed file and removes temporary data after %s fails', async stage => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'sqn-atomic-'));
    const file = path.join(directory, 'confirmed.json');
    try {
      await writeAtomicJson(fs, file, { text: 'confirmed' });
      const failure = new Error(`failed ${stage}`);
      const faulty = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        return {
          writeFile: async (...values: Parameters<typeof handle.writeFile>) => {
            if (stage === 'write') { await handle.writeFile('partial'); throw failure; }
            return handle.writeFile(...values);
          },
          sync: async () => { if (stage === 'sync') throw failure; await handle.sync(); },
          close: async () => { await handle.close(); if (stage === 'close') throw failure; },
        };
      }, rename: async (...args: Parameters<typeof fs.rename>) => {
        if (stage === 'rename') throw failure;
        return fs.rename(...args);
      } } as unknown as typeof fs;
      await expect(writeAtomicJson(faulty, file, { text: 'replacement' })).rejects.toBe(failure);
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ text: 'confirmed' });
      expect(await fs.readdir(directory)).toEqual(['confirmed.json']);
      await writeAtomicJson(fs, file, { text: 'retry' });
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ text: 'retry' });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
