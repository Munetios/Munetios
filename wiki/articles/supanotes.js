(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { pair, note, faq, table } = W.helpers;
  W.register({
    slug: "supanotes",
    title: "Munetios SupaNotes",
    short: "SupaNotes",
    logo: "images/logos/supanotes.png",
    category: "productivity",
    tagline: "End-to-end encrypted notes with passphrase locks, templates, reminders, and read aloud.",
    url: "/supanotes/",
    updated: "2026-11-27",
    shots: [
      { src: "supanotes-desktop.jpg", phone: "supanotes-phone.jpg", caption: "Munetios SupaNotes." },
    ],
    facts: {
      developer: "Munetios",
      type: "Notes",
      path: "/supanotes/",
      platforms: "Web, installable app (PWA)",
      encryption: "End-to-end encryption; optional passphrase per note",
      sync: "Munetios Account",
      offline: "Yes",
      languages: "17 languages",
    },
    related: ["tasks", "omniwrite", "privacy"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "sticky_note_2",
        html: `
<p><strong>Munetios SupaNotes</strong> is a powerful, end-to-end encrypted note-taking app built for productivity and privacy. Notes are encrypted before they ever leave your device. It works on desktop, tablet, and phone, and can be installed as an app.</p>
${pair("supanotes-desktop.jpg", "supanotes-phone.jpg", "SupaNotes.")}`,
      },
      {
        id: "notes", title: "Writing and organizing", icon: "edit_note",
        html: `
<ul>
<li>A formatting toolbar with Heading 1, Heading 2, quotes, code blocks, highlights, and checklists (with progress such as 2/5).</li>
<li>Voice notes and images in notes.</li>
<li><strong>Favorites</strong>, <strong>pinned</strong> notes, <strong>tags</strong>, ten <strong>colors</strong>, <strong>archive</strong>, and <strong>trash</strong>.</li>
<li>Grid or list layout; sort by last edited, date created, or title; filter by tag or color; select many notes at once.</li>
<li>Instant search across all notes, with a command palette.</li>
<li><strong>Find and replace</strong>, <strong>focus mode</strong>, and live counts of words, characters, and reading time.</li>
<li><strong>Autosave</strong> while you type.</li>
</ul>`,
      },
      {
        id: "lock", title: "Passphrase locks", icon: "lock",
        html: `<p>Lock any note with a passphrase for an extra layer of protection on top of end-to-end encryption. Locked notes show <em>This note is locked</em> until you unlock them.</p>
${note("Remember your passphrase", "Munetios can't recover a forgotten passphrase.", "warning")}`,
      },
      {
        id: "templates", title: "Templates", icon: "dashboard_customize",
        html: `
${table(["Built-in template", "Sections"], [
  ["Meeting notes", "Agenda, Notes, Action items"], ["To-do list", "Checklist"], ["Journal", "I'm grateful for, Highlights, For tomorrow"], ["Project plan", "Goal, Milestones, Risks"],
  ["Lecture notes", "Key ideas, Questions, Summary"], ["Weekly review", "Wins, Challenges, Next week"], ["Daily note", "A note for today"],
])}
<p>Save any note as your own template from its More menu.</p>`,
      },
      {
        id: "tools", title: "Reminders, sharing, and read aloud", icon: "record_voice_over",
        html: `<p>Set a <strong>reminder</strong> on a note. <strong>Copy</strong> a note as text or Markdown, <strong>export</strong> it as Markdown, plain text, or a web page, or export all notes as Markdown. <strong>Read aloud</strong> reads a note using your device's voices.</p>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([["Can I use SupaNotes without signing in?", "Yes. Notes stay on your device. Sign in to sync them across devices with end-to-end encryption."]]),
      },
    ],
  });
})();
