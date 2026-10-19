![Quick Notes: Capture a thought. Return to SiYuan.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/3fedb25b03e2e597544e4c9d1adb1ab285c91a6b/docs/images/en/00-header.png)

[简体中文](README.md) · **English**

# Quick Notes

Capture an idea without switching back to a document in SiYuan. Press **Ctrl + Alt + N** (**Option + Command + N** on macOS) to open a small floating note for ideas, tasks, or temporary excerpts. New notes autosave in device-specific plugin drafts. After you manually save a note to SiYuan, later edits sync automatically.

Requires **SiYuan desktop 3.8.6 or later on Windows, macOS, or Linux**, with SiYuan running. See the [testing record (Chinese)](docs/testing.md) for the status of native macOS/Linux verification.

**Interface language:** floating notes and the independent recent-notes window, including its embedded settings, follow SiYuan's Chinese or English interface language. Reload the plugin after changing SiYuan's language. The tray menu and fallback panels currently use Chinese; this guide includes their Chinese labels. The operation guides show the real English note and list interfaces.

## What’s new in 0.1.28

- **Plugin drafts first:** save locally as you write; manually save to SiYuan once to enable later autosync.
- **Live Markdown and formatting:** source toggle, H1–H6, tasks, and a toolbar you can reorder.
- **Independent note list and settings:** search, pin, recover drafts, save to SiYuan, or open existing content from the list.
- **Custom titles and callouts:** click the pencil to edit a title; choose five callout types with light and dark palettes. New note and SiYuan actions are at the bottom right.
- **Draft sharing and organization:** read-only foreign drafts with independent copies, archive and clear actions, capacity reminders, and recovery choices for deleted originals.

See the [0.1.28 release notes](docs/releases/0.1.28.md) for changes and verification scope. All six operation guides below show this version’s actual interface with sample data.

## Features

The format toolbar uses consistent Lucide icons. Choose Paragraph or H1–H6 from the heading menu. Drag buttons to reorder them; “More formatting” collects tools that do not fit and includes an arrangement panel with keyboard controls and reset. The order is saved and synced through SiYuan.

The main list shows this device’s drafts and shared saved-note references. **More → Other devices’ drafts** at the top right opens read-only previews of synced foreign drafts. **Copy to this device** creates an independent local note for editing. Use the same synced workspace and include `storage/petal/siyuan-quick-notes/drafts/`, `shared/`, `settings.json`, and `toolbar.json` in sync. Toolbar order, settings, SiYuan bodies and assets continue to sync.

Deleting from the list opens confirmation inside that panel and propagates removal to other devices. SiYuan content is kept. Remote removal stops autosave in an open note while preserving its content for copying or saving as a new note; existing unsaved local drafts appear as “Removed · recover draft”. Drafts are owned by each device; foreign drafts are read-only. Actual window positions, sizes, pin states, and open states remain device-specific. Functional defaults, such as new-window size, still sync.

| What you need | How Quick Notes helps |
| --- | --- |
| Capture a passing thought | A global shortcut opens an independent note; multiple windows, pinning, and remembered positions are supported. |
| Write text and add images | Markdown live rendering by default, optional source mode, pasted screenshots, image selection and drag-and-drop, with previews of SiYuan image assets. |
| Save to SiYuan on demand | New notes stay in the plugin. Save to SiYuan manually to enable autosync after 800 ms, with each note in its own native callout. |
| Pick up where you left off | Search recent notes, recover local drafts or copy foreign drafts, and optionally restore previously open windows. |

## Get started

