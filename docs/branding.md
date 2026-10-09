# 图标与题头图

0.1.3 使用深玉绿色与暖白纸张，突出“随手记下，回到思源”。图像由内置 ImageGen 生成，随后仅调整尺寸供插件使用。

- `icon.png`：160×160 插件图标，控制在集市要求的 64 KiB 以内。
- `preview.png`：1280×512 README 题头图。
- `assets/icon-source.png`、`assets/header-source.png`：生成原图。
- `assets/tray-16.png`、`assets/tray-32.png`、`assets/tray-48.png`：托盘尺寸；构建时封装为 ICO。

首次提交集市时保留生成原图，缩小插件图标，并对题头图进行 PNG 调色板压缩，控制在集市要求的 512 KiB 以内，保持原构图与尺寸。

## 图标提示词

```text
Use case: logo-brand. Create a polished app icon for a SiYuan desktop floating quick-note plugin. A compact warm ivory sticky note with a folded lower-right corner and a single flowing deep jade handwritten stroke that subtly forms a lightning bolt, conveying capturing a fleeting thought. Rich dark jade rounded-square background, simple strong silhouette, soft restrained dimensional paper shadow, no tiny detail, legible at 32px. Square 1024x1024 composition, icon fills canvas, generous consistent internal padding. No words, letters, numbers, pen, watermark, extra surrounding canvas. Professional calm productivity app identity.
```

## 题头图提示词

```text
Use case: ads-marketing. Create a premium wide README header banner for the Chinese SiYuan floating quick notes plugin. Wide 2.5:1 landscape composition. Deep jade green and warm ivory stationery brand, restrained tactile paper illustration. Left half spacious typography, exact large Chinese title '悬浮速记', below exact smaller subtitle '随手记下，回到思源'. On right a floating ivory sticky-note sheet with a single fluid dark-jade lightning brush stroke and folded lower-right corner; a second very subtle sheet behind it, sparse abstract trails expressing fleeting thoughts. Elegant editorial layout, generous margins, subtle paper grain, professional and quiet, perfectly legible Chinese text, no mock interface, no extra text, no watermark. Color and icon design consistent with warm ivory sticky note and dark jade brush lightning app icon.
```
