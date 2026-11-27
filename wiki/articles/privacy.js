(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, note, faq, table, link } = W.helpers;
  W.register({
    slug: "privacy",
    title: "Privacy and encryption at Munetios",
    short: "Privacy and encryption",
    logo: "images/logos/munetios.png",
    category: "platform",
    tagline: "How Munetios encrypts your data, what servers can and can't see, and how sharing stays private.",
    url: "/account/",
    updated: "2026-11-27",
    shots: [
      { src: "account-desktop.jpg", phone: "account-phone.jpg", caption: "Account settings, where Sync, Security, and Data & privacy live." },
    ],
    facts: {
      developer: "Munetios",
      type: "Platform security model",
      encryption: "End-to-end (personal data), AES-GCM (shares and media chunks)",
      sync: "Encrypted sync through Munetios Accounts",
      storage: "Ciphertext only on Munetios servers",
      license: "Apache License 2.0",
    },
    related: ["accounts", "cloud", "collaboration", "mail", "photos"],
    sections: [
      {
        id: "summary", title: "Summary", icon: "shield_lock",
        html: `
<p>Munetios is designed so that the company running the servers can't read your personal content. Data is encrypted on your device with a key derived from your account, and only encrypted bytes (ciphertext) are uploaded. This applies to OmniWrite documents and spreadsheets, SupaNotes notes, Tasks, Meals, Maps markers and Home address, Calendar events and birthdays, Photos details and albums, search history, appearance, shortcuts, and favorites.</p>
${note("What this means for you", "Munetios can't read your synced data and can't recover it if you forget your password. Keep your password and your authenticator recovery codes safe.", "success")}`,
      },
      {
        id: "what-is-encrypted", title: "What is encrypted, and how", icon: "lock",
        html: `
${table(["Data", "Protection", "Who can read it"], [
  ["Documents, spreadsheets, notes, tasks, meals, events, photo details", "End-to-end encrypted sync", "Only your devices"],
  ["Photo and video bytes", "AES-GCM per item, uploaded in 4 MiB encrypted chunks", "Your devices, and people in an album you share"],
  ["Shared calendars and albums (spaces)", "Encrypted in the browser; Munetios stores the space key so invitees can open it", "You and the people you add by email"],
  ["Shared OmniWrite files", "AES-GCM; the key travels in the link's #fragment", "People with the link or an invitation"],
  ["Comments on shared files", "Encrypted with the file's link key", "Collaborators"],
  ["Email", "TLS between servers when supported, and encrypted at rest", "Munetios servers process mail to deliver, filter, and search it"],
  ["Passwords", "Salted scrypt hashes", "Nobody; the password itself is never stored"],
  ["Sessions", "Only SHA-256 hashes of random tokens are stored", "Nobody can reuse a stored hash"],
])}
<p>Munetios Mail is the one app that can't be end-to-end encrypted, because servers have to receive, filter, and search messages for you. Mail says so plainly in its privacy information panel, and adds tracker blocking, a privacy image proxy, and sender authentication checks to compensate.</p>`,
      },
      {
        id: "sharing", title: "Sharing without giving up privacy", icon: "share",
        html: `
<p>Sharing always needs a Munetios Account, and only the owner can add people, change roles, or stop sharing. Collaborators can leave at any time.</p>
<ul>
<li><strong>OmniWrite and Sheets:</strong> roles are Editor, Suggester, and Viewer. General access is Restricted (only invited people) or Anyone with the link. Switching back to Restricted removes the public key while invitees keep access. Locked files can't be shared at all. See ${link("collaboration", "Real-time collaboration")}.</li>
<li><strong>Calendar and Photos:</strong> roles are Editor and Viewer. Stopping sharing deletes the space and its key from the server. Album members can download only the photos linked to that album. See ${link("cloud", "Munetios Cloud")}.</li>
<li><strong>WebFilter:</strong> collaborators are added by email and given Admin or Teacher roles scoped to specific classes.</li>
</ul>
${note("Access changes can't undo the past", "Removing someone stops future access, but it can't remove copies they already made. Share carefully.", "warning")}`,
      },
      {
        id: "account-security", title: "Account security", icon: "security",
        html: `
<ul>
<li>Passwords must be at least 12 characters. Changing your password signs out your other devices.</li>
<li>Two-factor authentication uses six-digit authenticator codes (TOTP, 30-second periods) with replay prevention. Turning it on signs out other devices. Ten single-use recovery codes are available to download.</li>
<li>Sessions expire after seven days. You can review signed-in devices and sign out of any of them, or all of them at once.</li>
<li>Sign-in attempts are rate limited per IP address and email.</li>
<li>A verified recovery email can send you your sign-in email if you forget it. There is no administrator bypass for 2FA.</li>
</ul>
${fig("account-desktop.jpg", "Account settings: profile, security, sync, workspaces, and data & privacy.")}`,
      },
      {
        id: "tracking", title: "No tracking", icon: "visibility_off",
        html: `
<p>Munetios apps don't include analytics or advertising scripts. Some examples of privacy work in specific apps:</p>
<ul>
<li><strong>Search</strong> fetches website icons through a server-side favicon proxy, so your browser never contacts the site or a third-party icon service just to draw an icon. The proxy sends no cookies, no referrer, and a generic User-Agent.</li>
<li><strong>Mail</strong> blocks remote images, external fonts and stylesheets, and known trackers by default, removes forms, and warns about suspicious links.</li>
<li><strong>Maps</strong> live traffic uses anonymous speed reports with no account, device, or trip ID. The first and last 500 m of each trip are never sent, and reports are kept for 15 minutes.</li>
<li><strong>Photos</strong> runs the AI eraser on your device, so photos never leave it, and can remove location and camera details when you download.</li>
<li><strong>YouTube embeds</strong> load only after you accept a privacy warning, use the nocookie domain, and never forward your cookies through Munetios servers.</li>
</ul>`,
      },
      {
        id: "storage", title: "Storage and quotas", icon: "cloud",
        html: `
<p>Each account has 50 GB of encrypted sync storage, measured as stored ciphertext. When an item doesn't fit, it stays on your device and sync retries later; other items keep uploading. Turning sync off on one device keeps the cloud copies. You can export all synced data from this device as a JSON file, delete your synced data from Munetios servers, or delete your account entirely in ${link("accounts", "Account settings")}.</p>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["What happens if I forget my password?", "Munetios can't decrypt your synced data without it. Data that is still on your devices stays there. Keep a password manager or written backup."],
          ["Does deleting synced data delete it from my devices?", "No. Delete synced data removes the encrypted copies from Munetios servers. Your devices keep their data and upload it again the next time they sync."],
          ["Can a teacher see my screen with WebFilter?", "Only on devices enrolled in a school's WebFilter workspace, and only by Admins and the Teachers assigned to that class."],
        ]),
      },
    ],
  });
})();
