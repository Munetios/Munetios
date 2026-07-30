import { auth } from "../../../auth.js";
import {
  createFeedbackReport,
  getFeedbackReports,
  getFeedbackScreenshot,
} from "../../lib/feedbackDatabase.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const allowedFeedbackTypes = new Set([
  "general",
  "feature-request",
  "bug-report",
  "other",
]);
const allowedScreenshotTypes = new Set(["image/jpeg", "image/png"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const screenshotPattern = /^data:(image\/(?:jpeg|png));base64,([a-z\d+/=]+)$/i;
const maximumScreenshotBytes = 5 * 1024 * 1024;
const feedbackRateLimitWindow = 60_000;
const feedbackRateLimitMaximum = 5;
const feedbackSubmissionStore =
  globalThis.__munetiosFeedbackSubmissionStore || new Map();

globalThis.__munetiosFeedbackSubmissionStore = feedbackSubmissionStore;

function jsonResponse(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function hasFeedbackAdminAccess(request) {
  const configuredToken = process.env.MUNETIOS_FEEDBACK_ADMIN_TOKEN;
  if (!configuredToken) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${configuredToken}`;
}

function hasLocalFeedbackAccess(request) {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function getFeedbackAccess(session, includeAll) {
  return {
    email: session?.user?.email || "",
    includeAll,
    userId: session?.user?.id || "",
  };
}

export async function GET(request) {
  const includeAll =
    hasFeedbackAdminAccess(request) || hasLocalFeedbackAccess(request);
  const session = includeAll ? null : await auth(request);

  if (!includeAll && !session) {
    return jsonResponse(
      { error: "unauthorized", message: "Sign in to view feedback reports." },
      { status: 401 },
    );
  }

  const requestUrl = new URL(request.url);
  const screenshotId = requestUrl.searchParams.get("screenshot");
  const access = getFeedbackAccess(session, includeAll);

  if (screenshotId) {
    const screenshot = getFeedbackScreenshot({
      ...access,
      id: screenshotId,
    });

    if (!screenshot) {
      return jsonResponse(
        { error: "not_found", message: "Screenshot not found." },
        { status: 404 },
      );
    }

    return new Response(screenshot.data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="feedback-${screenshot.id}.${screenshot.mimeType === "image/png" ? "png" : "jpg"}"`,
        "Content-Type": screenshot.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const reports = getFeedbackReports({
    ...access,
    limit: requestUrl.searchParams.get("limit"),
  }).map((report) => ({
    ...report,
    screenshotUrl: report.hasScreenshot
      ? `/api/feedback?screenshot=${encodeURIComponent(report.id)}`
      : null,
  }));

  return jsonResponse({
    encoding: "UTF-8",
    reports,
    total: reports.length,
  });
}

function normalizeText(value, maximumLength, { required = false } = {}) {
  if (typeof value !== "string") {
    return required ? null : "";
  }

  const normalizedValue = value.trim();
  if (
    (required && !normalizedValue) ||
    normalizedValue.length > maximumLength
  ) {
    return null;
  }

  return normalizedValue;
}

function normalizeEmail(value) {
  const email = normalizeText(value, 254);
  if (email === "") {
    return "";
  }
  return email && emailPattern.test(email) ? email.toLowerCase() : null;
}

function normalizePageUrl(value, request) {
  const pageUrl = normalizeText(value, 2048);
  if (!pageUrl) {
    return "";
  }

  try {
    const parsedUrl = new URL(pageUrl);
    const requestUrl = new URL(request.url);
    return parsedUrl.origin === requestUrl.origin ? parsedUrl.href : "";
  } catch {
    return "";
  }
}

function normalizeScreenshot(value) {
  if (!value) {
    return { data: null, mimeType: null };
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(screenshotPattern);
  if (!match || !allowedScreenshotTypes.has(match[1].toLowerCase())) {
    return null;
  }

  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > maximumScreenshotBytes) {
    return null;
  }

  return { data, mimeType: match[1].toLowerCase() };
}

function getRateLimitKey(request, session, email) {
  if (session?.user?.id) {
    return `user:${session.user.id}`;
  }

  return `guest:${email}:${request.headers.get("user-agent") || "unknown"}`;
}

function isRateLimited(key) {
  const now = Date.now();
  const recentSubmissions = (feedbackSubmissionStore.get(key) || []).filter(
    (timestamp) => now - timestamp < feedbackRateLimitWindow,
  );

  if (recentSubmissions.length >= feedbackRateLimitMaximum) {
    feedbackSubmissionStore.set(key, recentSubmissions);
    return true;
  }

  recentSubmissions.push(now);
  feedbackSubmissionStore.set(key, recentSubmissions);
  return false;
}

export async function POST(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return jsonResponse(
      { error: "invalid_origin", message: "Invalid request origin." },
      { status: 403 },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_body", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse(
      { error: "invalid_feedback", message: "Invalid feedback details." },
      { status: 400 },
    );
  }

  const session = await auth(request);
  const feedbackType = allowedFeedbackTypes.has(payload.feedbackType)
    ? payload.feedbackType
    : null;
  const email = normalizeEmail(
    Object.hasOwn(payload, "email")
      ? payload.email
      : session?.user?.email || "",
  );
  const explanation = normalizeText(payload.explanation ?? "", 5000);
  const context = normalizeText(payload.context || "unknown", 120, {
    required: true,
  });
  const pageUrl = normalizePageUrl(payload.pageUrl, request);
  const screenshot = normalizeScreenshot(payload.screenshot);

  if (
    !feedbackType ||
    email === null ||
    explanation === null ||
    !context ||
    !screenshot
  ) {
    return jsonResponse(
      {
        error: "invalid_feedback",
        message: "Check the feedback details and try again.",
      },
      { status: 400 },
    );
  }

  const rateLimitKey = getRateLimitKey(request, session, email);
  if (isRateLimited(rateLimitKey)) {
    return jsonResponse(
      {
        error: "rate_limited",
        message: "Too many feedback reports. Try again shortly.",
      },
      { status: 429 },
    );
  }

  const report = createFeedbackReport({
    context,
    createdAt: new Date().toISOString(),
    email,
    explanation,
    feedbackType,
    id: crypto.randomUUID(),
    pageUrl,
    screenshot: screenshot.data,
    screenshotMimeType: screenshot.mimeType,
    userAgent: normalizeText(request.headers.get("user-agent") || "", 500),
    userId: session?.user?.id || null,
  });

  return jsonResponse({ report, submitted: true }, { status: 201 });
}
