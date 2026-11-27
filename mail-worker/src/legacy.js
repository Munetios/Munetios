// Read access to the existing accounts database: mailbox entitlement, forwarding addresses,
// address availability, and the plain-text messages stored by the earlier Mail version.
// Locally, Express passes an object with the same methods as env.LEGACY.
export function legacyStore(env) {
    if (env.LEGACY) return env.LEGACY;
    const db = env.ACCOUNTS_DB;
    if (!db) {
        return {
            async hasMailbox() { return false; }, async aliasFor() { return null; },
            async messages() { return []; }, async addressTaken() { return false; }, async accountForAddress() { return null; },
        };
    }
    return {
        // The account an address belongs to, when that account is entitled to a mailbox.
        async accountForAddress(address) {
            const forwarding = await db.prepare("SELECT a.id, a.email, p.display_name FROM munetios_mail_aliases m JOIN munetios_accounts a ON a.id = m.account_id LEFT JOIN munetios_profiles p ON p.account_id = a.id WHERE m.address = ?").bind(address).first();
            if (forwarding) return { id: String(forwarding.id), email: forwarding.email, displayName: forwarding.display_name || "" };
            const owner = await db.prepare("SELECT a.id, a.email, p.display_name FROM munetios_accounts a JOIN munetios_mailboxes m ON m.account_id = a.id LEFT JOIN munetios_profiles p ON p.account_id = a.id WHERE a.email = ?").bind(address).first();
            return owner ? { id: String(owner.id), email: owner.email, displayName: owner.display_name || "" } : null;
        },
        async hasMailbox(accountId) {
            return Boolean(await db.prepare("SELECT 1 FROM munetios_mailboxes WHERE account_id = ?").bind(Number(accountId)).first());
        },
        async aliasFor(accountId) {
            return (await db.prepare("SELECT address FROM munetios_mail_aliases WHERE account_id = ?").bind(Number(accountId)).first())?.address || null;
        },
        async messages(accountId, afterId, limit) {
            const { results } = await db.prepare(
                "SELECT m.id, m.direction, m.message_key, m.sender, m.recipient, m.subject, m.body, m.created_at, h.html FROM munetios_mail_messages m " +
                "LEFT JOIN munetios_mail_html h ON h.message_id = m.id WHERE m.account_id = ? AND m.id > ? ORDER BY m.id LIMIT ?")
                .bind(Number(accountId), Number(afterId) || 0, limit).all();
            return results;
        },
        async addressTaken(address) {
            const account = await db.prepare("SELECT 1 FROM munetios_accounts WHERE email = ?").bind(address).first();
            if (account) return true;
            const retired = await db.prepare("SELECT 1 FROM munetios_retired_addresses WHERE email = ?").bind(address).first().catch(() => null);
            if (retired) return true;
            return Boolean(await db.prepare("SELECT 1 FROM munetios_mail_aliases WHERE address = ?").bind(address).first());
        },
    };
}

const SYSTEM = [
    "abuse", "admin", "administrator", "billing", "contact", "hostmaster", "info", "mail", "mailer-daemon",
    "accounts", "compliance", "customer-service", "dmarc", "feedback", "help", "helpdesk", "legal", "no-reply", "noreply",
    "notifications", "postmaster", "press", "privacy", "report", "reports", "root", "safety", "sales", "security",
    "service", "support", "trust", "verify", "webmaster",
];

// Mirrors auth/mail.js so aliases follow the same reservation rules as registration.
export function reservedAddress(address, env) {
    const names = new Set([...SYSTEM, ...String(env.MUNETIOS_RESERVED_MAILBOXES || "").split(","), String(env.MAIL_VERIFICATION_FROM || "")]
        .map(value => value.trim().toLowerCase().replace(/@munetios\.com$/, "").split("+")[0]).filter(Boolean));
    const local = address.split("@")[0].split("+")[0];
    const squash = value => value.replace(/[._-]/g, "");
    return local.startsWith("inbox-") || names.has(local) || [...names].some(name => squash(name) === squash(local));
}
