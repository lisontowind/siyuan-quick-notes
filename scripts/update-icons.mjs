// Explicit maintenance command; builds use the checked-in, offline SVG subset.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const names = ['bold', 'italic', 'underline', 'strikethrough', 'heading', 'list', 'list-ordered', 'list-todo', 'quote', 'code', 'link', 'image', 'plus', 'arrow-up-right', 'pin', 'ellipsis', 'minus', 'x', 'arrow-left', 'settings', 'keyboard', 'code-xml', 'chevron-left', 'chevron-right', 'grip-vertical'];
const entries = await Promise.all(names.map(async name => {
  if (process.argv[2]) {
    const svg = execFileSync('tar', ['-xOf', process.argv[2], `package/icons/${name}.svg`], { encoding: 'utf8' });
    return [name, /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(svg)[1].trim()];
  }
  const response = await fetch(`https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/icons/${name}.svg`);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const svg = await response.text();
  return [name, /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(svg)[1].trim()];
}));
const source = `// Lucide 0.468.0; ISC and Feather MIT notices in THIRD_PARTY_NOTICES.md.\nconst paths: Record<string, string> = ${JSON.stringify(Object.fromEntries(entries), null, 2)};\nexport function icon(name: string): SVGSVGElement {\n  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');\n  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');\n  svg.innerHTML = paths[name] ?? paths['ellipsis'];\n  return svg;\n}\nexport function windowIcons(): void {\n  const names: Record<string, string> = { new: 'plus', open: 'arrow-up-right', pin: 'pin', more: 'ellipsis', minimize: 'minus', close: 'x', back: 'arrow-left', settings: 'settings', 'render-mode': 'code-xml', 'toolbar-toggle': 'keyboard' };\n  for (const [id, name] of Object.entries(names)) document.getElementById(id)?.replaceChildren(icon(name));\n}\n`;
await writeFile(new URL('../src/window/icons.ts', import.meta.url), source);
if (process.argv[2]) {
  const license = execFileSync('tar', ['-xOf', process.argv[2], 'package/LICENSE'], { encoding: 'utf8' });
  const notices = new URL('../THIRD_PARTY_NOTICES.md', import.meta.url);
  const original = await readFile(notices, 'utf8');
  if (!original.includes('## Lucide 0.468.0')) await writeFile(notices, `${original}\n## Lucide 0.468.0\n\nSVG subset from https://github.com/lucide-icons/lucide/tree/0.468.0/icons\n\n${license}\n`);
}
