(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "munetios-ui",
    title: "Munetios UI v4",
    short: "Munetios UI v4",
    logo: "images/logos/munetios.png",
    category: "developers",
    tagline: "The shared liquid glass component library behind every Munetios app, including this wiki.",
    url: "/munetios-ui/",
    updated: "2026-11-27",
    shots: [
      { src: "munetios-ui-desktop.jpg", phone: "munetios-ui-phone.jpg", caption: "The Munetios UI v4 preview page with every component." },
    ],
    facts: {
      developer: "Munetios",
      type: "Design system and component library",
      path: "/munetios-ui/",
      platforms: "Any browser",
      license: "Apache License 2.0; fonts under SIL OFL 1.1",
      languages: "Used by apps in 17 languages",
      released: "Version 4.4.0",
    },
    related: ["developers", "munetios", "omniwrite"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "palette",
        html: `
<p><strong>Munetios UI v4</strong> is the shared set of components extracted from the OmniWrite redesign. Every Munetios app reuses it: one stylesheet (<code>munetios-ui-v4.css</code>, classes start with <code>mu-</code>) and one script (<code>munetios-ui-v4.js</code>). The preview page at <code>/munetios-ui/</code> shows every component with copyable markup.</p>
${pair("munetios-ui-desktop.jpg", "munetios-ui-phone.jpg", "Component previews.")}`,
      },
      {
        id: "rules", title: "Design rules", icon: "rule",
        html: `
${table(["Rule", "Detail"], [
  ["Liquid glass", "Backdrop blur never above 2px; glass transparency between 0.01 and 0.50"],
  ["Type sizes", "Text from 18px to 48px; no small text or compact layouts"],
  ["Type weight", "Never bold; headings use weight 300, everything else 400"],
  ["Roundness", "Pills for single-line controls, circles for icon buttons"],
  ["Fonts", "Munetios UI v4 Font first; Google Sans Flex available as an option; Material Symbols Rounded icons"],
  ["Themes", "Light and dark mode, following the system by default"],
  ["Selects", "No native select menus: select.mu-select becomes a liquid glass dropdown"],
])}
<p>Pages also load Munetios Beautiful CSS from api.munetios.com.</p>`,
      },
      {
        id: "components", title: "Components", icon: "widgets",
        html: `
<p>More than 200 components, grouped into families:</p>
<ul>
<li><strong>Actions:</strong> buttons, icon buttons, button groups, action cards, danger zones, chips, and segmented controls.</li>
<li><strong>Inputs:</strong> fields, search, custom select, switches, checks, radios, sliders, color, date, time, and date-time pickers, file drop zones, and password strength.</li>
<li><strong>Navigation:</strong> top bars and top bar search, sidebars (resizable), nav lists, tabs, breadcrumbs, pagination, outlines, jump lists, tree browsers, and mega menus.</li>
<li><strong>Surfaces:</strong> glass panels, cards, modals and dialogs (non-blocking and duplicable), side panels, bottom sheets, menus, popovers, tooltips, and toasts.</li>
<li><strong>Data:</strong> tables, stats, meters, progress, sparklines, heatmaps, storage bars, and timelines.</li>
<li><strong>Story surfaces:</strong> pull quotes, bylines, reading details, fact sheets, glossary entries, footnotes, transcripts, checklists, and the <strong>read aloud player</strong> used in this wiki.</li>
</ul>`,
      },
      {
        id: "behavior", title: "Behavior (JavaScript API)", icon: "code",
        html: `
<p><code>munetios-ui-v4.js</code> makes no network requests and does no tracking. It exposes <code>window.MunetiosUI</code>:</p>
<pre><code>MunetiosUI.theme.set('light' | 'dark' | 'system')
MunetiosUI.toast('Saved', { type: 'success', icon: 'check' })
MunetiosUI.openModal('settingsDialog')
MunetiosUI.pickDate({ … })   // also pickTime, pickDateTime, pickColor
MunetiosUI.enhanceSelect(selectElement)</code></pre>
<ul>
<li><code>[data-mu-open="id"]</code> opens a modal; opening it again stacks an exact duplicate. <code>[data-mu-close]</code> or Escape closes it. Danger actions are locked while a modal is open.</li>
<li>Toasts appear at the top center, newest on top.</li>
<li>Segmented controls, chips, and tabs manage <code>aria-pressed</code> and <code>aria-selected</code>.</li>
<li><code>[data-mu-resizable]</code> sidebars get a drag and keyboard resize handle and remember their width.</li>
<li>Buttons, nav items, tiles, and chips get a ripple, which respects reduced motion.</li>
</ul>`,
      },
      {
        id: "fonts", title: "Fonts", icon: "font_download",
        html: `<p>The <strong>Munetios UI v4 Font</strong> is the default UI font. It uses a single-story <em>a</em> by default and switches to a double-story <em>a</em> with the <code>ss02</code> feature. The original Google Sans Flex is available in font pickers with <code>ss01</code> off by default. Both use the SIL Open Font License 1.1. Attribution text, such as map credits, uses Munetios Sans.</p>`,
      },
      {
        id: "contributing", title: "Adding components", icon: "add_box",
        html: `${note("Reuse first", "Always reuse an existing mu- component. If a component you need is missing, add it to the v4 stylesheet and the preview page instead of writing one-off styles.")}
<p>See the ${link("developers", "developer guide")} for running the preview page locally.</p>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([["Why is blur limited to 2px?", "Light blur keeps glass surfaces readable and fast on every device while still looking like glass."]]),
      },
    ],
  });
})();
