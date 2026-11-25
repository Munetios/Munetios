importScripts("/shared/offline-shell.js");

const root = new URL(self.registration.scope).pathname;
self.installMunetiosOfflineShell({
  cacheName: "omniwrite-cache-v102",
  obsolete: (name) => name.startsWith("omniwrite-cache-"),
  required: [
    "./", "chart.js", "local-signin.js", "lazy-dom.js", "font-settings.js", "omniwrite-v4.js",
    "omniwrite.css", "mobile-layout.css", "omniwrite-late.css", "omniwrite-v4.css",
    "video-player.js", "mobile-layout.js", "media-sync.js", "account-link.js",
    "omni-ui.js", "omni-select.js", "formatting.js", "panel-resize.js", "icon-picker.js",
    "command-palette.js", "native-files.js", "spellcheck.js", "dictionary.js", "collab.js",
    "languages/index.json", "languages/en.json", "sheets/", "sheets/redirect.js",
    "sheets/sheets.css", "sheets/sheets-shell.css", "sheets/sheets-engine.js", "sheets/sheets-files.js", "sheets/sheets.js",
    "/signin/translations.js", "/munetios-ui/munetios-ui-v4.css", "/munetios-ui/munetios-ui-v4.js",
    "/munetios-ui/media-player-styles.js", "/munetios-ui/youtube-i18n.js", "/munetios-ui/youtube-player.js",
    "/account/account-menu.css", "/account/account-i18n.js", "/account/account-core.js", "/account/account-menu.js",
  ],
  optional: [
    "site.webmanifest?v=2", "android-chrome-192x192.png?v=2", "android-chrome-512x512.png?v=2",
    "apple-touch-icon.png?v=2", "favicon-16x16.png", "favicon-32x32.png", "favicon.ico",
    "spellcheck-en.txt", "material-symbols.json", "sheets/site.webmanifest",
    "languages/pt.json", "languages/pt-BR.json", "languages/pt-PT.json", "/fonts/google-sans-flex/munetios-ui-v4-font.ttf",
    "https://write.munetios.com/tone.js",
    "https://www.munetios.com/munetios-pronounce.js", "https://api.munetios.com/web-protection/protection.min.js",
    "https://api.munetios.com/beautiful-css/beautiful.css",
    "/fonts/google-sans-flex/googlesansflex.ttf",
    "https://api.munetios.com/fonts/material-symbols/MaterialSymbolsRounded-VariableFont_FILL,GRAD,opsz,wght.ttf",
    "https://api.munetios.com/fonts/inter/inter.ttf",
    "https://api.munetios.com/fonts/open-sans/opensans.ttf",
    "https://api.munetios.com/fonts/roboto/roboto.ttf",
    "https://api.munetios.com/fonts/google-sans/googlesans.ttf",
    "https://api.munetios.com/fonts/lexend/lexend.ttf",
    "https://api.munetios.com/fonts/poppins/Poppins-Regular.ttf",
  ],
  documentFor(path) {
    if ([root, root + "index.html"].includes(path)) return "./";
    if ([root + "sheets", root + "sheets/", root + "sheets/index.html"].includes(path)) return "sheets/";
    return null;
  },
});
