// Folders, labels, contacts, signatures, templates, filters, sender lists, saved searches,
// preferences, themes, theme assets, subscriptions, and safe unsubscribe.
import { sanitizePreferences, sanitizeTheme } from "../../mail/js/theme-schema.js";
import { sanitizeEmailHtml } from "./sanitize.js";
import { validateFilter, applyFilters, senderMatches } from "./rules.js";
import { changeStatement } from "./mailbox.js";
import { storeBlob, readBlobJson, readBlob, dropRefStatements, reserve, release } from "./storage.js";
import { safeFetch } from "./proxy.js";
import { fail, id, now, normalizeEmail, validEmail, cleanHeaderText, parseJson, readBytes, utf8, bool, opsLog } from "./util.js";

const name = (value, max = 120) => {
    const text = cleanHeaderText(value, max);
    if (!text) fail(400, "nameRequired");
    return text;
};
const colorValue = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : "";
const icon = value => /^[a-z0-9_]{1,40}$/.test(value || "") ? value : "";

/* ------------------------------------------------------------------ folders */
export async function listFolders(env, mailboxIds) {
    if (!mailboxIds.length) return [];
    const { results } = await env.MAIL_DB.prepare(`SELECT id, mailbox_id AS mailboxId, parent_id AS parentId, name, color, icon, favorite, position FROM folders WHERE mailbox_id IN (${mailboxIds.map(() => "?").join(",")}) ORDER BY position, name`).bind(...mailboxIds).all();
    return results.map(row => ({ ...row, favorite: Boolean(row.favorite) }));
}

export async function saveFolder(env, mailbox, input, folderId = null) {
    const db = env.MAIL_DB;
    const parentId = input.parentId || null;
    if (parentId) {
        const parent = await db.prepare("SELECT id FROM folders WHERE id = ? AND mailbox_id = ?").bind(parentId, mailbox.id).first();
        if (!parent) fail(400, "invalidFolder");
        // Prevent cycles: walk up from the new parent.
        let cursor = parentId;
        for (let depth = 0; cursor && depth < 64; depth++) {
            if (cursor === folderId) fail(400, "invalidFolder");
            cursor = (await db.prepare("SELECT parent_id FROM folders WHERE id = ?").bind(cursor).first())?.parent_id;
        }
    }
    if (folderId) {
        const row = await db.prepare("SELECT * FROM folders WHERE id = ? AND mailbox_id = ?").bind(folderId, mailbox.id).first();
        if (!row) fail(404, "notFound");
        await db.batch([
            db.prepare("UPDATE folders SET name = ?, parent_id = ?, color = ?, icon = ?, favorite = ?, position = ? WHERE id = ?")
                .bind(input.name !== undefined ? name(input.name) : row.name, "parentId" in input ? parentId : row.parent_id, "color" in input ? colorValue(input.color) : row.color,
                    "icon" in input ? icon(input.icon) || "folder" : row.icon, "favorite" in input ? bool(input.favorite) : row.favorite, Number.isFinite(input.position) ? input.position : row.position, folderId),
            changeStatement(db, mailbox.id, "folder", folderId, "upsert"),
        ]);
        return { id: folderId };
    }
    const folder = { id: id("f_"), name: name(input.name) };
    await db.batch([
        db.prepare("INSERT INTO folders (id, mailbox_id, parent_id, name, color, icon, favorite, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM folders WHERE mailbox_id = ?), ?)")
            .bind(folder.id, mailbox.id, parentId, folder.name, colorValue(input.color), icon(input.icon) || "folder", bool(input.favorite), mailbox.id, now()),
        changeStatement(db, mailbox.id, "folder", folder.id, "upsert"),
    ]);
    return folder;
}

// Messages in a deleted folder (and its subfolders) move to the Inbox rather than being deleted.
export async function deleteFolder(env, mailbox, folderId) {
    const db = env.MAIL_DB;
    const row = await db.prepare("SELECT id FROM folders WHERE id = ? AND mailbox_id = ?").bind(folderId, mailbox.id).first();
    if (!row) fail(404, "notFound");
    const ids = [folderId];
    for (let index = 0; index < ids.length; index++) {
        const { results } = await db.prepare("SELECT id FROM folders WHERE parent_id = ?").bind(ids[index]).all();
        ids.push(...results.map(item => item.id));
    }
    const statements = [];
    for (const folder of ids) {
        statements.push(db.prepare("UPDATE messages SET folder = 'inbox', version = version + 1, updated_at = ? WHERE mailbox_id = ? AND folder = ?").bind(now(), mailbox.id, folder));
        statements.push(db.prepare("UPDATE filters SET enabled = 0 WHERE mailbox_id = ? AND actions_json LIKE ?").bind(mailbox.id, `%"${folder}"%`));
    }
    statements.push(db.prepare("DELETE FROM folders WHERE id = ?").bind(folderId), changeStatement(db, mailbox.id, "folder", folderId, "delete"), changeStatement(db, mailbox.id, "message", "*", "refresh"));
    await db.batch(statements);
}

