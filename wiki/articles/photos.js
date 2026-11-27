(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "photos",
    title: "Munetios Photos",
    short: "Photos",
    logo: "images/logos/photos.png",
    category: "media",
    tagline: "Private, encrypted photos and videos with cloud backup, shared albums, editing, and an on-device AI eraser.",
    url: "/photos/",
    updated: "2026-11-27",
    shots: [
      { src: "photos-desktop.jpg", phone: "photos-phone.jpg", caption: "The Photos library with filters, color search, and size controls." },
    ],
    facts: {
      developer: "Munetios",
      type: "Photo and video library",
      path: "/photos/",
      platforms: "Web, installable app (PWA)",
      encryption: "End-to-end encrypted details; AES-GCM media chunks",
      sync: "Munetios Account and Munetios Cloud",
      offline: "Yes",
      sharing: "Shared albums (Editor, Viewer)",
      languages: "17 languages",
    },
    related: ["cloud", "privacy", "calendar"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "photo_library",
        html: `
<p><strong>Munetios Photos</strong> is a fast, private photo and video library. Photos and videos are encrypted on your device, back up to ${link("cloud", "Munetios Cloud")} in encrypted pieces, and stay organized the same way on every device. It works offline as an installable app.</p>
${pair("photos-desktop.jpg", "photos-phone.jpg", "The Photos library.")}`,
      },
      {
        id: "library", title: "Library and organization", icon: "collections",
        html: `
${table(["Section", "What it shows"], [
  ["Photos", "Your whole library, grouped by day, month, or year"],
  ["Memories", "On this day in past years, and favorites by month, with slideshows"],
  ["Favorites, Videos, Screenshots", "Quick collections"],
  ["Albums", "Your albums and shared albums, with covers, descriptions, and sorting"],
  ["Archive", "Items hidden from the main library"],
  ["Locked folder", "Private items behind a 4–12 digit PIN that never leaves the device; hidden from the library, albums, and Munetios Cloud"],
  ["Recently deleted", "Deleted items, kept for the number of days you choose"],
])}
<p>Filter by photos, videos, favorites, edited, rated, large files, in Munetios Cloud, or only on this device. <strong>Search by color</strong> with one tap, and search photos, dates, and captions. Add captions, star ratings, and tags. Sort by date taken, date added, name, or file size.</p>`,
      },
      {
        id: "editing", title: "Editing", icon: "tune",
        html: `
<ul>
<li><strong>Adjust:</strong> brightness, contrast, saturation, warmth, sepia, blur, vignette, sharpen, grain, fade, hue, and tint.</li>
<li><strong>Filters:</strong> Vivid, Mono, Cool, Warm, Dramatic, Noir, Golden, Teal and orange, Duotone, and Color pop (keep one color and turn the rest black and white).</li>
<li><strong>Crop and rotate</strong> with aspect ratios and flipping.</li>
<li><strong>Paint</strong> with a brush, pen, or marker.</li>
<li>Hold to compare with the original, undo and redo, and save as a copy.</li>
</ul>
<h3>AI eraser</h3>
<p>Paint over anything you want to remove, then choose Erase. The eraser uses <strong>MI-GAN</strong>, an open-source model (MIT license) by Picsart AI Research, running with ONNX Runtime Web on WebGPU or WebAssembly. The model downloads once (about 28 MB) from Hugging Face after you agree, then runs on your device. Your photos never leave it.</p>
${note("On-device AI", "The AI eraser never uploads your photos. The model is cached in your browser after the first download.", "success")}`,
      },
      {
        id: "tools", title: "Utilities", icon: "handyman",
        html: `
<ul>
<li><strong>Duplicates:</strong> identical files are matched by content; keep one and the others go to Recently deleted.</li>
<li><strong>Storage:</strong> see what's backed up, back up everything, free up space on this device, and find large items.</li>
<li><strong>Year in review:</strong> photos and videos so far, the busiest month, and highlights.</li>
<li><strong>Collage:</strong> combine two or more photos in a grid, row, or column.</li>
<li><strong>Compare:</strong> two photos side by side or with a slider.</li>
<li><strong>Camera</strong> and <strong>Record screen</strong> right in the app.</li>
<li><strong>Download as ZIP</strong> and <strong>Import ZIP</strong>; optionally remove location and camera details when you download.</li>
</ul>`,
      },
      {
        id: "sharing", title: "Shared albums", icon: "group",
        html: `
<p>Share an album with people by their Munetios Account email, as Editor (add and remove photos) or Viewer (view photos). Album members can download the photos linked to that album and nothing else. The owner can remove any photo; others can remove only the photos they added. Stopping sharing deletes the shared album and its key from the server, and your photos stay in your library.</p>`,
      },
      {
        id: "settings", title: "Settings", icon: "settings",
        html: `<p>Settings include language, Reduce transparency, slideshow speed and transition, upload quality (Original, High, Medium, Low), showing memories, how long to keep deleted items, backup and sync, Locked folder PIN, import and export, and Delete all data.</p>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Do large videos upload on slow connections?", "Yes. Uploads are split into encrypted 4 MiB chunks that resume where they stopped, retry with backoff, and wait while you're offline."],
          ["Can Munetios see my Locked folder?", "No. Items in the Locked folder are hidden from Munetios Cloud, and the PIN never leaves your device."],
        ]),
      },
    ],
  });
})();
