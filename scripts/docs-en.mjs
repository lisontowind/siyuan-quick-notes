// Bilingual editorial copy; the screenshots themselves use real localized pages.
export function documentationCards(english) {
  const choose = (zh, en) => english ? en : zh;
  return [
    { name: '01-window', title: choose('随手记下，准备好后再保存到思源', 'Write now. Save to SiYuan when ready.'),
      intro: choose('Markdown 即时渲染 · 自定义标题 · 五种提示块类别', 'Live Markdown · Custom titles · Five callout colors'),
      items: choose([
        ['铅笔改标题，图钉放在手边', '顶部提供标题编辑、置顶和更多菜单。<br>新建与保存到思源在右下角。'],
        ['直接编辑渲染后的正文', '底栏可切换源码、展开格式工具栏。<br>支持标题、待办与常用格式，按钮可拖动排序。'],
        ['默认先保存在插件中', '“已保存到插件”表示本机草稿已经落盘。<br>首次手动保存到思源后，后续修改自动同步。'],
      ], [
        ['Edit the title with the pencil', 'Pin the note or open More at the top.<br>New note and Save to SiYuan are at the bottom right.'],
        ['Format without leaving the note', 'Live rendering is on by default. Toggle source or the<br>format toolbar below; drag tools to change their order.'],
        ['Start with a plugin draft', '“Saved in plugin” confirms a local draft.<br>Save to SiYuan once to enable later autosync.'],
      ]) },
    { name: '02-images', title: choose('截图贴进来，图片直接看', 'Paste a screenshot. See the image.'),
      intro: choose('粘贴截图、选择或拖入 · 思源资源图片 · 一键切换源码', 'Paste, choose, or drop · SiYuan image assets · Source toggle'),
      items: choose([
        ['三种方式插入图片', 'Ctrl + V 粘贴；更多 → 插入图片；<br>或直接拖入文件。macOS 使用 Command。'],
        ['正文中直接查看图片', '即时渲染显示思源资源图片。<br>底栏切换源码后，可修改 Markdown 图片链接。'],
        ['图片随思源资源同步', '支持 PNG、JPEG、GIF、WebP、BMP。<br>每次最多 10 张，总计不超过 20 MB。'],
      ], [
        ['Three ways to insert images', 'Ctrl + V to paste; More → Insert image;<br>or drop files into the editor. On macOS, use Command.'],
        ['View images in the rendered body', 'Local SiYuan assets appear directly in the note.<br>Toggle source below to edit the Markdown image link.'],
        ['Assets follow workspace sync', 'PNG, JPEG, GIF, WebP, BMP.<br>Up to 10 images and 20 MB per batch.'],
      ]) },
    { name: '03-storage', page: 'settings', title: choose('选择笔记本，预览思源保存位置', 'Choose where SiYuan saves your notes'),
      intro: choose('速记列表 → 设置 · 图中使用按天汇集模板', 'Note list → Settings · Example: group notes by day'),
      items: choose([
        ['首次保存到思源前再配置', '仅保存在插件中无需选择笔记本。<br>请选择已打开的普通非加密笔记本。'],
        ['多条便签可以汇集到同一文档', '按天模板将当天的便签放在同一文档中。<br>每条便签独立保存为原生提示块。'],
        ['先预览，再保存设置', '预览不会创建文档，点击保存设置后生效。<br>首次保存到思源确定路径，后续编辑沿用原位置。'],
      ], [
        ['Choose a notebook before the first save', 'Plugin drafts work without this setup.<br>Select an open, ordinary, unencrypted notebook.'],
        ['Preview a daily path template', 'The example groups a day’s notes in one document.<br>Each note has its own native callout.'],
        ['Save settings to apply changes', 'Preview creates no document. The first SiYuan save<br>fixes the path; later edits keep that location.'],
      ]) },
    { name: '04-recovery', page: 'notes', title: choose('一张列表，找回速记与草稿', 'Your notes and drafts, in one list'),
      intro: choose('搜索 · 继续编辑 · 列表独立置顶 · 内置设置', 'Search · Resume editing · Pin the list · Embedded settings'),
      items: choose([
        ['按摘要、路径或时间搜索', '标题与正文摘要分行展示。<br>点击记录继续编辑，列表保持打开。'],
        ['在列表中保存或回到思源', '记录右侧按钮首次保存到思源，<br>已保存的记录则直接打开思源原文。'],
        ['更多菜单收纳整理入口', '其他设备草稿与整理便签都在右上角更多中。<br>删除移除插件记录，思源正文保留。'],
      ], [
        ['Find the right note', 'Search a summary, path, or time.<br>Titles and body summaries appear on separate lines.'],
        ['Continue or save to SiYuan', 'Click a record to resume. Its side button saves a<br>plugin draft or opens an already saved SiYuan note.'],
        ['More keeps the list compact', 'Foreign drafts and Organize notes are in More.<br>Deleting removes plugin records; SiYuan content stays.'],
      ]) },
    { name: '05-cleanup', page: 'cleanup', title: choose('整理旧便签，思源内容继续保留', 'Archive old notes. Keep SiYuan content.'),
      intro: choose('速记列表 → 更多 → 整理便签', 'Note list → More → Organize notes'),
      items: choose([
        ['查看完整插件记录', '统计不受最近列表展示条数限制。<br>已打开、忙碌或内容变化的条目会跳过。'],
        ['选择归档或直接清除', '归档先保存或核实思源正文，再移出插件。<br>清除不先保存，确认后丢弃所选插件副本。'],
        ['确认前检查未保存内容', '丢弃未保存内容需要明确确认。<br>思源文档和图片始终保留。'],
      ], [
        ['Review the full plugin collection', 'Counts include notes beyond the recent-list limit.<br>Open, busy, or changed entries are skipped.'],
        ['Choose archive or clear', 'Archive saves or verifies SiYuan content first.<br>Clear discards selected plugin copies after confirmation.'],
        ['Check before confirming', 'Unsaved discards require explicit confirmation.<br>SiYuan documents and images are kept.'],
      ]) },
    { name: '06-devices', page: 'devices', title: choose('查看外机草稿，复制后继续写', 'Read another device’s draft safely'),
      intro: choose('速记列表 → 更多 → 其他设备草稿', 'Note list → More → Other devices’ drafts'),
      items: choose([
        ['先等待思源工作空间同步', '这里只显示已经同步到当前空间的草稿。<br>每台设备的草稿和窗口状态各自独立。'],
        ['只读查看完整正文', '来源草稿不可直接修改或删除。<br>预览不会改变另一台设备的内容。'],
        ['复制到本设备后编辑', '副本是一条全新的独立便签。<br>首次保存到思源时再确定它的保存位置。'],
      ], [
        ['Wait for workspace sync', 'Only drafts synced to this workspace appear.<br>Each device keeps its own drafts and window state.'],
        ['Preview the complete body', 'Foreign drafts are read-only.<br>The source draft stays on its original device.'],
        ['Copy to this device to edit', 'The copy is a new independent note.<br>Its destination is chosen when you first save to SiYuan.'],
      ]) },
  ];
}
