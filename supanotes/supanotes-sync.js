/*
 * Munetios SupaNotes accounts and sync.
 * - Guests keep using the original "SupaNotes_v1" database on this device.
 * - Each Munetios Account gets its own local database, so accounts never mix.
 * - Signed in with sync unlocked, notes and tags sync with end-to-end encryption
 *   through the shared Munetios Account sync engine (account-core.js).
 */
(() => {
  "use strict";

  const PREFIX = "munetios-supanotes:";
  const TAGS_KEY = PREFIX + "tags";
  const encoder = new TextEncoder();
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
  const noteKey = async (id) => PREFIX + "note:" + hex(await crypto.subtle.digest("SHA-256", encoder.encode(String(id))));

  let resolveReady;
  const workspace = {
    ready: new Promise((resolve) => { resolveReady = resolve; }),
    dbName: "SupaNotes_v1",
    accountId: null,
  };
  window.SupaNotesWorkspace = workspace;

  /* ---------------------------------------------------------- sanitizing */
  const BLOCKED = "script,iframe,object,embed,link,meta,style,base,form,frame,frameset,template,svg,math";
  const SAFE_URL = /^(https?:|mailto:|tel:|#|data:image\/(png|jpe?g|gif|webp|bmp);base64,|data:audio\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,|blob:)/i;
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString("<body>" + String(html || "") + "</body>", "text/html");
    doc.body.querySelectorAll(BLOCKED).forEach((node) => node.remove());
    doc.body.querySelectorAll("*").forEach((node) => {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith("on") || name === "srcdoc" || name === "formaction") node.removeAttribute(attr.name);
        else if (["href", "src", "xlink:href", "action", "poster"].includes(name) && value && !SAFE_URL.test(value)) node.removeAttribute(attr.name);
        else if (name === "data-audio" && value && !/^data:audio\//i.test(value)) node.removeAttribute(attr.name);
        else if (name === "style" && /(expression\s*\(|url\s*\(\s*['"]?\s*javascript:)/i.test(value)) node.removeAttribute(attr.name);
      }
      if (node.tagName === "A") { node.setAttribute("rel", "noopener noreferrer"); node.setAttribute("target", "_blank"); }
    });
    return doc.body.innerHTML;
  }
  function sanitizeNote(note) {
    if (!note || typeof note !== "object") throw new Error("Invalid note");
    const id = typeof note.id === "string" || typeof note.id === "number" ? String(note.id) : "";
    if (!id) throw new Error("Invalid note");
    const meta = note.meta && typeof note.meta === "object" && !Array.isArray(note.meta) ? note.meta : {};
    return {
      id,
      title: String(note.title ?? "").slice(0, 2000),
      content: sanitizeHtml(note.content),
      createdAt: Number(note.createdAt) || Date.now(),
      updatedAt: Number(note.updatedAt) || Date.now(),
      favorite: Boolean(note.favorite),
      trashed: Boolean(note.trashed),
      tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
      meta,
    };
  }
  const validTags = (list) => (Array.isArray(list) ? list : [])
    .filter((tag) => tag && (typeof tag.id === "string" || typeof tag.id === "number") && typeof tag.name === "string")
    .map((tag) => ({ ...tag, id: String(tag.id), name: tag.name.slice(0, 80) }));
  window.SupaNotesSanitize = { html: sanitizeHtml, note: sanitizeNote };

  /* ---------------------------------------------------------- workspace */
  async function init() {
    const account = window.MunetiosAccount;
    if (account && !account.state.ready) {
      await new Promise((resolve) => {
        const stop = account.on((state) => { if (state.ready) { stop(); resolve(); } });
        setTimeout(resolve, 6000);
      });
    }
    const current = () => (account?.state.account ? String(account.state.account.id) : null);
    workspace.accountId = current();
    workspace.dbName = workspace.accountId === null ? "SupaNotes_v1" : "SupaNotes_account_" + workspace.accountId;
    resolveReady(workspace.accountId);
    account?.on(() => {
      if (!account.state.ready || current() === workspace.accountId) return;
      const app = document.getElementById("app");
      if (app) app.inert = true;
      location.reload();
    });
  }

  /* ---------------------------------------------------------- provider */
  const tagStampKey = () => "munetios-supanotes-tags:" + workspace.accountId;
  async function tagState(tags) {
    const signature = hex(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(tags))));
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(tagStampKey()) || "{}"); } catch {}
    if (saved.signature !== signature) {
      saved = { signature, updatedAt: tags.length || saved.updatedAt ? Math.max(Date.now(), (saved.updatedAt || 0) + 1) : 0 };
      try { localStorage.setItem(tagStampKey(), JSON.stringify(saved)); } catch {}
    }
    return saved;
  }

  function register() {
    const account = window.MunetiosAccount;
    const app = window.SupaNotesApp;
    if (!account || !app || workspace.accountId === null) return;
    const accountId = workspace.accountId;
    let queue = Promise.resolve();
    const run = (task) => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
    account.sync.register({
      id: "munetios-supanotes",
      prefix: PREFIX,
      preserveLocal: true,
      paginated: true,
      enabled: () => String(account.state.account?.id) === accountId,
      snapshot: () => run(async () => {
        const notes = await app.getAllNotes();
        const items = await Promise.all(notes.map(async (note) => ({ key: await noteKey(note.id), data: note, updatedAt: note.updatedAt || 1 })));
        const tags = await app.getTags();
        const state = await tagState(tags);
        if (state.updatedAt) items.push({ key: TAGS_KEY, data: tags, updatedAt: state.updatedAt });
        return items;
      }),
      apply: (items) => run(async () => {
        if (String(account.state.account?.id) !== accountId) return false;
        const notes = await app.getAllNotes();
        const byKey = new Map(await Promise.all(notes.map(async (note) => [await noteKey(note.id), note])));
        let changed = false;
        for (const item of items) {
          if (item.key === TAGS_KEY) {
            if (item.deleted) continue;
            const remote = validTags(item.data);
            const local = await app.getTags();
            for (const tag of local) if (!remote.some((r) => r.id === tag.id)) await app.deleteTag(tag.id, { silent: true });
            for (const tag of remote) await app.saveTag(tag, { silent: true });
            await tagState(remote);
            changed = true;
            continue;
          }
          const existing = byKey.get(item.key);
          if (item.deleted) {
            if (existing) { await app.deleteNote(existing.id, { silent: true }); changed = true; }
            continue;
          }
          let note;
          try { note = sanitizeNote(item.data); } catch { continue; }
          if (await noteKey(note.id) !== item.key) continue;
          note.updatedAt = item.updatedAt || note.updatedAt;
          await app.saveNote(note, { silent: true, keepUpdatedAt: true, fromSync: true });
          changed = true;
        }
        if (changed) app.render();
        return changed;
      }),
    });
    document.addEventListener("supanotes-changed", () => {
      if (String(account.state.account?.id) === accountId) account.sync.schedule(800);
    });
  }

  document.addEventListener("supanotes-ready", register, { once: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
