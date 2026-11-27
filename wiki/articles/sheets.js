(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, note, faq, table, link } = W.helpers;
  W.register({
    slug: "sheets",
    title: "Munetios Sheets",
    short: "Sheets",
    logo: "images/logos/sheets.png",
    category: "productivity",
    tagline: "Spreadsheets with formulas, live charts, and end-to-end encrypted sync. Part of OmniWrite.",
    url: "/omniwrite/sheets/",
    updated: "2026-11-27",
    shots: [
      { src: "sheets-desktop.jpg", phone: "sheets-phone.jpg", caption: "A new spreadsheet with the Sheets toolbar, formula bar, and sheet tabs." },
    ],
    facts: {
      developer: "Munetios",
      type: "Spreadsheet",
      path: "/omniwrite/sheets/",
      platforms: "Web, installable app (PWA)",
      encryption: "End-to-end encrypted autosave",
      sync: "Munetios Account",
      offline: "Yes (saved in IndexedDB)",
      sharing: "Editor, Suggester, Viewer",
      languages: "17 languages",
    },
    related: ["omniwrite", "collaboration", "accounts"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "table_view",
        html: `
<p><strong>Munetios Sheets</strong> brings spreadsheets with formulas, charts, and end-to-end encrypted sync to ${link("omniwrite", "OmniWrite")}. A spreadsheet is a file in your OmniWrite workspace, next to your documents. Links to <code>/omniwrite/sheets/</code> open the right place: <code>#/new</code> creates a spreadsheet, and <code>#/templates</code> opens spreadsheet templates.</p>
${fig("sheets-desktop.jpg", "Sheets inside OmniWrite: toolbar, name box, formula bar, grid, and sheet tabs.")}`,
      },
      {
        id: "toolbar", title: "Toolbar", icon: "build",
        html: `
${table(["Group", "Tools"], [
  ["Number format", "Automatic, currency, percent, and more or fewer decimal places"],
  ["Text", "Font family, font size, bold, italic, underline, and text color"],
  ["Cells", "Fill color, borders, merge cells, alignment, and text wrapping"],
  ["Insert", "Charts, functions, and more insert options"],
  ["Data", "Data tools for sorting and working with ranges"],
  ["Editing", "Undo, redo, find and replace, and zoom"],
])}
<p>The <strong>name box</strong> shows the selected cell (for example A1), and the <strong>formula bar</strong> edits its value or formula. Below the grid you can add 100 more rows at a time, add sheets, and open the list of all sheets. Column width and row height can be resized.</p>`,
      },
      {
        id: "charts", title: "Charts", icon: "insert_chart",
        html: `<p>Turn any range into a <strong>column</strong>, <strong>line</strong>, <strong>pie</strong>, or <strong>scatter</strong> chart. Charts update live as the data changes, and you can insert them into OmniWrite documents too.</p>`,
      },
      {
        id: "saving", title: "Saving and reliability", icon: "save",
        html: `
<p>Sheets autosaves to encrypted snapshots in your browser's IndexedDB, including drafts in a cell or the formula bar.</p>
<ul>
<li><strong>Enter</strong> commits an edit. <strong>Escape</strong> restores the original value and saves that cancellation.</li>
<li>Saves run in order, failed revisions are kept for retry, and success is shown only after the write is committed.</li>
<li>While a write is pending, the browser warns you before you leave the page.</li>
<li>Tabs opened at the same time agree on one encryption key in a single transaction, so nothing is lost.</li>
</ul>
${note("Collaboration merges by cell", "When two people edit the same spreadsheet, changes are merged cell by cell in the browser.")}`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Can I import an existing spreadsheet?", "Yes. Use Import Spreadsheet in OmniWrite."],
          ["Is Sheets a separate app?", "Sheets is part of OmniWrite. It has its own address and icon, but files live in your OmniWrite workspace."],
        ]),
      },
    ],
  });
})();
