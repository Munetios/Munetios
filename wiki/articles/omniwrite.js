(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "omniwrite",
    title: "Munetios OmniWrite",
    short: "OmniWrite",
    logo: "images/logos/omniwrite.png",
    category: "productivity",
    tagline: "Write, organize, and collaborate: documents and spreadsheets in one encrypted workspace.",
    url: "/omniwrite/",
    updated: "2026-11-27",
    shots: [
      { src: "omniwrite-desktop.jpg", phone: "omniwrite-phone.jpg", caption: "OmniWrite home: new documents, spreadsheets, templates, and recent files." },
      { src: "omniwrite-editor-desktop.jpg", caption: "The OmniWrite document editor with its formatting toolbar." },
      { src: "omniwrite-overview-desktop.jpg", phone: "omniwrite-overview-phone.jpg", caption: "The OmniWrite overview page." },
    ],
    facts: {
      developer: "Munetios",
      type: "Document editor and spreadsheets",
      path: "/omniwrite/",
      platforms: "Web, installable app (PWA)",
      encryption: "End-to-end encrypted local documents",
      sync: "Munetios Account, per workspace",
      offline: "Yes",
      sharing: "Editor, Suggester, Viewer",
      languages: "17 languages",
    },
    related: ["sheets", "collaboration", "accounts", "supanotes"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "edit_document",
        html: `
<p><strong>Munetios OmniWrite</strong> is a writing tool for documents and spreadsheets in one workspace. Documents can contain charts, code blocks, tables, callouts, videos, music, and page layouts. Spreadsheets live alongside them as ${link("sheets", "Munetios Sheets")}. Files are end-to-end encrypted on your device, can be locked, and sync through your Munetios Account. When you're ready, ${link("collaboration", "share")} a file and edit it together in real time.</p>
${pair("omniwrite-desktop.jpg", "omniwrite-phone.jpg", "The OmniWrite home screen greets you and shows your files.")}`,
      },
      {
        id: "home", title: "Home and organization", icon: "folder_open",
        html: `
<p>The home screen greets you by name and shows counts of documents, pinned files, spreadsheets, and folders, plus Recent Documents and Spreadsheets. The sidebar holds:</p>
<ul>
<li><strong>Templates:</strong> start from ready-made layouts for documents and spreadsheets.</li>
<li><strong>Images:</strong> browse, preview, restore, and manage your local image library.</li>
<li><strong>Tasks</strong> and <strong>Quick Notes:</strong> capture ideas and insert them into the current document when needed.</li>
<li><strong>Shared:</strong> files other people shared with you.</li>
<li><strong>Pinned</strong> files, <strong>Folders</strong>, and <strong>Files</strong> with sorting.</li>
<li><strong>Trash:</strong> deleted documents stay here before permanent cleanup, with Restore all and Delete all.</li>
</ul>
<p>Each workspace (Personal, School, Work, and any you create in ${link("accounts", "Account settings")}) has its own files.</p>`,
      },
      {
        id: "editor", title: "The document editor", icon: "format_paint",
        html: `
${fig("omniwrite-editor-desktop.jpg", "Writing in OmniWrite. The toolbar groups text styles, fonts, formatting, insert tools, and find and replace.")}
<h3>Text and formatting</h3>
<ul>
<li>Styles: Normal Text, Title, Subtitle, Heading 1–6, Paragraph, Caption, Quote, Inline Code, and Emphasis.</li>
<li>Font sizes from 6 pt to 200 pt, and more than 60 font families, with Munetios UI v4 Font as the default. You can also add a custom font.</li>
<li>Bold, italic, underline, strikethrough, superscript, subscript, highlight, text and background color, uppercase and lowercase, and clear formatting.</li>
<li>Bulleted, numbered, and checkbox lists; indent; alignment; line spacing; columns; and document background color.</li>
</ul>
<h3>Insert</h3>
<p>Links, images, icons (Material Symbols), horizontal lines, videos (with captions you type or import as WebVTT or SRT), music, dropdowns, callouts, quotes, code blocks, inline code, tables, charts, watermarks, a table of contents, page breaks, and new pages.</p>
<h3>Writing tools</h3>
<ul>
<li><strong>Voice typing</strong> (Ctrl + D), a virtual keyboard, and an emoji picker.</li>
<li><strong>Handwriting</strong> input.</li>
<li><strong>Find and replace</strong> with match case.</li>
<li>English <strong>spellcheck</strong> and a dictionary.</li>
<li><strong>Command palette</strong> for every action.</li>
</ul>`,
      },
      {
        id: "reading", title: "Reading, preview, and read aloud", icon: "record_voice_over",
        html: `
<p>OmniWrite has a <strong>Reading Mode</strong> and a <strong>Preview</strong>, plus <strong>Split Screen</strong> for working on two files side by side. <strong>Read aloud</strong> plays the document with play, pause, and stop controls, your choice of voice, and speed.</p>`,
      },
      {
        id: "privacy", title: "Encryption, locking, and versions", icon: "lock",
        html: `
<p>The top bar shows a lock with <em>End to end encrypted</em> for every file. You can:</p>
<ul>
<li><strong>Lock</strong> a document or spreadsheet. While a file is locked, only its owner can open it to unlock it, and it can't be shared.</li>
<li>Open <strong>Version History</strong> to go back to an earlier version.</li>
<li><strong>Sync</strong> a local document to your account, or keep it local only.</li>
<li><strong>Pin</strong> a file, see <strong>Document info</strong>, and <strong>Download</strong> it.</li>
</ul>
${note("Recovery flows", "If a document can't be opened, OmniWrite offers recovery choices such as restoring the last version that opened.")}`,
      },
      {
        id: "settings", title: "Settings", icon: "settings",
        html: `
<p>Settings include System, Light, Dark, and Custom themes; default font and formatting (defaults apply to new text, and existing formatting is preserved); and the interface language. OmniWrite works on phones with a dedicated mobile layout, a formatting tools sheet, and a writing tools sheet.</p>`,
      },
      {
        id: "compare", title: "OmniWrite at a glance", icon: "fact_check",
        html: table(["Feature", "OmniWrite"], [
          ["Documents and spreadsheets in one app", true],
          ["Charts that update live from data", true],
          ["Code blocks, callouts, watermarks, table of contents", true],
          ["End-to-end encrypted local documents", true],
          ["Lock individual files", true],
          ["Real-time collaboration with suggestions and comments", true],
          ["Voice typing and handwriting", true],
          ["Works offline", true],
        ]),
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Where are my documents stored?", "On your device, encrypted. With sync on, an encrypted copy is stored in your Munetios Account so it appears on your other devices."],
          ["Can I open a spreadsheet from OmniWrite?", "Yes. Select New Spreadsheet, or open one from Files. Spreadsheets open in the same window."],
          ["Why can't I share a file?", "Locked files can't be shared. Unlock it first. Sharing also needs a Munetios Account."],
        ]),
      },
    ],
  });
})();
