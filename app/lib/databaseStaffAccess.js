export const databaseStaffEmails = new Set([
  "contact@munetios.com",
  "munetios@munetios.com",
  "munetios96@munetios.com",
  "privacy@munetios.com",
  "support@munetios.com",
]);

export function hasDatabaseStaffAccess(session) {
  const email = String(session?.user?.email || "")
    .trim()
    .toLowerCase();
  return Boolean(session?.authenticated && databaseStaffEmails.has(email));
}

export function isDatabaseStaffEmail(email) {
  return databaseStaffEmails.has(
    String(email || "")
      .trim()
      .toLowerCase(),
  );
}
