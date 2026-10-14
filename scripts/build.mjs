import { build } from 'vite';
import { readdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { zipSync } from 'fflate';
import { createTrayIcon } from './create-tray-icon.mjs';

await build();
await createTrayIcon('dist');
await build({ configFile: false, publicDir: false, build: {
  outDir: 'dist', emptyOutDir: false, target: 'es2022',
  lib: { entry: resolve('src/platform/tray-lifetime.ts'), formats: ['cjs'], fileName: () => 'tray-lifetime.cjs' },
}});
await build({ configFile: false, publicDir: false, build: {
  outDir: 'dist', emptyOutDir: false, target: 'es2022',
  lib: { entry: resolve('src/window/main.ts'), formats: ['iife'], name: 'QuickNotesWindow', fileName: () => 'window.js' },
  rollupOptions: { output: { assetFileNames: 'window.[ext]' } },
}});
for (const name of ['plugin.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'window.html', 'icon.png', 'preview.png']) {
  await copyFile(name, `dist/${name}`);
}
for (const dir of ['i18n', 'docs']) {
  await cp(dir, `dist/${dir}`, { recursive: true });
}
const files = {};
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) await collect(path);
    else files[relative(resolve('dist'), path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
}
await collect('dist');
for (const required of ['index.js', 'index.css', 'plugin.json', 'window.js', 'window.css', 'window.html', 'README.md', 'tray.ico', 'tray-lifetime.cjs']) {
  if (!files[required]) throw new Error(`Missing package file: ${required}`);
}
if (Object.keys(files).some(p => p.includes('..') || p.includes('node_modules'))) throw new Error('Unsafe archive entry');
await writeFile('package.zip', zipSync(files));
console.log(`package.zip: ${Object.keys(files).length} files`);