/* ------------------------------------------------------------------ labels */
export async function listLabels(env, mailboxIds) {
    if (!mailboxIds.length) return [];
    const { results } = await env.MAIL_DB.prepare(`SELECT id, mailbox_id AS mailboxId, name, color, icon, favorite, position FROM labels WHERE mailbox_id IN (${mailboxIds.map(() => "?").join(",")}) ORDER BY position, name`).bind(...mailboxIds).all();
    return results.map(row => ({ ...row, favorite: Boolean(row.favorite) }));
}

export async function saveLabel(env, mailbox, input, labelId = null) {
    const db = env.MAIL_DB;
    try {
        if (labelId) {
            const row = await db.prepare("SELECT * FROM labels WHERE id = ? AND mailbox_id = ?").bind(labelId, mailbox.id).first();
            if (!row) fail(404, "notFound");
            await db.batch([
                db.prepare("UPDATE labels SET name = ?, color = ?, icon = ?, favorite = ?, position = ? WHERE id = ?")
                    .bind(input.name !== undefined ? name(input.name, 80) : row.name, "color" in input ? colorValue(input.color) || row.color : row.color, "icon" in input ? icon(input.icon) || "label" : row.icon,
                        "favorite" in input ? bool(input.favorite) : row.favorite, Number.isFinite(input.position) ? input.position : row.position, labelId),
                changeStatement(db, mailbox.id, "label", labelId, "upsert"),
            ]);
            return { id: labelId };
        }
        const label = { id: id("l_"), name: name(input.name, 80) };
        await db.batch([
            db.prepare("INSERT INTO labels (id, mailbox_id, name, color, icon, favorite, position, created_at) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM labels WHERE mailbox_id = ?), ?)")
                .bind(label.id, mailbox.id, label.name, colorValue(input.color) || "#8f5cff", icon(input.icon) || "label", bool(input.favorite), mailbox.id, now()),
            changeStatement(db, mailbox.id, "label", label.id, "upsert"),
        ]);
        return label;
    } catch (error) {
        if (/UNIQUE/i.test(String(error?.message))) fail(409, "nameTaken");
        throw error;
    }
}

export async function deleteLabel(env, mailbox, labelId) {
    const result = await env.MAIL_DB.prepare("DELETE FROM labels WHERE id = ? AND mailbox_id = ?").bind(labelId, mailbox.id).run();
    if (!result.meta.changes) fail(404, "notFound");
    await changeStatement(env.MAIL_DB, mailbox.id, "label", labelId, "delete").run();
}

/* ------------------------------------------------------------------ contacts */
export async function listContacts(env, mailbox, { q = "", limit = 50, offset = 0, auto = true } = {}) {
    const like = "%" + String(q).replace(/[\\%_]/g, c => "\\" + c) + "%";
    const { results } = await env.MAIL_DB.prepare(
        "SELECT id, name, email, phone, company, notes, favorite, auto, use_count AS useCount, last_used AS lastUsed FROM contacts WHERE mailbox_id = ? AND (? = 1 OR auto = 0) " +
        "AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\') ORDER BY favorite DESC, use_count DESC, name COLLATE NOCASE LIMIT ? OFFSET ?")
        .bind(mailbox.id, auto ? 1 : 0, like, like, like, Math.min(500, Number(limit) || 50), Math.max(0, Number(offset) || 0)).all();
    const { results: groups } = await env.MAIL_DB.prepare("SELECT g.id, g.name, (SELECT COUNT(*) FROM contact_group_members m WHERE m.group_id = g.id) AS size FROM contact_groups g WHERE g.mailbox_id = ? ORDER BY g.name").bind(mailbox.id).all();
    return { contacts: results.map(row => ({ ...row, favorite: Boolean(row.favorite), auto: Boolean(row.auto) })), groups };
}

export async function suggestRecipients(env, mailboxes, q) {
    const term = String(q || "").trim();
    if (!term) return [];
    const like = "%" + term.replace(/[\\%_]/g, c => "\\" + c) + "%";
    const ids = mailboxes.map(row => row.id);
    const { results } = await env.MAIL_DB.prepare(
        `SELECT name, email, use_count FROM contacts WHERE mailbox_id IN (${ids.map(() => "?").join(",")}) AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY favorite DESC, use_count DESC LIMIT 12`)
        .bind(...ids, like, like).all();
    const { results: groups } = await env.MAIL_DB.prepare(
        `SELECT g.id, g.name FROM contact_groups g WHERE g.mailbox_id IN (${ids.map(() => "?").join(",")}) AND g.name LIKE ? ESCAPE '\\' LIMIT 5`).bind(...ids, like).all();
    const out = [];
    const seen = new Set();
    for (const row of results) if (!seen.has(row.email)) { seen.add(row.email); out.push({ type: "contact", name: row.name, email: row.email }); }
    for (const group of groups) {
        const { results: members } = await env.MAIL_DB.prepare("SELECT c.name, c.email FROM contact_group_members m JOIN contacts c ON c.id = m.contact_id WHERE m.group_id = ?").bind(group.id).all();
        out.push({ type: "group", name: group.name, members: members.map(item => ({ name: item.name, email: item.email })) });
    }
    return out;
}

