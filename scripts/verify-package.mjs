import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

const archive = await readFile('package.zip');
const files = unzipSync(archive);
const manifest = JSON.parse(strFromU8(files['plugin.json']));
assert.equal(manifest.name, 'siyuan-quick-notes');
assert.deepEqual(manifest.backends, ['windows']);
assert.deepEqual(manifest.frontends, ['desktop']);
assert.equal(manifest.url, `https://github.com/lisontowind/${manifest.name}`);
assert.equal(manifest.version, JSON.parse(await readFile('package.json', 'utf8')).version);
for (const [field, maxBytes] of [['icon', 64 * 1024], ['preview', 512 * 1024]]) {
  const name = manifest[field];
  assert.equal(name, `${field}.png`);
  assert(files[name]?.length && files[name].length <= maxBytes, `${name} exceeds marketplace image size limit`);
}
for (const file of ['index.js', 'index.css', 'window.js', 'window.css', 'window.html', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/testing.md', 'docs/feasibility.md', 'docs/development.md', 'icon.png', 'preview.png', 'tray.ico', 'tray-lifetime.cjs']) {
  assert(files[file]?.length, `Missing ${file}`);
  assert.deepEqual(Buffer.from(files[file]), await readFile(`dist/${file}`), `Archive differs from dist: ${file}`);
}
// README images must remain available when the plugin is installed from the ZIP.
const readme = strFromU8(files['README.md']);
for (const match of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  const name = match[1];
  if (/^https?:\/\//.test(name)) continue;
  assert(files[name]?.length, `Missing README image: ${name}`);
  assert.deepEqual(Buffer.from(files[name]), await readFile(name), `README image differs from source: ${name}`);
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
new Script(strFromU8(files['tray-lifetime.cjs']));
assert.match(strFromU8(files['index.js']), /require\(["']siyuan["']\)/);
assert.match(strFromU8(files['index.js']), /module\.exports\s*=/);
assert(!/\brequire\(/.test(strFromU8(files['window.js'])), 'Window bundle must not require Node modules');
const html = strFromU8(files['window.html']);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /src="window\.js"/);
assert.match(html, /href="window\.css"/);
console.log(JSON.stringify({ files: Object.keys(files).sort(), bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), result: 'PASS' }, null, 2));
