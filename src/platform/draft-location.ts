import type * as Fs from 'node:fs/promises';
import type * as Path from 'node:path';
import type * as Crypto from 'node:crypto';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const migrationFile = '.legacy-migration-v1';

/** This identity stays outside the workspace: syncing a workspace must not
 * make another computer adopt this computer's drafts or window positions. */
export async function loadDeviceId(fs: typeof Fs, path: typeof Path, crypto: typeof Crypto, home: string): Promise<string> {
  if (!home || !path.isAbsolute(home)) throw new Error('无法定位本机设备标识目录');
  const directory = path.join(home, '.siyuan');
  const file = path.join(directory, 'quick-notes-device-id');
  await fs.mkdir(directory, { recursive: true });
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Another workspace may still be writing the newly created identity.
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = (await fs.readFile(file, 'utf8')).trim();
      if (uuid.test(id)) return id;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('本机设备标识无法读取，请保留 quick-notes-device-id 文件并重试');
  }
  const id = crypto.randomUUID();
  try { await handle.writeFile(id + '\n', 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  return id;
}

/** Copy once, keeping legacy originals and any existing destination files.
 * The completion marker prevents old backups from resurrecting deleted drafts. */
export async function migrateLegacyDrafts(fs: typeof Fs, path: typeof Path, crypto: typeof Crypto,
  directory: string, legacyDirectory?: string): Promise<void> {
  const marker = path.join(directory, migrationFile);
  try {
    if (await fs.readFile(marker, 'utf8') !== 'complete\n') throw new Error('草稿迁移记录损坏，请保留草稿目录并重试');
    return;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let names: string[] = [];
  if (legacyDirectory) {
    try { names = await fs.readdir(legacyDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await fs.mkdir(directory, { recursive: true });
  for (const name of names.filter(name => name === 'windows.json' || (name.endsWith('.json') && uuid.test(name.slice(0, -5))))) {
    const destination = path.join(directory, name);
    try { await fs.stat(destination); continue; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const source = await fs.readFile(path.join(legacyDirectory!, name));
    await writeVerified(fs, crypto, destination, source);
  }
  await writeVerified(fs, crypto, marker, Buffer.from('complete\n'));
}

async function writeVerified(fs: typeof Fs, crypto: typeof Crypto, file: string, contents: Buffer): Promise<void> {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    if (!(await fs.readFile(temp)).equals(contents)) throw new Error('草稿迁移校验失败，旧草稿已保留');
    await fs.rename(temp, file);
    if (!(await fs.readFile(file)).equals(contents)) throw new Error('草稿迁移校验失败，旧草稿已保留');
  } finally { await fs.unlink(temp).catch(() => {}); }
}
