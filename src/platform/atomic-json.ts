import type * as Fs from 'node:fs/promises';

/** Replace a JSON file only after its complete contents reach disk. */
export async function writeAtomicJson(fs: typeof Fs, file: string, value: unknown): Promise<void> {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx');
  try {
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temp, file);
  } catch (error) {
    // This also runs when writing, syncing, or closing the handle fails.
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}
