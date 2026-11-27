// Scheduled work (Cron Triggers): scheduled sends, snooze and follow-up reminders, retention cleanup,
// automatic archiving, storage reconciliation, orphaned-object cleanup, and housekeeping.
import { dispatchScheduled } from "./outbound.js";
import { deleteMessages } from "./messages.js";
import { changeStatement, notify, mailboxSettings } from "./mailbox.js";
import { processBlobDeletions, expireReservations, reconcileUsage, sweepOrphans, dropRefStatements } from "./storage.js";
import { checkWarnings } from "./inbound.js";
import { expireDeviceDeliveries } from "./device-delivery.js";
import { now } from "./util.js";

const DAY = 86_400_000;

export async function everyMinute(env) {
    await dispatchScheduled(env);
    await wakeSnoozed(env);
    await dueFollowUps(env);
    await processBlobDeletions(env, 200);
}

async function wakeSnoozed(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT m.id, m.mailbox_id, b.account_id FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id WHERE m.snooze_until IS NOT NULL AND m.snooze_until <= ? LIMIT 500").bind(now()).all();
    const accounts = new Map();
    for (const row of results) {
        await env.MAIL_DB.batch([
            env.MAIL_DB.prepare("UPDATE messages SET snooze_until = NULL, is_read = 0, folder = CASE WHEN folder IN ('archive') THEN 'inbox' ELSE folder END, date = ?, version = version + 1, updated_at = ? WHERE id = ?").bind(now(), now(), row.id),
            changeStatement(env.MAIL_DB, row.mailbox_id, "message", row.id, "upsert"),
        ]);
        accounts.set(row.account_id, [...(accounts.get(row.account_id) || []), row.mailbox_id]);
    }
    for (const [account, boxes] of accounts) await notify(env, account, { type: "snoozed", mailboxes: [...new Set(boxes)] });
}

async function dueFollowUps(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT m.id, m.mailbox_id, b.account_id FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id WHERE m.follow_up_at IS NOT NULL AND m.follow_up_at <= ? LIMIT 500").bind(now()).all();
    for (const row of results) {
        await env.MAIL_DB.batch([
            env.MAIL_DB.prepare("UPDATE messages SET follow_up_at = NULL, follow_up_due = 1, version = version + 1, updated_at = ? WHERE id = ?").bind(now(), row.id),
            changeStatement(env.MAIL_DB, row.mailbox_id, "message", row.id, "upsert"),
        ]);
        await notify(env, row.account_id, { type: "followup", mailboxId: row.mailbox_id, messageId: row.id });
    }
}

export async function hourly(env) {
    await expireReservations(env);
    await expireDeviceDeliveries(env);
    await staleUploads(env);
    await retention(env);
    await autoArchive(env);
    await housekeeping(env);
    await reconcileSome(env);
    await processBlobDeletions(env, 1000);
}

async function staleUploads(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT id, mailbox_id, blob_hash FROM uploads WHERE created_at < ? LIMIT 500").bind(now() - 3 * DAY).all();
    for (const row of results) {
        await env.MAIL_DB.batch([env.MAIL_DB.prepare("DELETE FROM uploads WHERE id = ?").bind(row.id), ...dropRefStatements(env.MAIL_DB, row.mailbox_id, [row.blob_hash])]);
    }
}

// Trash and Spam keep their messages for the number of days each mailbox chose (0 = keep until emptied).
async function retention(env) {
    const { results: boxes } = await env.MAIL_DB.prepare("SELECT DISTINCT m.mailbox_id, b.account_id FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id WHERE m.folder IN ('trash', 'spam')").all();
    for (const box of boxes) {
        const settings = await mailboxSettings(env, box.mailbox_id);
        for (const [folder, days] of [["trash", settings.retention.trashDays], ["spam", settings.retention.spamDays]]) {
            if (!days) continue;
            const cutoff = now() - days * DAY;
            const column = folder === "trash" ? "COALESCE(trashed_at, updated_at)" : "date";
            const { results } = await env.MAIL_DB.prepare(`SELECT m.*, ? AS owner_account FROM messages m WHERE mailbox_id = ? AND folder = ? AND ${column} < ? LIMIT 200`).bind(box.account_id, box.mailbox_id, folder, cutoff).all();
            if (results.length) await deleteMessages(env, null, null, results, { internal: true });
        }
        await checkWarnings(env, box.mailbox_id);
    }
}

