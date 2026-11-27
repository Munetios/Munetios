importScripts("/shared/offline-shell.js", new URL("routes.js", self.registration.scope).href);
const root = new URL(self.registration.scope).pathname;

self.installMunetiosOfflineShell({
  cacheName: "munetios-photos-v15",
  obsolete: (name) => name.startsWith("munetios-photos"),
  required: [
    "./", "photos.css", "photos.js", "routes.js", "photos-i18n.js", "photo-editor.js", "ai-eraser.js", "jszip.min.js",
    "/munetios-ui/munetios-ui-v4.css", "/munetios-ui/munetios-ui-v4.js", "/munetios-ui/media-player-styles.js", "/omniwrite/video-player.js",
    "/account/account-menu.css", "/account/account-i18n.js", "/account/account-core.js", "/account/account-menu.js", "/shared/test-error.js",
    "/shared/munetios-cloud.css", "/shared/cloud-i18n.js", "/shared/munetios-cloud.js",
  ],
  optional: [
    "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "/tone.js",
    "/fonts/google-sans-flex/munetios-ui-v4-font.ttf",
    "https://api.munetios.com/beautiful-css/beautiful.css",
    "https://api.munetios.com/fonts/material-symbols/MaterialSymbolsRounded-VariableFont_FILL,GRAD,opsz,wght.ttf",
  ],
  documentFor: (path) => path === root || path === root + "index.html" || MunetiosPhotosRoutes.parse(path) ? "./" : null,
});