1. Download and extract `package.zip` from [GitHub Releases](https://github.com/lisontowind/siyuan-quick-notes/releases/latest). Place its contents in `<workspace>/data/plugins/siyuan-quick-notes/`. Back up the existing plugin directory before updating. Once the plugin is listed in the marketplace, you can also search for **Quick Notes / 悬浮速记** there.
2. Open SiYuan and enable the plugin under **Settings → Marketplace → Downloaded → Plugins**.
3. In SiYuan's top bar, open **Quick Notes (悬浮速记) → Quick note settings (速记设置)** and choose a save location in the recent window's **Settings** page.

![Storage setup: select a notebook, enter a path template, and preview the resolved document path.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/5b694913c9b46b4f5032035c49879cf2c0c39048/docs/images/en/03-storage.png)

*The current embedded settings with a sample daily template. A fresh installation uses the timestamp template below.*

**Select a target notebook before first saving to SiYuan.** Plugin-only notes need no notebook configuration. The default path is `/闪念速记/{{now | date "20060102150405"}}`. It uses the date and time of the first manual SiYuan save, down to the second, to create a document path such as `/闪念速记/20261010035000`. Each note is saved in its own **native callout**. Notes resolving to the same path are appended to the same document.

The save directory accepts SiYuan template variables. A template's result is used as the complete document path, without adding a number or child document. For example, `/Quick Notes/{{now | date "2006-01-02"}}` groups the day's notes in `/Quick Notes/2026-10-10`. Each note edits only its own callout, leaving other document content in place. A plain directory without template variables, such as `/Quick Notes`, instead receives a generated document name containing a timestamp and identifier. Time formats use Go's reference date, `2006-01-02`, and are resolved by the SiYuan kernel.

The path is fixed on the first manual SiYuan save. Retries and edits on another day continue saving to that location. Settings changes affect notes without a fixed destination.

**Preview save location (预览保存位置)** displays the selected notebook and resolved full path without creating a document. Time templates use the preview time; a note resolves its destination when first saved to SiYuan, keeping any existing destination. Saving settings validates the notebook, directory, and template. Invalid input produces an error instead of silently falling back to a default directory.

The plugin and its settings apply to Windows, macOS, and Linux desktop only. They do not read or change SiYuan's built-in quick-note defaults.

Use the **Settings gear** in the note list's upper-right corner to open embedded settings, and the upper-left **Back to note list** button to return. Adjust the save destination, shortcut action, tray, window dimensions and pinning, autosave and history limit, then choose **Save settings**. Failed saves keep your input. Returning to the list preserves unsaved settings, search and scroll position. **Reload settings** discards unsaved settings input and reads the active configuration. Top-bar, tray and SiYuan plugin settings entries open this embedded panel; the old host settings panel remains available when native windows fail. Global key bindings still use SiYuan's shortcut settings; opening that entry minimizes the list window.

**Shortcut action** supports creating a note, focusing the most recent note, or opening the note list. Creating a note remains the default. Opening the list works even when the note limit is reached. The plus button always creates a note; tray left-click behavior is configured separately.

## Capture a thought

![Note window: toolbar actions, Markdown body, and save status.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/5b694913c9b46b4f5032035c49879cf2c0c39048/docs/images/en/01-window.png)

*The current English note window with sample content. Title editing, pin, More, minimize and close are at the top; New note and Save/Open in SiYuan are at the bottom right.*

- **Create a note:** press `Ctrl + Alt + N` (`Option + Command + N` on macOS), or click the plus button in a note's lower-right corner. You can open several notes at once.
- **Write directly:** there is one Markdown body editor, with no separate title field. When saved to SiYuan, each note uses a native callout with its contents arranged from top to bottom.
- **Identify a window:** the upper left shows its SiYuan document title and provides a drag area. Click the pencil beside the title to set a custom callout title. Tray entries and recent records prefer that title, then the first nonempty body line. The shortcut can be configured to wake the most recent window; the plus button always creates a new note.
- **Keep it nearby:** click the pin button to keep the window on top. Drag the toolbar's blank area to move it, or drag an edge to resize it.
- **Save or return to SiYuan:** the arrow button offers **Save to SiYuan** before the first confirmed save, then **Open in SiYuan**. Each list row has the same action above Delete.
- **Resume an older note:** open **Note list (速记列表)**, search by first-line summary, save location, or time, and click a record to continue editing.
- **Use the tray:** Windows has a green note icon; macOS uses a monochrome menu-bar icon. Left-click creates a note by default; **Tray left-click action (托盘左键行为)** can switch it to opening the independent recent list. The change applies after saving and is independent of the global shortcut. Right-click opens the menu. Linux uses the desktop environment's tray menu. **Close tray icon (关闭托盘图标)** saves that preference; re-enable it in the plugin's settings from SiYuan's top bar.

### Markdown live rendering

Live rendering is enabled by default and allows direct body editing. Recognized Markdown markers stay hidden when clicking, moving the cursor or selecting text. Task checkboxes update `[ ]` / `[x]` as an undoable edit. Tables remain rendered; use the footer source switch to edit their structure or existing image and link addresses.

The footer's **Show source / Return to rendering** button switches the whole editor without changing or saving text, selections or undo history. Source mode disables decorations and image previews. **Show toolbar / Hide toolbar** expands formatting tools above the footer; the toolbar starts collapsed and moves overflow into “More formatting” in narrow windows. Both modes support bold, italic, underline, strikethrough, Paragraph and H1–H6 headings, lists, tasks, quotes, inline code, links and images. Select text to apply or remove a format; an empty selection inserts paired markers with the cursor between them. The link tool asks for an HTTP/HTTPS address.

Underline is stored as `<u>text</u>`, supported by SiYuan. Only paired, attribute-free underline tags are rendered; arbitrary HTML is not executed. Other HTML, SiYuan-specific syntax and unsupported content remain source text. Very large tables remain source to avoid excessive DOM rendering. Math and diagrams are not rendered; the fallback editor remains a source editor. Source and toolbar visibility are local to the current window; reopened notes start rendered with the toolbar collapsed.

### Add screenshots and images

![Images: paste a screenshot, choose a file, or drop an image; keep the Markdown link and view its preview below.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/5b694913c9b46b4f5032035c49879cf2c0c39048/docs/images/en/02-images.png)

*The current live-rendering editor, using the plugin icon as a sample image. Toggle source below to edit image links.*

The editor stores Markdown and enables live rendering by default. After taking a screenshot, return to the note and press **Ctrl + V** (**Command + V** on macOS). You can also choose **More (更多) → Insert image (插入图片)** or drop image files into the editor.

In a floating window, dropped images are inserted at the drop point; pasted or selected images use the current cursor or replace the selection. The fallback editor has an Insert image button and uses the cursor position for drops.

Supported formats: PNG, JPEG, GIF, WebP, and BMP. Each batch accepts up to **10 images totaling 20 MB**. Once upload succeeds, Markdown links are inserted. Images are stored in the SiYuan workspace's `data/assets/` directory and follow SiYuan's asset synchronization. Rendering hides supported image links and displays previews scaled to the window. Switch to source in the footer to edit the original links. Existing images also appear when reopening saved notes or recovering drafts.

Previews load only those image formats from SiYuan's asset directory. Image examples inside code blocks and external image URLs are not loaded automatically. A missing or unreadable asset shows an image-load error; its link and the rest of the body remain editable and saveable. The fallback editor remains a source editor. Other attachment types are not supported.

The body is temporarily read-only during upload. Closing or reloading normally asks you to wait for completion. If upload fails, the original text remains; paste or select the images again. Images not yet inserted are not included in local recovery drafts. Partial failures, timeouts, or disabling the plugin during upload can leave unreferenced SiYuan assets. Use SiYuan's asset management tools to handle them; the plugin does not delete assets automatically.

### Common actions

| Action | Shortcut or entry |
| --- | --- |
| New note | `Ctrl + Alt + N` (macOS: `Option + Command + N`) / toolbar plus |
| Save now | `Ctrl + S` (macOS: `Command + S`) / More → Save now (立即保存) |
| Add an image | `Ctrl + V` (macOS: `Command + V`) / More → Insert image (插入图片) / drag image files in |
| Pin or unpin | Toolbar pin |
| Keep a draft and close | More → Save draft and close (保存草稿后关闭) |
| Save a separate copy | More → Save as new note (另存为新速记) |
| Delete a plugin record | More → Delete this note (删除这条速记) / delete button in the recent list |
| Change the shortcut | Search for New floating quick note (新建悬浮速记) in SiYuan's shortcut settings |

## Recover recent notes and drafts

![Recovery: search by summary, path, or time; reopen saved notes, recover local drafts, and optionally restore windows.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/5b694913c9b46b4f5032035c49879cf2c0c39048/docs/images/en/04-recovery.png)

*The current independent note list with sample records and times.*

Open **Note list (速记列表)** from a note's More menu, SiYuan's top bar, or the tray menu. This is an independent window: repeated opening focuses the existing list, it does not count toward the note limit, and opening a record keeps the list open. Open notes, local drafts and history are merged by note ID and sorted by latest update, with draft and open badges. Search by first-line summary, location, or time; refresh preserves the query and scroll position.

Opening a record first focuses an existing editor, otherwise restores a local draft, otherwise loads the latest body from SiYuan. The list defaults to 400×560 and unpinned, and can be pinned or minimized independently. The existing remember-position setting controls its separate `recent-window.json` state in the device draft directory. The list does not reopen automatically on restart. If native windows are unavailable, the main-window recovery dialog remains available.

To put a note away temporarily, choose **More → Save draft and close (保存草稿后关闭)**. Resume directly on this device; preview and copy drafts from other devices before editing. **Restore previously open windows after restart (重启后恢复上次打开的窗口)** is off by default and can be enabled in settings. Manual draft recovery remains available when automatic restoration is off.

**Deleting a note clears local plugin records and propagates removal to other devices' lists. SiYuan documents and their contents are kept.** Before confirming, check whether you still need any unsaved draft. The details are below.

## Organize, archive and clear notes

### Device-specific drafts and foreign previews

![Foreign draft preview: read the complete synced body and copy it to this device before editing.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/5b694913c9b46b4f5032035c49879cf2c0c39048/docs/images/en/06-devices.png)

Drafts live under `storage/petal/siyuan-quick-notes/drafts/<device ID>/`. The main list, automatic recovery and organization statistics use only this device’s drafts. Saved SiYuan references remain shared. After workspace sync finishes, choose **More → Other devices’ drafts** at the top right to preview a device identifier, summary, modification time and complete read-only body.

Foreign drafts cannot be edited, saved to SiYuan or deleted directly. **Copy to this device** first persists a new local note and then opens it. The copy receives a fresh identity and does not inherit the source’s SiYuan link, save location, baseline or window state. Editing and saving it leaves the source intact. Refresh if the source changes or disappears. Only content already synced to this workspace is visible.

Existing bodies from the previous `shared/drafts/` implementation are preserved. Uncovered versions appear as **Legacy shared draft** recovery sources with read-only preview and copy. Upgrade does not automatically merge, migrate or delete these bodies. Local edits preserved after remote removal can also be recovered as new notes.

The note list footer shows all unarchived notes, notes not saved to SiYuan, and archive candidates, while **Organize notes** and **Other devices’ drafts** are available in the top-right **More (⋯)** menu. Reminders and the snooze button stay hidden below the threshold. **Remind me in 7 days** appears in the footer only when the threshold is reached and reminders have not been postponed. Organization reads the full shared index, local drafts and body copies, independently of the recent list display limit.

The default reminder threshold is **100 notes**, with at most one brief reminder per day on each device. Choose **Remind me in 7 days** in the list to postpone it. Settings let you disable reminders or change the threshold and archive age. Archive selection defaults to notes last edited **more than 30 days ago**, skipping open or busy notes. Opening a note or loading unchanged content does not reset its edit time. Reminders never delete content automatically.

![Organization: review the full collection, choose archive or clear, and confirm how unsaved content is handled.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/5b694913c9b46b4f5032035c49879cf2c0c39048/docs/images/en/05-cleanup.png)

- **Archive and remove from plugin** saves pending content to SiYuan using the existing destination, or verifies that an already-saved original can still be read without overwriting newer SiYuan edits. Each successful note is removed from every device’s list; local drafts, body copies and window recovery records are cleared. Find archived content in SiYuan afterward; plugin-copy recovery is no longer available for it.
- **Clear from plugin** skips saving. Notes with unsaved content are unchecked by default. Selecting them explicitly displays the number of local unsaved notes that will be permanently discarded before confirmation. SiYuan documents and images are kept.

Progress includes success, failure and skipped counts. Retry failed notes or stop subsequent work while keeping completed results. Failures, conflicts, missing originals and changed content are retained. Interrupted cleanup resumes on restart only for approved, unchanged content. Other devices keep unsubmitted local edits for recovery; clean local copies are removed after the removal state syncs. Returning offline devices cannot restore removed list entries.

## Where is content saved?

New notes autosave in this device’s plugin drafts. Typing, `Ctrl + S` (`Command + S` on macOS), Save now, and normal close do not create SiYuan content. Nonempty notes remain recoverable after closing and restarting. A new note that has never been saved to SiYuan is removed automatically if it is blank when closed, including whitespace-only content. The lower-right arrow button offers **Save to SiYuan** until the first confirmed save, then changes to **Open in SiYuan**. The same button appears above Delete on each list row. The first click saves without opening a document. Later edits autosync after **800 ms**, on Save now, or on normal close. A note needs either a title or body before its first SiYuan save.

**“Saved in plugin” confirms persistence on this device; “Saved to SiYuan” confirms a successful SiYuan body save.** Failed first saves retain the plugin body and the save action. Normal close syncs only notes already saved to SiYuan, after confirming the local draft is on disk. If sync fails, the window closes with its local draft retained. If the latest draft has not been confirmed on disk, the window stays open.

The plugin keeps a complete confirmed body copy on this device in `drafts/<device ID>/saved/`. When reopening a note or choosing **Open in SiYuan**, a deleted source offers **Restore to SiYuan**, **Delete note**, or **Cancel**. Restore writes the full plugin copy back; Delete removes the plugin records, draft, and copy. Network or kernel errors do not count as deletion. Older notes whose sources were already deleted without a full local copy cannot be recovered from a summary; use SiYuan history or trash instead.

The upper-left title defaults to the SiYuan document name and remains draggable. **Click the pencil beside the title** to set a single-line note title of up to **200 characters**. Leave it blank to restore the default. The title text remains a native drag area with the system context menu. You can also press F2 from the editor, or choose Edit title from the upper-right More menu. Lists display the title and body preview on separate lines, using the document name or Untitled note when no custom title exists. Titles autosave and survive closing, restarting, copying and recovery. Lists and the tray prefer the custom title. Saved-note titles sync with shared references; unsaved drafts stay device-specific and retain their title when copied locally.

The note title appears at the top of the native SiYuan callout, with the body underneath. The document name stays unchanged. Cancel leaves the current title unchanged. Title-only notes can also be saved to SiYuan. The footer continues to show save status and errors.

Titles entered in older versions are preserved as a level-one heading at the start of the body. You can edit or remove that heading in saved notes and recovered drafts; it is not repeatedly added.

Use the bottom-right **Callout type** button to choose **NOTE (default), TIP, IMPORTANT, WARNING, or CAUTION**. The note background changes immediately, with colors for light and dark themes. The category and title autosave alongside the unchanged body and survive restart and copying. Saved notes sync to the original callout. External changes to the callout title or category trigger conflict protection; Reload reads those changes back.

Older horizontal or vertical superblocks are converted in place to native callouts on the next edit or explicit save, keeping its block ID and document. Notes saved as standalone documents in 0.1.17 are copied into native callouts at the current save location on their next edited save. The original standalone documents are kept. Upgrading alone does not bulk-migrate or delete SiYuan content.

Drafts, recovery copies and window state are stored under `<workspace>/data/storage/petal/siyuan-quick-notes/drafts/<device ID>/`. Other devices can preview synced drafts and copy them locally before editing. They do not open your windows or inherit their positions.

The device ID is stored in `.siyuan/quick-notes-device-id` under the current OS user's home directory, independently of the workspace. Keep this file so the plugin can find this device's drafts after a restart. Do not copy it to another computer.

Starting with 0.1.25, the first Windows load copies and verifies the current workspace's older drafts and window state from `%LOCALAPPDATA%/SiYuanQuickNotes/`, keeping the original files as a backup. Migration runs once to prevent old drafts from reappearing after saving or deleting them. A migration failure stops initialization and preserves the old files for troubleshooting and retry. macOS/Linux use the same device-scoped workspace directory and do not read the older Windows directory.

The recent list displays **50 saved notes** by default, configurable from **1 to 200** with **Recent list display limit (最近记录展示条数)**. Reducing the limit only reduces the displayed records; the shared index, SiYuan content, and recovery drafts are kept. Increasing it shows older records still in the shared index. Records discarded by older releases cannot be recovered automatically. Recovery drafts do not count toward that limit. New installations default to a 320-pixel-wide window; existing saved window sizes are retained.

By default, up to **10 notes** can be open at once. Set **Maximum open notes (最多同时打开的便签)** from **1 to 50** in settings. Creating a note, saving a copy, and restoring windows all respect this limit. At the limit, close one note before opening another; the shortcut wakes the most recent window. Lowering the limit keeps already open notes. Upgrades retain a previously saved limit.

Deleting from the list opens confirmation inside that panel. Confirmation clears the local draft, recent record and window recovery record, closes the local note, and syncs a removal marker to other devices' lists. **The SiYuan document and all its content remain.** No SiYuan deletion API is called. Unsaved local content is deleted and cannot be undone through the plugin. Other devices keep unsaved content for recovery or saving as a new note. If local cleanup fails, the window is kept for retry; an already written shared removal marker remains effective. Deleting from a note's own More menu continues to use SiYuan's confirmation dialog.

When automatic window restoration is enabled, the next plugin load restores previously open notes, including drafts not yet saved to SiYuan. The open-window note index is device-scoped and independent of the recent-list limit. Saved-note recovery reads the latest body from SiYuan; draft recovery keeps this device's unsubmitted content. An old window already removed from the recent list, with no recovery draft, cannot be recovered from older window-size records alone.

Restoration uses the last recorded position, size, and pin state, falling back to the draft's position when no window record exists. If one record cannot be opened, other records are still attempted until the window limit is reached. Repeated restoration does not progressively enlarge windows.

## If saving fails

- **Invalid save location (保存位置无效):** select an open, ordinary notebook in settings. Check that the directory begins with `/`. For a template error, check variables and the time format.
- **Original content changed (原文已被修改):** keep the current window's text. Use **Save as new note (另存为新速记)** to retain a copy, or confirm **Reload original (重新载入原文)**. Automatic overwriting stops to protect changes made elsewhere.
- **Unclosed code block or superblock (代码块或超级块未闭合):** complete the Markdown closing markers, or save a local draft first.
- **Disconnected from plugin (与插件失去连接):** keep SiYuan running and check that the plugin is enabled. Preserve the window's text before troubleshooting. After more than six seconds without communication, editing stops while selection and copying remain available. Copy the text, click Close, and click again when prompted. If communication recovers, editing resumes and unconfirmed input is resubmitted.
- **Draft not confirmed on disk (草稿未落盘):** copy the body elsewhere first. Closing the window at this point does not mean the content is safely saved.

After an interrupted close or reload, the retained window becomes editable again and retries unsubmitted saves using the configured debounce interval. External-edit conflicts still need manual handling.

Before reloading, the recovery draft is updated; if that fails, the current edits are kept. If **Local draft cleanup failed (本机草稿清理失败)** appears, the remaining local draft contains the newly loaded body. Save again after releasing any file lock to retry cleanup. Settings take effect only after their save is confirmed. At the window limit, **Save as new note** asks you to close a window before retrying.

Normal plugin deactivation collects window content and confirms drafts first. Force-quitting SiYuan, a power failure, or a disk failure can still lose the latest input. Check the save status for important content.

During an update or deactivation, notes with confirmed local drafts close and can be reopened from the recovery list. With automatic restoration enabled, reloading the plugin restores them. If content collection or draft writing fails, the body stays available for copying; Close first asks you to copy it, then closes on a second click.

## Current scope

Multiple windows, individual pinning, remembered positions, tray access, and local draft recovery are supported. The target must be an open, ordinary, unencrypted notebook. Quick Notes cannot run independently after SiYuan fully exits. A single note supports up to **2 million characters**.

Linux tray visibility and menu behavior depend on the desktop environment. If no tray is available, create or recover notes from SiYuan's top bar. X11 uses the standard window and shortcut interfaces. On Wayland, global shortcuts, exact position restoration, pinning, and active focus depend on the SiYuan host, desktop environment, and permissions. The system may reposition windows; after waking a note, you may need to switch to it through the system's window list. The plugin does not change host startup arguments or system shortcut settings. See Electron's [window documentation](https://www.electronjs.org/docs/latest/api/browser-window) and [global shortcut documentation](https://www.electronjs.org/docs/latest/api/global-shortcut).

The top-bar entry remains available if the tray is unavailable. If a native floating window cannot be created, a clearly marked fallback editor can save content and open SiYuan's official document window. The illustrations show Windows-style shortcuts; use the Command shortcuts above on macOS.

Editing a saved note may rebuild its internal child blocks. If you need stable long-term references to a child block, edit it in SiYuan. Watch for conflict notices when editing the same note from multiple devices.

For verified native behaviors and pending checks, see the [testing record (Chinese)](docs/testing.md). Build details are in the [development documentation (Chinese)](docs/development.md).
