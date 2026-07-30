import { auth } from "../../../../auth.js";
import { createHelpReport } from "../../../lib/helpReportDatabase.js";

export const dynamic = "force-dynamic";

const allowedApps = new Set(["ai", "meet", "omniwrite", "tasks", "account"]);
const allowedCategories = new Set([
  "accessibility",
  "account",
  "billing",
  "bug",
  "feature",
  "performance",
  "privacy",
  "security",
  "translation",
]);
const blockedLanguage =
  /\b(?:fuck|fucking|shit|bitch|asshole|cunt|nigger|faggot|puta|puto|mierda|joder|cabron|cabrón)\b/iu;
const unsafeContent =
  /\b(?:kill yourself|suicide instructions|build (?:a )?bomb|make (?:a )?bomb|child sexual|rape|doxx|steal passwords?|bypass safety|jailbreak)\b/iu;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const screenshotPattern =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/u;
const reportRateLimits = globalThis.__munetiosHelpReportRateLimits || new Map();
globalThis.__munetiosHelpReportRateLimits = reportRateLimits;

function response(payload, status = 200) {
  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function normalize(value, maximumLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/gu, " ").slice(0, maximumLength);
}

function decodeScreenshot(value) {
  if (!value) return { data: null, mimeType: null };
  const match = value.match(screenshotPattern);
  if (!match) throw new Error("invalid_screenshot");
  const data = Buffer.from(match[2], "base64");
  if (data.byteLength > 5 * 1024 * 1024) {
    throw new Error("screenshot_too_large");
  }
  return { data, mimeType: match[1] };
}

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return response({ error: "invalid_origin" }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, 400);
  }

  const subject = normalize(payload?.subject, 160);
  const email = normalize(payload?.email, 254).toLowerCase();
  const app = normalize(payload?.app, 40).toLowerCase();
  const category = normalize(payload?.category, 40).toLowerCase();
  const context = normalize(payload?.context, 8000);
  const reportType =
    payload?.reportType === "feature-request"
      ? "feature-request"
      : payload?.reportType === "bug-report"
        ? "bug-report"
        : "";

  if (
    !subject ||
    !context ||
    !reportType ||
    !allowedApps.has(app) ||
    !allowedCategories.has(category)
  ) {
    return response({ error: "missing_fields" }, 400);
  }
  if (email && !emailPattern.test(email)) {
    return response({ error: "invalid_email" }, 400);
  }
  if (blockedLanguage.test(`${subject} ${context}`)) {
    return response({ error: "profanity_not_allowed" }, 400);
  }
  if (unsafeContent.test(`${subject} ${context}`)) {
    return response({ error: "unsafe_content_not_allowed" }, 400);
  }

  const session = await auth(request);
  const fingerprint =
    session?.user?.id ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "guest";
  const now = Date.now();
  const attempts = (reportRateLimits.get(fingerprint) || []).filter(
    (timestamp) => now - timestamp < 60 * 60 * 1000,
  );
  if (attempts.length >= 5) {
    return response({ error: "rate_limited" }, 429);
  }

  let screenshot;
  try {
    screenshot = decodeScreenshot(payload?.screenshot);
  } catch (error) {
    return response({ error: error.message }, 400);
  }

  reportRateLimits.set(fingerprint, [...attempts, now]);
  const report = createHelpReport({
    app,
    category,
    context,
    createdAt: new Date(now).toISOString(),
    email,
    id: `help-report-${crypto.randomUUID()}`,
    reportType,
    screenshot: screenshot.data,
    screenshotMimeType: screenshot.mimeType,
    subject,
    userId: session?.user?.id || null,
  });

  return response({ report, submitted: true }, 201);
}
