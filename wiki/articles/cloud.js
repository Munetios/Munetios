(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { note, faq, table, link } = W.helpers;
  W.register({
    slug: "cloud",
    title: "Munetios Cloud",
    short: "Cloud",
    logo: "images/logos/munetios.png",
    category: "platform",
    tagline: "Encrypted backup, resumable uploads, and shared spaces for Calendar and Photos.",
    url: "/photos/",
    updated: "2026-11-27",
    shots: [
      { src: "photos-desktop.jpg", caption: "Photos filters show what is in Munetios Cloud and what is only on this device." },
    ],
    facts: {
      developer: "Munetios",
      type: "Encrypted storage and sharing service",
      path: "/api/cloud",
      encryption: "AES-GCM per item and per chunk",
      storage: "50 GB per account by default",
      sharing: "Shared calendars and albums (Editor, Viewer)",
      sync: "Live updates with Server-Sent Events",
    },
    related: ["photos", "calendar", "privacy", "accounts"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "cloud",
        html: `<p><strong>Munetios Cloud</strong> powers backup and sharing in ${link("photos", "Photos")} and ${link("calendar", "Calendar")}. Personal data, including your own events, birthdays, photo details, and albums, syncs through end-to-end encrypted Munetios Account sync. Photo and video bytes are encrypted in the browser and uploaded in chunks.</p>`,
      },
      {
        id: "uploads", title: "How uploads work", icon: "upload",
        html: `
<ol>
<li>The browser reserves an upload with the encrypted size and chunk count. The server checks your storage quota.</li>
<li>Each 4 MiB chunk is encrypted with AES-GCM using a per-item key and sent separately (the server accepts up to 8 MiB per chunk).</li>
<li>If the upload is interrupted, the browser asks which chunks arrived and resumes from there.</li>
<li>The server confirms every chunk arrived and the total size matches.</li>
</ol>
<p>Failed chunks retry with backoff, and uploads wait while you're offline. The per-item key travels only inside your end-to-end encrypted sync data, or inside a shared album.</p>`,
      },
      {
        id: "spaces", title: "Shared spaces", icon: "group",
        html: `
<p>Shared calendars and shared albums are called <strong>spaces</strong>. They're encrypted in the browser, and Munetios stores the space key so collaborators added by email can open them. The owner can stop sharing at any time, which deletes the space and its key from the server.</p>
${table(["Role", "Calendar", "Album"], [["Editor", "Make changes to events", "Add and remove photos (others can remove only what they added)"], ["Viewer", "See all event details", "View and download the album's photos"]])}
<p>Changes arrive live through Server-Sent Events: content, role, member, revoked, and deleted updates.</p>`,
      },
      {
        id: "helpers", title: "Calendar helpers", icon: "public",
        html: `<p>Munetios Cloud also provides Calendar's time zone list with current UTC offsets (refreshed every 10 minutes so daylight saving changes appear quickly) and holiday dates computed on the server for many countries.</p>`,
      },
      {
        id: "limits", title: "Limits", icon: "speed",
        html: `
<p>Updating and syncing share one budget per session: by default 400 requests per 10 minutes. An idle sync costs one request, because each device pulls only when something changed and pushes only what changed locally. When the limit is reached, sync waits and resumes on its own. Chunk uploads and downloads don't count, so large videos are never blocked.</p>
${note("Storage full", "When your Munetios Cloud storage is full, new uploads wait and Photos tells you. Free up space or remove large items.")}`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([["Can Munetios see my photos?", "No. Photo bytes are encrypted with a per-item key before upload, and that key is only in your encrypted sync data or a shared album you created."]]),
      },
    ],
  });
})();
