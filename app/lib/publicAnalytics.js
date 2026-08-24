import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "./dataDirectory.js";

const directory = dataDirectory;
const databasePath = join(directory, "public-analytics.sqlite");

function database() {
  mkdirSync(directory, { recursive: true });
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA busy_timeout = 10000;");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS aggregate_counts (
      metric TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0
    );
  `);
  return connection;
}

export function recordLandingPageView() {
  const connection = database();
  try {
    connection
      .prepare(`
        INSERT INTO aggregate_counts (metric, total) VALUES ('landing_page_views', 1)
        ON CONFLICT(metric) DO UPDATE SET total = total + 1
      `)
      .run();
    return Number(
      connection
        .prepare(
          "SELECT total FROM aggregate_counts WHERE metric = 'landing_page_views'",
        )
        .get()?.total || 0,
    );
  } finally {
    connection.close();
  }
}
