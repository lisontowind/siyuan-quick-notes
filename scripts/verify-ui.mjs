// Isolated browser acceptance checks against built pages. No SiYuan workspace is connected.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DOCS_PLAYWRIGHT || 'playwright');
const output = resolve('artifacts/ui'); await mkdir(output, { recursive: true });
const allowed = new Map(['window.html', 'window.js', 'window.css', 'recent.html', 'recent.js', 'recent.css'].map(name => [`/plugins/siyuan-quick-notes/${name}`, `dist/${name}`]));
allowed.set('/assets/example.png', 'icon.png');
const server = createServer(async (request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  const file = allowed.get(new URL(request.url, 'http://localhost').pathname);
  if (!file) { response.writeHead(404).end(); return; }
  try { response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/png'); response.end(await readFile(file)); }
  catch { response.writeHead(500).end(); }
});
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.DOCS_CHROMIUM || chromium.executablePath() });
const errors = [];
const sample = '# 即时渲染\n\n**粗体** *斜体* ~~删除线~~ `code` [链接](https://example.com)\n\n> 引用文字\n\n- 普通列表\n- [ ] 待办事项\n\n| 项目 | 状态 |\n| --- | --- |\n| 表格 | 支持 |\n\n```js\nconst value = "**源码**";\n```\n\n![示例](assets/example.png)\n\n编辑这里';
const noteState = { revision: 1, savedRevision: 1, localRevision: 1, docId: '20261010000000-aaaaaaa', title: '', docTitle: '2026-10-19', phase: 'saved', pinned: false, dark: false, showSaved: true };
let page;
try {
  page = await browser.newPage({ viewport: { width: 500, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(({ sample, noteState }) => {
    window.__requests = []; window.__state = noteState;
    window.__layout = JSON.parse(localStorage.getItem('toolbar-test') || 'null') || { order: ['bold', 'italic', 'underline', 'strike', 'heading', 'unordered', 'ordered', 'task', 'quote', 'code', 'link', 'image'] };
    window.__failToolbar = false;
    window.BroadcastChannel = class {
      constructor(name) { this.name = name; window.__channel = this; }
      send(extra) { this.onmessage?.({ data: { session: 'ui', windowId: this.name.includes(':recent:') ? 'recent' : 'sample', ...extra } }); }
      postMessage(request) {
        window.__requests.push(request);
        setTimeout(() => {
          if (this.name.includes(':recent:')) {
            const items = Array.from({ length: 30 }, (_, index) => ({ id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, summary: `测试速记 ${index} <script>`, path: '/速记/2026-10-19', updatedAt: Date.now() - index * 1000, draft: index % 2 === 0, open: index === 0 }));
            this.send({ requestId: request.requestId, ...(['ready', 'refresh'].includes(request.action) ? { items } : {}), pinned: request.action === 'pin', dark: false }); return;
          }
          if (request.action === 'ready') this.send({ state: window.__state, content: { text: sample, revision: 1, caption: window.__state.caption, calloutType: window.__state.calloutType }, toolbarLayout: window.__layout });
          else if (request.action === 'open') {
            if (window.__state.siyuanSaved === false) window.__state = { ...window.__state, docId: '20261010000000-aaaaaaa', siyuanSaved: true, phase: 'saved', savedRevision: window.__state.revision };
            else window.__openedSiYuan = (window.__openedSiYuan || 0) + 1;
            this.send({ requestId: request.requestId, state: window.__state });
          }
          else if (request.action === 'save-toolbar') {
            if (!window.__failToolbar) { window.__layout = request.toolbarLayout; localStorage.setItem('toolbar-test', JSON.stringify(window.__layout)); }
            this.send({ requestId: request.requestId, toolbarLayout: window.__layout, ...(window.__failToolbar ? { toolbarError: 'disk locked' } : {}) });
          }
          else if (request.action === 'upload-images') this.send({ requestId: request.requestId, imageUpload: { markdown: '![uploaded](assets/example.png)' } });
          else if (request.action === 'edit') { window.__state = { ...window.__state, revision: request.revision, caption: request.caption, calloutType: request.calloutType, savedRevision: request.revision, localRevision: request.revision }; this.send({ state: window.__state }); }
          else this.send({ requestId: request.requestId, heartbeat: { revision: window.__state.revision, localRevision: window.__state.localRevision } });
        }, 0);
      }
      close() {}
    };
  }, { sample, noteState });
  await page.goto(`${origin}/plugins/siyuan-quick-notes/window.html?session=ui&windowId=sample&channel=siyuan-quick-notes:ui`);
  await page.locator('.cm-content').waitFor();
  await page.waitForFunction(() => document.getElementById('title-display').textContent === '2026-10-19');
  await page.waitForFunction(() => { const image = document.querySelector('.qn-image-preview img'); return image?.complete && image.naturalWidth > 0 && !document.querySelector('.qn-image-preview').textContent.includes('图片加载中'); });
  async function checkFooterButtonStates(theme) {
    const ids = ['render-mode', 'toolbar-toggle', 'callout-type'];
    const states = [], original = {};
    for (const id of ids) {
      const button = page.locator('#' + id), attribute = id === 'render-mode' ? 'aria-pressed' : 'aria-expanded';
      original[id] = await button.getAttribute(attribute) === 'true';
      if (original[id]) await button.click();
      await button.click();
      assert.equal(await button.getAttribute(attribute), 'true');
      states.push(await button.evaluate(element => { const s = getComputedStyle(element); return { color: s.color, background: s.backgroundColor, outline: s.outlineStyle, radius: s.borderRadius, border: s.borderWidth }; }));
    }
    assert.deepEqual(states[1], states[0]); assert.deepEqual(states[2], states[0]);
    assert.equal(states[0].outline, 'none');
    await page.screenshot({ path: resolve(output, 'note-footer-active-' + theme + '.png') });
    await page.keyboard.press('Escape');
    const focusStyles = [];
    for (const id of ids) {
      await page.locator('#' + id).focus();
      focusStyles.push(await page.locator('#' + id).evaluate(element => { const s = getComputedStyle(element); return [s.outlineStyle, s.outlineWidth, s.outlineColor]; }));
    }
    assert.deepEqual(focusStyles[1], focusStyles[0]); assert.deepEqual(focusStyles[2], focusStyles[0]);
    assert.equal(focusStyles[0][0], 'solid'); assert.equal(focusStyles[0][1], '2px');
    for (const id of ids) {
      const attribute = id === 'render-mode' ? 'aria-pressed' : 'aria-expanded', button = page.locator('#' + id);
      if ((await button.getAttribute(attribute) === 'true') !== original[id]) await button.click();
    }
    await page.locator('.cm-content').focus();
  }
  await checkFooterButtonStates('light');
  async function checkNoteActionPlacement() {
    assert.equal(await page.locator('header #new, header #open').count(), 0);
    assert.equal(await page.locator('#footer #new, #footer #open').count(), 2);
    const layout = await page.evaluate(() => {
      const footer = document.getElementById('footer').getBoundingClientRect(), status = document.getElementById('status').getBoundingClientRect();
      return { footer: { top: footer.top, bottom: footer.bottom }, statusRight: status.right, width: innerWidth, height: innerHeight,
        buttons: [...document.querySelectorAll('.footer-actions button')].map(button => { const r = button.getBoundingClientRect(); return { id: button.id, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }) };
    });
    assert.deepEqual(layout.buttons.map(button => button.id), ['render-mode', 'toolbar-toggle', 'callout-type', 'new', 'open']);
    assert.equal(new Set(layout.buttons.map(button => button.top)).size, 1);
    assert(layout.statusRight <= layout.buttons[0].left);
    for (const button of layout.buttons) assert(button.left >= 0 && button.right <= layout.width && button.top >= layout.footer.top && button.bottom <= layout.footer.bottom && button.bottom <= layout.height);
  }
  await checkNoteActionPlacement();
  await page.locator('#footer #new').click();
  assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'new').length), 1);
  const titleBody = await page.locator('.cm-content').innerText();
  const calloutColors = [];
  assert.equal(await page.evaluate(() => document.documentElement.dataset.noteKind), 'NOTE');
  const categoryBody = await page.locator('.cm-content').innerText();
  await page.locator('#callout-type').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#callout-picker').isVisible(), false);
  for (const type of ['TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'NOTE']) {
    await page.locator('#callout-type').click(); await page.locator(`#callout-${type.toLowerCase()}`).click();
    await page.waitForFunction(type => document.documentElement.dataset.noteKind === type, type);
    calloutColors.push(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor));
    assert.equal(await page.locator('.cm-content').innerText(), categoryBody);
    assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'edit').at(-1).calloutType), type);
    await page.screenshot({ path: resolve(output, `note-callout-${type.toLowerCase()}.png`) });
  }
  assert.equal(new Set(calloutColors).size, 5);
  const categoryEdits = await page.evaluate(() => window.__requests.filter(request => request.action === 'edit').length);
  assert.equal(await page.locator('#title-display').evaluate(element => getComputedStyle(element).webkitAppRegion), 'drag');
  assert.equal(await page.locator('#title-display').evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))), true);
  assert.equal(await page.locator('#title-editor').isVisible(), false);
  assert.equal(await page.locator('#edit-title').evaluate(element => getComputedStyle(element).webkitAppRegion), 'no-drag');
  assert.equal(await page.locator('#edit-title').getAttribute('aria-expanded'), 'false');
  await page.locator('#more').click(); await page.locator('#rename-note').click();
  await page.locator('#note-caption').fill('取消标题'); await page.locator('#title-cancel').click();
  assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'edit').length), categoryEdits);
  await page.locator('#edit-title').click();
  await page.locator('#note-caption').fill('我的便签 <script>');
  await page.screenshot({ path: resolve(output, 'note-title-editor.png') });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('title-display').textContent === '我的便签 <script>');
  assert.equal(await page.locator('.cm-content').innerText(), titleBody);
  assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'edit').at(-1).caption), '我的便签 <script>');
  await page.locator('#edit-title').click(); await page.locator('#note-caption').fill('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('title-display').textContent === '2026-10-19');
  await page.locator('.cm-content').waitFor(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  const reminderText = await page.locator('.cm-content').innerText();
  await page.evaluate(() => window.__channel.send({ cleanupReminder: true }));
  assert.equal(await page.locator('#cleanup-reminder').isVisible(), true);
  await page.locator('#cleanup-later').click();
  assert.equal(await page.locator('#cleanup-reminder').isVisible(), false);
  assert.equal(await page.locator('.cm-content').innerText(), reminderText);
  assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'cleanup-snooze').length), 1);
  await page.evaluate(() => { window.__state = { ...window.__state, docId: undefined, siyuanSaved: false, phase: 'local', savedRevision: 0 }; window.__channel.send({ state: window.__state }); });
  await page.getByRole('button', { name: '保存到思源中', exact: true }).click();
  await page.getByRole('button', { name: '在思源中打开', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__openedSiYuan || 0), 0);
  await page.getByRole('button', { name: '在思源中打开', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__openedSiYuan), 1);
  await page.locator('.qn-live-h1').waitFor(); await page.locator('.qn-live-table').waitFor();
  assert.equal(await page.locator('.qn-live-strong').innerText(), '粗体');
  assert.equal(await page.locator('.qn-live-table th').count(), 2);
  const noteControlPositions = await page.evaluate(() => Object.fromEntries(['pin', 'minimize', 'close'].map(id => {
    const rect = document.getElementById(id).getBoundingClientRect(); return [id, { right: innerWidth - rect.right, top: rect.top, width: rect.width, height: rect.height }];
  })));
  await page.locator('.qn-image-preview img').first().evaluate(image => image.decode());
  await page.screenshot({ path: resolve(output, 'note-live.png'), fullPage: true });
  // Copy through the real CodeMirror handler without changing the system clipboard.
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+a');
  const copied = await page.evaluate(() => {
    const clipboard = new DataTransfer();
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }));
    return clipboard.getData('text/plain');
  });
  assert.equal(copied, sample); await page.keyboard.press('Control+End');
  const noteUrl = page.url(); await page.locator('.qn-live-link').click(); assert.equal(page.url(), noteUrl);
  await page.keyboard.press('Control+End');
  await page.setViewportSize({ width: 320, height: 320 });
  assert.equal(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth), true);
  await checkNoteActionPlacement();
  await page.screenshot({ path: resolve(output, 'note-default-size.png') });
  await page.setViewportSize({ width: 500, height: 800 }); await page.keyboard.press('Control+End');
  await page.locator('.qn-task').check(); await page.waitForTimeout(200);
  assert((await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text)).includes('- [x] 待办事项'));
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  assert((await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text)).includes('- [ ] 待办事项'));
  await page.locator('.qn-live-table').click(); assert.equal(await page.locator('.qn-live-table').count(), 1);
  await page.keyboard.press('Control+End'); await page.locator('.qn-live-table').waitFor();
  const beforeMode = await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').length);
  await page.getByRole('button', { name: '显示源码', exact: true }).click();
  assert.equal(await page.locator('.qn-live-table').count(), 0); await page.waitForTimeout(200);
  assert.equal(await page.locator('.qn-image-preview').count(), 0);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').length), beforeMode);
  await page.getByRole('button', { name: '返回渲染', exact: true }).click();
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+End');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '中文输入', selectionStart: 4, selectionEnd: 4 });
  await cdp.send('Input.insertText', { text: '中文输入' }); await page.waitForTimeout(250);
  assert((await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text)).endsWith('编辑这里中文输入'));
  await page.locator('#image-picker').setInputFiles(resolve('icon.png')); await page.waitForTimeout(300);
  assert((await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text)).includes('![uploaded](assets/example.png)'));
  // Freeze the real editor through the existing close/snapshot protocol.
  await page.evaluate(() => window.__channel.send({ collect: true, requestId: 'snapshot' })); await page.waitForTimeout(100);
  assert.equal(await page.locator('.cm-content').getAttribute('contenteditable'), 'false');
  assert.equal(await page.locator('.qn-task').isDisabled(), true);
  await page.evaluate(() => window.__channel.send({ resume: true }));
  await page.locator('.cm-content[contenteditable=true]').waitFor();
  await page.evaluate(() => { window.__state = { ...window.__state, dark: true }; window.__channel.send({ state: window.__state }); });
  await page.screenshot({ path: resolve(output, 'note-dark.png'), fullPage: true });
  // Check the actual drawn selection: CodeMirror's focused base selector must
  // not override the dark palette with its default pale lavender.
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+a');
  await page.locator('.cm-selectionBackground').first().waitFor();
  const selectionColor = () => page.locator('.cm-selectionBackground').first().evaluate(element => getComputedStyle(element).backgroundColor);
  assert.equal(await selectionColor(), 'rgb(48, 68, 63)');
  await page.screenshot({ path: resolve(output, 'note-dark-selection.png') });
  await page.locator('#more').focus(); assert.equal(await selectionColor(), 'rgb(48, 68, 63)');
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+End');
  // Long document: ensure rendering remains responsive and the bottom heading is decorated on scrolling.
  await page.evaluate(() => window.__channel.send({ state: { ...window.__state, revision: 100 }, content: { text: Array.from({ length: 3000 }, (_, i) => `## Section ${i}\n\n**body ${i}**\n`).join('\n'), revision: 100 } }));
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+End'); await page.waitForTimeout(300);
  assert((await page.locator('.cm-content').innerText()).includes('body 2999'));
  await page.evaluate(() => window.__channel.send({ state: { ...window.__state, revision: 200, savedRevision: 200, localRevision: 200, showSaved: false }, content: { text: 'word', revision: 200 } }));
  assert.equal(await page.locator('#footer').isVisible(), true); assert.equal(await page.locator('#status').isHidden(), true);
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+a'); await page.getByRole('button', { name: '加粗', exact: true }).click(); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text), '**word**');
  assert.equal(await page.locator('.qn-live-strong').innerText(), 'word');
  await page.locator('.qn-live-strong').click(); assert(!(await page.locator('.cm-content').innerText()).includes('**'));
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+a'); await page.getByRole('button', { name: '下划线', exact: true }).click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.qn-live-underline').innerText(), 'word');
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+a'); await page.getByRole('button', { name: '链接', exact: true }).click();
  await page.getByRole('textbox', { name: '链接地址', exact: true }).fill('https://example.com/test');
  await page.getByRole('button', { name: '应用链接', exact: true }).click(); await page.waitForTimeout(200);
  assert((await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text)).includes('https://example.com/test'));
  await page.evaluate(() => window.__channel.send({ state: { ...window.__state, revision: 300 }, content: { text: '', revision: 300 } }));
  await page.locator('.cm-content').focus(); await page.getByRole('button', { name: '加粗', exact: true }).click(); await page.keyboard.insertText('正文'); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text), '**正文**');
  assert.equal(await page.locator('.qn-live-strong').innerText(), '正文');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text), '正文');
  await page.setViewportSize({ width: 320, height: 320 });
  assert.equal(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth), true);
  const tools = await page.locator('#format-toolbar button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
  assert.equal(new Set(tools).size, 1); assert.equal(await page.locator('#format-link').count(), 0);
  await page.locator('#format-more').click(); await page.getByRole('menuitem', { name: '链接', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#format-heading').click(); await page.locator('[data-level="3"]').click(); await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text), '### 正文');
  await page.locator('#format-heading').click(); await page.locator('[data-level="0"]').click(); await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').at(-1).text), '正文');
  const editsBeforeSort = await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').length);
  const boldBox = await page.locator('#format-bold').boundingBox(), italicBox = await page.locator('#format-italic').boundingBox();
  await page.mouse.move(boldBox.x + 14, boldBox.y + 14); await page.mouse.down();
  await page.mouse.move(italicBox.x + 20, italicBox.y + 14, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(150);
  assert.equal(await page.locator('#format-toolbar button').first().getAttribute('id'), 'format-italic');
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'edit').length), editsBeforeSort);
  await page.locator('#format-more').click(); await page.getByRole('menuitem', { name: '调整顺序', exact: true }).click();
  await page.locator('.sort-row button[data-format="image"]').focus();
  for (let index = 0; index < 11; index++) { await page.keyboard.press('Alt+ArrowUp'); await page.waitForTimeout(35); }
  assert.equal(await page.locator('#format-toolbar button').first().getAttribute('id'), 'format-image');
  await page.getByRole('menuitem', { name: '恢复默认顺序', exact: true }).click(); await page.waitForTimeout(100);
  await page.evaluate(() => { window.__failToolbar = true; });
  await page.getByRole('menuitem', { name: '加粗 · 向后移动', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#format-toolbar button').first().getAttribute('id'), 'format-bold');
  assert((await page.locator('#status').innerText()).includes('disk locked'));
  await page.evaluate(() => { window.__failToolbar = false; });
  await page.getByRole('menuitem', { name: '加粗 · 向后移动', exact: true }).click(); await page.waitForTimeout(100);
  await page.keyboard.press('Escape'); await page.screenshot({ path: resolve(output, 'note-toolbar.png') });
  await page.reload(); await page.locator('.cm-content').waitFor(); await page.locator('#toolbar-toggle').click();
  await page.waitForTimeout(100); assert.equal(await page.locator('#format-toolbar button').first().getAttribute('id'), 'format-italic');
  await page.setViewportSize({ width: 500, height: 800 }); await page.waitForTimeout(100); assert.equal(await page.locator('#format-link').count(), 1);
  await page.evaluate(() => window.__channel.send({ toolbarLayout: { order: [...window.__layout.order].reverse() } }));
  assert.equal(await page.locator('#format-toolbar button').first().getAttribute('id'), 'format-image');
  await page.setViewportSize({ width: 320, height: 320 });
  await page.evaluate(() => { window.__state = { ...window.__state, dark: true }; window.__channel.send({ state: window.__state }); });
  await checkFooterButtonStates('dark-narrow');
  await page.locator('#callout-type').click();
  assert(await page.locator('#callout-picker').evaluate(element => element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().right <= innerWidth));
  await page.screenshot({ path: resolve(output, 'note-callout-menu-dark-narrow.png') });
  await page.locator('#callout-warning').click();
  await page.locator('#edit-title').click();
  await page.locator('#note-caption').fill('中文便签标题');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert(await page.locator('#title-editor').evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: resolve(output, 'note-title-dark-narrow.png') }); await page.keyboard.press('Escape');
  await page.goto(`${origin}/plugins/siyuan-quick-notes/window.html?session=ui&windowId=sample&channel=siyuan-quick-notes:ui&lang=en-US`);
  await page.waitForFunction(() => document.getElementById('title-display').textContent === '2026-10-19');
  await page.locator('.cm-content').focus(); await page.keyboard.press('F2');
  assert.equal(await page.getByRole('textbox', { name: 'Note title', exact: true }).getAttribute('maxlength'), '200');
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('English note title');
  assert(await page.getByRole('button', { name: 'Save', exact: true }).evaluate(element => element.getBoundingClientRect().bottom <= innerHeight));
  await page.screenshot({ path: resolve(output, 'note-title-english-narrow.png') }); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'edit').length), 0);
  await page.locator('#callout-type').click();
  assert.equal(await page.getByRole('menuitemradio', { name: 'TIP · Tip', exact: true }).count(), 1);
  await page.screenshot({ path: resolve(output, 'note-callout-menu-english-narrow.png') });
  await page.locator('#callout-tip').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.noteKind), 'TIP');
  await page.close();
  page = await browser.newPage({ viewport: { width: 400, height: 560 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__requests = [];
    window.__settings = { trayEnabled: true, trayClickAction: 'new', shortcutBehavior: 'new', width: 320, height: 320,
      alwaysOnTop: false, rememberPosition: true, restoreWindows: false, notebook: 'book', directory: '/Original', debounceMs: 800, showSaved: true, maxWindows: 10, historyLimit: 50,
      cleanupReminder: true, cleanupThreshold: 100, archiveDays: 30 };
    window.__failSettings = false; window.__previewDelay = 0;
    window.BroadcastChannel = class {
      constructor() { window.__channel = this; }
      send(extra) { this.onmessage?.({ data: { session: 'ui', windowId: 'recent', dark: false, pinned: false, ...extra } }); }
      postMessage(request) { window.__requests.push(request); setTimeout(() => {
        if (request.action === 'settings') { this.send({ requestId: request.requestId, settingsData: { settings: window.__settings, notebooks: [{ id: 'book', name: '测试笔记本 <script>' }], platform: 'windows', shortcut: 'Ctrl + Alt + N' } }); return; }
        if (request.action === 'preview-settings') { setTimeout(() => this.send({ requestId: request.requestId, preview: { notebook: request.settings.notebook, path: request.settings.directory } }), window.__previewDelay); return; }
        if (request.action === 'save-settings') {
          if (window.__failSettings) this.send({ requestId: request.requestId, error: 'disk locked' });
          else { window.__settings = request.settings; this.send({ requestId: request.requestId, savedSettings: window.__settings }); }
          return;
        }
        const items = window.__items ??= Array.from({ length: 30 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, summary: `测试速记 ${i} <script>`, title: `示例标题 ${i}`, bodySummary: `测试速记 ${i} <script>`, calloutType: i === 5 ? undefined : ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'][i % 5], path: i % 2 ? '/速记/2026-10-19' : '', updatedAt: 1792339200000 - i * 1000, draft: i % 2 === 0, siyuanSaved: i % 2 !== 0, open: i === 0 }));
        const cleanupItems = items.map((item, i) => ({ ...item, version: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`, unsaved: !item.siyuanSaved, busy: false, eligible: !item.open, removed: false }));
        const cleanup = { items: cleanupItems, total: items.length, unsaved: cleanupItems.filter(item => item.unsaved).length, eligible: cleanupItems.filter(item => item.eligible).length,
          reminderActive: window.__settings.cleanupReminder && items.length >= window.__settings.cleanupThreshold && !window.__cleanupSnoozed, progress: window.__cleanupProgress };
        if (request.action === 'cleanup-snooze') { window.__cleanupSnoozed = true; this.send({ requestId: request.requestId }); return; }
        if (request.action === 'draft-versions') {
          this.send({ requestId: request.requestId, draftVersions: { token: '90000000-0000-0000-0000-000000000001', removed: false,
            versions: [{ version: '80000000-0000-0000-0000-000000000001', device: 'a0000000-0000-0000-0000-000000000001', summary: '版本 A <script>', text: '# 版本 A\n\n保留设备 A 的正文 <script>', updatedAt: Date.now() },
              { version: '80000000-0000-0000-0000-000000000002', device: 'b0000000-0000-0000-0000-000000000002', summary: '版本 B', text: '# 版本 B\n\n保留设备 B 的修改', updatedAt: Date.now() }] } }); return;
        }
        if (request.action === 'choose-draft-version') { window.__versionChoice = request; this.send({ requestId: request.requestId }); return; }
        if (request.action === 'cleanup') { this.send({ requestId: request.requestId, cleanup }); return; }
        if (request.action === 'cleanup-start') {
          window.__cleanupProgress = { jobId: 'job', mode: request.mode, running: false, cancelled: false, total: request.selections.length, completed: request.selections.length, succeeded: request.selections.length, skipped: 0, failures: [] };
          this.send({ requestId: request.requestId, cleanupProgress: window.__cleanupProgress }); return;
        }
        if (request.action === 'siyuan') {
          if (window.__failSiYuan) { this.send({ requestId: request.requestId, error: 'SiYuan save failed' }); return; }
          const item = items.find(item => item.id === request.id);
          if (item.siyuanSaved) window.__openedSiYuan = (window.__openedSiYuan || 0) + 1;
          else { item.siyuanSaved = true; item.path = '/速记/2026-10-19'; }
          this.send({ requestId: request.requestId, items }); return;
        }
        this.send({ requestId: request.requestId, ...(['ready', 'refresh'].includes(request.action) ? { items, cleanup } : {}) });
      }, 0); }
      close() {}
    };
  });
  await page.goto(`${origin}/plugins/siyuan-quick-notes/recent.html?session=ui&channel=siyuan-quick-notes:recent:ui`);
  await page.locator('.recent-row').first().waitFor(); assert.equal(await page.locator('.recent-row').count(), 30);
  assert.equal(await page.locator('.recent-item strong').first().innerText(), '示例标题 0');
  assert.equal(await page.locator('.recent-body').first().innerText(), '测试速记 0 <script>');
  assert(await page.locator('.recent-item').first().evaluate(element => element.querySelector('strong').getBoundingClientRect().bottom <= element.querySelector('.recent-body').getBoundingClientRect().top));
  const listKinds = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
  const lightColors = [];
  for (let index = 0; index < listKinds.length; index++) {
    const row = page.locator('.recent-row').nth(index);
    assert.equal(await row.getAttribute('data-note-kind'), listKinds[index]);
    lightColors.push(await row.evaluate(element => getComputedStyle(element).backgroundColor));
  }
  assert.deepEqual(lightColors, ['rgb(240, 247, 255)', 'rgb(240, 250, 242)', 'rgb(247, 242, 253)', 'rgb(255, 249, 235)', 'rgb(255, 242, 242)']);
  assert.equal(await page.locator('.recent-row').nth(5).getAttribute('data-note-kind'), 'NOTE');
  await page.screenshot({ path: resolve(output, 'recent-callout-colors-light.png') });
  await page.evaluate(() => window.__channel.send({ dark: true }));
  const darkColors = await page.locator('.recent-row').evaluateAll(rows => rows.slice(0, 5).map(row => getComputedStyle(row).backgroundColor));
  assert.deepEqual(darkColors, ['rgb(32, 44, 56)', 'rgb(34, 47, 39)', 'rgb(45, 37, 56)', 'rgb(52, 46, 32)', 'rgb(53, 38, 38)']);
  await page.screenshot({ path: resolve(output, 'recent-callout-colors-dark.png') });
  await page.evaluate(() => { window.__items[0].calloutType = 'WARNING'; });
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('.recent-row').dataset.noteKind === 'WARNING');
  assert.equal(await page.locator('.recent-row').first().evaluate(element => getComputedStyle(element).backgroundColor), lightColors[3]);
  await page.evaluate(() => { window.__items[0].calloutType = 'NOTE'; window.__channel.send({ items: window.__items, dark: false }); });
  assert.equal(await page.locator('.cleanup-overview').count(), 0);
  assert.equal(await page.locator('#cleanup-snooze').isVisible(), false);
  assert((await page.locator('#recent-footer').innerText()).includes('全部未归档 30'));
  const footerLayout = await page.evaluate(() => ({ footer: document.getElementById('recent-footer').getBoundingClientRect().top,
    results: document.getElementById('results').getBoundingClientRect().bottom, summaryInFooter: document.getElementById('recent-footer').contains(document.getElementById('cleanup-summary')) }));
  assert(footerLayout.summaryInFooter && footerLayout.footer >= footerLayout.results);
  await page.setViewportSize({ width: 320, height: 400 });
  await page.evaluate(() => window.__channel.send({ items: [window.__items[0]], cleanup: { items: [], total: 1, unsaved: 1, eligible: 0, reminderActive: false }, dark: true }));
  assert.equal(await page.locator('#cleanup-summary').innerText(), '全部未归档 1 · 未保存到思源 1 · 可归档 0');
  assert.equal(await page.locator('#cleanup-snooze').isVisible(), false);
  assert(await page.locator('#recent-footer').evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().bottom <= innerHeight));
  assert.equal(await page.locator('#recent-footer #organize, #recent-footer #other-devices').count(), 0);
  assert.equal(await page.locator('#actions').isVisible(), false);
  await page.locator('#more').focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#more').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'other-devices');
  await page.keyboard.press('ArrowDown'); assert.equal(await page.evaluate(() => document.activeElement.id), 'organize');
  await page.keyboard.press('Home'); assert.equal(await page.evaluate(() => document.activeElement.id), 'other-devices');
  assert(await page.locator('#actions').evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: resolve(output, 'recent-more-dark-narrow.png') });
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#actions').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'more');
  await page.locator('#more').click(); await page.locator('#search').click({ position: { x: 10, y: 10 } }); assert.equal(await page.locator('#actions').isVisible(), false);
  await page.screenshot({ path: resolve(output, 'recent-single-footer.png') });
  await page.setViewportSize({ width: 400, height: 560 });
  await page.locator('#refresh').click(); await page.waitForTimeout(100);
  const compactRow = await page.locator('.recent-row').first().evaluate(row => {
    const open = row.querySelector('.recent-item').getBoundingClientRect(), actions = row.querySelector('.recent-row-actions').getBoundingClientRect();
    const save = row.querySelector('.recent-siyuan').getBoundingClientRect(), remove = row.querySelector('.recent-delete').getBoundingClientRect();
    const badge = row.querySelector('.recent-badges').getBoundingClientRect(), time = row.querySelector('time').getBoundingClientRect();
    return { openHeight: open.height, actionsHeight: actions.height, saveBottom: save.bottom, deleteTop: remove.top, badgeTop: badge.top, timeTop: time.top };
  });
  assert.equal(compactRow.openHeight, compactRow.actionsHeight); assert(compactRow.openHeight < 110);
  assert(compactRow.saveBottom <= compactRow.deleteTop);
  assert(Math.abs(compactRow.badgeTop - compactRow.timeTop) < 2);
  await page.setViewportSize({ width: 320, height: 400 });
  assert.equal(await page.locator('#results').evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: resolve(output, 'recent-compact-narrow.png') });
  await page.setViewportSize({ width: 400, height: 560 });
  assert.equal(await page.locator('.recent-siyuan').first().innerText(), '保存到思源中');
  assert.equal(await page.locator('.recent-siyuan').nth(1).innerText(), '在思源中打开');
  await page.locator('.recent-siyuan').first().click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('.recent-siyuan').first().innerText(), '在思源中打开');
  assert.equal(await page.evaluate(() => window.__openedSiYuan || 0), 0); assert.equal(await page.locator('.recent-row').count(), 30);
  await page.locator('.recent-siyuan').first().click(); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__openedSiYuan), 1);
  await page.evaluate(() => { window.__failSiYuan = true; });
  await page.locator('.recent-siyuan').nth(2).click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('.recent-siyuan').nth(2).innerText(), '保存到思源中');
  assert((await page.locator('#recent-status').innerText()).includes('SiYuan save failed'));
  await page.evaluate(() => { window.__failSiYuan = false; });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForTimeout(100);
  await page.locator('.recent-delete').first().click();
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '取消');
  assert((await page.locator('dialog.delete-confirm').innerText()).includes('测试速记 0 <script>'));
  await page.screenshot({ path: resolve(output, 'recent-delete-confirm.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'delete').length), 0);
  await page.locator('.recent-delete').first().click(); await page.locator('dialog.delete-confirm .danger').click(); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'delete').length), 1);
  assert.equal(await page.locator('[role=tab]').count(), 0);
  const listControlPositions = await page.evaluate(() => Object.fromEntries(['pin', 'minimize', 'close'].map(id => {
    const rect = document.getElementById(id).getBoundingClientRect(); return [id, { right: innerWidth - rect.right, top: rect.top, width: rect.width, height: rect.height }];
  })));
  assert.deepEqual(listControlPositions, noteControlPositions);
  await page.screenshot({ path: resolve(output, 'recent.png') });
  await page.locator('#search').fill('测试速记 2'); assert.equal(await page.locator('.recent-row').count(), 11);
  await page.locator('#results').evaluate(element => { element.scrollTop = 120; });
  const scroll = await page.locator('#results').evaluate(element => element.scrollTop);
  await page.getByRole('button', { name: '刷新', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#search').inputValue(), '测试速记 2'); assert.equal(await page.locator('#results').evaluate(element => element.scrollTop), scroll);
  await page.locator('.recent-item').first().click(); await page.waitForTimeout(100); assert.equal(await page.locator('.recent-row').count(), 11);
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'open').length), 1);
  const notesScroll = await page.locator('#results').evaluate(element => element.scrollTop);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#setting-directory').waitFor();
  assert.equal(await page.locator('#settings-panel input, #settings-panel select').count(), 17);
  await page.locator('#setting-trayClickAction').selectOption('recent'); await page.locator('#setting-directory').fill('/Draft');
  await page.evaluate(() => window.__channel.send({ settingsChanged: true }));
  assert.equal(await page.locator('#setting-directory').inputValue(), '/Draft');
  assert((await page.locator('.settings-status').innerText()).includes('其他设备已更新设置'));
  await page.getByRole('button', { name: '返回速记列表', exact: true }).click(); assert.equal(await page.locator('#search').inputValue(), '测试速记 2');
  assert.equal(await page.locator('#results').evaluate(element => element.scrollTop), notesScroll);
  await page.getByRole('button', { name: '设置', exact: true }).click(); assert.equal(await page.locator('#setting-directory').inputValue(), '/Draft');
  await page.evaluate(() => { window.__previewDelay = 200; });
  await page.getByRole('button', { name: '预览保存位置', exact: true }).click(); await page.locator('#setting-directory').fill('/Changed'); await page.waitForTimeout(250);
  assert.equal(await page.locator('.settings-preview-output').innerText(), '保存位置已更改，请重新预览。');
  await page.getByRole('button', { name: '预览保存位置', exact: true }).click(); await page.waitForTimeout(250);
  assert.equal(await page.locator('.settings-preview-output').innerText(), '测试笔记本 <script> · /Changed');
  await page.locator('#setting-directory').fill('/../bad'); await page.getByRole('button', { name: '保存设置', exact: true }).click();
  assert((await page.locator('.settings-status').innerText()).includes('保存目录无效'));
  assert.equal(await page.evaluate(() => window.__requests.filter(r => r.action === 'save-settings').length), 0);
  await page.locator('#setting-directory').fill('/Accepted'); await page.evaluate(() => { window.__failSettings = true; });
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.waitForTimeout(100);
  assert((await page.locator('.settings-status').innerText()).includes('disk locked')); assert.equal(await page.locator('#setting-directory').inputValue(), '/Accepted');
  assert.equal(await page.evaluate(() => window.__settings.directory), '/Original');
  await page.evaluate(() => { window.__failSettings = false; }); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('.settings-status').innerText(), '速记设置已保存'); assert.equal(await page.evaluate(() => window.__settings.trayClickAction), 'recent');
  await page.screenshot({ path: resolve(output, 'settings.png') });
  await page.evaluate(() => window.__channel.send({ dark: true })); await page.screenshot({ path: resolve(output, 'settings-dark.png') });
  await page.getByRole('button', { name: '返回速记列表', exact: true }).click();
  await page.locator('#more').click(); await page.getByRole('menuitem', { name: '整理便签', exact: true }).click();
  await page.locator('.cleanup-row').first().waitFor();
  assert.equal(await page.locator('.cleanup-row').count(), 30);
  assert.equal(await page.locator('.cleanup-row input:checked').count(), 29);
  assert.equal(await page.locator('.cleanup-row input:disabled').count(), 1);
  await page.screenshot({ path: resolve(output, 'cleanup-archive.png') });
  await page.getByRole('combobox', { name: '整理方式' }).selectOption('clear');
  const unsavedRow = page.locator('.cleanup-row').filter({ hasText: '测试速记 2 <script>' });
  assert.equal(await unsavedRow.locator('input').isChecked(), false);
  await page.getByRole('button', { name: '取消选择', exact: true }).click(); await unsavedRow.locator('input').check();
  await page.getByRole('button', { name: '执行所选操作 (1)', exact: true }).click();
  assert((await page.locator('.cleanup-confirm').innerText()).includes('将永久丢弃本机未保存内容的条数：1'));
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '取消');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'cleanup-start').length), 0);
  await page.getByRole('button', { name: '执行所选操作 (1)', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'cleanup-clear-confirm.png') });
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.waitForFunction(() => window.__requests.some(request => request.action === 'cleanup-start'));
  assert.equal(await page.evaluate(() => window.__requests.find(request => request.action === 'cleanup-start').discard), true);
  await page.waitForTimeout(100);
  assert((await page.locator('.cleanup-status').innerText()).includes('成功 1'));
  await page.setViewportSize({ width: 320, height: 400 });
  assert.equal(await page.locator('.cleanup-panel').evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert(await page.getByRole('button', { name: '停止后续处理', exact: true }).evaluate(element => element.getBoundingClientRect().bottom <= innerHeight));
  await page.screenshot({ path: resolve(output, 'cleanup-narrow.png') });
  await page.setViewportSize({ width: 400, height: 560 });
  await page.getByRole('button', { name: '返回速记列表', exact: true }).click();
  assert.equal(await page.locator('#cleanup-snooze').isVisible(), false);
  await page.evaluate(() => { window.__settings.cleanupThreshold = 30; });
  await page.locator('#refresh').click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#cleanup-snooze').isVisible(), true);
  await page.getByRole('button', { name: '7 天后再提醒', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#recent-status').innerText(), '已延后 7 天提醒');
  assert.equal(await page.locator('#cleanup-snooze').isVisible(), false);
  await page.locator('#refresh').click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#cleanup-snooze').isVisible(), false);
  await page.evaluate(() => { window.__cleanupSnoozed = false; window.__settings.cleanupReminder = false; });
  await page.locator('#refresh').click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#cleanup-snooze').isVisible(), false);
  await page.evaluate(() => window.__channel.send({ error: 'disk locked' })); assert.equal(await page.locator('#recent-status').innerText(), 'disk locked');
  await page.evaluate(() => window.__channel.send({ items: [] })); assert.equal(await page.locator('#recent-status').innerText(), 'disk locked');
  assert((await page.locator('#cleanup-summary').innerText()).includes('全部未归档 30'));
  await page.locator('#search').fill('');
  await page.locator('#more').click(); await page.getByRole('menuitem', { name: '其他设备草稿', exact: true }).click();
  await page.locator('.draft-versions-dialog textarea').waitFor();
  await page.waitForFunction(() => document.querySelector('.draft-versions-dialog textarea').value.includes('版本 A'));
  assert((await page.locator('.draft-versions-dialog textarea').inputValue()).includes('<script>'));
  assert.equal(await page.locator('.draft-versions-dialog textarea').getAttribute('readonly'), '');
  assert.equal(await page.getByRole('button', { name: '继续此版本', exact: true }).count(), 0);
  await page.getByRole('combobox', { name: '选择草稿', exact: true }).selectOption('80000000-0000-0000-0000-000000000002');
  assert((await page.locator('.draft-versions-dialog textarea').inputValue()).includes('设备 B 的修改'));
  await page.screenshot({ path: resolve(output, 'draft-versions.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__requests.filter(request => request.action === 'choose-draft-version').length), 0);
  await page.locator('#more').click(); await page.locator('#other-devices').click(); await page.locator('.draft-versions-dialog textarea').waitFor();
  await page.getByRole('button', { name: '复制到本设备', exact: true }).click(); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__versionChoice.copy), true);
  assert.equal(await page.evaluate(() => window.__versionChoice.id), undefined);
  assert.equal(await page.evaluate(() => window.__versionChoice.token), '90000000-0000-0000-0000-000000000001');
  assert.equal(await page.locator('.draft-versions-dialog').isVisible(), false);
  await page.goto(`${origin}/plugins/siyuan-quick-notes/recent.html?session=ui&channel=siyuan-quick-notes:recent:ui&lang=en-US`);
  await page.locator('.recent-row').first().waitFor();
  assert.equal(await page.locator('#search').getAttribute('placeholder'), 'Search summary, path, or time');
  assert.equal(await page.locator('#title-display').innerText(), 'Note list');
  assert.equal(await page.locator('.recent-siyuan').nth(2).innerText(), 'Save to SiYuan');
  assert.equal(await page.locator('.recent-siyuan').nth(1).innerText(), 'Open in SiYuan');
  assert((await page.locator('.recent-item').first().innerText()).includes('测试速记 0 <script>'));
  await page.screenshot({ path: resolve(output, 'recent-english.png') });
  await page.locator('#more').click();
  assert.equal(await page.getByRole('menuitem', { name: 'Other devices’ drafts', exact: true }).count(), 1);
  assert.equal(await page.getByRole('menuitem', { name: 'Organize notes', exact: true }).count(), 1);
  await page.screenshot({ path: resolve(output, 'recent-more-english.png') }); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.locator('#setting-directory').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save settings', exact: true }).count(), 1);
  await page.screenshot({ path: resolve(output, 'settings-english.png') });
  await page.getByRole('button', { name: 'Back to note list', exact: true }).click();
  await page.locator('#more').click(); await page.getByRole('menuitem', { name: 'Organize notes', exact: true }).click();
  await page.locator('.cleanup-row').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Select eligible notes', exact: true }).count(), 1);
  assert((await page.locator('.cleanup-row').first().innerText()).includes('测试速记 0 <script>'));
  await page.screenshot({ path: resolve(output, 'cleanup-english.png') });
  await page.getByRole('button', { name: 'Back to note list', exact: true }).click();
  await page.locator('#more').click(); await page.locator('#other-devices').click(); await page.locator('.draft-versions-dialog textarea').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Copy to this device', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Continue this version and keep the others', exact: true }).count(), 0);
  await page.setViewportSize({ width: 320, height: 400 });
  assert(await page.locator('.draft-versions-dialog').evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: resolve(output, 'draft-versions-english-narrow.png') }); await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ result: 'PASS', checks: ['new note and SiYuan save/open actions live in the lower-right footer, preserving behavior and fitting the narrow window without overlap', 'footer buttons share active fill, icon color, radius and border, with consistent keyboard focus in light and dark narrow windows', 'list rows follow all five note palettes in light and dark themes, old notes default to NOTE, refreshed category changes update color', 'five native callout choices, immediate colors, unchanged body, keyboard dismissal and bilingual narrow menus', 'single-click pencil dialog outside the native drag region, unchanged system menu, cancel, save, clear, F2, menu alternative and unchanged body', 'live Markdown', 'cross-paragraph source copy', 'link click keeps rendering without navigation', '320x320 note layout', 'table clicks keep rendering', 'task toggle and undo', 'mode switch without edits', 'Chinese IME', 'image upload', 'snapshot freeze and resume', 'dark theme', '3000-section scrolling', 'list search', 'list refresh preserves scroll', 'open retains list', 'persistent inline errors', 'English list preserves note text', 'embedded settings with all 17 fields', 'settings icon and back preserve drafts and list scroll', 'stale settings preview ignored', 'invalid path blocks settings save', 'failed settings save preserves form', 'settings save acknowledgement', 'bilingual settings', 'organization selection, explicit unsaved discard, cancellation, progress, snooze, narrow layout and English', 'floating note reminder with snooze preserves content', 'top-right More menu entries, keyboard navigation, Escape, outside dismissal and narrow bilingual layout', 'read-only other-device draft preview, selection and copy-only action', 'footer controls remain visible', 'single-line toolbar overflow at 320px, pointer sorting, hidden item keyboard sorting, rollback, persistence and external layout updates', 'selected text formatting', 'empty format insertion and Chinese text', 'hidden boundary backspace', 'link address input', 'matching window control alignment, local delete cancel and confirm, external settings preserve drafts'], errors }, null, 2));
  console.log('Browser UI checks PASS; screenshots and results: artifacts/ui/');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('Browser errors:', errors); throw error;
} finally { await browser.close(); server.close(); }
