(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "mail",
    title: "Munetios Mail",
    short: "Mail",
    logo: "images/logos/mail.png",
    category: "communication",
    tagline: "Email that blocks trackers, verifies senders, and protects you from suspicious links.",
    url: "/mail/",
    updated: "2026-11-27",
    shots: [
      { src: "mail-desktop.jpg", phone: "mail-phone.jpg", caption: "The Munetios Mail inbox with Primary, Social, and Promotions tabs." },
      { src: "mail-compose-desktop.jpg", caption: "Writing a new message with the rich text toolbar." },
    ],
    facts: {
      developer: "Munetios",
      type: "Email",
      path: "/mail/",
      platforms: "Web, installable app (PWA)",
      encryption: "TLS in transit when supported; encrypted at rest",
      sync: "Live updates across devices",
      offline: "Saved views and messages",
      storage: "50 GB mailbox",
      languages: "17 languages",
    },
    related: ["accounts", "privacy", "calendar"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "mail",
        html: `
<p><strong>Munetios Mail</strong> is the email app for Munetios Accounts. Accounts with an <code>@munetios.com</code> address get a mailbox when they register; external accounts get a forwarding address. Mail runs on Cloudflare Email Routing for incoming mail and Cloudflare Email Sending for outgoing mail, and it is built to keep senders from learning anything about you.</p>
${pair("mail-desktop.jpg", "mail-phone.jpg", "The Mail inbox.")}`,
      },
      {
        id: "organize", title: "Folders, labels, and views", icon: "inbox",
        html: `
${table(["View", "Contains"], [
  ["Inbox", "New mail, split into Primary, Social, Promotions, Updates, and Forums"],
  ["Starred, Important, Snoozed", "Messages you flagged, marked important, or snoozed until later"],
  ["Sent, Drafts, Scheduled, Outbox", "Outgoing mail and its delivery status"],
  ["All Mail, Archive, Spam, Trash", "Everything, archived mail, spam, and deleted mail"],
  ["Follow-ups", "Messages with a reminder that is due"],
  ["On this device", "Mail received while your mailbox was full, kept only on this device"],
])}
<p>Create <strong>folders</strong> (with subfolders, colors, and Material Symbols icons), <strong>labels</strong>, <strong>favorites</strong>, and <strong>saved searches</strong>. Sort by newest, oldest, largest, smallest, sender, or subject, and filter by unread, starred, attachments, important, or larger than 5 MB. Pin messages to the top. A storage meter shows how much of your 50 GB is used, with cleanup recommendations for Trash, Spam, large mail, old attachments, and old promotions.</p>`,
      },
      {
        id: "privacy", title: "Privacy protection", icon: "shield",
        html: `
<ul>
<li><strong>Trackers and remote images are blocked</strong> by default, so the sender can't tell you opened the message. When you choose <em>Load images</em> (or <em>Always for this sender</em>), they load through the Munetios privacy proxy, so the sender never sees your IP address.</li>
<li>External fonts and stylesheets are blocked, and forms are removed from messages for your safety.</li>
<li><strong>Sender authentication:</strong> each message shows SPF, DKIM, and DMARC results, and a spam score with reasons such as misleading sender names, shortened links, or dangerous attachments. Messages pretending to be from Munetios are flagged.</li>
<li><strong>Suspicious links</strong> are checked before they open: Mail warns when a link isn't encrypted (HTTP), hides a sign-in name, uses a raw IP address, imitates another domain, or shows different text than the address it opens.</li>
<li><strong>Block sender</strong>, <strong>Trust this sender</strong>, and one-click <strong>Unsubscribe</strong> for mailing lists.</li>
</ul>
${note("Honest about encryption", "Mail travels encrypted between servers when the other server supports TLS and is encrypted at rest. It isn't end-to-end encrypted: Munetios servers process messages to deliver, filter, and search them.", "warning")}`,
      },
      {
        id: "compose", title: "Writing messages", icon: "edit",
        html: `
${fig("mail-compose-desktop.jpg", "The compose window: recipients, subject, editor modes, and the formatting toolbar.")}
<ul>
<li>Rich text with paragraph and heading styles, fonts, sizes, colors, highlight, alignment, line spacing, lists, checklists, tables, buttons, dividers, images with alt text, special characters, and find and replace.</li>
<li><strong>Schedule send</strong>, high priority, follow-up reminders, and <strong>Cancel sending</strong> while a message is still queued.</li>
<li>Helpful checks: forgotten attachments, a missing subject, and invalid addresses.</li>
<li><strong>Personalization</strong> with <code>{{first_name}}</code>, <code>{{name}}</code>, <code>{{email}}</code>, <code>{{sender_name}}</code>, and <code>{{date}}</code>. Personalized messages are sent individually to each recipient.</li>
<li>Delivery tracking: Sending, Scheduled, Sent, Delivered, Delayed, Bounced, and Not delivered, with details.</li>
<li>Drafts are recovered automatically if the page closes.</li>
</ul>`,
      },
      {
        id: "studio", title: "HTML studio and email builder", icon: "code",
        html: `
<p>For newsletters and announcements, Mail includes a block-based <strong>email builder</strong> (header, text, image, button, divider, spacer, columns, table, footer, and custom HTML) with saved components and email settings for backgrounds, link color, width, corner radius, and preview text.</p>
<p>The <strong>HTML source editor</strong> highlights code, folds sections, and checks compatibility as you type. It warns that flexbox and CSS grid don't work in Outlook, that Gmail clips messages larger than about 102 KB, that SVG images are blocked by Gmail and Outlook, that scripts never run in email, and much more. Event handlers, <code>javascript:</code> links, and scripts are removed before sending. You can send yourself a test first.</p>`,
      },
      {
        id: "reading", title: "Reading and actions", icon: "drafts",
        html: `
<p>Open messages in the reading pane or in a tab, view conversations as threads, reply, reply all, forward, print, download as <code>.eml</code>, or show the original headers. Snooze until later today, tomorrow, this weekend, next week, or a custom time. New mail arrives live without reloading.</p>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Who gets a Munetios Mail mailbox?", "Accounts with an @munetios.com address. External accounts get a forwarding address instead."],
          ["What happens when my mailbox is full?", "New mail is held for this device and appears in On this device, so nothing is lost. Free up space to receive mail normally again."],
          ["Can I link another address?", "Yes. Addresses at other providers that forward to Munetios can be verified with a code and linked to your mailbox."],
        ]),
      },
    ],
  });
})();