export async function saveContact(env, mailbox, input, contactId = null) {
    const email = normalizeEmail(input.email);
    if (!validEmail(email)) fail(400, "invalidAddress");
    const values = [cleanHeaderText(input.name, 200), email, cleanHeaderText(input.phone, 60), cleanHeaderText(input.company, 200), String(input.notes || "").slice(0, 4000), bool(input.favorite)];
    try {
        if (contactId) {
            const result = await env.MAIL_DB.prepare("UPDATE contacts SET name = ?, email = ?, phone = ?, company = ?, notes = ?, favorite = ?, auto = 0 WHERE id = ? AND mailbox_id = ?").bind(...values, contactId, mailbox.id).run();
            if (!result.meta.changes) fail(404, "notFound");
            return { id: contactId };
        }
        const contactIdNew = id("c_");
        await env.MAIL_DB.prepare("INSERT INTO contacts (id, mailbox_id, name, email, phone, company, notes, favorite, auto, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?) " +
            "ON CONFLICT (mailbox_id, email) DO UPDATE SET name = excluded.name, phone = excluded.phone, company = excluded.company, notes = excluded.notes, favorite = excluded.favorite, auto = 0")
            .bind(contactIdNew, mailbox.id, ...values, now()).run();
        return { id: (await env.MAIL_DB.prepare("SELECT id FROM contacts WHERE mailbox_id = ? AND email = ?").bind(mailbox.id, email).first()).id };
    } catch (error) {
        if (/UNIQUE/i.test(String(error?.message))) fail(409, "contactExists");
        throw error;
    }
}

export async function deleteContacts(env, mailbox, ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(value => /^c_[a-z0-9]{15}$/.test(value)).slice(0, 90);
    if (!list.length) fail(400, "invalidRequest");
    await env.MAIL_DB.prepare(`DELETE FROM contacts WHERE mailbox_id = ? AND id IN (${list.map(() => "?").join(",")})`).bind(mailbox.id, ...list).run();
}

export async function saveGroup(env, mailbox, input, groupId = null) {
    const db = env.MAIL_DB;
    const groupName = name(input.name, 120);
    const members = (Array.isArray(input.members) ? input.members : []).filter(value => /^c_[a-z0-9]{15}$/.test(value));
    const target = groupId || id("g_");
    if (groupId && !await db.prepare("SELECT 1 FROM contact_groups WHERE id = ? AND mailbox_id = ?").bind(groupId, mailbox.id).first()) fail(404, "notFound");
    const statements = [groupId
        ? db.prepare("UPDATE contact_groups SET name = ? WHERE id = ?").bind(groupName, groupId)
        : db.prepare("INSERT INTO contact_groups (id, mailbox_id, name, created_at) VALUES (?, ?, ?, ?)").bind(target, mailbox.id, groupName, now()),
        db.prepare("DELETE FROM contact_group_members WHERE group_id = ?").bind(target)];
    for (const member of members) statements.push(db.prepare("INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) SELECT ?, id FROM contacts WHERE id = ? AND mailbox_id = ?").bind(target, member, mailbox.id));
    await db.batch(statements);
    return { id: target };
}

export async function groupMembers(env, mailbox, groupId) {
    const { results } = await env.MAIL_DB.prepare("SELECT c.id FROM contact_group_members m JOIN contacts c ON c.id = m.contact_id JOIN contact_groups g ON g.id = m.group_id WHERE g.id = ? AND g.mailbox_id = ?").bind(groupId, mailbox.id).all();
    return results.map(row => row.id);
}

export async function deleteGroup(env, mailbox, groupId) {
    const result = await env.MAIL_DB.prepare("DELETE FROM contact_groups WHERE id = ? AND mailbox_id = ?").bind(groupId, mailbox.id).run();
    if (!result.meta.changes) fail(404, "notFound");
}

/* ------------------------------------------------------------------ signatures */
export async function listSignatures(env, mailbox) {
    const { results } = await env.MAIL_DB.prepare("SELECT id, name, html, default_new AS defaultNew, default_reply AS defaultReply FROM signatures WHERE mailbox_id = ? ORDER BY position, name").bind(mailbox.id).all();
    return results.map(row => ({ ...row, defaultNew: Boolean(row.defaultNew), defaultReply: Boolean(row.defaultReply) }));
}

export async function saveSignature(env, mailbox, input, signatureId = null) {
    const db = env.MAIL_DB;
    const html = sanitizeEmailHtml(String(input.html || "").slice(0, 200_000));
    const target = signatureId || id("s_");
    const statements = [];
    if (input.defaultNew) statements.push(db.prepare("UPDATE signatures SET default_new = 0 WHERE mailbox_id = ?").bind(mailbox.id));
    if (input.defaultReply) statements.push(db.prepare("UPDATE signatures SET default_reply = 0 WHERE mailbox_id = ?").bind(mailbox.id));
    if (signatureId) {
        if (!await db.prepare("SELECT 1 FROM signatures WHERE id = ? AND mailbox_id = ?").bind(signatureId, mailbox.id).first()) fail(404, "notFound");
        statements.push(db.prepare("UPDATE signatures SET name = ?, html = ?, default_new = ?, default_reply = ?, updated_at = ? WHERE id = ?").bind(name(input.name), html, bool(input.defaultNew), bool(input.defaultReply), now(), signatureId));
    } else {
        statements.push(db.prepare("INSERT INTO signatures (id, mailbox_id, name, html, default_new, default_reply, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, (SELECT COUNT(*) FROM signatures WHERE mailbox_id = ?), ?)")
            .bind(target, mailbox.id, name(input.name), html, bool(input.defaultNew), bool(input.defaultReply), mailbox.id, now()));
    }
    statements.push(changeStatement(db, mailbox.id, "signature", target, "upsert"));
    await db.batch(statements);
    return { id: target, html };
}

