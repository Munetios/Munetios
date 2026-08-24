import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory as resolvedDataDirectory } from "./dataDirectory.js";

const databaseDirectory = resolvedDataDirectory;
const databasePath = join(databaseDirectory, "munetios.sqlite");
const feedbackReportExportPath = join(
  databaseDirectory,
  "feedback-reports.json",
);

function createFeedbackDatabase() {
  mkdirSync(databaseDirectory, { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA encoding = 'UTF-8';");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS feedback_reports (
      id TEXT PRIMARY KEY,
      feedback_type TEXT NOT NULL CHECK (
        feedback_type IN ('general', 'feature-request', 'bug-report', 'other')
      ),
      email TEXT NOT NULL,
      explanation TEXT,
      context TEXT NOT NULL,
      page_url TEXT,
      screenshot BLOB,
      screenshot_mime_type TEXT,
      user_id TEXT,
      user_agent TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS feedback_reports_created_at_index
      ON feedback_reports (created_at DESC);

    CREATE INDEX IF NOT EXISTS feedback_reports_status_index
      ON feedback_reports (status);
  `);

  return database;
}

const feedbackDatabase =
  globalThis.__munetiosFeedbackDatabase || createFeedbackDatabase();

globalThis.__munetiosFeedbackDatabase = feedbackDatabase;

const insertFeedbackStatement = feedbackDatabase.prepare(`
  INSERT INTO feedback_reports (
    id,
    feedback_type,
    email,
    explanation,
    context,
    page_url,
    screenshot,
    screenshot_mime_type,
    user_id,
    user_agent,
    status,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
`);

const listAllFeedbackStatement = feedbackDatabase.prepare(`
  SELECT
    id,
    feedback_type,
    email,
    explanation,
    context,
    page_url,
    screenshot IS NOT NULL AS has_screenshot,
    screenshot_mime_type,
    user_id,
    user_agent,
    status,
    created_at
  FROM feedback_reports
  ORDER BY created_at DESC
  LIMIT ?
`);

const listUserFeedbackStatement = feedbackDatabase.prepare(`
  SELECT
    id,
    feedback_type,
    email,
    explanation,
    context,
    page_url,
    screenshot IS NOT NULL AS has_screenshot,
    screenshot_mime_type,
    user_id,
    user_agent,
    status,
    created_at
  FROM feedback_reports
  WHERE user_id = ? OR lower(email) = lower(?)
  ORDER BY created_at DESC
  LIMIT ?
`);

const getAllFeedbackScreenshotStatement = feedbackDatabase.prepare(`
  SELECT id, screenshot, screenshot_mime_type
  FROM feedback_reports
  WHERE id = ? AND screenshot IS NOT NULL
`);

const getUserFeedbackScreenshotStatement = feedbackDatabase.prepare(`
  SELECT id, screenshot, screenshot_mime_type
  FROM feedback_reports
  WHERE id = ?
    AND screenshot IS NOT NULL
    AND (user_id = ? OR lower(email) = lower(?))
`);

function serializeFeedbackReport(report) {
  return {
    context: report.context,
    createdAt: report.created_at,
    email: report.email,
    explanation: report.explanation || "",
    feedbackType: report.feedback_type,
    hasScreenshot: Boolean(report.has_screenshot),
    id: report.id,
    pageUrl: report.page_url || "",
    screenshotMimeType: report.screenshot_mime_type || null,
    status: report.status,
    userAgent: report.user_agent || "",
    userId: report.user_id || null,
  };
}

export function createFeedbackReport(report) {
  insertFeedbackStatement.run(
    report.id,
    report.feedbackType,
    report.email,
    report.explanation || null,
    report.context,
    report.pageUrl || null,
    report.screenshot || null,
    report.screenshotMimeType || null,
    report.userId || null,
    report.userAgent || null,
    report.createdAt,
  );

  refreshFeedbackReportExport();

  return {
    createdAt: report.createdAt,
    id: report.id,
    status: "new",
  };
}

export function getFeedbackReports({
  email = "",
  includeAll = false,
  limit = 50,
  userId = "",
} = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const reports = includeAll
    ? listAllFeedbackStatement.all(safeLimit)
    : listUserFeedbackStatement.all(userId, email, safeLimit);

  return reports.map(serializeFeedbackReport);
}

export function getFeedbackScreenshot({
  email = "",
  id,
  includeAll = false,
  userId = "",
}) {
  const screenshot = includeAll
    ? getAllFeedbackScreenshotStatement.get(id)
    : getUserFeedbackScreenshotStatement.get(id, userId, email);

  if (!screenshot) {
    return null;
  }

  return {
    data: screenshot.screenshot,
    id: screenshot.id,
    mimeType: screenshot.screenshot_mime_type,
  };
}

function refreshFeedbackReportExport() {
  try {
    const reports = listAllFeedbackStatement
      .all(1000)
      .map(serializeFeedbackReport);
    writeFileSync(
      feedbackReportExportPath,
      `${JSON.stringify(
        {
          encoding: "UTF-8",
          generatedAt: new Date().toISOString(),
          reports,
          total: reports.length,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // The SQLite report remains saved if a read-only deployment cannot write the inspection export.
  }
}

refreshFeedbackReportExport();
