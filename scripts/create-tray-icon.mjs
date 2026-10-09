import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Embed pre-scaled branding PNGs; builds require no image library or network call.
export async function createTrayIcon(directory) {
  const sizes = [16, 32, 48];
  const frames = await Promise.all(sizes.map(size => readFile(new URL(`../assets/tray-${size}.png`, import.meta.url))));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = size; header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += frames[i].length;
  });
  await writeFile(join(directory, 'tray.ico'), Buffer.concat([header, ...frames]));
}
