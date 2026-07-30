import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databaseDirectory =
  process.env.MUNETIOS_DATA_DIR || join(process.cwd(), "data");
const databasePath = join(
  databaseDirectory,
  "featurerequestsandbugreports.sqlite",
);

function createDatabase() {
  mkdirSync(databaseDirectory, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 10000;");
  database.exec("PRAGMA encoding = 'UTF-8';");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS featurerequestsandbugreports (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL CHECK (
        report_type IN ('feature-request', 'bug-report')
      ),
      subject TEXT NOT NULL,
      email TEXT,
      app TEXT NOT NULL,
      category TEXT NOT NULL,
      context TEXT NOT NULL,
      screenshot BLOB,
      screenshot_mime_type TEXT,
      user_id TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS help_reports_created_at_index
      ON featurerequestsandbugreports (created_at DESC);
    CREATE INDEX IF NOT EXISTS help_reports_status_index
      ON featurerequestsandbugreports (status);
  `);
  return database;
}

const database = globalThis.__munetiosHelpReportDatabase || createDatabase();
globalThis.__munetiosHelpReportDatabase = database;

const insertReport = database.prepare(`
  INSERT INTO featurerequestsandbugreports (
    id, report_type, subject, email, app, category, context,
    screenshot, screenshot_mime_type, user_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function createHelpReport(report) {
  insertReport.run(
    report.id,
    report.reportType,
    report.subject,
    report.email || null,
    report.app,
    report.category,
    report.context,
    report.screenshot || null,
    report.screenshotMimeType || null,
    report.userId || null,
    report.createdAt,
  );
  return { id: report.id, status: "new" };
}