export async function deleteSignature(env, mailbox, signatureId) {
    const result = await env.MAIL_DB.prepare("DELETE FROM signatures WHERE id = ? AND mailbox_id = ?").bind(signatureId, mailbox.id).run();
    if (!result.meta.changes) fail(404, "notFound");
}

/* ------------------------------------------------------------------ templates (stored in R2) */
export async function listTemplates(env, mailbox) {
    const { results } = await env.MAIL_DB.prepare("SELECT id, name, kind, size, updated_at AS updatedAt FROM templates WHERE mailbox_id = ? ORDER BY name COLLATE NOCASE").bind(mailbox.id).all();
    return results;
}

export async function getTemplate(env, mailbox, templateId) {
    const row = await env.MAIL_DB.prepare("SELECT * FROM templates WHERE id = ? AND mailbox_id = ?").bind(templateId, mailbox.id).first();
    if (!row) fail(404, "notFound");
    return { id: row.id, name: row.name, kind: row.kind, data: await readBlobJson(env, mailbox.id, row.blob_hash) };
}

export async function saveTemplate(env, mailbox, input, templateId = null) {
    const kind = ["message", "design", "component"].includes(input.kind) ? input.kind : "message";
    const data = {
        subject: cleanHeaderText(input.data?.subject, 998), html: String(input.data?.html || "").slice(0, 5_000_000), text: String(input.data?.text || "").slice(0, 1_000_000),
        mode: String(input.data?.mode || "rich").slice(0, 20), design: input.data?.design && typeof input.data.design === "object" ? input.data.design : null,
    };
    const bytes = utf8(JSON.stringify(data));
    if (bytes.byteLength > 6 * 1024 * 1024) fail(413, "tooLarge");
    const db = env.MAIL_DB;
    const old = templateId ? await db.prepare("SELECT blob_hash FROM templates WHERE id = ? AND mailbox_id = ?").bind(templateId, mailbox.id).first() : null;
    if (templateId && !old) fail(404, "notFound");
    const target = templateId || id("tp_");
    const stored = await storeBlob(env, mailbox.id, bytes, { category: "template", contentType: "application/json" });
    await db.batch([
        templateId
            ? db.prepare("UPDATE templates SET name = ?, kind = ?, blob_hash = ?, size = ?, updated_at = ? WHERE id = ?").bind(name(input.name), kind, stored.hash, stored.size, now(), templateId)
            : db.prepare("INSERT INTO templates (id, mailbox_id, name, kind, blob_hash, size, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(target, mailbox.id, name(input.name), kind, stored.hash, stored.size, now()),
        ...dropRefStatements(db, mailbox.id, old ? [old.blob_hash] : []),
        changeStatement(db, mailbox.id, "template", target, "upsert"),
    ]);
    return { id: target };
}

export async function deleteTemplate(env, mailbox, templateId) {
    const row = await env.MAIL_DB.prepare("SELECT blob_hash FROM templates WHERE id = ? AND mailbox_id = ?").bind(templateId, mailbox.id).first();
    if (!row) fail(404, "notFound");
    await env.MAIL_DB.batch([env.MAIL_DB.prepare("DELETE FROM templates WHERE id = ?").bind(templateId), ...dropRefStatements(env.MAIL_DB, mailbox.id, [row.blob_hash])]);
}

/* ------------------------------------------------------------------ filters */
export async function listFilters(env, mailbox) {
    const { results } = await env.MAIL_DB.prepare("SELECT * FROM filters WHERE mailbox_id = ? ORDER BY position").bind(mailbox.id).all();
    return results.map(row => ({ id: row.id, name: row.name, enabled: Boolean(row.enabled), matchAll: Boolean(row.match_all), stop: Boolean(row.stop), position: row.position,
        conditions: parseJson(row.conditions_json, []), actions: parseJson(row.actions_json, []) }));
}

export async function saveFilter(env, mailbox, input, filterId = null) {
    const { conditions, actions } = validateFilter(input);
    if (!conditions.length || !actions.length) fail(400, "invalidFilter");
    for (const action of actions) {
        if (action.type === "move" && !/^(inbox|archive|spam|trash)$/.test(action.value) && !await env.MAIL_DB.prepare("SELECT 1 FROM folders WHERE id = ? AND mailbox_id = ?").bind(action.value, mailbox.id).first()) fail(400, "invalidFolder");
        if (action.type === "label" && !await env.MAIL_DB.prepare("SELECT 1 FROM labels WHERE id = ? AND mailbox_id = ?").bind(action.value, mailbox.id).first()) fail(400, "invalidLabel");
        if (action.type === "forward" && !validEmail(action.value)) fail(400, "invalidAddress");
    }
    const values = [name(input.name), bool(input.enabled !== false), bool(input.matchAll !== false), JSON.stringify(conditions), JSON.stringify(actions), bool(input.stop), now()];
    if (filterId) {
        const result = await env.MAIL_DB.prepare("UPDATE filters SET name = ?, enabled = ?, match_all = ?, conditions_json = ?, actions_json = ?, stop = ?, updated_at = ? WHERE id = ? AND mailbox_id = ?").bind(...values, filterId, mailbox.id).run();
        if (!result.meta.changes) fail(404, "notFound");
        return { id: filterId };
    }
    const target = id("fl_");
    await env.MAIL_DB.prepare("INSERT INTO filters (id, mailbox_id, name, enabled, match_all, conditions_json, actions_json, stop, updated_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COUNT(*) FROM filters WHERE mailbox_id = ?))")
        .bind(target, mailbox.id, ...values, mailbox.id).run();
    return { id: target };
}

export async function reorderFilters(env, mailbox, order) {
    const list = (Array.isArray(order) ? order : []).filter(value => typeof value === "string");
    await env.MAIL_DB.batch(list.map((filterId, position) => env.MAIL_DB.prepare("UPDATE filters SET position = ? WHERE id = ? AND mailbox_id = ?").bind(position, filterId, mailbox.id)));
}

export async function deleteFilter(env, mailbox, filterId) {
    const result = await env.MAIL_DB.prepare("DELETE FROM filters WHERE id = ? AND mailbox_id = ?").bind(filterId, mailbox.id).run();
    if (!result.meta.changes) fail(404, "notFound");
}

// Applies one filter to messages already in the Inbox and Archive.
export async function runFilter(env, session, execCtx, mailbox, filterId) {
    const filter = await env.MAIL_DB.prepare("SELECT * FROM filters WHERE id = ? AND mailbox_id = ?").bind(filterId, mailbox.id).first();
    if (!filter) fail(404, "notFound");
    const { updateMessages } = await import("./messages.js");
    let matched = 0;
    let offset = 0;
    for (;;) {
        const { results } = await env.MAIL_DB.prepare("SELECT id, from_addr, from_name, to_json, cc_json, subject, snippet, size_bytes, attachment_count FROM messages WHERE mailbox_id = ? AND folder IN ('inbox', 'archive') ORDER BY num LIMIT 200 OFFSET ?")
            .bind(mailbox.id, offset).all();
        if (!results.length) break;
        offset += results.length;
        for (const row of results) {
            const actions = applyFilters([{ ...filter, enabled: 1 }], {
                from: row.from_addr, fromName: row.from_name, to: parseJson(row.to_json, []).map(item => item.email), cc: parseJson(row.cc_json, []).map(item => item.email),
                subject: row.subject, text: row.snippet, size: row.size_bytes, attachmentCount: row.attachment_count, listId: "", filenames: [],
            });
            if (!actions.length) continue;
            matched++;
            const patch = {};
            for (const action of actions) {
                if (action.type === "move") patch.folder = action.value;
                if (action.type === "archive") patch.folder = "archive";
                if (action.type === "trash") patch.folder = "trash";
                if (action.type === "spam") patch.spam = true;
                if (action.type === "label") patch.addLabels = [...(patch.addLabels || []), action.value];
                if (action.type === "star") patch.starred = true;
                if (action.type === "read") patch.read = true;
                if (action.type === "important") patch.important = true;
                if (action.type === "pin") patch.pinned = true;
                if (action.type === "category") patch.category = action.value;
            }
            if (Object.keys(patch).length) await updateMessages(env, session, execCtx, [row.id], patch);
        }
    }
    return { matched };
}

/* ------------------------------------------------------------------ sender lists */
export async function listSenders(env, mailbox) {
    const { results } = await env.MAIL_DB.prepare("SELECT list, pattern, created_at AS createdAt FROM sender_lists WHERE mailbox_id = ? ORDER BY list, pattern").bind(mailbox.id).all();
    return results;
}

export async function addSender(env, mailbox, list, pattern) {
    if (!["block", "allow", "trusted"].includes(list)) fail(400, "invalidRequest");
    const value = String(pattern || "").trim().toLowerCase();
    if (!(validEmail(value) || /^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value))) fail(400, "invalidAddress");
    const db = env.MAIL_DB;
    const statements = [db.prepare("INSERT OR IGNORE INTO sender_lists (mailbox_id, list, pattern, created_at) VALUES (?, ?, ?, ?)").bind(mailbox.id, list, value, now())];
    if (list === "block") statements.push(db.prepare("DELETE FROM sender_lists WHERE mailbox_id = ? AND list = 'allow' AND pattern = ?").bind(mailbox.id, value));
    if (list === "allow") statements.push(db.prepare("DELETE FROM sender_lists WHERE mailbox_id = ? AND list = 'block' AND pattern = ?").bind(mailbox.id, value));
    statements.push(changeStatement(db, mailbox.id, "senders", list, "upsert"));
    await db.batch(statements);
    return { list, pattern: value };
}

