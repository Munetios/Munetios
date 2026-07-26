import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const serverUrl = process.env.MUNETIOS_LOCAL_AI_URL || "http://127.0.0.1:11434";
const model = process.env.MUNETIOS_TASKS_LLAMA_MODEL || "llama3.2:3b";

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

async function ensureModel() {
  const tagsResponse = await fetch(`${serverUrl}/api/tags`, {
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!tagsResponse.ok) throw new Error("local_ai_unavailable");
  const tags = await tagsResponse.json();
  const installed = (tags.models || []).some(
    (item) => item.name === model || item.model === model,
  );
  if (installed) return;
  const pullResponse = await fetch(`${serverUrl}/api/pull`, {
    body: JSON.stringify({ model, stream: false }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(120_000),
  });
  if (!pullResponse.ok) throw new Error("model_download_failed");
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return respond({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const rateLimit = consumeRateLimit({
    key: `tasks-suggestions:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return respond({ error: "rate_limited" }, { status: 429 });
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "invalid_json" }, { status: 400 });
  }
  const topic = String(payload?.topic || "")
    .trim()
    .slice(0, 500);
  const categories = Array.isArray(payload?.categories)
    ? payload.categories
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
  if (!topic || categories.length === 0) {
    return respond({ suggestion: null });
  }
  try {
    await ensureModel();
    const generation = await fetch(`${serverUrl}/api/generate`, {
      body: JSON.stringify({
        model,
        prompt: `Choose exactly one category from this list for the task. Reply only with the category text.\nCategories: ${categories.join(" | ")}\nTask: ${topic}`,
        stream: false,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    if (!generation.ok) throw new Error("generation_failed");
    const result = await generation.json();
    const answer = String(result.response || "")
      .trim()
      .toLocaleLowerCase();
    const suggestion =
      categories.find((category) =>
        answer.includes(category.toLocaleLowerCase()),
      ) || null;
    return respond({ model, suggestion });
  } catch {
    const words = topic.toLocaleLowerCase().split(/\W+/).filter(Boolean);
    const suggestion =
      categories.find((category) =>
        category
          .toLocaleLowerCase()
          .split(/\W+/)
          .some((word) => word.length > 2 && words.includes(word)),
      ) || null;
    return respond({ fallback: true, model, suggestion });
  }
}
