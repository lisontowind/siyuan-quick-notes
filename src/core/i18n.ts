export type Locale = 'zh-CN' | 'en-US';

export function resolveLocale(value?: string | null): Locale {
  return /^en(?:[-_]|$)/i.test(value ?? '') ? 'en-US' : 'zh-CN';
}

export function hostLocale(): Locale {
  return resolveLocale(typeof window === 'undefined' ? undefined : window.siyuan?.config?.lang);
}

export function windowLocale(): Locale {
  return resolveLocale(typeof document === 'undefined' ? undefined : document.documentElement?.lang);
}

const english: Record<string, string> = {
  '悬浮速记': 'Quick Notes', '新速记': 'New note', '新建速记': 'New note',
  '在思源打开': 'Open in SiYuan', '置顶': 'Pin on top', '取消置顶': 'Unpin',
  '更多': 'More', '最小化': 'Minimize', '关闭': 'Close', '再次点击关闭': 'Click again to close',
  '拖动移动窗口': 'Drag to move', 'Markdown 速记': 'Markdown note', '选择图片': 'Choose images',
  '插入图片… / 截图可直接粘贴': 'Insert image… / Paste a screenshot',
  '立即保存 / 重试': 'Save now / Retry', '重新载入原文': 'Reload original',
  '另存为新速记': 'Save as new note', '保存本机草稿后关闭': 'Save local draft and close',
  '最近速记与恢复草稿': 'Recent notes and recovery drafts', '删除这条速记…': 'Delete this note…',
  '连接中…': 'Connecting…', '写下此刻的想法…': 'Capture a thought…',
  '新速记 · 输入后自动保存': 'New note · Autosaves as you type', '待保存': 'Unsaved changes',
  '保存中…': 'Saving…', '已保存到思源': 'Saved to SiYuan', '保存失败': 'Save failed',
  '原文已变化': 'Original content changed', '仅保存到本机': 'Saved locally only', '正在编辑…': 'Editing…',
  '本机草稿已落盘，可关闭后恢复': 'Local draft is on disk; close and recover later',
  '先确保本机草稿落盘再关闭': 'Confirm the local draft is on disk before closing',
  '缺少速记会话信息': 'Missing note session information',
  '当前无法插入图片，请等待连接、输入或上传完成': 'Cannot insert images yet. Wait for connection, typing, or upload to finish.',
  '正在上传图片…': 'Uploading images…',
  '连接或窗口状态已变化，请重新插入图片': 'The connection or window state changed. Insert the images again.',
  '图片上传未收到确认，请重新插入图片': 'Image upload was not confirmed. Insert the images again.',
  '速记超过 200 万字符，当前内容未提交。请拆分或复制保留。': 'This note exceeds 2 million characters and was not submitted. Split it or copy the text to keep it.',
  '请先选中并复制文本。再次点击关闭将关闭窗口，未保存的内容可能丢失。': 'Select and copy the text first. Click Close again to close this window; unsaved content may be lost.',
  '与插件失去连接，请复制文本后点击关闭。': 'Disconnected from the plugin. Copy the text before closing.',
  '尚未连接插件，请稍后重试': 'Not connected to the plugin yet. Try again shortly.',
  '图片正在上传，已保留窗口，请等待完成后再关闭或重新载入': 'Images are uploading. This window was kept open; wait before closing or reloading.',
  '窗口尚未完成初始化，内容未确认': 'The window has not finished initializing; its content is not confirmed.',
  '速记超过 200 万字符，草稿未提交，请复制文本': 'This note exceeds 2 million characters. The draft was not submitted; copy the text.',
  '图片上传结果为空': 'Image upload returned no result', '插件已停用，请重新插入图片': 'The plugin was disabled. Insert the images again after enabling it.',
  '连接已恢复，正在核对保存状态…': 'Reconnected. Checking save status…',
  '再次点击确认放弃本窗口修改': 'Click again to discard this window’s changes',
  '与插件失去连接，请重新插入图片': 'Disconnected from the plugin. Insert the images again after reconnecting.',
  '与插件失去连接，当前输入可能尚未保存。请复制文本后点击关闭。': 'Disconnected. Your latest input may not be saved. Copy the text before closing.',
  '插件连接失败。请保留窗口内容并检查主窗口中的插件状态。': 'Could not connect to the plugin. Keep this text and check the plugin in SiYuan’s main window.',
  '正文已变化，请重新插入图片': 'The body changed. Insert the images again.',
  '插入图片后超过 200 万字符，请拆分便签': 'Adding these images would exceed 2 million characters. Split the note.',
  '图片预览': 'Image preview', '图片加载中…': 'Loading image…', '编辑图片链接': 'Edit image link', '图片': 'Image', '截图': 'Screenshot',
  '图片无法加载，请检查资源或链接': 'Could not load the image. Check the asset or link.',
  '每次最多插入 10 张图片，总大小不超过 20 MB': 'Insert up to 10 images totaling no more than 20 MB at a time.',
  '仅支持 PNG、JPEG、GIF、WebP 和 BMP 图片': 'Only PNG, JPEG, GIF, WebP, and BMP images are supported.',
  '内核返回的图片资源路径无效': 'The kernel returned an invalid image asset path.',
  '窗口忙碌，请稍后重试': 'The window is busy. Try again shortly.',
  '窗口正在关闭，请稍后重新插入图片': 'The window is closing. Insert the images again later.',
  '未收到窗口最新内容的落盘确认，已保留窗口，请复制文本': 'The latest content was not confirmed on disk. This window was kept open; copy the text.',
  '窗口内容版本不一致，已保留窗口': 'Window content versions do not match. This window was kept open.',
  '插件已停用或更新，最新内容未确认落盘。请复制文本后点击关闭。': 'The plugin was disabled or updated. The latest content was not confirmed on disk. Copy the text before closing.',
  '插件已停止，未完成内容保留为恢复草稿': 'The plugin stopped. Unfinished content is kept as a recovery draft.',
  '恢复草稿未落盘，已停止内核写入': 'The recovery draft is not confirmed on disk. Writing to SiYuan has stopped.',
  '重新载入期间有新输入，请重试': 'New input arrived while reloading. Try again.',
  '内核请求失败': 'Kernel request failed', '内核请求超时，保存结果需要核对': 'Kernel request timed out. The save result needs verification.',
  '图片上传失败': 'Image upload failed', '部分图片上传失败，请重新选择图片': 'Some images failed to upload. Select them again.',
  '图片上传超时，请重新插入图片': 'Image upload timed out. Insert the images again.',
  '速记标题须为不超过 200 字符的单行文本': 'The note title must be a single line of at most 200 characters.',
  '独立的 }}} 不是有效超级块，请将其放入代码块': 'A standalone }}} is not a valid superblock. Put it in a code block.',
  'Markdown 中的超级块未闭合，请补全或放入代码块': 'An unclosed superblock was found. Complete it or put it in a code block.',
  'Markdown 代码块未闭合，请补全后保存': 'A Markdown code block is not closed. Complete it before saving.',
  '请在插件设置中选择目标笔记本': 'Select a target notebook in the plugin settings.',
  '保存目录模板解析结果无效：请包含文档名': 'The save path template must resolve to a path containing a document name.',
  '速记文档不存在或不可访问': 'The note document does not exist or cannot be accessed.', '无效的文档 ID': 'Invalid document ID',
  '原文档标识不匹配，已停止保存': 'The original document ID does not match. Saving has stopped.',
  '原文已在其他位置修改，请重新载入或另存速记': 'The original was edited elsewhere. Reload it or save as a new note.',
  '发现已存在的内容，请重新载入后继续编辑': 'Existing content was found. Reload it before continuing to edit.',
  '原文档已删除，已停止保存': 'The original document was deleted. Saving has stopped.',
  '目标路径匹配多个文档，请调整保存位置': 'The target path matches several documents. Change the save location.',
  '速记内容块已被移动或标识不匹配，已停止保存': 'The note block was moved or its ID does not match. Saving has stopped.',
  '速记容器标识不匹配，已停止保存': 'The note container ID does not match. Saving has stopped.',
  '原内容块已删除，已停止自动保存': 'The original block was deleted. Autosave has stopped.',
  '内核未保留竖向速记容器标识，草稿已保留': 'The kernel did not retain the vertical note container ID. The draft was kept.',
  '写入后正文与提交内容不一致，草稿已保留，请重新载入或另存速记': 'The saved body differs from the submitted content. The draft was kept; reload or save as a new note.',
  '速记容器标识不匹配，已停止重新载入': 'The note container ID does not match. Reloading has stopped.',
  '宿主 Markdown 内容核对失败': 'Host Markdown content verification failed',
  '图片未插入': 'Images were not inserted', '本机草稿保存失败': 'Could not save the local draft',
  '本机草稿清理失败': 'Could not clear the local draft', '删除失败': 'Deletion failed',
  '重新载入未完成，恢复草稿更新失败，已保留当前修改': 'Reload did not finish because the recovery draft could not be updated. Current edits were kept',
  '正文核对失败，草稿已保留': 'Body verification failed; the draft was kept',
  '保存目录无效：请使用以 / 开头的目录，且不含控制字符、连续斜杠或 .、.. 路径段': 'Invalid save directory. Use a path starting with /, without control characters, repeated slashes, or . and .. segments.',
  '保存目录无效：不能包含控制字符': 'The save directory cannot contain control characters.',
  '保存目录模板未返回有效路径': 'The save path template did not return a valid path.',
  '保存目录模板解析结果无效': 'The save path template resolved to an invalid path',
  '仍包含未解析的表达式': 'Unresolved template expressions remain',
};

// Translate plugin-owned messages only. Unknown kernel/OS details are preserved.
export function translate(text: string, locale: Locale): string {
  if (locale !== 'en-US') return text;
  if (Object.hasOwn(english, text)) return english[text];
  const colon = text.indexOf('：');
  if (colon > 0 && Object.hasOwn(english, text.slice(0, colon))) {
    return `${english[text.slice(0, colon)]}: ${translate(text.slice(colon + 1), locale)}`;
  }
  return text.replace(/^内核 HTTP (\d+)$/, 'Kernel HTTP $1').replace(/^图片上传 HTTP (\d+)$/, 'Image upload HTTP $1');
}

export const t = (text: string): string => translate(text, windowLocale());

export function localizeWindow(root: HTMLElement): void {
  if (windowLocale() !== 'en-US') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    node.textContent = t(node.textContent ?? '');
  }
  for (const element of root.querySelectorAll('[title], [aria-label]')) {
    for (const name of ['title', 'aria-label']) {
      const value = element.getAttribute(name);
      if (value) element.setAttribute(name, t(value));
    }
  }
}