export async function removeSender(env, mailbox, list, pattern) {
    await env.MAIL_DB.prepare("DELETE FROM sender_lists WHERE mailbox_id = ? AND list = ? AND pattern = ?").bind(mailbox.id, list, String(pattern || "").toLowerCase()).run();
}

export async function isTrusted(env, mailboxId, address) {
    const { results } = await env.MAIL_DB.prepare("SELECT pattern FROM sender_lists WHERE mailbox_id = ? AND list = 'trusted'").bind(mailboxId).all();
    return results.some(row => senderMatches(row.pattern, address));
}

/* ------------------------------------------------------------------ saved searches and history */
export async function listSavedSearches(env, mailboxIds) {
    if (!mailboxIds.length) return [];
    const { results } = await env.MAIL_DB.prepare(`SELECT id, mailbox_id AS mailboxId, name, query, smart, icon, position FROM saved_searches WHERE mailbox_id IN (${mailboxIds.map(() => "?").join(",")}) ORDER BY position, name`).bind(...mailboxIds).all();
    return results.map(row => ({ ...row, smart: Boolean(row.smart) }));
}

export async function saveSearch(env, mailbox, input, searchId = null) {
    const query = String(input.query || "").trim().slice(0, 1000);
    if (!query) fail(400, "invalidRequest");
    const values = [name(input.name, 80), query, bool(input.smart), icon(input.icon) || (input.smart ? "auto_awesome_motion" : "saved_search")];
    if (searchId) {
        const result = await env.MAIL_DB.prepare("UPDATE saved_searches SET name = ?, query = ?, smart = ?, icon = ? WHERE id = ? AND mailbox_id = ?").bind(...values, searchId, mailbox.id).run();
        if (!result.meta.changes) fail(404, "notFound");
        return { id: searchId };
    }
    const target = id("ss_");
    await env.MAIL_DB.prepare("INSERT INTO saved_searches (id, mailbox_id, name, query, smart, icon, position, created_at) VALUES (?, ?, ?, ?, ?, ?, (SELECT COUNT(*) FROM saved_searches WHERE mailbox_id = ?), ?)")
        .bind(target, mailbox.id, ...values, mailbox.id, now()).run();
    return { id: target };
}

