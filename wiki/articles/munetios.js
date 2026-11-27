(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "munetios",
    title: "Munetios",
    short: "Munetios",
    logo: "images/logos/munetios.png",
    category: "platform",
    tagline: "The privacy-focused productivity and workspace platform behind every app in this wiki.",
    url: "/",
    updated: "2026-11-27",
    shots: [
      { src: "search-desktop.jpg", phone: "search-phone.jpg", caption: "Munetios Search, the front door to the Munetios platform." },
      { src: "omniwrite-desktop.jpg", phone: "omniwrite-phone.jpg", caption: "Munetios OmniWrite home with documents, spreadsheets, and folders." },
      { src: "calendar-desktop.jpg", phone: "calendar-phone.jpg", caption: "Munetios Calendar month view with holidays." },
    ],
    facts: {
      developer: "Munetios",
      type: "Productivity and workspace platform",
      platforms: "Web (desktop and phone), installable apps, OS and phone projects",
      encryption: "End-to-end encrypted sync for personal data",
      sync: "One Munetios Account across every app",
      storage: "50 GB encrypted sync storage per account",
      languages: "17 languages",
      license: "Apache License 2.0 (source code)",
    },
    related: ["privacy", "accounts", "search", "omniwrite", "munetios-ui", "developers"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "info",
        html: `
<p><strong>Munetios</strong> is a privacy-focused productivity and workspace platform. It covers everyday productivity, business, education, and developer tools, and extends to operating system and phone projects. Every Munetios app is built around one idea: your work belongs to you. Personal data is encrypted on your device before it syncs, apps work offline, and nothing is tracked or profiled.</p>
<p>The platform is made up of focused apps that share one account, one design language (Munetios UI v4), and one sync engine. You can write in ${link("omniwrite", "OmniWrite")}, plan your week in ${link("calendar", "Calendar")}, keep private photos in ${link("photos", "Photos")}, read email in ${link("mail", "Mail")}, manage school devices with ${link("webfilter", "WebFilter")}, and search the web with ${link("search", "Munetios Search")}, all with the same ${link("accounts", "Munetios Account")}.</p>
${pair("search-desktop.jpg", "search-phone.jpg", "Munetios Search on desktop.")}`,
      },
      {
        id: "apps", title: "Apps and services", icon: "apps",
        html: `
<p>Munetios apps are grouped by what they help you do. Each one has its own detailed article in this wiki.</p>
${table(["App", "What it does", "Where"], [
  [link("search", "Munetios Search"), "Private web, image, video, news, Wikipedia, and book search with Voice mode", "<code>/</code>"],
  [link("accounts", "Munetios Accounts"), "Sign-in, profile, security, two-factor authentication, workspaces, and encrypted sync", "<code>/signin/</code>, <code>/account/</code>"],
  [link("omniwrite", "Munetios OmniWrite"), "Documents with charts, tables, code blocks, page layouts, and templates", "<code>/omniwrite/</code>"],
  [link("sheets", "Munetios Sheets"), "Spreadsheets with formulas and live charts, part of OmniWrite", "<code>/omniwrite/sheets/</code>"],
  [link("collaboration", "Real-time collaboration"), "Encrypted sharing, live cursors, suggestions, and comments for OmniWrite files", "<code>/api/collab</code>"],
  [link("mail", "Munetios Mail"), "Email with tracker blocking, sender verification, scheduling, and an HTML studio", "<code>/mail/</code>"],
  [link("calendar", "Munetios Calendar"), "Encrypted scheduling with seven views, sharing, birthdays, and world clocks", "<code>/calendar/</code>"],
  [link("photos", "Munetios Photos"), "Encrypted photo and video library with editing, AI eraser, and shared albums", "<code>/photos/</code>"],
  [link("cloud", "Munetios Cloud"), "Encrypted backup, chunked uploads, and shared spaces for Calendar and Photos", "<code>/api/cloud</code>"],
  [link("webfilter", "Munetios WebFilter"), "Web filtering, classroom rules, UserCSS policies, and remote devices for schools", "<code>/webfilter/</code>"],
  [link("tasks", "Munetios Tasks"), "Tasks with categories, Board and Calendar views, focus timer, and templates", "<code>/tasks/</code>"],
  [link("supanotes", "Munetios SupaNotes"), "End-to-end encrypted notes with locks, templates, and read aloud", "<code>/supanotes/</code>"],
  [link("meals", "Munetios Meals"), "Meal planning with recipes, nutrition, and shopping lists", "<code>/meals/</code>"],
  [link("maps", "Munetios Maps"), "Maps with directions, live traffic, satellite imagery, and space views", "<code>/maps/</code>"],
  [link("munetios-ui", "Munetios UI v4"), "The shared liquid glass component library", "<code>/munetios-ui/</code>"],
])}`,
      },
      {
        id: "principles", title: "Design principles", icon: "verified_user",
        html: `
<h3>Privacy first</h3>
<p>Munetios keeps personal content end-to-end encrypted. Documents, notes, tasks, events, photo details, and albums are encrypted in the browser, and Munetios servers only store ciphertext. When a feature must involve the server, such as delivering email, it is designed to reveal as little as possible. See ${link("privacy", "Privacy and encryption")} for the details.</p>
<h3>No tracking</h3>
<p>Munetios apps don't include analytics, advertising, or profiling. Munetios Search describes itself as a way to "search the web without Google watching". Mail blocks trackers and remote images, and loads images through a privacy proxy when you allow them.</p>
<h3>Offline and local by default</h3>
<p>Many apps are Progressive Web Apps with service workers. Data is saved on your device first, and sync is optional. Guest modes in Tasks, SupaNotes, OmniWrite, and Photos work without an account.</p>
<h3>One design language</h3>
<p>Every app uses ${link("munetios-ui", "Munetios UI v4")}: translucent liquid glass surfaces with no more than 2px of blur, generous 18px–48px text, no bold type, rounded pill controls, and light and dark modes.</p>
${note("Brands", "Munetios is the productivity and workspace platform. Ganetios is a separate brand focused on Browser, Search, Maps, and Navigation. This wiki covers Munetios.")}`,
      },
      {
        id: "languages", title: "Languages", icon: "translate",
        html: `
<p>Every Munetios app offers the same 17 languages, each with regional conventions:</p>
${table(["Language", "Regional notes"], [
  ["English (United States), English (United Kingdom)", "US English says “Couldn't”; British English says “Could not” and uses British spelling such as colour and organise."],
  ["Español (Latinoamérica), Español (Estados Unidos), Español (España)", "Settings is Configuración in Latin America and the US, and Ajustes in Spain. The home page is Principal or Inicio. A personal home is Casa everywhere."],
  ["Français (France), Français (Canada)", "Canadian French uses Québec terms such as courriel and fin de semaine."],
  ["Português (Brasil), Português (Portugal)", "Brazil uses Buscar and Configurações; Portugal uses Pesquisar and Ajustes."],
  ["Deutsch, Italiano, 한국어, العربية, हिन्दी, Corsu", "Arabic is shown right to left."],
  ["中文（简体）, 中文（繁體）", "Traditional Chinese uses Taiwan vocabulary."],
])}
<p>Browsers set to other regions are mapped to the closest match. For example, es-MX uses Español (Latinoamérica) and en-AU uses English (United Kingdom).</p>`,
      },
      {
        id: "time", title: "Time format", icon: "schedule",
        html: `
<p>Munetios apps write times before noon with <strong>NM</strong> and times after noon with <strong>AN</strong>, instead of AM and PM. For example, Calendar's quick add understands “Lunch tomorrow at 1 AN”, and Tasks understands “Call Sam tomorrow 3 AN”. Apps that support a 24-hour clock also let you switch to it.</p>
${fig("calendar-week-desktop.jpg", "Calendar's week view labels hours with NM and AN.")}`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Do I need an account to use Munetios?", "No. Search, OmniWrite, Tasks, SupaNotes, Meals, Calendar, Photos, and Maps work without one. An account adds encrypted sync across devices, sharing, Munetios Cloud backup, and a Munetios Mail mailbox for @munetios.com addresses."],
          ["Can Munetios read my documents?", "No. Synced documents, notes, tasks, events, and photo details are end-to-end encrypted with a key that only your devices hold. Munetios can't recover them without your password."],
          ["How much storage do I get?", "Each Munetios Account includes 50 GB of encrypted sync storage, measured as stored ciphertext. Munetios Cloud and Munetios Mail show their own usage."],
          ["Is Munetios open source?", "Yes. Munetios source code is licensed under the Apache License, Version 2.0. The Munetios UI v4 Font and Google Sans Flex use the SIL Open Font License 1.1."],
        ]),
      },
    ],
  });
})();