async function autoArchive(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT mailbox_id, data_json FROM mailbox_settings WHERE data_json LIKE '%\"autoArchive\":{\"enabled\":true%'").all();
    for (const row of results) {
        const settings = await mailboxSettings(env, row.mailbox_id);
        if (!settings.autoArchive.enabled) continue;
        const cutoff = now() - settings.autoArchive.days * DAY;
        const { results: messages } = await env.MAIL_DB.prepare(
            `SELECT id FROM messages WHERE mailbox_id = ? AND folder = 'inbox' AND date < ? AND is_starred = 0 AND is_pinned = 0 AND snooze_until IS NULL ${settings.autoArchive.readOnly ? "AND is_read = 1" : ""} LIMIT 500`)
            .bind(row.mailbox_id, cutoff).all();
        for (const message of messages) {
            await env.MAIL_DB.batch([
                env.MAIL_DB.prepare("UPDATE messages SET folder = 'archive', previous_folder = 'inbox', version = version + 1, updated_at = ? WHERE id = ?").bind(now(), message.id),
                changeStatement(env.MAIL_DB, row.mailbox_id, "message", message.id, "upsert"),
            ]);
        }
    }
}

async function housekeeping(env) {
    const db = env.MAIL_DB;
    await db.batch([
        db.prepare("DELETE FROM changes WHERE at < ?").bind(now() - 45 * DAY),
        db.prepare("DELETE FROM rate_counters WHERE window < ?").bind(Math.floor(now() / 1000 / 86400) - 2),
        db.prepare("DELETE FROM ops_log WHERE at < ?").bind(now() - 30 * DAY),
        db.prepare("DELETE FROM vacation_replies WHERE sent_at < ?").bind(now() - 30 * DAY),
    ]);
    const { results: exports } = await db.prepare("SELECT id, mailbox_id, upload_id FROM exports WHERE expires_at < ? OR (state IN ('queued', 'running') AND created_at < ?) LIMIT 100").bind(now(), now() - 2 * DAY).all();
    for (const row of exports) {
        await env.MAIL_STORE.delete(`m/${row.mailbox_id}/exports/${row.id}.mbox`);
        if (row.upload_id) await env.MAIL_STORE.resumeMultipartUpload(`m/${row.mailbox_id}/exports/${row.id}.mbox`, row.upload_id).abort().catch(() => {});
        await db.prepare("DELETE FROM exports WHERE id = ?").bind(row.id).run();
    }
    // Mailboxes whose deletion was interrupted continue deleting.
    const { results: deleting } = await db.prepare("SELECT id FROM mailboxes WHERE status = 'deleting' LIMIT 5").all();
    for (const row of deleting) if (env.MAIL_JOBS) await env.MAIL_JOBS.send({ type: "delete-mailbox", mailboxId: row.id });
}

async function reconcileSome(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT id FROM mailboxes WHERE status <> 'deleting' ORDER BY reconciled_at LIMIT 10").all();
    for (const row of results) {
        await reconcileUsage(env, row.id);
        await sweepOrphans(env, row.id);
        await env.MAIL_DB.prepare("UPDATE mailboxes SET reconciled_at = ? WHERE id = ?").bind(now(), row.id).run();
        await checkWarnings(env, row.id);
    }
}

// Secure mailbox deletion: every message and object is removed, then the mailbox row.
export async function deleteMailboxJob(env, mailboxId) {
    const db = env.MAIL_DB;
    const box = await db.prepare("SELECT * FROM mailboxes WHERE id = ? AND status = 'deleting'").bind(mailboxId).first();
    if (!box) return {};
    const started = now();
    for (;;) {
        const { results } = await db.prepare("SELECT m.*, ? AS owner_account FROM messages m WHERE mailbox_id = ? LIMIT 100").bind(box.account_id, mailboxId).all();
        if (!results.length) break;
        await deleteMessages(env, null, null, results, { internal: true });
        if (now() - started > 20_000) return { retryDelaySeconds: 5 };
    }
    let cursor;
    do {
        const page = await env.MAIL_STORE.list({ prefix: `m/${mailboxId}/`, cursor, limit: 500 });
        if (page.objects.length) await env.MAIL_STORE.delete(page.objects.map(object => object.key));
        cursor = page.truncated ? page.cursor : undefined;
        if (now() - started > 25_000) return { retryDelaySeconds: 5 };
    } while (cursor);
    const { results: aliases } = await db.prepare("SELECT address FROM aliases WHERE mailbox_id = ?").bind(mailboxId).all();
    await db.batch([
        ...aliases.map(alias => db.prepare("INSERT OR IGNORE INTO retired_addresses (address, retired_at) VALUES (?, ?)").bind(alias.address, now())),
        db.prepare("DELETE FROM blob_deletions WHERE r2_key LIKE ?").bind(`m/${mailboxId}/%`),
        db.prepare("DELETE FROM changes WHERE mailbox_id = ?").bind(mailboxId),
        db.prepare("DELETE FROM outbound WHERE mailbox_id = ?").bind(mailboxId),
        db.prepare("DELETE FROM mailboxes WHERE id = ?").bind(mailboxId),
    ]);
    await notify(env, box.account_id, { type: "mailboxDeleted", mailboxId });
    return {};
}