export async function deleteSearch(env, mailbox, searchId) {
    const result = await env.MAIL_DB.prepare("DELETE FROM saved_searches WHERE id = ? AND mailbox_id = ?").bind(searchId, mailbox.id).run();
    if (!result.meta.changes) fail(404, "notFound");
}

export async function recordSearch(env, accountId, query) {
    const text = String(query || "").trim().slice(0, 300);
    if (!text) return;
    await env.MAIL_DB.batch([
        env.MAIL_DB.prepare("INSERT INTO search_history (account_id, query, used_at) VALUES (?, ?, ?) ON CONFLICT (account_id, query) DO UPDATE SET used_at = excluded.used_at").bind(accountId, text, now()),
        env.MAIL_DB.prepare("DELETE FROM search_history WHERE account_id = ? AND used_at < (SELECT used_at FROM search_history WHERE account_id = ? ORDER BY used_at DESC LIMIT 1 OFFSET 49)").bind(accountId, accountId),
    ]);
}

export async function searchHistory(env, accountId) {
    const { results } = await env.MAIL_DB.prepare("SELECT query, used_at AS usedAt FROM search_history WHERE account_id = ? ORDER BY used_at DESC LIMIT 20").bind(accountId).all();
    return results;
}

/* ------------------------------------------------------------------ preferences and themes */
export async function getPreferences(env, accountId) {
    const row = await env.MAIL_DB.prepare("SELECT data_json, version, updated_at FROM preferences WHERE account_id = ?").bind(accountId).first();
    return { data: sanitizePreferences(parseJson(row?.data_json, {})), version: row?.version || 0, updatedAt: row?.updated_at || 0 };
}

export async function savePreferences(env, accountId, input) {
    const data = sanitizePreferences(input.data);
    const json = JSON.stringify(data);
    if (json.length > 256 * 1024) fail(413, "tooLarge");
    const current = await env.MAIL_DB.prepare("SELECT version FROM preferences WHERE account_id = ?").bind(accountId).first();
    if (current && Number.isFinite(input.baseVersion) && input.baseVersion !== current.version && !input.force) {
        fail(409, "preferencesConflict", { server: await getPreferences(env, accountId) });
    }
    await env.MAIL_DB.prepare("INSERT INTO preferences (account_id, data_json, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT (account_id) DO UPDATE SET data_json = excluded.data_json, version = preferences.version + 1, updated_at = excluded.updated_at")
        .bind(accountId, json, now()).run();
    return getPreferences(env, accountId);
}

export async function listThemes(env, accountId) {
    const { results } = await env.MAIL_DB.prepare("SELECT id, name, data_json, updated_at AS updatedAt FROM themes WHERE account_id = ? ORDER BY name COLLATE NOCASE").bind(accountId).all();
    return results.map(row => ({ id: row.id, name: row.name, data: sanitizeTheme({ data: parseJson(row.data_json, {}) }).data, updatedAt: row.updatedAt }));
}

