# 图标与题头图

0.1.3 使用深玉绿色与暖白纸张，突出“随手记下，回到思源”。图像由内置 ImageGen 生成，随后仅调整尺寸供插件使用。

- `icon.png`：160×160 插件图标，圆角外透明，控制在集市要求的 64 KiB 以内。
- `preview.png`：800×320 README 题头图，控制在 128 KiB 的项目体积预算内。
- `assets/icon-source.png`、`assets/header-source.png`：生成原图。
- `assets/icon-transparent-source.png`：清除图标圆角外绿色背景后的透明原图，当前集市图标由它缩小得到；原始图保留供追溯。
- `assets/tray-16.png`、`assets/tray-32.png`、`assets/tray-48.png`：托盘尺寸；构建时封装为 ICO。

首次提交集市时保留生成原图，缩小插件图标，并对题头图进行 PNG 调色板压缩，控制在集市要求的 512 KiB 以内，保持原构图与尺寸。

2026-10-16 优化安装包预览图：从保留的 `assets/header-source.png` 生成 800×320 的 `preview.png`，保留原构图、标题和副标题。使用 Sharp 缩放及 PNG 调色板编码，参数为 `quality: 80`、`dither: 0`、`compressionLevel: 9`、`effort: 10`；不添加构建依赖。预览图从 495,661 字节降至 97,627 字节，约减少 80.3%。安装包校验增加 128 KiB 的预览图体积预算，避免后续替换素材时意外增大。

2026-10-13 修正集市图标圆角：旧图虽然带有 alpha 通道，但圆角外仍有绿色背景，部分角落完全不透明。使用内置 ImageGen 清除圆角外背景，保留绿色圆角底板与便签图案，再以保留 alpha 的方式缩小为 160×160。检查四角 alpha 均为 0、中心 alpha 为 253，以及浅色和深色背景上的边缘显示。托盘图标继续使用原有素材。

## 功能说明配图

说明图源文件为 `docs/images/01-window.png`、`02-images.png`、`03-storage.png`、`04-recovery.png`，分别说明便签操作、图片插入、保存位置和最近记录与草稿恢复。README 通过固定到完整提交 SHA 的 `https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/<commit>/docs/images/<name>.png` 公开链接加载这些图片，避免后续修改主分支时改变已发布版本的配图。源图保留在仓库中，构建时排除整个 `docs/images/` 目录；根目录的集市图标与预览图仍打包。

便签与图片预览使用构建后的 `window.html`、`window.js`、`window.css` 离线渲染，通过演示频道提供样例正文与保存状态，不连接思源工作空间。示例图片为现有插件图标。设置和最近记录为明确标注的关键项示意。图片尺寸为 1680×915，中文文字与实际界面一起渲染。

先运行 `npm run build`，再运行 `node scripts/render-docs.mjs` 生成配图。渲染需要可解析的 Playwright 包和已安装的 Chromium 浏览器；可用 `DOCS_PLAYWRIGHT` 指定包路径，`DOCS_CHROMIUM` 指定浏览器可执行文件路径。这些依赖仅供文档制图，不加入插件运行依赖。更新配图后，先将源图提交并推送至公开仓库，再将 README 中对应链接的提交 SHA 更新为该提交，确认公开链接可访问后重新运行 `npm run build`。包校验会确认说明图未被打包，且 README 不再引用本地说明图；构建过程不需要联网下载图片。

## 透明背景修正提示词

```text
Use case: background-extraction.
Asset type: existing SiYuan marketplace app icon, correcting transparency.
Input image 1 is the edit target.
Primary request: remove ONLY the unwanted dark green canvas outside the existing dark jade rounded-square tile, making all four outside corners genuinely transparent. Keep the entire rounded-square jade tile itself opaque, with its current rounded silhouette, and preserve the ivory folded sticky note, jade brush lightning stroke, shadows, textures, colors, placement, and proportions as closely as possible. This is a background cleanup, not a redesign. Maintain square framing with tile filling the canvas, no extra padding except minimally needed to avoid clipping. Clean antialiased rounded edges, no opaque green fringe or external shadow outside the tile. No text, no new objects, no checkerboard baked into the image. Output PNG with true alpha transparency outside the rounded tile.
```

## 图标提示词

```text
Use case: logo-brand. Create a polished app icon for a SiYuan desktop floating quick-note plugin. A compact warm ivory sticky note with a folded lower-right corner and a single flowing deep jade handwritten stroke that subtly forms a lightning bolt, conveying capturing a fleeting thought. Rich dark jade rounded-square background, simple strong silhouette, soft restrained dimensional paper shadow, no tiny detail, legible at 32px. Square 1024x1024 composition, icon fills canvas, generous consistent internal padding. No words, letters, numbers, pen, watermark, extra surrounding canvas. Professional calm productivity app identity.
```

## 题头图提示词

```text
Use case: ads-marketing. Create a premium wide README header banner for the Chinese SiYuan floating quick notes plugin. Wide 2.5:1 landscape composition. Deep jade green and warm ivory stationery brand, restrained tactile paper illustration. Left half spacious typography, exact large Chinese title '悬浮速记', below exact smaller subtitle '随手记下，回到思源'. On right a floating ivory sticky-note sheet with a single fluid dark-jade lightning brush stroke and folded lower-right corner; a second very subtle sheet behind it, sparse abstract trails expressing fleeting thoughts. Elegant editorial layout, generous margins, subtle paper grain, professional and quiet, perfectly legible Chinese text, no mock interface, no extra text, no watermark. Color and icon design consistent with warm ivory sticky note and dark jade brush lightning app icon.
```
