window.MUNETIOS_VIDEOS = [
  ["GmTO-w7wazU", "Munetios Meet Preview", "Munetios YouTube Channel"],
  ["44pThpUVoPk", "Munetios Tasks 2 Preview", "Munetios YouTube Channel"],
  [
    "1KJrusVLPRU",
    "Munetios OmniWrite vs Google Docs | Full Comparison",
    "Munetios YouTube Channel",
  ],
  ["sDtoYK-xecQ", "Munetios Workflow (Labs)", "Munetios YouTube Channel"],

  [
    "_iExvPYQcTI",
    "Join4Join (j4j) Discord Bot Official Tutorial ",
    "Gaming Dada · Discord Bot Tutorials",
  ],
].map(([id, title, description]) => ({
  id,
  title,
  description,
  // Local placeholder: thumbnails are not fetched from YouTube, so browsing the list contacts no third party.
  thumbnail:
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d28d9"/><stop offset="1" stop-color="#2d164e"/></linearGradient></defs><rect width="480" height="360" fill="url(#g)"/><circle cx="240" cy="180" r="54" fill="#fff" fill-opacity=".18"/><path d="M222 150v60l50-30z" fill="#fff"/></svg>',
    ),
}));
