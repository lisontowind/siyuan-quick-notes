![Quick Notes: Capture a thought. Return to SiYuan.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/3fedb25b03e2e597544e4c9d1adb1ab285c91a6b/docs/images/en/00-header.png)

[简体中文](README.md) · **English**

# Quick Notes

Capture an idea without switching back to a document in SiYuan. Press **Ctrl + Alt + N** (**Option + Command + N** on macOS) to open a small floating note for ideas, tasks, or temporary excerpts. Your text is saved to SiYuan automatically after you stop typing.

Requires **SiYuan desktop 3.8.6 or later on Windows, macOS, or Linux**, with SiYuan running. See the [testing record (Chinese)](docs/testing.md) for the status of native macOS/Linux verification.

**Interface language:** the floating note window follows SiYuan's Chinese or English interface language, including its toolbar, menus, editor, image previews, and save status. Reload the plugin after changing SiYuan's language. Settings and recovery dialogs currently use Chinese; this guide includes their Chinese labels. Their illustrations show English translations for reference.

## Features

| What you need | How Quick Notes helps |
| --- | --- |
| Capture a passing thought | A global shortcut opens an independent note; multiple windows, pinning, and remembered positions are supported. |
| Write text and add images | Markdown source editing, pasted screenshots, image selection and drag-and-drop, with previews of SiYuan image assets. |
| Save directly to SiYuan | Autosave after 800 ms by default; group notes by day with a path template, each in its own vertical superblock. |
| Pick up where you left off | Search recent notes, recover this device's drafts, and optionally restore previously open windows. |

## Get started

