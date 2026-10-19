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
  '笔记': 'Note', '技巧': 'Tip', '重要': 'Important', '警告': 'Warning', '注意': 'Caution',
  '提示块类别': 'Callout type', '无效的提示块类别': 'Invalid callout type',
  'NOTE · 笔记': 'NOTE · Note', 'TIP · 技巧': 'TIP · Tip', 'IMPORTANT · 重要': 'IMPORTANT · Important',
  'WARNING · 警告': 'WARNING · Warning', 'CAUTION · 注意': 'CAUTION · Caution',
  '标题将显示在思源提示块顶部，思源文档名保持不变。': 'The title appears at the top of the SiYuan callout. The document name stays unchanged.',
  '提示块结构不完整，已保留草稿': 'The callout structure is incomplete. Your draft was kept.',
  '内核未保留原生提示块标识，草稿已保留': 'The kernel did not preserve the native callout identity. Your draft was kept.',

  '未命名便签': 'Untitled note', '暂无正文': 'No body text', '正文摘要待更新': 'Body preview will appear after reopening',
  '双击修改标题': 'Double-click to edit title', '便签标题': 'Note title', '修改标题': 'Edit title', '保存': 'Save', '留空使用默认标题': 'Leave blank to use the default title',
  '拖动移动窗口，点击铅笔修改标题': 'Drag to move; click the pencil to edit title',
  '仅修改便签标题，不改变正文和思源文档名。': 'Changes the note title only. Body and SiYuan document name stay unchanged.',
  '便签标题须为不超过 200 字符的单行文本': 'Use a single-line note title of up to 200 characters.',

  '其他设备草稿': 'Other devices’ drafts', '恢复本机草稿': 'Recover local draft', '选择草稿': 'Select a draft',
  '复制到本设备': 'Copy to this device', '设备': 'Device', '历史共享草稿': 'Legacy shared draft',
  '暂无其他设备草稿，请等待思源同步后刷新': 'No other devices’ drafts. Refresh after SiYuan finishes syncing.',
  '其他设备草稿仅供查看，请复制到本设备后编辑': 'Other devices’ drafts are read-only. Copy to this device to edit.',
  '其他设备草稿仅供查看，请复制到本设备后编辑。仅显示已同步到当前工作空间的内容。': 'Other devices’ drafts are read-only. Copy to this device to edit. Only content synced to this workspace is shown.',

  '草稿': 'Draft', '多个版本': 'Multiple versions', '选择版本': 'Choose version', '选择草稿版本': 'Choose a draft version',
  '草稿版本': 'Draft version', '版本正文预览': 'Version content preview', '已移除 · 草稿恢复': 'Removed · recover draft',
  '不同设备的修改已分别保留。继续所选版本时，其他版本会另存为独立便签。已打开的原便签请先关闭；也可以只另存所选版本。': 'Changes from different devices have been kept separately. Continuing a selected version saves the others as separate notes. Close the original note first, or save only the selected version as a new note.',
  '继续此版本并保留其他版本': 'Continue this version and keep the others', '另存所选版本': 'Save selected version as a new note',
  '继续此版本': 'Continue this version', '另存为新便签': 'Save as new note',
  '继续所选版本前，会把其他版本另存为独立便签。原便签已打开时，可先关闭或直接另存。': 'Continuing saves the other versions as separate notes. Close the original first, or save a copy.',
  '草稿存在多个版本，请从速记列表选择版本或另存': 'This draft has multiple versions. Choose a version or save a copy from the note list.',
  '草稿版本已变化，请刷新后重试': 'Draft versions have changed. Refresh and try again.',
  '请先关闭这条便签，再选择要继续的版本': 'Close this note before choosing a version to continue.',
  '共享草稿版本损坏，原文件已保留': 'A shared draft revision is damaged. The original file was kept.',
  '多个版本，先选择版本': 'Multiple versions; choose a version first',
  '整理便签': 'Organize notes', '便签整理': 'Note organization', '整理方式': 'Organization mode',
  '便签已达到整理提醒条数': 'Your notes have reached the reminder threshold', '关闭提醒': 'Dismiss reminder',
  '归档并移出插件': 'Archive and remove from plugin', '直接从插件清除': 'Clear from plugin',
  '全部未归档': 'Unarchived', '未保存到思源': 'Not saved to SiYuan', '可归档': 'Ready to archive',
  '7 天后再提醒': 'Remind me in 7 days', '已延后 7 天提醒': 'Reminder postponed for 7 days',
  '便签已达到整理提醒条数。请打开速记列表整理，或选择 7 天后再提醒。': 'Your notes have reached the reminder threshold. Open the note list to organize them or postpone the reminder for 7 days.',
  '归档先确认最新内容已保存到思源，再移出所有设备的列表。清除会直接丢弃选中的本机内容。思源文档和图片保留。': 'Archive confirms the latest content is saved to SiYuan before removing notes from every device’s list. Clear discards selected local content. SiYuan documents and images are kept.',
  '选择符合条件的便签': 'Select eligible notes', '取消选择': 'Deselect all', '执行所选操作': 'Process selected notes',
  '重试失败项': 'Retry failed notes', '停止后续处理': 'Stop after current note', '确认整理': 'Confirm organization',
  '将永久丢弃本机未保存内容的条数': 'Notes whose unsaved local content will be permanently discarded',
  '思源文档和图片保留；操作完成后不能通过插件撤销。': 'SiYuan documents and images are kept. Completed actions cannot be undone in the plugin.',
  '有未保存到思源的内容': 'Has content not saved to SiYuan', '已打开，跳过': 'Open; skipped', '正在处理，跳过': 'Busy; skipped',
  '暂无需要整理的便签': 'No notes to organize', '正在整理': 'Organizing', '已停止后续处理': 'Remaining work stopped',
  '整理完成': 'Organization complete', '成功': 'Succeeded', '跳过': 'Skipped', '失败': 'Failed', '确认': 'Confirm',
  '整理数据读取失败': 'Could not load organization data', '整理任务正在进行': 'An organization task is already running',
  '整理选择无效': 'Invalid note selection', '正文已变化，请刷新后重试': 'Content changed. Refresh and try again.',
  '请确认丢弃未保存的本机内容': 'Confirm discarding unsaved local content',
  '整理任务正在处理这条便签，请稍后重试': 'This note is being organized. Try again shortly.',
  '速记已从插件移除，请复制或另存本机修改': 'This note was removed. Copy or save local changes as a new note.',
  '清理记录损坏，原文件已保留': 'Cleanup journal is damaged. The original file was kept.',
  '提醒记录损坏，原文件已保留': 'Reminder state is damaged. The original file was kept.',
  '最近记录展示条数': 'Recent list display limit',
  '仅限制最近列表展示，不清理正文、副本或草稿。整理便签可查看全部记录。': 'Limits only the recent list display. Bodies, copies and drafts are kept. Organize notes shows all records.',
  '启用整理提醒': 'Enable organization reminders', '整理提醒条数': 'Reminder note count', '归档候选天数': 'Days since last edit for archive selection',
  '达到条数后每天最多轻提示一次，不会自动删除内容。': 'At most one reminder per day after reaching the threshold. Content is never deleted automatically.',
  '按最后修改时间筛选，默认跳过正在打开的便签。': 'Select by last content edit. Open notes are skipped by default.',
  '思源中已删除': 'Deleted in SiYuan',
  '思源中已删除，是否删除便签或恢复到思源？': 'This note was deleted in SiYuan. Delete the plugin note or restore it to SiYuan?',
  '删除将清理插件中的便签和副本；恢复将使用插件副本重新写入思源。': 'Delete removes the plugin note and its copy. Restore writes the plugin copy back to SiYuan.',
  '恢复到思源': 'Restore to SiYuan', '删除便签': 'Delete note',
  '没有可用的插件正文副本，无法恢复。请从思源历史或回收站恢复。': 'No full plugin copy is available. Restore this note from SiYuan history or trash.',
  '保存到思源中': 'Save to SiYuan', '在思源中打开': 'Open in SiYuan', '已保存到插件': 'Saved in plugin',
  '默认保存到思源': 'Save to SiYuan by default',
  '开启后，新建、打开或编辑的非空便签会自动保存到思源，失败时保留本机草稿。跨设备同步需在思源中配置数据同步。': 'Automatically save nonempty notes to SiYuan when created, opened or edited. Local drafts are kept if saving fails. Configure SiYuan data sync for access on other devices.',
  '新速记 · 输入后自动保存到插件': 'New note · Autosaves in plugin',
  '首次保存到思源时确定保存位置，修改设置只影响尚未确定位置的便签。': 'The destination is fixed when first saving to SiYuan. Changes affect notes without a destination.',
  '速记内容为空，请输入内容后保存到思源': 'This note is empty. Enter content before saving to SiYuan.',
  '正在保存到思源，请稍后重试': 'Saving to SiYuan. Try again shortly.',
  '速记已从插件移除': 'This note was removed from the plugin.',
  '更多格式': 'More formatting', '调整顺序': 'Arrange tools', '恢复默认顺序': 'Reset order',
  '正文': 'Paragraph', '向前移动': 'Move earlier', '向后移动': 'Move later',
  '按住拖动，或使用左右按钮调整顺序': 'Drag to reorder, or use the move buttons',
  '工具栏顺序未保存': 'Toolbar order was not saved', '工具栏设置未收到确认，请重试': 'Toolbar settings were not confirmed. Try again.',
  '工具栏顺序已保存': 'Toolbar order saved',
  '工具栏设置暂不可用': 'Toolbar settings are unavailable',
  '其他设备已更新设置。当前输入已保留，重新载入可查看同步结果。': 'Settings changed on another device. Your edits were kept; reload to see the synced settings.',
  '从插件删除这条速记？': 'Remove this note from the plugin?',
  '将清理插件中的草稿、最近记录和窗口记录，并同步移除其他设备的列表记录。已保存到思源的正文保留。尚未保存的本机内容将被删除，此操作不可通过插件撤销。': 'This removes the plugin draft, history and window records, including list entries on other devices. Content saved in SiYuan is kept. Unsaved local content will be deleted. The plugin cannot undo this action.',
  '这条速记已从插件移除，当前内容已保留，可复制或另存为新速记。': 'This note was removed from the plugin. Your content was kept; copy it or save as a new note.',
  '已移除 · 本机恢复': 'Removed · Local recovery',
  '正文暂不可用，请等待思源同步完成后刷新重试': 'Content is not available yet. Wait for SiYuan sync and refresh',
  '删除未完成，请重试': 'Removal did not finish. Try again.',
  '修改后点击保存，返回列表会保留输入。': 'Save to apply changes. Returning to the list keeps your edits.',
  '链接地址': 'Link URL', '应用链接': 'Apply link', '应用': 'Apply', '取消': 'Cancel',
  '正文已变化，请重新插入链接': 'The body changed. Insert the link again.', '请输入有效的 HTTP 或 HTTPS 链接': 'Enter a valid HTTP or HTTPS link.',
  '返回速记列表': 'Back to note list', '显示源码': 'Show source', '返回渲染': 'Return to rendering',
  '显示工具栏': 'Show toolbar', '隐藏工具栏': 'Hide toolbar', '格式工具栏': 'Formatting toolbar',
  '加粗': 'Bold', '斜体': 'Italic', '下划线': 'Underline', '删除线': 'Strikethrough', '标题': 'Heading',
  '无序列表': 'Bullet list', '有序列表': 'Numbered list', '待办': 'Task list', '引用': 'Quote', '行内代码': 'Inline code', '链接': 'Link', '插入图片': 'Insert image',
  '速记与设置': 'Notes and settings', '速记': 'Notes', '设置': 'Settings', '保存设置': 'Save settings', '重新载入设置': 'Reload settings',
  '正在载入设置…': 'Loading settings…', '设置读取失败，请重试': 'Could not load settings. Try again.',
  '设置保存未确认，请重试': 'Settings save was not confirmed. Try again.', '设置操作未确认，请重试': 'Settings operation was not confirmed. Try again.',
  '修改后点击保存，切换页签会保留输入。': 'Save to apply changes. Switching tabs keeps your edits.', '有未保存的修改': 'Unsaved changes',
  '正在保存设置…': 'Saving settings…', '速记设置已保存': 'Settings saved', '设置未保存': 'Settings were not saved',
  '设置格式无效，请检查输入': 'Invalid settings. Check the input.', '保存位置': 'Save location', '目标笔记本': 'Target notebook',
  '请选择笔记本': 'Select a notebook', '保存目录（支持模板变量）': 'Save path (templates supported)',
  '首次输入时确定保存位置，修改设置只影响新便签。': 'The destination is fixed on first input. Changes affect new notes only.',
  '预览保存位置': 'Preview save location', '仅预览，不创建文档。': 'Preview only; no document is created.',
  '保存位置已更改，请重新预览。': 'The destination changed. Preview it again.', '正在解析保存位置…': 'Resolving save location…', '无法预览': 'Could not preview',
  '快捷键与托盘': 'Shortcuts and tray', '默认快捷键': 'Default shortcut', '打开思源快捷键设置': 'Open SiYuan shortcut settings',
  '快捷键行为': 'Shortcut action', '唤醒最近窗口': 'Focus the most recent note', '显示独立速记托盘图标': 'Show the Quick Notes tray icon',
  '托盘左键行为': 'Tray left-click action', '新建便签': 'New note', '打开速记列表': 'Open note list',
  'Linux 使用桌面环境提供的托盘菜单，此选项不改变菜单行为。': 'Linux uses the desktop tray menu; this option does not change it.',
  '独立于全局快捷键行为，保存后立即生效。': 'Independent of the global shortcut. Applies after saving.',
  '便签窗口': 'Note windows', '默认窗口宽度': 'Default window width', '默认窗口高度': 'Default window height',
  '新窗口默认置顶': 'Pin new windows by default', '记忆窗口位置、大小与置顶': 'Remember position, size and pin state',
  '重启后恢复上次打开的窗口': 'Restore open notes after restart', '未保存草稿始终保留恢复入口。': 'Unsaved drafts remain available for recovery.',
  '最多同时打开的便签': 'Maximum open notes', '调小上限不会关闭已打开的便签。': 'Lowering this limit keeps existing windows open.',
  '保存与历史': 'Saving and history', '自动保存防抖（毫秒）': 'Autosave delay (ms)', '最近速记记忆条数': 'Recent history limit',
  '调小后只移出较旧的列表记录，思源正文和本机草稿保留。': 'Lowering this limit removes older list entries. SiYuan content and drafts are kept.',
  '显示保存成功状态': 'Show successful save status', '保存失败与冲突始终显示。': 'Errors and conflicts are always shown.',
  '请先选择一个已打开的普通笔记本': 'Select an open, non-encrypted notebook first.',
  '即时渲染': 'Live rendering', 'Markdown 源码': 'Markdown source',
  '切换待办状态': 'Toggle task', '编辑表格源码': 'Edit table source',
  '搜索速记': 'Search notes', '搜索摘要、保存位置或时间': 'Search summary, path, or time',
  '刷新': 'Refresh', '删除': 'Delete', '本机草稿': 'Local draft', '已保存': 'Saved', '已打开': 'Open',
  '条速记': 'notes', '没有匹配的速记': 'No matching notes', '暂无速记，点击上方加号新建。': 'No notes yet. Use + to create one.',
  '与插件失去连接，请重新打开列表。': 'Disconnected. Reopen the list.',
  '操作未确认，请刷新后重试': 'Operation not confirmed. Refresh before retrying.',
  '速记已不在列表中，请刷新后重试': 'The note is no longer listed. Refresh and try again.',
  '悬浮速记': 'Quick Notes', '新速记': 'New note', '新建速记': 'New note',
  '在思源打开': 'Open in SiYuan', '置顶': 'Pin on top', '取消置顶': 'Unpin',
  '更多': 'More', '最小化': 'Minimize', '关闭': 'Close', '再次点击关闭': 'Click again to close',
  '拖动移动窗口': 'Drag to move', 'Markdown 速记': 'Markdown note', '选择图片': 'Choose images',
  '插入图片… / 截图可直接粘贴': 'Insert image… / Paste a screenshot',
  '立即保存 / 重试': 'Save now / Retry', '重新载入原文': 'Reload original',
  '另存为新速记': 'Save as new note', '保存本机草稿后关闭': 'Save local draft and close', '保存草稿后关闭': 'Save draft and close',
  '速记列表': 'Note list', '删除这条速记…': 'Delete this note…',
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
  for (const input of root.querySelectorAll<HTMLInputElement>('[placeholder]')) input.placeholder = t(input.placeholder);
}
