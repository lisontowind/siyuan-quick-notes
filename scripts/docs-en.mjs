// Translated documentation only. Does not change the plugin's runtime language.
export function englishCards(item) {
  return [
    { name: '01-window', title: 'Keep a passing thought within reach',
      intro: 'Ctrl + Alt + N to create a note · Multiple windows · Pin on top · Markdown body',
      text: 'Ideas for the next release\n\n- [ ] Add an illustrated user guide\n- [ ] Capture today’s ideas\n\n## Quick excerpt\nWrite it down now. Organize it in SiYuan later.',
      copy: item(1, 'Your everyday actions, at the top', 'Plus: new note. Arrow: open in SiYuan. Pin: stay on top.<br>More includes save, images, recovery, and save a copy.')
        + item(2, 'Start with the body', 'Use Markdown for text, tasks, code, and tables.<br>The upper left shows the SiYuan document title.')
        + item(3, 'Check the save status', 'Autosave starts after 800 ms without typing by default.<br>“Saved to SiYuan” confirms the save succeeded.'),
    },
    { name: '02-images', title: 'Paste a screenshot. See the image.',
      intro: 'Paste, choose, or drop image files · Markdown links with inline image previews',
      text: 'Design reference\n\n![Reference image](assets/example.png)',
      copy: item(1, 'Three ways to insert images', '<kbd>Ctrl + V</kbd> to paste; More → Insert image;<br>or drop image files into the editor.')
        + item(2, 'Keep the link and see the preview', 'Images in SiYuan’s assets folder appear below links.<br>“Edit image link” selects the Markdown source.')
        + item(3, 'Sync with SiYuan assets', 'PNG, JPEG, GIF, WebP, and BMP.<br>Up to 10 images and 20 MB in each batch.'),
    },
    { name: '03-storage', title: 'Choose a notebook and a save path',
      intro: 'SiYuan top bar → Quick Notes → Quick note settings · Example: group notes by day',
      panel: '<h2>Save location · settings illustration</h2><div class="label">Target notebook</div><div class="field">Daily notes</div><div class="label">Save directory (templates supported)</div><div class="field"><code>/Quick Notes/{{now | date "2006-01-02"}}</code></div><div class="button">Preview save location</div><div class="result">Daily notes · /Quick Notes/2026-10-18</div>',
      copy: item(1, 'Select a notebook before you start', 'Choose an open, ordinary, unencrypted notebook.<br>The default template uses the time of your first input.')
        + item(2, 'Group a day’s notes in one document', 'The daily template shown here gives each note<br>its own vertical superblock in the same document.')
        + item(3, 'Preview before saving settings', 'Preview shows the path without creating a document.<br>Settings changes affect new notes only.'),
    },
    { name: '04-recovery', title: 'Find a recent note. Resume a draft.',
      intro: 'Note’s More menu / SiYuan top bar / tray menu → Recent notes and recovery drafts',
      panel: '<h2>Recent notes and drafts · list illustration</h2><div class="field search">Search summary, save location, or time</div><div class="row"><div class="record"><span class="local">Local draft</span> · An idea still in progress<br><span class="meta">2026-10-18 09:30:00<br>/Quick Notes/2026-10-18</span></div><span class="delete">Delete</span></div><div class="row"><div class="record">Ideas for the next release<br><span class="meta">2026-10-18 09:10:00<br>/Quick Notes/2026-10-18</span></div><span class="delete">Delete</span></div>',
      copy: item(1, 'Search by summary, path, or time', 'Click a record to keep editing.<br>Saved notes load the latest body from SiYuan.')
        + item(2, 'Recover this device’s drafts', 'More → Save local draft and close.<br>Other devices’ drafts are excluded from recovery.<br>Draft files may still follow workspace sync.')
        + item(3, 'Restore windows when you need them', 'Enable window restoration after restart in settings.<br>Deleting clears plugin records after confirmation.<br>SiYuan documents and their contents are kept.'),
    },
  ];
}
