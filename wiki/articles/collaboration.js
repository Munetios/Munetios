(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { note, faq, table, link } = W.helpers;
  W.register({
    slug: "collaboration",
    title: "Real-time collaboration",
    short: "Collaboration",
    logo: "images/logos/omniwrite.png",
    category: "productivity",
    tagline: "Encrypted sharing, live presence, suggestions, and comments for OmniWrite documents and spreadsheets.",
    url: "/omniwrite/",
    updated: "2026-11-27",
    shots: [
      { src: "omniwrite-editor-desktop.jpg", caption: "Share and comments live in the OmniWrite top bar." },
    ],
    facts: {
      developer: "Munetios",
      type: "Collaboration service",
      path: "/api/collab",
      encryption: "AES-GCM in the browser",
      sharing: "Editor, Suggester, Viewer; Restricted or Anyone with the link",
      sync: "Live updates with Server-Sent Events",
    },
    related: ["omniwrite", "sheets", "privacy", "accounts"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "group",
        html: `
<p>OmniWrite documents and spreadsheets can be edited together in real time. You see who is here, their cursors, their suggestions, and their comments, while the content stays encrypted. The browser encrypts shared content with AES-GCM, and existing links keep the key in the URL fragment (<code>/omniwrite/#/shared/{id}/{key}</code>), which browsers never send to the server.</p>`,
      },
      {
        id: "access", title: "Roles and general access", icon: "admin_panel_settings",
        html: `
${table(["Role", "Can"], [["Editor", "Edit the file directly"], ["Suggester", "Propose changes the owner can accept or reject"], ["Viewer", "Read the file"]])}
${table(["General access", "Who can open the file"], [["Restricted", "Only people you add by email"], ["Anyone with the link", "Anyone with the link, signed in or signed out, with the link's role"]])}
<ul>
<li>Sharing needs a Munetios Account. Only the owner can add people, change roles, change general access, or stop sharing.</li>
<li>When you enable Anyone with the link or invite people, you give Munetios the file key so invitees can open the file through <strong>Shared</strong>.</li>
<li>Switching to Restricted removes the public key; invitees keep access. Removing the last invitation deletes the invitation key.</li>
<li>Locked files can't collaborate. While a file is locked, only its owner can reach it.</li>
</ul>`,
      },
      {
        id: "live", title: "Live editing", icon: "bolt",
        html: `
<p>Content, presence, role, and settings changes arrive over Server-Sent Events. Edits made at the same time are merged in the browser: documents merge by block and then by character, and spreadsheets merge by cell. Presence and live cursors are kept in memory, never stored.</p>
<p>On the Munetios developer beta, each shared file has its own Durable Object, so every request for one file reaches the same place.</p>`,
      },
      {
        id: "comments", title: "Comments and suggestions", icon: "comment",
        html: `
<p>Comments on private files stay with the file on your device. Comments on shared files are stored on the server, encrypted with the link key: that includes the text and the anchor in the document. Replies are grouped into threads that can be resolved. Each person can have one open suggestion per file.</p>
${note("Reporting", "Files shared with Anyone with the link can be reported if they contain abuse.")}`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Does removing someone delete what they saw?", "No. Access changes can't undo earlier access or copies someone already made."],
          ["Do collaborators need an account?", "Invited people do. Anyone with the link can open a link-shared file without signing in, with the link's role."],
          ["Where else is sharing used?", `Calendar and Photos use shared spaces from ${link("cloud", "Munetios Cloud")}.`],
        ]),
      },
    ],
  });
})();
