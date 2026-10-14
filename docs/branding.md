# 图标与题头图

0.1.3 使用深玉绿色与暖白纸张，突出“随手记下，回到思源”。图像由内置 ImageGen 生成，随后仅调整尺寸供插件使用。

- `icon.png`：160×160 插件图标，圆角外透明，控制在集市要求的 64 KiB 以内。
- `preview.png`：1280×512 README 题头图。
- `assets/icon-source.png`、`assets/header-source.png`：生成原图。
- `assets/icon-transparent-source.png`：清除图标圆角外绿色背景后的透明原图，当前集市图标由它缩小得到；原始图保留供追溯。
- `assets/tray-16.png`、`assets/tray-32.png`、`assets/tray-48.png`：托盘尺寸；构建时封装为 ICO。

首次提交集市时保留生成原图，缩小插件图标，并对题头图进行 PNG 调色板压缩，控制在集市要求的 512 KiB 以内，保持原构图与尺寸。

2026-10-13 修正集市图标圆角：旧图虽然带有 alpha 通道，但圆角外仍有绿色背景，部分角落完全不透明。使用内置 ImageGen 清除圆角外背景，保留绿色圆角底板与便签图案，再以保留 alpha 的方式缩小为 160×160。检查四角 alpha 均为 0、中心 alpha 为 253，以及浅色和深色背景上的边缘显示。托盘图标继续使用原有素材。

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
