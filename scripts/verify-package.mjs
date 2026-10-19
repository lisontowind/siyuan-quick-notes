import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { inflateSync } from 'node:zlib';

const archive = await readFile('package.zip');
const files = unzipSync(archive);
const manifest = JSON.parse(strFromU8(files['plugin.json']));
assert.equal(manifest.name, 'siyuan-quick-notes');
assert.deepEqual(manifest.backends, ['windows', 'darwin', 'linux']);
assert.deepEqual(manifest.frontends, ['desktop']);
assert.equal(manifest.url, `https://github.com/lisontowind/${manifest.name}`);
assert.equal(manifest.version, JSON.parse(await readFile('package.json', 'utf8')).version);
for (const [field, maxBytes] of [['icon', 64 * 1024], ['preview', 512 * 1024]]) {
  const name = manifest[field];
  assert.equal(name, `${field}.png`);
  assert(files[name]?.length && files[name].length <= maxBytes, `${name} exceeds marketplace image size limit`);
}
assert(files['preview.png'].length <= 128 * 1024, 'preview.png exceeds the 128 KiB package budget');
for (const file of ['index.js', 'index.css', 'window.js', 'window.css', 'window.html', 'recent.js', 'recent.css', 'recent.html', 'README.md', 'README_en_US.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/testing.md', 'docs/feasibility.md', 'docs/development.md', 'icon.png', 'preview.png', 'tray.ico', 'tray.png', 'trayTemplate.png', 'trayTemplate@2x.png', 'tray-lifetime.cjs']) {
  assert(files[file]?.length, `Missing ${file}`);
  assert.deepEqual(Buffer.from(files[file]), await readFile(`dist/${file}`), `Archive differs from dist: ${file}`);
}
assert.deepEqual(Buffer.from(files['tray.png']), await readFile('assets/tray-32.png'));
for (const [name, size, dpi] of [['trayTemplate.png', 16, 2835], ['trayTemplate@2x.png', 32, 5670]]) {
  const png = Buffer.from(files[name]);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  assert.equal(png[24], 8); assert.equal(png[25], 6);
  const data = []; let density;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const contents = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') data.push(contents);
    if (type === 'pHYs') density = contents;
    offset += length + 12;
  }
  assert.equal(density?.readUInt32BE(0), dpi); assert.equal(density?.readUInt32BE(4), dpi); assert.equal(density?.[8], 1);
  const pixels = inflateSync(Buffer.concat(data)); let transparent = false, ink = false;
  assert.equal(pixels.length, size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1); assert.equal(pixels[row], 0);
    for (let x = 0; x < size; x++) {
      const start = row + 1 + x * 4;
      assert(pixels.subarray(start, start + 3).every(value => value === 0), 'Template must be monochrome black');
      transparent ||= pixels[start + 3] === 0; ink ||= pixels[start + 3] > 0;
    }
  }
  assert(transparent && ink, 'Template must have transparent background and visible strokes');
}
// Both guides use public HTTPS images; documentation images must stay out.
assert.equal(manifest.readme.default, 'README_en_US.md');
assert.equal(manifest.readme['zh-CN'], 'README.md');
assert(!Object.keys(files).some(name => name.startsWith('docs/images/')), 'Documentation images must not be bundled');
for (const readmeFile of ['README.md', 'README_en_US.md']) {
  const readme = strFromU8(files[readmeFile]);
  for (const match of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const name = match[1];
    if (/^https:\/\//.test(name)) {
      if (name.includes('/docs/images/')) {
        assert.match(name, /^https:\/\/raw\.githubusercontent\.com\/lisontowind\/siyuan-quick-notes\/[a-f0-9]{40}\/docs\/images\/(?:en\/)?[\w-]+\.png$/, 'Documentation images must use immutable repository URLs');
        const path = new URL(name).pathname.split('/').slice(4).join('/');
        assert((await readFile(path)).length, `Missing source image: ${path}`);
      }
      continue;
    }
    assert(!name.startsWith('docs/images/'), `README documentation image must use a public HTTPS URL: ${name}`);
    assert(files[name]?.length, `Missing README image: ${name}`);
    assert.deepEqual(Buffer.from(files[name]), await readFile(name), `README image differs from source: ${name}`);
  }
}
const icon = Buffer.from(files['tray.ico']);
assert.equal(icon.readUInt16LE(2), 1); assert.equal(icon.readUInt16LE(4), 3);
for (let i = 0; i < 3; i++) {
  const entry = 6 + i * 16, length = icon.readUInt32LE(entry + 8), offset = icon.readUInt32LE(entry + 12);
  assert(offset >= 54 && offset + length <= icon.length, 'Invalid ICO frame');
  assert.deepEqual(icon.subarray(offset, offset + 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}
for (const file of Object.keys(files)) assert(!file.startsWith('/') && !file.includes('..') && !file.includes('node_modules'), `Unsafe entry: ${file}`);
new Script(strFromU8(files['index.js']));
new Script(strFromU8(files['window.js']));
new Script(strFromU8(files['recent.js']));
new Script(strFromU8(files['tray-lifetime.cjs']));
assert.match(strFromU8(files['index.js']), /require\(["']siyuan["']\)/);
assert.match(strFromU8(files['index.js']), /module\.exports\s*=/);
assert(!/\brequire\(/.test(strFromU8(files['window.js'])), 'Window bundle must not require Node modules');
assert(!/\brequire\(/.test(strFromU8(files['recent.js'])), 'Recent bundle must not require Node modules');
const recentHtml = strFromU8(files['recent.html']);
assert.match(recentHtml, /Content-Security-Policy/); assert.match(recentHtml, /src="recent\.js"/); assert.match(recentHtml, /href="recent\.css"/);
const html = strFromU8(files['window.html']);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /src="window\.js"/);
assert.match(html, /href="window\.css"/);
console.log(JSON.stringify({ files: Object.keys(files).sort(), bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), result: 'PASS' }, null, 2));