export async function saveTheme(env, accountId, input, themeId = null) {
    const theme = sanitizeTheme(input);
    const json = JSON.stringify(theme.data);
    if (json.length > 128 * 1024) fail(413, "tooLarge");
    if (themeId) {
        const result = await env.MAIL_DB.prepare("UPDATE themes SET name = ?, data_json = ?, updated_at = ? WHERE id = ? AND account_id = ?").bind(theme.name, json, now(), themeId, accountId).run();
        if (!result.meta.changes) fail(404, "notFound");
        return { id: themeId, ...theme };
    }
    const target = id("th_");
    await env.MAIL_DB.prepare("INSERT INTO themes (id, account_id, name, data_json, updated_at) VALUES (?, ?, ?, ?, ?)").bind(target, accountId, theme.name, json, now()).run();
    return { id: target, ...theme };
}

export async function deleteTheme(env, accountId, themeId) {
    const result = await env.MAIL_DB.prepare("DELETE FROM themes WHERE id = ? AND account_id = ?").bind(themeId, accountId).run();
    if (!result.meta.changes) fail(404, "notFound");
}

/* ------------------------------------------------------------------ assets: backgrounds, fonts, sounds, profile pictures */
const ASSET_TYPES = {
    background: /^image\/(png|jpeg|webp|gif|avif)$/,
    font: /^(font\/(woff2|woff|ttf|otf)|application\/(font-woff2?|x-font-ttf|x-font-otf|octet-stream))$/,
    picture: /^image\/(png|jpeg|webp)$/,
    sound: /^audio\/(mpeg|ogg|wav|x-wav|webm|mp4|aac)$/,
};
const ASSET_LIMIT = { background: 15 * 1024 * 1024, font: 10 * 1024 * 1024, picture: 2 * 1024 * 1024, sound: 2 * 1024 * 1024 };

function sniff(kind, bytes) {
    const head = [...bytes.subarray(0, 12)];
    const is = (...signature) => signature.every((byte, index) => byte === null || head[index] === byte);
    if (kind === "sound") return is(0x49, 0x44, 0x33) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) || is(0x4f, 0x67, 0x67, 0x53) || is(0x52, 0x49, 0x46, 0x46) || is(0x1a, 0x45, 0xdf, 0xa3) || is(null, null, null, null, 0x66, 0x74, 0x79, 0x70);
    if (kind === "font") return is(0x77, 0x4f, 0x46, 0x32) || is(0x77, 0x4f, 0x46, 0x46) || is(0x00, 0x01, 0x00, 0x00) || is(0x4f, 0x54, 0x54, 0x4f) || is(0x74, 0x72, 0x75, 0x65);
    return is(0x89, 0x50, 0x4e, 0x47) || is(0xff, 0xd8, 0xff) || is(0x47, 0x49, 0x46, 0x38) || (is(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57) || (is(null, null, null, null, 0x66, 0x74, 0x79, 0x70));
}