1. Download and extract `package.zip` from [GitHub Releases](https://github.com/lisontowind/siyuan-quick-notes/releases/latest). Place its contents in `<workspace>/data/plugins/siyuan-quick-notes/`. Back up the existing plugin directory before updating. Once the plugin is listed in the marketplace, you can also search for **Quick Notes / 悬浮速记** there.
2. Open SiYuan and enable the plugin under **Settings → Marketplace → Downloaded → Plugins**.
3. In SiYuan's top bar, open **Quick Notes (悬浮速记) → Quick note settings (速记设置)** and choose a save location.

![Storage setup: select a notebook, enter a path template, and preview the resolved document path.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/3fedb25b03e2e597544e4c9d1adb1ab285c91a6b/docs/images/en/03-storage.png)

*An illustration of the main settings, with translated labels. It shows a daily grouping template; a fresh installation uses the timestamp template below.*

**Select a target notebook before creating your first note.** The default path is `/闪念速记/{{now | date "20060102150405"}}`. It uses the date and time of your first input, down to the second, to create a document path such as `/闪念速记/20261010035000`. Each note is saved in its own **vertical superblock**. Notes resolving to the same path are appended to the same document.

The save directory accepts SiYuan template variables. A template's result is used as the complete document path, without adding a number or child document. For example, `/Quick Notes/{{now | date "2006-01-02"}}` groups the day's notes in `/Quick Notes/2026-10-10`. Each note edits only its own superblock, leaving other document content in place. A plain directory without template variables, such as `/Quick Notes`, instead receives a generated document name containing a timestamp and identifier. Time formats use Go's reference date, `2006-01-02`, and are resolved by the SiYuan kernel.

The path is fixed when you first type. Retries and edits on another day continue saving to that location. Settings changes affect new notes only.

**Preview save location (预览保存位置)** displays the selected notebook and resolved full path without creating a document. Time templates use the preview time; a new note uses the time of its first input. Saving settings validates the notebook, directory, and template. Invalid input produces an error instead of silently falling back to a default directory.

The plugin and its settings apply to Windows, macOS, and Linux desktop only. They do not read or change SiYuan's built-in quick-note defaults.

## Capture a thought

![Note window: toolbar actions, Markdown body, and save status.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/3fedb25b03e2e597544e4c9d1adb1ab285c91a6b/docs/images/en/01-window.png)

*The English note window is rendered from the current build with sample content. Toolbar buttons, left to right: new note, open in SiYuan, pin, more, minimize, close.*

- **Create a note:** press `Ctrl + Alt + N` (`Option + Command + N` on macOS), or click the plus button in a note's toolbar. You can open several notes at once.
- **Write directly:** there is one Markdown body editor, with no separate title field. Each note is stored as a vertical superblock with its contents arranged from top to bottom.
- **Identify a window:** the upper left shows its SiYuan document title and provides a drag area. Tray entries and recent records show the first nonempty body line. The shortcut can be configured to wake the most recent window; the plus button always creates a new note.
- **Keep it nearby:** click the pin button to keep the window on top. Drag the toolbar's blank area to move it, or drag an edge to resize it.
- **Return to SiYuan:** click the arrow button to open the corresponding SiYuan document.
- **Resume an older note:** open **Recent notes and recovery drafts (最近速记与恢复草稿)**, search by first-line summary, save location, or time, and click a record to continue editing.
- **Use the tray:** Windows has a green note icon; macOS uses a monochrome menu-bar icon. Left-click creates a note; right-click opens the menu. Linux uses the desktop environment's tray menu. The menu includes recent notes, open windows, and settings. **Close tray icon (关闭托盘图标)** saves that preference; re-enable it in the plugin's settings from SiYuan's top bar.

### Add screenshots and images

![Images: paste a screenshot, choose a file, or drop an image; keep the Markdown link and view its preview below.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/3fedb25b03e2e597544e4c9d1adb1ab285c91a6b/docs/images/en/02-images.png)

*Rendered from the current English window, using the plugin icon as a sample image. Other Markdown remains visible as source.*

The editor uses Markdown source, suitable for text, lists, code blocks, tables, and image links. After taking a screenshot, return to the note and press **Ctrl + V** (**Command + V** on macOS). You can also choose **More (更多) → Insert image (插入图片)** or drop image files into the editor.

In a floating window, dropped images are inserted at the drop point; pasted or selected images use the current cursor or replace the selection. The fallback editor has an Insert image button and uses the cursor position for drops.

Supported formats: PNG, JPEG, GIF, WebP, and BMP. Each batch accepts up to **10 images totaling 20 MB**. Once upload succeeds, Markdown links are inserted. Images are stored in the SiYuan workspace's `data/assets/` directory and follow SiYuan's asset synchronization. Floating notes display previews below image links, scaled to fit the window. Click **Edit image link (编辑图片链接)** to select the source. Existing images also appear when reopening saved notes or recovering drafts.

Previews load only those image formats from SiYuan's asset directory. Image examples inside code blocks and external image URLs are not loaded automatically. A missing or unreadable asset shows an image-load error; its link and the rest of the body remain editable and saveable. Other Markdown stays as source. The fallback editor remains a source editor. Other attachment types are not supported.

The body is temporarily read-only during upload. Closing or reloading normally asks you to wait for completion. If upload fails, the original text remains; paste or select the images again. Images not yet inserted are not included in local recovery drafts. Partial failures, timeouts, or disabling the plugin during upload can leave unreferenced SiYuan assets. Use SiYuan's asset management tools to handle them; the plugin does not delete assets automatically.

### Common actions

| Action | Shortcut or entry |
| --- | --- |
| New note | `Ctrl + Alt + N` (macOS: `Option + Command + N`) / toolbar plus |
| Save now | `Ctrl + S` (macOS: `Command + S`) / More → Save now (立即保存) |
| Add an image | `Ctrl + V` (macOS: `Command + V`) / More → Insert image (插入图片) / drag image files in |
| Pin or unpin | Toolbar pin |
| Keep a draft and close | More → Save local draft and close (保存本机草稿后关闭) |
| Save a separate copy | More → Save as new note (另存为新速记) |
| Delete a plugin record | More → Delete this note (删除这条速记) / delete button in the recent list |
| Change the shortcut | Search for New floating quick note (新建悬浮速记) in SiYuan's shortcut settings |

## Recover recent notes and drafts

![Recovery: search by summary, path, or time; reopen saved notes, recover local drafts, and optionally restore windows.](https://raw.githubusercontent.com/lisontowind/siyuan-quick-notes/3fedb25b03e2e597544e4c9d1adb1ab285c91a6b/docs/images/en/04-recovery.png)

*An illustration of the main list features, with translated labels and sample records and times.*

Open **Recent notes and recovery drafts (最近速记与恢复草稿)** from a note's More menu, SiYuan's top bar, or the tray menu. Search by first-line summary, location, or time. Click a record to continue editing. Saved notes load the latest body from SiYuan; local drafts retain unsubmitted content.

To put a note away temporarily, choose **More → Save local draft and close (保存本机草稿后关闭)**. Draft recovery is scoped to the current device. **Restore previously open windows after restart (重启后恢复上次打开的窗口)** is off by default and can be enabled in settings. Manual draft recovery remains available when automatic restoration is off.

**Deleting a note clears only the plugin's local records. SiYuan documents and their contents are kept.** Before confirming, check whether you still need any unsaved draft. The details are below.

## Where is content saved?

Autosave runs **800 ms** after you stop typing by default. Switching to another window, pressing `Ctrl + S` (`Command + S` on macOS), or closing normally also submits a save. An empty note does not create a document.

**Only “Saved to SiYuan” (已保存到思源) confirms a successful save to SiYuan.** A local recovery draft is also written while you type. A normal close first confirms that the draft is on disk, then saves to SiYuan. If the SiYuan save fails, the window still closes with a notice that the local draft was kept. If the latest draft has not been confirmed on disk, the window stays open.

The **document title** appears at the upper left, for example `20261010035000`. The current title is read on the next save or reload. If it cannot be read, the plugin uses the previous title or the final component of the saved path. Editing the body does not rename the document. The footer shows save status or errors, without repeating the title. Disabling successful-save notices hides the success status.

Titles entered in older versions are preserved as a level-one heading at the start of the body. You can edit or remove that heading in saved notes and recovered drafts; it is not repeatedly added.

An older horizontal superblock is converted in place to a vertical layout on its next edited save, keeping its block ID and document. Notes saved as standalone documents in 0.1.17 are copied into vertical superblocks at the current save location on their next edited save. The original standalone documents are kept. Upgrading alone does not bulk-migrate or delete SiYuan content.

Drafts and window recovery state are stored under `<workspace>/data/storage/petal/siyuan-quick-notes/drafts/<device ID>/`. Even if this directory is synchronized or copied to another computer, the plugin reads only the current device's subdirectory. It does not combine other devices' unsubmitted drafts, window positions, or open state. **Device isolation does not exclude these files from synchronization.** If you need them to remain on one computer, exclude `storage/petal/siyuan-quick-notes/drafts/` in SiYuan's sync settings.

The device ID is stored in `.siyuan/quick-notes-device-id` under the current OS user's home directory, independently of the workspace. Keep this file so the plugin can find this device's drafts after a restart. Do not copy it to another computer.

Starting with 0.1.25, the first Windows load copies and verifies the current workspace's older drafts and window state from `%LOCALAPPDATA%/SiYuanQuickNotes/`, keeping the original files as a backup. Migration runs once to prevent old drafts from reappearing after saving or deleting them. A migration failure stops initialization and preserves the old files for troubleshooting and retry. macOS/Linux use the same device-scoped workspace directory and do not read the older Windows directory.

The recent list remembers **50 saved notes** by default, configurable from **1 to 200** with **Recent note history limit (最近速记记忆条数)**. Reducing the limit immediately removes older list records without deleting SiYuan content or recovery drafts. Increasing it does not restore records already removed. Recovery drafts are retained separately and do not count toward that limit. New installations default to a 320-pixel-wide window; adjust this in settings. Existing saved window sizes are retained.

By default, up to **10 notes** can be open at once. Set **Maximum open notes (最多同时打开的便签)** from **1 to 50** in settings. Creating a note, saving a copy, and restoring windows all respect this limit. At the limit, close one note before opening another; the shortcut wakes the most recent window. Lowering the limit keeps already open notes. Upgrades retain a previously saved limit.

Deleting a note opens a confirmation in SiYuan's main window. Confirmation clears **only the plugin's local draft, recent record, and window recovery record**, and closes that note. **The SiYuan document and all its content remain.** No SiYuan deletion API is called. Unsaved local content is deleted and cannot be undone through the plugin. If local draft cleanup fails, the window and records are kept so you can retry.

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
