import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";
import { generateTaskPlan } from "../../../lib/localLlama.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const promptInjectionPattern =
  /\b(ignore|override|reveal|repeat|bypass|disable)\b.{0,50}\b(instruction|prompt|policy|system|safety|rule)s?\b/i;
const unsafePatterns = [
  /\b(build|create|make|assemble|detonate|acquire)\b.{0,60}\b(bomb|explosive|weapon|poison)\b/i,
  /\b(kill|murder|assault|kidnap|torture|seriously harm)\b/i,
  /\b(suicide|self[- ]?harm)\b.{0,60}\b(method|plan|instructions?|how)\b/i,
  /\b(child|minor)\b.{0,50}\b(sexual|explicit|nude|pornograph)/i,
  /\b(ransomware|malware|credential theft|steal passwords?|phishing kit)\b/i,
  /\b(hack|breach|compromise)\b.{0,60}\b(account|device|network|server)\b/i,
  /\b(doxx|stalk|swat)\b/i,
];

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function hasUnsafeContent(value) {
  const text = String(value || "");
  return (
    promptInjectionPattern.test(text) ||
    unsafePatterns.some((pattern) => pattern.test(text))
  );
}

function cleanText(value, maximumLength) {
  return Array.from(String(value || ""))
    .map((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function validatePlan(plan, categories) {
  const category = cleanText(plan?.category, 80);
  const description = cleanText(plan?.description, 240);
  const steps = Array.isArray(plan?.steps)
    ? plan.steps
        .map((step) => cleanText(step, 100))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const combinedOutput = [category, description, ...steps].join(" ");

  if (
    !description ||
    steps.length < 2 ||
    hasUnsafeContent(combinedOutput) ||
    /https?:\/\/|www\./i.test(combinedOutput)
  ) {
    throw new Error("unsafe_or_invalid_model_output");
  }

  return {
    category: categories.includes(category) ? category : null,
    description,
    steps,
  };
}

function lexicalCategory(categories, topic) {
  const words = new Set(
    topic.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [],
  );
  return (
    categories.find((category) =>
      (category.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []).some(
        (word) => word.length > 2 && words.has(word),
      ),
    ) || null
  );
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return respond({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "tasks", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;

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

  const topic = cleanText(payload?.topic, 500);
  const categories = Array.isArray(payload?.categories)
    ? [
        ...new Set(
          payload.categories
            .map((item) => cleanText(item, 80))
            .filter(Boolean)
            .slice(0, 30),
        ),
      ]
    : [];

  if (!topic) {
    return respond({ contentSuggestion: null, suggestion: null });
  }
  if (hasUnsafeContent(topic) || categories.some(hasUnsafeContent)) {
    return respond(
      {
        blocked: true,
        contentSuggestion: null,
        error: "unsafe_topic",
        suggestion: null,
      },
      { status: 422 },
    );
  }

  try {
    const result = await generateTaskPlan({
      categories,
      signal: request.signal,
      topic,
    });
    const plan = validatePlan(result.plan, categories);
    return respond({
      contentSuggestion: {
        description: plan.description,
        options: plan.steps,
      },
      model: result.model,
      provider: "llama.cpp",
      suggestion: plan.category,
    });
  } catch {
    return respond({
      contentSuggestion: null,
      fallback: true,
      provider: "llama.cpp",
      suggestion: lexicalCategory(categories, topic),
    });
  }
}
