(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { pair, note, faq, table, keys, link } = W.helpers;
  W.register({
    slug: "search",
    title: "Munetios Search",
    short: "Search",
    logo: "images/logos/munetios.png",
    category: "productivity",
    tagline: "Search the web without being watched: no tracking, no profiling, no ads.",
    url: "/",
    updated: "2026-11-27",
    shots: [
      { src: "search-desktop.jpg", phone: "search-phone.jpg", caption: "The Munetios Search home page with shortcuts and Voice mode." },
    ],
    facts: {
      developer: "Munetios",
      type: "Privacy-focused search engine",
      path: "/",
      platforms: "Web (desktop and phone)",
      encryption: "Synced settings are end-to-end encrypted",
      sync: "Optional, with a Munetios Account",
      offline: "Settings and history are stored locally",
      languages: "17 languages",
      released: "May 16, 2026 (version 1.0.0)",
    },
    related: ["accounts", "maps", "privacy", "webfilter"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "search",
        html: `
<p><strong>Munetios Search</strong> is a privacy-focused search engine and the home page of Munetios. Its promise is simple: search the web without Google watching. There is no tracking, no profiling, and no advertising. Search works without an account; signing in adds encrypted sync of your history, appearance, shortcuts, and favorites.</p>
${pair("search-desktop.jpg", "search-phone.jpg", "The Search home page.")}`,
      },
      {
        id: "verticals", title: "Search types", icon: "travel_explore",
        html: `
${table(["Tab", "What it searches"], [
  ["Search", "The web, with SafeSearch and search filters"],
  ["Images", "Images, plus reverse image search: upload or drop a picture, and text found in it is extracted"],
  ["Videos", "Videos by title"],
  ["Maps", "Locations on an interactive map with map and satellite layers, your location, straight-line distance, shared map views, and copied coordinates"],
  ["News", "Technology news from Hacker News, sorted by most comments or the last 7 days (hidden in School Mode)"],
  ["Wiki", "Wikipedia articles"],
  ["Books", "Books from Open Library, with author-only and newest-first options"],
])}
<p><strong>Search filters</strong> let you search for an exact phrase, search within one website, and limit results to a file type such as PDF. You can share a search as a link or save it as a favorite. <strong>I'm Feeling Lucky</strong> opens the first result directly.</p>`,
      },
      {
        id: "voice", title: "Voice search and Voice mode", icon: "mic",
        html: `
<p>Select the microphone to search by voice, or open the virtual keyboard to type in another script. <strong>Voice mode</strong> is a hands-free experience with your choice of system voice, voice speed, and optional background music that plays while Voice mode is open. Voice mode arrived in version 1.3.0.</p>
<p>Under Advanced settings, <strong>Text to Speech</strong> can speak text aloud when you select buttons or labels, which helps people with low vision.</p>`,
      },
      {
        id: "personalize", title: "Personalization", icon: "palette",
        html: `
<ul>
<li><strong>Shortcuts:</strong> tiles for your favorite sites on the home page. Add, remove, and choose from presets. Site icons load through the Munetios favicon proxy.</li>
<li><strong>Favorites:</strong> saved searches and pages, searchable by title.</li>
<li><strong>Appearance:</strong> theme, background color and text color with liquid glass color pickers, background image, font family (Munetios UI v4 Font by default, with local font detection), and Reduce Transparency.</li>
<li><strong>Suggestions:</strong> local search suggestions based on your own history. You can clear all personalization at any time.</li>
<li><strong>Labs:</strong> experimental features, including School Quiz Studio for creating, playing, and saving quizzes.</li>
</ul>`,
      },
      {
        id: "safety", title: "SafeSearch and School Mode", icon: "school",
        html: `
<p>SafeSearch can be Off, Moderate, or Strict. <strong>School Mode</strong> locks SafeSearch to Strict, hides Labs, and turns off News. Schools can combine Search with ${link("webfilter", "Munetios WebFilter")}, which can also enforce SafeSearch on managed devices.</p>
${note("Rate limits", "When Wikipedia, News, or map tiles are requested too quickly, Search asks you to complete a CAPTCHA or wait for the limit to reset.")}`,
      },
      {
        id: "privacy", title: "Privacy and data", icon: "privacy_tip",
        html: `
<p>Search history and settings are stored on your device. In Settings → Privacy you can manage your data, clear personalization, and delete search history. Under Data you can export, import, or reset all settings, delete all shortcuts, or delete everything.</p>
<p>Website icons are fetched by the Munetios server, not your browser. The server sends no cookies, no referrer, and a generic User-Agent, and caches only the icon bytes in memory.</p>`,
      },
      {
        id: "shortcuts", title: "Keyboard shortcuts", icon: "keyboard",
        html: keys([["Focus the search bar", "/"], ["Open voice search", "Ctrl + K"], ["Open image search", "Ctrl + I"], ["I'm Feeling Lucky", "Ctrl + Enter"], ["Open Settings", "Ctrl + ,"]]),
      },
      {
        id: "history", title: "Version history", icon: "history",
        html: table(["Version", "Date", "Highlights"], [
          ["1.4.0", "September 24, 2026", "School Quiz Studio, expanded built-in quizzes, custom themes, toast appearance controls, shortcut presets, and advanced customization"],
          ["1.3.0", "August 3, 2026", "Refreshed branding, Voice mode with voice selection, speed, and background music, and expanded image discovery"],
          ["1.2.0", "June 29, 2026", "Reusable modal templates, liquid glass color pickers, and better settings, shortcuts, privacy controls, and localization"],
          ["1.1.0", "May 20, 2026", "Local search suggestions, search-history controls, Activities, and more languages"],
          ["1.0.0", "May 16, 2026", "Launch with private web and image search, themes, shortcuts, SafeSearch, and country selection"],
        ]),
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Does Munetios Search keep a profile of me?", "No. Suggestions are based on history stored on your device, and you can clear it at any time."],
          ["Can I change my country and language?", "Yes. Choose your country in the footer or General settings, and your language from the 17 Munetios languages."],
        ]),
      },
    ],
  });
})();
