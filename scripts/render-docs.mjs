// Offline documentation illustrations. Uses the built window with sample data;
// no SiYuan workspace is connected or modified.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { englishCards } from './docs-en.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DOCS_PLAYWRIGHT || 'playwright');
const root = resolve('.');
const english = process.argv.includes('--lang=en');
const output = english ? 'docs/images/en' : 'docs/images';
await mkdir(output, { recursive: true });
// Optional asset optimization, independent of the plugin's build dependencies.
const sharp = process.env.DOCS_SHARP ? require(process.env.DOCS_SHARP) : undefined;
async function screenshot(page, path) {
  const png = await page.screenshot();
  await writeFile(path, sharp ? await sharp(png).png({ palette: true, quality: 85, dither: 0, compressionLevel: 9, effort: 10 }).toBuffer() : png);
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.DOCS_CHROMIUM || chromium.executablePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 610 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', error => console.error(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.route('http://localhost:49781/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const allowed = ['/dist/window.html', '/dist/window.js', '/dist/window.css', '/assets/example.png'];
    if (!allowed.includes(pathname)) return route.abort();
    const file = pathname === '/assets/example.png' ? 'icon.png' : pathname.slice(1);
    const contentType = pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'image/png';
    await route.fulfill({ body: await readFile(resolve(root, file)), contentType });
  });
  const style = `<style>
    *{box-sizing:border-box}body{margin:0;background:#eff3ee;color:#243e37;font-family:'Microsoft YaHei','Segoe UI',sans-serif}
    .sheet{width:1120px;height:610px;padding:38px 48px;position:relative;overflow:hidden}
    .eyebrow{font-size:13px;letter-spacing:2px;color:#537c70;margin-bottom:10px}h1{font-size:30px;font-weight:650;margin:0 0 8px} .intro{font-size:16px;color:#607369;margin:0;line-height:1.8}
    iframe{position:absolute;left:48px;top:157px;width:500px;height:365px;border:0;border-radius:9px;box-shadow:0 12px 30px #1e483723;overflow:hidden}
    .copy{position:absolute;left:594px;top:151px;width:475px}.item{margin:0 0 24px;display:flex;gap:14px}.num{background:#2c6d59;color:white;border-radius:50%;font-size:16px;width:29px;height:29px;display:grid;place-items:center;flex:none}.item h2{font-size:18px;margin:0 0 7px}.item p{font-size:15px;line-height:1.8;color:#5d6f64;margin:0}
    kbd,code{font:14px 'Consolas','Microsoft YaHei',monospace;background:#e0e9df;padding:3px 6px;border-radius:4px;color:#284d3d}.foot{position:absolute;left:48px;bottom:26px;right:48px;border-top:1px solid #ccdace;padding-top:13px;font-size:12px;color:#6b7e71}
    .badge{position:absolute;left:61px;background:#2c6d59;color:white;border-radius:4px;padding:4px 8px;font-size:12px;box-shadow:0 2px 4px #0001;pointer-events:none}
    .panel{position:absolute;left:48px;top:157px;width:500px;height:365px;background:#faf9f5;border:1px solid #d9dfd6;border-radius:9px;padding:24px;box-shadow:0 12px 30px #1e483715}.panel h2{font-size:19px;margin:0 0 22px}.label{font-size:14px;color:#566659;margin:16px 0 7px}.field{padding:10px 12px;border:1px solid #d5dcd2;border-radius:5px;background:white;font-size:14px;overflow-wrap:anywhere;line-height:1.5}.button{display:inline-block;border:1px solid #97b1a1;border-radius:5px;padding:8px 12px;color:#2c6d59;font-size:14px;margin-top:18px}.result{font-size:14px;color:#2c6d59;line-height:1.8;margin-top:12px}.search{color:#819083}.row{display:flex;gap:9px;margin-top:12px;align-items:center}.record{border:1px solid #d5dcd2;border-radius:5px;padding:12px;flex:1;font-size:14px;line-height:1.65;background:white}.meta{font-size:12px;color:#7b857a}.delete{color:#a45041;font-size:13px}.local{font-size:12px;color:#2c6d59;background:#e0ecdf;border-radius:3px;padding:2px 5px}
  </style>`;
  const localeStyle = english ? '<style>body{font-family:"Segoe UI",sans-serif}.foot{line-height:1.5}code,kbd{font-family:Consolas,monospace}</style>' : '';
  const sample = '整理下一版插件的想法\n\n- [ ] 补充图文使用说明\n- [ ] 记录今天的灵感\n\n## 临时摘录\n随手记下，稍后回到思源整理。';
  const item = (n, title, text) => `<div class="item"><span class="num">${n}</span><div><h2>${title}</h2><p>${text}</p></div></div>`;
  const cards = english ? englishCards(item) : [
    { name: '01-window', title: '随时唤起，把想法留在手边', intro: 'Ctrl + Alt + N 新建便签 · 多窗口 · 独立置顶 · Markdown 正文', text: sample,
      copy: item(1, '顶部就是常用入口', '加号新建，箭头回到思源，图钉切换置顶。<br>更多菜单提供保存、图片、恢复与另存。') + item(2, '直接写正文', '文字、待办、代码块和表格都可用 Markdown。<br>左上角显示思源文档标题，不设标题输入框。') + item(3, '留意底部保存状态', '默认停止输入 800 毫秒后自动保存。<br>看到“已保存到思源”，才表示正式保存成功。'),
    },
    { name: '02-images', title: '截图贴进来，图片直接看', intro: '粘贴截图、选择文件或拖入图片 · 上传后插入 Markdown 链接', text: '记录设计参考\n\n截图后回到便签，按 Ctrl + V。\n\n![参考图片](assets/example.png)',
      copy: item(1, '三种插入方式', '<kbd>Ctrl + V</kbd> 粘贴截图；更多 → 插入图片；<br>直接将图片文件拖入编辑区。') + item(2, '正文保留链接，下方显示图片', '思源 assets 内的图片可直接预览。<br>点击“编辑图片链接”即可选中对应源码。') + item(3, '图片跟随思源资源同步', '支持 PNG、JPEG、GIF、WebP、BMP。<br>每次最多 10 张，总计不超过 20 MB。'), height: 395 },
    { name: '03-storage', title: '先选笔记本，再确认保存位置', intro: '思源顶栏 → 悬浮速记 → 速记设置 · 图中使用“按天汇集”模板',
      panel: '<h2>保存位置设置 · 关键项示意</h2><div class="label">目标笔记本</div><div class="field">日常笔记</div><div class="label">保存目录（支持模板变量）</div><div class="field"><code>/Quick Notes/{{now | date "2006-01-02"}}</code></div><div class="button">预览保存位置</div><div class="result">日常笔记 · /Quick Notes/2026-10-15</div>',
      copy: item(1, '第一次使用先选目标笔记本', '选择已打开的普通非加密笔记本。<br>默认模板按首次输入时间生成文档路径。') + item(2, '同一天，也可以写进同一文档', '使用左侧按天模板，多条便签各自保存为<br>竖向超级块，共用当天的思源文档。') + item(3, '先预览，再保存设置', '预览只显示路径，不创建文档。<br>首次输入确定位置，修改设置只影响新便签。') },
    { name: '04-recovery', title: '找回最近速记，接着编辑草稿', intro: '便签更多菜单 / 思源顶栏 / 托盘右键 → 最近速记与恢复草稿',
      panel: '<h2>最近速记与恢复草稿 · 列表示意</h2><div class="field search">搜索摘要、保存位置或时间</div><div class="row"><div class="record"><span class="local">本机草稿</span> · 还没整理完的想法<br><span class="meta">2026/10/15 09:30:00<br>/Quick Notes/2026-10-15</span></div><span class="delete">删除</span></div><div class="row"><div class="record">整理下一版插件的想法<br><span class="meta">2026/10/15 09:10:00<br>/Quick Notes/2026-10-15</span></div><span class="delete">删除</span></div>',
      copy: item(1, '按摘要、路径或时间搜索', '点击记录即可继续编辑；<br>正式速记读取思源中的最新正文。') + item(2, '草稿保留在当前电脑', '更多 → 保存本机草稿后关闭，稍后恢复。<br>草稿不占最近记录额度，也不跨设备同步。') + item(3, '按需恢复窗口', '设置中可开启“重启后恢复上次打开的窗口”。<br>删除前会确认，只清理插件本机记录；<br>思源文档及其内容保留。') },
  ];
  for (const card of cards) {
    await page.goto('about:blank');
    const channelName = `siyuan-quick-notes:docs-${card.name}`;
    const view = card.panel ? `<div class="panel">${card.panel}</div>` : `<iframe src="http://localhost:49781/dist/window.html?session=docs&amp;windowId=sample&amp;channel=${channelName}&amp;lang=${english ? 'en-US' : 'zh-CN'}" style="height:${card.height || 365}px"></iframe>${card.badges || ''}`;
    const foot = english
      ? `${card.panel ? 'Settings and lists are illustrations with translated English labels.' : 'English note window rendered from the current build with sample content.'}<br>SiYuan desktop 3.8.6+ · Windows / macOS / Linux · Keep SiYuan running. On macOS, use Command shortcuts.`
      : `${card.panel ? '设置与列表为关键项示意，具体外观随思源主题变化。' : '便签界面由当前版本代码渲染，内容为演示数据。'}　Windows 桌面版思源 3.8.6+，使用时保持思源运行。`;
    await page.route('http://localhost:49781/card', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${english ? 'en' : 'zh-CN'}"><meta charset="utf-8">${style}${localeStyle}<div class="sheet"><div class="eyebrow">${english ? 'QUICK NOTES / ILLUSTRATED GUIDE' : '悬浮速记 / 功能图解'}</div><h1>${card.title}</h1><p class="intro">${card.intro}</p>${view}<div class="copy">${card.copy}</div><div class="foot">${foot}</div></div></html>` }));
    await page.addInitScript(({ channelName, text, english }) => {
      if (window.top !== window) return;
      const channel = new BroadcastChannel(channelName);
      channel.onmessage = event => {
        const request = event.data;
        channel.postMessage({ session: 'docs', windowId: 'sample',
          state: { revision: 1, savedRevision: 1, localRevision: 1, docId: 'sample', docTitle: english ? '2026-10-18' : '2026-10-15', title: '', phase: 'saved', pinned: true, dark: false, showSaved: true },
          content: { text, revision: 1 },
          ...(request.action === 'heartbeat' ? { heartbeat: { revision: 1, localRevision: 1 } } : {}) });
      };
    }, { channelName, text: card.text || '', english });
    await page.goto('http://localhost:49781/card');
    await page.evaluate(() => document.fonts.ready);
    if (!card.panel) {
      const frame = page.frameLocator('iframe');
      try { await frame.locator('#status').filter({ hasText: english ? 'Saved to SiYuan' : '已保存到思源' }).waitFor({ timeout: 10000 }); }
      catch (error) {
        console.error('Window status:', await frame.locator('#status').textContent());
        throw error;
      }
      if (card.name === '02-images') await frame.locator('.qn-image-preview img').evaluate(img => img.decode());
      if (english) {
        // Verify real localized controls; no DOM translation is used for screenshots.
        await frame.getByRole('button', { name: 'More', exact: true }).click();
        await frame.getByRole('button', { name: 'Save local draft and close', exact: true }).waitFor();
        await frame.getByRole('button', { name: 'More', exact: true }).click();
      }
    }
    await screenshot(page, `${output}/${card.name}.png`);
    await page.unroute('http://localhost:49781/card');
    console.log(`Rendered ${output}/${card.name}.png`);
  }
  if (english) {
    await page.setViewportSize({ width: 800, height: 320 });
    const icon = (await readFile('icon.png')).toString('base64');
    await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',sans-serif;background:#143f35;color:#faf7eb}
      .banner{width:800px;height:320px;position:relative;padding:47px 46px;overflow:hidden;background:radial-gradient(ellipse at 88% 0%,#316c58 0%,transparent 65%)}
      .tag{font-size:12px;letter-spacing:3px;color:#b4cabc}h1{font-size:51px;font-weight:600;letter-spacing:-1.5px;margin:17px 0 10px}
      p{font-size:19px;line-height:1.55;margin:0;color:#dbe5d8}.platform{margin-top:25px;font-size:12px;letter-spacing:1px;color:#afc7b9}
      img{position:absolute;right:43px;top:63px;width:190px;height:190px;filter:drop-shadow(0 16px 20px #092c3060);transform:rotate(5deg)}
    </style><div class="banner"><div class="tag">SiYuan DESKTOP PLUGIN</div><h1>Quick Notes</h1><p>Capture a thought.<br>Return to SiYuan.</p><div class="platform">WINDOWS · macOS · LINUX</div><img alt="Quick Notes icon" src="data:image/png;base64,${icon}"></div></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('img').evaluate(img => img.decode());
    await screenshot(page, `${output}/00-header.png`);
    console.log(`Rendered ${output}/00-header.png`);
  }
} finally { await browser.close(); }
