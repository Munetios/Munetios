(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "accounts",
    title: "Munetios Accounts",
    short: "Accounts",
    logo: "images/logos/munetios.png",
    category: "platform",
    tagline: "One account for every Munetios app, with encrypted sync, two-factor authentication, and workspaces.",
    url: "/account/",
    updated: "2026-11-27",
    shots: [
      { src: "account-desktop.jpg", phone: "account-phone.jpg", caption: "Account settings with Profile, Security, Sync, Workspaces, and Data & privacy." },
      { src: "signin-desktop.jpg", phone: "signin-phone.jpg", caption: "The Munetios sign-in page." },
    ],
    facts: {
      developer: "Munetios",
      type: "Identity, security, and sync",
      path: "/signin/ and /account/",
      platforms: "Web",
      encryption: "End-to-end encrypted sync; scrypt password hashes",
      sync: "All Munetios apps",
      storage: "50 GB encrypted sync storage",
      languages: "17 languages",
    },
    related: ["privacy", "cloud", "omniwrite", "mail"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "account_circle",
        html: `
<p><strong>Munetios Accounts</strong> is the single sign-in for every Munetios app. One account unlocks end-to-end encrypted sync, sharing, Munetios Cloud backup, and, for @munetios.com addresses, a Munetios Mail mailbox. The account menu appears in the top corner of each app and shows your sync status, workspaces, other signed-in accounts, and a link to Account settings.</p>
${pair("signin-desktop.jpg", "signin-phone.jpg", "Signing in to Munetios.")}`,
      },
      {
        id: "sign-up", title: "Creating an account", icon: "person_add",
        html: `
<ul>
<li><strong>Munetios address:</strong> anyone can register an available <code>@munetios.com</code> address as a personal account. It comes with a Munetios Mail mailbox. System mailboxes and reserved addresses can't be claimed.</li>
<li><strong>External address:</strong> new sign-ups with another email provider enter a single-use verification code that expires after 10 minutes. External accounts get a forwarding address in Mail.</li>
<li><strong>Sign in with Google:</strong> available when configured. You can disconnect it later and add a password instead.</li>
</ul>
<p>Passwords must be at least 12 characters and are stored only as salted scrypt hashes. Sign-in attempts are rate limited per IP address and email.</p>`,
      },
      {
        id: "settings", title: "Account settings", icon: "manage_accounts",
        html: `
<p>Account settings at <code>/account/</code> has five pages, plus a language picker.</p>
${table(["Page", "What you can do"], [
  ["Account", "Change your name and profile picture (cropped to 256×256 PNG), add an optional birthday that appears in Munetios Calendar, change your email address, and see your member-since date."],
  ["Security", "Change your password, turn on two-factor authentication, download recovery codes, set a recovery email, and review or sign out signed-in devices."],
  ["Sync", "Turn sync on or off for this device, choose what syncs, see storage by category, and sync now."],
  ["Workspaces", "Create, rename, open, and delete OmniWrite workspaces. Personal is the default."],
  ["Data & privacy", "Export your data as JSON, delete synced data, choose export options, and delete your account."],
])}
${fig("account-desktop.jpg", "The Account page with profile picture, name, birthday, and email address.")}`,
      },
      {
        id: "security", title: "Two-factor authentication and recovery", icon: "phonelink_lock",
        html: `
<p>Authenticator 2FA uses six-digit TOTP codes with 30-second periods, a one-step clock tolerance, and atomic replay prevention, so each code works only once. To set it up:</p>
<ol>
<li>Open <strong>Security</strong> and choose <strong>Set up authenticator</strong>. Enter your password.</li>
<li>Scan the QR code with your authenticator app, or type the setup key.</li>
<li>Enter the six-digit code to turn on 2FA. Setup expires after 10 minutes.</li>
<li>Download your recovery codes. Each code can be used once, and generating new codes invalidates the old ones.</li>
</ol>
${note("Keep your setup key safe", "There is no email recovery or administrator bypass for 2FA. Turning on 2FA signs out your other devices.", "warning")}
<p>A <strong>recovery email</strong> at another provider can send you your sign-in email address if you forget it (“Forgot email?”).</p>`,
      },
      {
        id: "sync", title: "Encrypted sync", icon: "sync",
        html: `
<p>When you sign in on a new device, you enter your password once to decrypt your synced data there. After that, everything syncs automatically. These categories sync across your signed-in devices, and each can be turned off per browser:</p>
<ul>
<li>Search history, appearance, search and voice settings, shortcuts and favorites</li>
<li>Workspaces, OmniWrite folders and documents, OmniWrite Sheets spreadsheets, and media</li>
<li>Data from Tasks, SupaNotes, Meals, Maps, Calendar, and Photos</li>
</ul>
<p>Sync options include a background sync interval (30 seconds to 15 minutes), syncing when the connection returns, syncing in background tabs, and syncing on data-saving connections. The account menu shows <em>Synced</em>, <em>Syncing…</em>, <em>Sync is paused on this device</em>, or <em>Couldn't sync. Saved locally instead</em>.</p>
<p>Each account has <strong>50 GB</strong> of encrypted sync storage. Items that don't fit stay on the device and retry later.</p>`,
      },
      {
        id: "workspaces", title: "Workspaces and multiple accounts", icon: "workspaces",
        html: `
<p>Workspaces keep OmniWrite documents separate, for example Personal, School, and Work. They sync to all your devices. A workspace must be empty before you can delete it, and Personal can't be deleted.</p>
<p>You can be signed in to several accounts at once. Use <strong>Switch accounts</strong> in the account menu, or <strong>Add account</strong> to sign in to another. Local data is kept separately for each account and for guest mode.</p>`,
      },
      {
        id: "data", title: "Your data", icon: "folder_managed",
        html: `
<ul>
<li><strong>Export your data</strong> downloads the data on this device that syncs to your account, as readable or compact JSON. You choose whether to include search history, appearance, shortcuts, and your email address.</li>
<li><strong>Delete synced data</strong> removes your encrypted data from Munetios servers. Your devices keep their data.</li>
<li><strong>Delete account</strong> permanently deletes your account and its synced data after you enter your password. Data on your devices stays.</li>
</ul>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Why do I enter my password again on a new device?", "Your password unlocks the key that decrypts your synced data on that device. Munetios never has that key."],
          ["What happens when I'm signed out on one device?", "Apps show a “You've been signed out” dialog and keep your local data. Sign in again to resume syncing."],
          ["Can I use Munetios apps without an account?", "Yes. Guest data stays on your device. In Tasks, export a backup as a guest, then import it after signing in to move it into your account."],
        ]),
      },
    ],
  });
})();
