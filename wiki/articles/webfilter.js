(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "webfilter",
    title: "Munetios WebFilter",
    short: "WebFilter",
    logo: "images/logos/webfilter.svg",
    category: "education",
    tagline: "Web filter rules, categories, classroom controls, UserCSS policies, remote devices, and extension deployment for schools.",
    url: "/webfilter/",
    updated: "2026-11-27",
    shots: [
      { src: "webfilter-desktop.jpg", phone: "webfilter-phone.jpg", caption: "Web Filter Rules: check a URL, Global rules, and Allowlist only." },
      { src: "webfilter-categories-desktop.jpg", caption: "Categories: block whole categories of websites for the school or one class." },
      { src: "webfilter-classes-desktop.jpg", caption: "Classes group devices and assign Teachers." },
      { src: "webfilter-comparison-desktop.jpg", caption: "The built-in comparison page." },
      { src: "webfilter-blocked-desktop.jpg", phone: "webfilter-blocked-phone.jpg", caption: "The block page students see." },
      { src: "webfilter-welcome-desktop.jpg", phone: "webfilter-welcome-phone.jpg", caption: "The WebFilter welcome page." },
    ],
    facts: {
      developer: "Munetios",
      type: "School web filter and device management",
      path: "/webfilter/",
      platforms: "Web console; Chrome and Edge extension (Chromebooks and computers)",
      encryption: "Admin keys and enrollment tokens stored only as SHA-256 hashes",
      sync: "Devices check in about every 30 seconds, plus live commands",
      sharing: "Admin and Teacher roles, scoped to classes",
      languages: "17 languages",
    },
    related: ["search", "accounts", "privacy"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "shield",
        html: `
<p><strong>Munetios WebFilter</strong> lets schools manage website access, classroom rules, and browser extensions. Admins and Teachers sign in with their Munetios Accounts to a web console, and the Munetios WebFilter browser extension enforces the rules on school Chromebooks and computers. Each <strong>workspace</strong> is a separate organization with its own rules, devices, collaborators, and extension ID.</p>
${pair("webfilter-desktop.jpg", "webfilter-phone.jpg", "The WebFilter console.")}`,
      },
      {
        id: "rules", title: "Web filter rules", icon: "rule",
        html: `
<p>Block or allow websites for the whole school or for one class.</p>
<ul>
<li><strong>Global rules</strong> apply to every class. <strong>Class rules</strong> come first for that class, before Global rules. Teachers can change Global rules for their own class without affecting other classes.</li>
<li>Each rule matches a <strong>whole website</strong>, <strong>part of a website</strong> (such as <code>example.org/games</code>), or a <strong>word in the address</strong>. Add several rules at once, one per line, with an optional note.</li>
<li><strong>Allowlist only</strong> blocks every website except allowed ones, for example during a test.</li>
<li><strong>Blocked text:</strong> pages whose address contains these words are blocked, and the words are removed when students type or paste them.</li>
<li><strong>Check a URL</strong> shows exactly why a site is blocked or allowed, for any class: a Global block rule, a class rule, an allow rule, Allowlist only, or a temporary block.</li>
</ul>
<p>The WebFilter block page and browser pages are always reachable.</p>`,
      },
      {
        id: "categories", title: "Categories", icon: "category",
        html: `
${fig("webfilter-categories-desktop.jpg", "Categories with the website category checker and Global category switches.")}
<p>Block whole categories such as Education, Reference, Search engines, Productivity, News, Social media, Chat and messaging, Video and streaming, Music and audio, Games, and Gambling. More than 5,000 well-known sites, plus <code>.edu</code> and <code>.gov</code> addresses, are in the built-in category list; everything else is <em>Unrated</em>, which you can block too. No website is ever looked up online. Admins can create custom categories, and the most specific domain wins.</p>`,
      },
      {
        id: "classes", title: "Classes and collaborators", icon: "school",
        html: `
<p>Group devices by class (for example, Period 3 Biology) and choose which Teachers manage each one. Each class shows its rules, styles, and device count.</p>
${table(["Role", "Can"], [["Admin", "Manage the whole organization: Global rules, categories, classes, devices, collaborators, settings, and deployment"], ["Teacher", "Allow and block sites for assigned classes, change Global rules for them, and manage devices in those classes"]])}
<p>Admins add existing Munetios Accounts by email in <strong>Collaborators</strong>. The server enforces assigned classes on every request, and edits require the current policy revision so nobody overwrites someone else's changes. <strong>View as</strong> lets Admins preview the console as a Teacher.</p>`,
      },
      {
        id: "usercss", title: "UserCSS policies", icon: "format_paint",
        html: `
<p>Students can personalize websites with UserCSS, and WebFilter decides where it may run:</p>
${table(["List", "Effect"], [["Allowed URLs", "Full UserCSS runs inside the security sandbox; risky CSS is always removed"], ["Partially blocked URLs", "Only colors, backgrounds, and text style are kept"], ["Blocked URLs", "The website keeps its default look"]])}
<p>UserCSS never styles WebFilter restricted pages. The sandbox removes script execution vectors, unsafe <code>url()</code> resources (only HTTPS on api.munetios.com and fonts.googleapis.com), z-index above 9999, clickjacking and full-screen overlays, CSS-based data exfiltration and keystroke tracking, CSS escapes, and attempts to hide WebFilter notices. Admins can allow specific <code>@import</code> URLs.</p>`,
      },
      {
        id: "devices", title: "Remote devices", icon: "devices",
        html: `
<p>Managed devices running the extension report status about every 30 seconds, and connected devices also wait for live commands so actions happen right away. For each device you can see the current website, open tabs, online or locked status, and pending commands. Commands include:</p>
${table(["Command", "What it does"], [
  ["Lock screen / Unlock screen", "Locks the device, with an optional message such as “Eyes up front, please.”"],
  ["Push notice", "Shows a message from the school"],
  ["Send latest rules", "Syncs the policy immediately"],
  ["Open tab / Close tab", "Opens an http or https address, or closes a specific tab"],
  ["Temporary block", "Blocks a website on that device for a number of minutes"],
  ["Clear temporary blocks", "Removes temporary blocks"],
])}
<p>A 24-hour command history shows whether each command is Waiting, Delivered, Done, or Failed. Student screen viewing shows the latest screen image from enrolled devices.</p>`,
      },
      {
        id: "requests", title: "Access requests and bypass", icon: "mark_email_unread",
        html: `<p>From the block page, students can send an <strong>access request</strong> that Teachers approve or deny, and Admins can set a <strong>bypass password</strong> (stored as a salted scrypt hash) for temporary website access. The block page explains the reason: an organization-wide rule, a class rule, Allowlist only, blocked text, or a blocked category.</p>
${fig("webfilter-blocked-desktop.jpg", "The block page shows the address, the reason, and a way back.")}`,
      },
      {
        id: "deploy", title: "Extension download and deployment", icon: "extension",
        html: `
<p>Install the Munetios WebFilter extension on school Chromebooks and computers so your rules apply there. The console builds a signed package for your workspace, and Chrome and Edge keep it up to date through the workspace's update URL. You can deploy it through Google Admin using the extension ID. The extension popup shows the device name, connection, last sync, and how UserCSS applies to the current page.</p>
${note("Workspace keys", "The admin key and enrollment token are stored only as SHA-256 hashes on the server.", "success")}`,
      },
      {
        id: "compare", title: "Comparison", icon: "compare_arrows",
        html: `
${fig("webfilter-comparison-desktop.jpg", "Munetios WebFilter compared with GoGuardian, Securly, and Lightspeed.")}
${table(["Feature", "Munetios WebFilter", "GoGuardian", "Securly", "Lightspeed"], [
  ["Website allow and block rules", true, true, true, true],
  ["Category blocking", true, true, true, true],
  ["Classroom website rules", true, true, true, true],
  ["URL keyword rules", true, true, true, false],
  ["Enforce SafeSearch", true, false, true, true],
  ["YouTube Restricted Mode", true, false, true, false],
  ["Individual YouTube video rules", true, true, true, true],
  ["Student screen viewing", true, true, true, true],
  ["Remote tab management", true, true, true, true],
  ["Remote lock and unlock", true, true, true, true],
  ["Student access requests", true, false, true, false],
  ["Temporary website access", true, true, true, false],
  ["Sandboxed UserCSS", true, false, false, false],
  ["Munetios School Mode", true, false, false, false],
])}
${note("About this table", "From the WebFilter console's comparison page. ✗ means unavailable or not documented; availability varies by plan, device, and setup.")}`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["What if a device is offline?", "Rules keep working from the last synced policy. Commands run at the next check-in."],
          ["Can Teachers change rules for the whole school?", "No. Global rules are managed by Admins. Teachers can override them only for their assigned classes."],
          ["Can I move an older browser-only workspace?", "Yes. Claim it once with the legacy organization key and a Munetios Account. Rules and devices are kept."],
        ]),
      },
    ],
  });
})();
