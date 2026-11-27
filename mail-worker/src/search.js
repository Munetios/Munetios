// Mailbox search: operators become parameterized SQL, free text uses the FTS5 index.
// Supported: from: to: cc: subject: has:attachment filename: filetype: is:unread|read|starred|important|pinned|snoozed
// before: after: larger: smaller: label: folder: in: category: and -negation, "quoted phrases".
import { SYSTEM_FOLDERS } from "./util.js";

const SIZE_UNITS = { "": 1, b: 1, k: 1e3, kb: 1e3, m: 1e6, mb: 1e6, g: 1e9, gb: 1e9 };

export function tokenize(query) {
    const tokens = [];
    const pattern = /(-?)(?:([a-z_]+):)?(?:"([^"]*)"|(\S+))/gi;
    let match;
    while ((match = pattern.exec(String(query || "").slice(0, 1000)))) {
        const [, negate, operator, quoted, bare] = match;
        tokens.push({ negate: Boolean(negate), operator: operator ? operator.toLowerCase() : null, value: quoted ?? bare ?? "", quoted: quoted !== undefined });
    }
    return tokens;
}

export function parseSize(value) {
    const match = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(String(value).trim());
    if (!match || !(match[2].toLowerCase() in SIZE_UNITS)) return null;
    return Math.round(Number(match[1]) * SIZE_UNITS[match[2].toLowerCase()]);
}

export function parseDate(value, tzOffsetMinutes = 0) {
    const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value).trim());
    if (!match) return null;
    const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(utc) ? null : utc + tzOffsetMinutes * 60_000;
}

const like = value => "%" + String(value).replace(/[\\%_]/g, character => "\\" + character) + "%";
const ftsTerm = value => '"' + String(value).replace(/"/g, '""') + '"';

// Returns { where: [sql...], params: [...], fts: string|null, folderScoped: boolean, invalid: [] }.
export function buildSearch(query, { tzOffsetMinutes = 0 } = {}) {
    const where = [];
    const params = [];
    const text = [];
    const negText = [];
    const invalid = [];
    let folderScoped = false;
    const add = (negate, sql, ...values) => { where.push(negate ? `NOT (${sql})` : `(${sql})`); params.push(...values); };
    for (const token of tokenize(query)) {
        const { operator, value, negate } = token;
        if (!value && operator !== "has") continue;
        switch (operator) {
            case "from": add(negate, "m.from_addr LIKE ? ESCAPE '\\' OR m.from_name LIKE ? ESCAPE '\\'", like(value), like(value)); break;
            case "to": add(negate, "m.to_json LIKE ? ESCAPE '\\'", like(value)); break;
            case "cc": add(negate, "m.cc_json LIKE ? ESCAPE '\\'", like(value)); break;
            case "bcc": add(negate, "m.bcc_json LIKE ? ESCAPE '\\'", like(value)); break;
            case "subject": add(negate, "m.subject LIKE ? ESCAPE '\\'", like(value)); break;
            case "category":
                if (["primary", "social", "promotions", "updates", "forums"].includes(value.toLowerCase())) add(negate, "m.category = ?", value.toLowerCase());
                else invalid.push(token);
                break;
            case "has":
                if (/^attachments?$/i.test(value)) add(negate, "m.attachment_count > 0");
                else if (/^(label|labels)$/i.test(value)) add(negate, "EXISTS (SELECT 1 FROM message_labels ml WHERE ml.message_id = m.id)");
                else invalid.push(token);
                break;
            case "filename": add(negate, "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.filename LIKE ? ESCAPE '\\')", like(value)); break;
            case "filetype": case "type":
                add(negate, "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND (a.mime_type LIKE ? ESCAPE '\\' OR a.filename LIKE ? ESCAPE '\\'))",
                    like(value.toLowerCase()), "%." + value.toLowerCase().replace(/[\\%_]/g, c => "\\" + c));
                break;
            case "is": {
                const map = { unread: "m.is_read = 0", read: "m.is_read = 1", starred: "m.is_starred = 1", important: "m.is_important = 1", pinned: "m.is_pinned = 1", snoozed: "m.snooze_until IS NOT NULL" };
                const sql = map[value.toLowerCase()];
                if (sql) add(negate, sql); else invalid.push(token);
                break;
            }
            case "before": case "after": case "older": case "newer": {
                const at = parseDate(value, tzOffsetMinutes);
                if (at === null) { invalid.push(token); break; }
                const before = operator === "before" || operator === "older";
                add(negate, before ? "m.date < ?" : "m.date >= ?", before ? at : at);
                break;
            }
            case "larger": case "smaller": {
                const bytes = parseSize(value);
                if (bytes === null) { invalid.push(token); break; }
                add(negate, operator === "larger" ? "m.size_bytes > ?" : "m.size_bytes < ?", bytes);
                break;
            }
            case "label": add(negate, "EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id WHERE ml.message_id = m.id AND l.name = ? COLLATE NOCASE)", value); break;
            case "folder": case "in": {
                const name = value.toLowerCase();
                if (name === "anywhere" || name === "all") { folderScoped = true; break; }
                folderScoped = true;
                if (name === "starred") add(negate, "m.is_starred = 1");
                else if (name === "important") add(negate, "m.is_important = 1");
                else if (name === "snoozed") add(negate, "m.snooze_until IS NOT NULL");
                else if (SYSTEM_FOLDERS.includes(name)) add(negate, "m.folder = ?", name);
                else add(negate, "m.folder IN (SELECT f.id FROM folders f WHERE f.mailbox_id = m.mailbox_id AND f.name = ? COLLATE NOCASE)", value);
                break;
            }
            case null: (negate ? negText : text).push(value); break;
            default:
                // Unknown operators are searched as text so "re:meeting" still works.
                (negate ? negText : text).push(`${operator}:${value}`);
        }
    }
    let fts = null;
    if (text.length) {
        fts = text.map(term => term.replace(/[^\p{L}\p{N}@._+-]+/gu, " ").trim()).filter(Boolean).map(ftsTerm).join(" ");
        if (negText.length && fts) fts += " NOT " + negText.map(ftsTerm).join(" NOT ");
        if (!fts) fts = null;
    } else if (negText.length) {
        for (const term of negText) add(true, "m.num IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)", ftsTerm(term));
    }
    if (fts) { where.push("m.num IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)"); params.push(fts); }
    if (!folderScoped) where.push("m.folder NOT IN ('spam', 'trash', 'drafts')");
    return { where, params, fts, folderScoped, invalid };
}