export async function uploadAsset(env, mailbox, kind, request) {
    if (!ASSET_TYPES[kind]) fail(400, "invalidRequest");
    const declared = Number(request.headers.get("Content-Length"));
    if (!Number.isFinite(declared) || declared <= 0) fail(411, "lengthRequired");
    if (declared > ASSET_LIMIT[kind]) fail(413, "tooLarge");
    const mimeType = String(request.headers.get("X-File-Type") || "").toLowerCase();
    if (!ASSET_TYPES[kind].test(mimeType)) fail(415, "unsupportedFile");
    let filename = kind;
    try { filename = cleanHeaderText(decodeURIComponent(request.headers.get("X-File-Name") || kind), 120) || kind; } catch { /* default */ }
    const reservation = await reserve(env, mailbox.id, declared, "asset");
    try {
        const bytes = await readBytes(request, declared);
        if (!sniff(kind, bytes)) fail(415, "unsupportedFile");
        const assetId = id("as_");
        const stored = await storeBlob(env, mailbox.id, bytes, { category: "asset", reservation, contentType: mimeType });
        const db = env.MAIL_DB;
        const statements = [db.prepare("INSERT INTO assets (id, account_id, mailbox_id, kind, name, mime_type, blob_hash, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(assetId, mailbox.account_id, mailbox.id, kind, filename, mimeType, stored.hash, stored.size, now())];
        if (kind === "picture") {
            const old = await db.prepare("SELECT picture_hash FROM mailboxes WHERE id = ?").bind(mailbox.id).first();
            statements.push(db.prepare("UPDATE mailboxes SET picture_hash = ?, updated_at = ? WHERE id = ?").bind(stored.hash, now(), mailbox.id));
            statements.push(db.prepare("UPDATE blobs SET ref_count = ref_count + 1 WHERE mailbox_id = ? AND hash = ?").bind(mailbox.id, stored.hash));
            if (old?.picture_hash) statements.push(...dropRefStatements(db, mailbox.id, [old.picture_hash]));
        }
        await db.batch(statements);
        return { id: assetId, kind, name: filename, mimeType, size: stored.size };
    } finally {
        await release(env, reservation).catch(() => {});
    }
}

export async function listAssets(env, accountIds) {
    const ids = [...accountIds];
    const { results } = await env.MAIL_DB.prepare(`SELECT id, kind, name, mime_type AS mimeType, size, created_at AS createdAt FROM assets WHERE account_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`).bind(...ids).all();
    return results;
}

export async function assetObject(env, session, assetId) {
    if (!/^as_[a-z0-9]{15}$/.test(String(assetId))) fail(400, "invalidRequest");
    const row = await env.MAIL_DB.prepare("SELECT * FROM assets WHERE id = ?").bind(assetId).first();
    if (!row || !session.accountIds.has(row.account_id)) fail(404, "notFound");
    const object = await readBlob(env, row.mailbox_id, row.blob_hash);
    if (!object) fail(404, "notFound");
    return { object, row };
}

export async function deleteAsset(env, session, assetId) {
    const row = await env.MAIL_DB.prepare("SELECT * FROM assets WHERE id = ?").bind(assetId).first();
    if (!row || !session.accountIds.has(row.account_id)) fail(404, "notFound");
    await env.MAIL_DB.batch([env.MAIL_DB.prepare("DELETE FROM assets WHERE id = ?").bind(assetId), ...dropRefStatements(env.MAIL_DB, row.mailbox_id, [row.blob_hash])]);
}

export async function removePicture(env, mailbox) {
    const row = await env.MAIL_DB.prepare("SELECT picture_hash FROM mailboxes WHERE id = ?").bind(mailbox.id).first();
    if (!row?.picture_hash) return;
    await env.MAIL_DB.batch([env.MAIL_DB.prepare("UPDATE mailboxes SET picture_hash = NULL WHERE id = ?").bind(mailbox.id), ...dropRefStatements(env.MAIL_DB, mailbox.id, [row.picture_hash])]);
}

/* ------------------------------------------------------------------ subscriptions */
export async function listSubscriptions(env, mailbox) {
    const { results } = await env.MAIL_DB.prepare(
        "SELECT from_addr AS sender, MAX(from_name) AS name, COUNT(*) AS count, MAX(date) AS lastDate, SUM(size_bytes) AS bytes, MAX(list_unsubscribe) AS unsubscribe, MAX(list_unsubscribe_post) AS oneClick, " +
        "SUM(is_read = 0) AS unread FROM messages WHERE mailbox_id = ? AND list_unsubscribe <> '' AND folder NOT IN ('trash', 'spam') GROUP BY from_addr ORDER BY count DESC LIMIT 300").bind(mailbox.id).all();
    const blocked = new Set((await listSenders(env, mailbox)).filter(row => row.list === "block").map(row => row.pattern));
    return results.map(row => {
        const options = parseUnsubscribe(row.unsubscribe);
        return { sender: row.sender, name: row.name, count: row.count, unread: row.unread, lastDate: row.lastDate, bytes: row.bytes, blocked: blocked.has(row.sender),
            methods: { oneClick: Boolean(row.oneClick && options.https), mailto: Boolean(options.mailto), web: options.https || "" } };
    });
}

export function parseUnsubscribe(header) {
    const urls = (String(header || "").match(/<([^>]+)>/g) || []).map(item => item.slice(1, -1).trim());
    return { https: urls.find(url => /^https:\/\//i.test(url)) || "", mailto: urls.find(url => /^mailto:/i.test(url)) || "" };
}

// One-click (RFC 8058) or mailto unsubscribe, performed by the server so no tracking page opens in the browser.
export async function unsubscribe(env, mailbox, sender) {
    const row = await env.MAIL_DB.prepare("SELECT list_unsubscribe, list_unsubscribe_post FROM messages WHERE mailbox_id = ? AND from_addr = ? AND list_unsubscribe <> '' ORDER BY date DESC LIMIT 1").bind(mailbox.id, normalizeEmail(sender)).first();
    if (!row) fail(404, "notFound");
    const options = parseUnsubscribe(row.list_unsubscribe);
    if (row.list_unsubscribe_post && options.https) {
        const response = await safeFetch(env, options.https, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxBytes: 64 * 1024 });
        await opsLog(env.MAIL_DB, "unsubscribe", response.ok ? "oneClick" : "oneClickFailed");
        if (!response.ok) fail(502, "unsubscribeFailed");
        return { method: "oneClick" };
    }
    if (options.mailto) {
        const url = new URL(options.mailto);
        const to = normalizeEmail(decodeURIComponent(url.pathname));
        if (!validEmail(to) || !env.EMAIL) fail(502, "unsubscribeFailed");
        try {
            await env.EMAIL.send({ to, from: mailbox.address, subject: cleanHeaderText(url.searchParams.get("subject") || "unsubscribe", 200), text: cleanHeaderText(url.searchParams.get("body") || "unsubscribe", 1000) });
        } catch { fail(502, "unsubscribeFailed"); }
        await opsLog(env.MAIL_DB, "unsubscribe", "mailto");
        return { method: "mailto" };
    }
    if (options.https) return { method: "web", url: options.https };
    fail(400, "unsubscribeUnavailable");
}

