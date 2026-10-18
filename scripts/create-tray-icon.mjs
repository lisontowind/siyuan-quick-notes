import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

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
  await writeFile(join(directory, 'tray.png'), frames[1]);
  await writeFile(join(directory, 'trayTemplate.png'), templatePng(16));
  await writeFile(join(directory, 'trayTemplate@2x.png'), templatePng(32));
}

// A small folded-note outline, drawn from line segments. Keep the macOS template
// black with transparent surroundings so the OS can tint it in either theme.
function templatePng(size) {
  const segments = [[3, 1.5, 10, 1.5], [10, 1.5, 13, 4.5], [13, 4.5, 13, 14],
    [13, 14, 3, 14], [3, 14, 3, 1.5], [10, 1.5, 10, 4.5], [10, 4.5, 13, 4.5],
    [5.5, 7.5, 10.5, 7.5], [5.5, 10.5, 9.5, 10.5]];
  const distance = (x, y, [ax, ay, bx, by]) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
  };
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let covered = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      if (segments.some(line => distance((x + (sx + 0.5) / 4) * 16 / size, (y + (sy + 0.5) / 4) * 16 / size, line) <= 0.6)) covered++;
    }
    pixels[y * (size * 4 + 1) + 1 + x * 4 + 3] = Math.round(255 * covered / 16);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const density = Buffer.alloc(9); density.writeUInt32BE(size === 16 ? 2835 : 5670); density.writeUInt32BE(size === 16 ? 2835 : 5670, 4); density[8] = 1;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('pHYs', density), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}
