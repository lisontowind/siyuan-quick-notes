// Real localized pages with offline sample data; never connects to SiYuan.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { documentationCards } from './docs-en.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DOCS_PLAYWRIGHT || 'playwright');
const sharp = process.env.DOCS_SHARP ? require(process.env.DOCS_SHARP) : undefined;
const english = process.argv.includes('--lang=en');
const output = english ? 'docs/images/en' : 'docs/images';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.DOCS_CHROMIUM || chromium.executablePath() });
try {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('http://localhost:49781/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    if (!['/dist/window.html', '/dist/window.js', '/dist/window.css', '/dist/recent.html', '/dist/recent.js', '/dist/recent.css', '/assets/example.png'].includes(pathname)) return route.abort();
    const file = pathname === '/assets/example.png' ? 'icon.png' : pathname.slice(1);
    const contentType = pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'image/png';
    await route.fulfill({ body: await readFile(file), contentType });
  });
  // Sample records are explicit and deterministic. All application controls,
  // including settings, lists, dialogs and formatting, come from dist/.
  await page.addInitScript(({ english }) => {
    if (window.top === window) return;
    const tr = (zh, en) => english ? en : zh;
    const session = new URLSearchParams(location.search).get('session');
    const time = Date.parse('2026-10-20T09:30:00+08:00');
    const items = [
      { title: tr('值得留下的想法', 'An idea worth keeping'), bodySummary: tr('先记下来，再慢慢整理。', 'Write it down. Organize it later.'), siyuanSaved: false, draft: true, open: true, calloutType: 'NOTE' },
      { title: tr('今天的待办', 'Today’s tasks'), bodySummary: tr('整理资料，完成本周计划。', 'Review references and plan the week.'), siyuanSaved: true, draft: false, open: false, calloutType: 'TIP' },
      { title: tr('上月项目摘录', 'Last month’s excerpts'), bodySummary: tr('已整理的资料，准备归档。', 'Reviewed references, ready to archive.'), siyuanSaved: true, draft: false, open: false, calloutType: 'IMPORTANT' },
    ].map((value, index) => ({ ...value, summary: value.title, id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, path: value.siyuanSaved ? '/Quick Notes/2026-10-20' : '', updatedAt: time - index * 3600000 }));
    const cleanup = { total: 3, unsaved: 1, eligible: 1, reminderActive: false, items: items.map((value, index) => ({ ...value, version: value.id, unsaved: !value.siyuanSaved, busy: false, eligible: index === 2, removed: false, updatedAt: index === 2 ? time - 40 * 86400000 : value.updatedAt })) };
    const settings = { trayEnabled: true, trayClickAction: 'new', shortcutBehavior: 'new', width: 320, height: 320, alwaysOnTop: false, rememberPosition: true, restoreWindows: false, notebook: 'daily', directory: '/Quick Notes/{{now | date "2006-01-02"}}', debounceMs: 800, showSaved: true, maxWindows: 10, historyLimit: 50, cleanupReminder: true, cleanupThreshold: 100, archiveDays: 30 };
    const image = session === 'docs-02-images';
    const caption = image ? tr('设计参考', 'Image reference') : tr('值得留下的想法', 'An idea worth keeping');
    const text = image ? tr('## 设计参考\n\n截图后按 Ctrl + V。\n\n![参考图片](assets/example.png)', '## Design reference\n\nPaste a screenshot with Ctrl + V.\n\n![Reference](assets/example.png)') : tr('## 留住这一刻的想法\n\n**先记下来，再慢慢整理。**\n\n- [x] 写下一条速记\n- [ ] 准备好后保存到思源\n\n> 给灵感留一张小便签。', '## Capture the idea\n\n**Keep the important part.** Organize it later.\n\n- [x] Write a quick note\n- [ ] Save to SiYuan when ready\n\n> A space for a passing thought.');
    window.BroadcastChannel = class {
      constructor(name) { this.name = name; }
      postMessage(request) {
        setTimeout(() => {
          const response = this.name.includes(':recent:') ? {
            session, windowId: 'recent', requestId: request.requestId, pinned: false, dark: false,
            ...(['ready', 'refresh'].includes(request.action) ? { items, cleanup } : {}),
            ...(request.action === 'cleanup' ? { cleanup } : {}),
            ...(request.action === 'settings' ? { settingsData: { settings, notebooks: [{ id: 'daily', name: tr('日常笔记', 'Daily notes') }], platform: 'windows', shortcut: 'Ctrl + Alt + N' } } : {}),
            ...(request.action === 'preview-settings' ? { preview: { notebook: 'daily', path: '/Quick Notes/2026-10-20' } } : {}),
            ...(request.action === 'draft-versions' ? { draftVersions: { token: '00000000-0000-0000-0000-000000000010', removed: false, versions: [{ version: '00000000-0000-0000-0000-000000000011', device: 'laptop-a1b2', summary: tr('旅途中的灵感', 'An idea from the road'), text: tr('## 旅途中的灵感\n\n- 记下沿途看到的风景\n- 回家后整理成游记\n\n这是另一台设备的草稿，复制后可继续编辑。', '## An idea from the road\n\n- Capture scenery along the way\n- Turn these notes into a travel journal\n\nA draft from another device. Copy it to continue editing.'), updatedAt: time }] } } : {}),
          } : {
            session, windowId: 'sample', requestId: request.requestId,
            ...(request.action === 'ready' ? { state: { revision: 1, savedRevision: image ? 1 : 0, localRevision: 1, siyuanSaved: image, docId: image ? '20261020093000-aaaaaaa' : undefined, docTitle: image ? '2026-10-20' : '', caption, calloutType: 'NOTE', phase: image ? 'saved' : 'local', pinned: true, dark: false, showSaved: true }, content: { text, caption, calloutType: 'NOTE', revision: 1 } } : { heartbeat: { revision: 1, localRevision: 1 } }),
          };
          this.onmessage?.({ data: response });
        }, 0);
      }
      close() {}
    };
  }, { english });
  for (const card of documentationCards(english)) {
    const session = `docs-${card.name}`;
    const channel = card.page ? `siyuan-quick-notes:recent:${session}` : `siyuan-quick-notes:${session}`;
    const url = `http://localhost:49781/dist/${card.page ? 'recent' : 'window'}.html?session=${session}&windowId=sample&channel=${channel}&lang=${english ? 'en-US' : 'zh-CN'}`;
    const copy = card.items.map(([title, body], index) => `<div class="item"><span>${index + 1}</span><div><h2>${title}</h2><p>${body}</p></div></div>`).join('');
    await page.route('http://localhost:49781/card', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${english ? 'en' : 'zh-CN'}"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#eff3ee;color:#243e37;font-family:'Segoe UI','Microsoft YaHei',sans-serif}.sheet{width:1200px;height:760px;padding:36px 44px;overflow:hidden}.eyebrow{font-size:12px;letter-spacing:2px;color:#537c70}h1{font-size:32px;margin:13px 0 10px;font-weight:650}.intro{font-size:16px;color:#607369;margin:0}iframe{position:absolute;left:44px;top:155px;width:540px;height:510px;border:1px solid #cbd8ce;border-radius:10px;box-shadow:0 14px 32px #1e483720;background:#faf9f5}.copy{position:absolute;left:630px;top:165px;width:526px}.item{display:flex;gap:14px;margin-bottom:38px}.item>span{flex:none;display:grid;place-items:center;border-radius:50%;background:#2c6d59;color:white;width:29px;height:29px;font-size:15px}h2{font-size:20px;margin:1px 0 10px}p{font-size:16px;color:#5d6f64;line-height:1.85;margin:0}.foot{position:absolute;left:44px;right:44px;bottom:24px;border-top:1px solid #ccdace;padding-top:15px;color:#6b7e71;font-size:12px;line-height:1.7}
      </style><div class="sheet"><div class="eyebrow">${english ? 'QUICK NOTES / 0.1.28 ILLUSTRATED GUIDE' : '悬浮速记 / 0.1.28 功能图解'}</div><h1>${card.title}</h1><p class="intro">${card.intro}</p><iframe src="${url}"></iframe><div class="copy">${copy}</div><div class="foot">${english ? 'Actual interface from the current build; offline sample content and states. Image example uses the plugin icon.' : '界面来自当前版本真实构建，正文、记录和状态均为离线演示数据；图片示例使用插件图标。'}<br>SiYuan Desktop 3.8.6+ · Windows / macOS / Linux · ${english ? 'Keep SiYuan running. Use Command shortcuts on macOS.' : '使用时保持思源运行；macOS 使用 Command 快捷键。'}</div></div></html>` }));
    await page.goto('http://localhost:49781/card');
    const frame = page.frameLocator('iframe');
    if (!card.page) {
      await frame.locator('.cm-content').waitFor();
      await frame.locator('#status').filter({ hasText: card.name === '02-images' ? (english ? 'Saved to SiYuan' : '已保存到思源') : (english ? 'Saved in plugin' : '已保存到插件') }).waitFor();
      if (card.name === '02-images') await frame.locator('.qn-image-preview img').evaluate(img => img.decode());
      else await frame.locator('#toolbar-toggle').click();
    } else {
      await frame.locator('.recent-row').first().waitFor();
      if (card.page === 'settings') {
        await frame.locator('#settings').click(); await frame.locator('#setting-directory').waitFor();
        await frame.getByRole('button', { name: english ? 'Preview save location' : '预览保存位置', exact: true }).click();
        await frame.locator('.settings-preview-output').filter({ hasText: '/Quick Notes/2026-10-20' }).waitFor();
      }
      if (['cleanup', 'devices'].includes(card.page)) {
        await frame.locator('#more').click(); await frame.locator(card.page === 'cleanup' ? '#organize' : '#other-devices').click();
        await frame.locator(card.page === 'cleanup' ? '.cleanup-row' : '.draft-versions-dialog textarea').first().waitFor();
        if (card.page === 'devices') await frame.getByRole('button', { name: english ? 'Copy to this device' : '复制到本设备', exact: true }).waitFor();
      }
    }
    await page.evaluate(() => document.fonts.ready);
    await page.locator('iframe').evaluate(frame => frame.contentDocument.fonts.ready);
    assert(await page.locator('.copy').evaluate(el => el.getBoundingClientRect().bottom < 680), `Copy overflow: ${card.name}`);
    const png = await page.screenshot();
    await writeFile(`${output}/${card.name}.png`, sharp ? await sharp(png).png({ palette: true, quality: 85, dither: 0, compressionLevel: 9, effort: 10 }).toBuffer() : png);
    await page.unroute('http://localhost:49781/card');
    console.log(`Rendered ${output}/${card.name}.png`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
