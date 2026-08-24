import { loadDocumentation } from "../../../help/documentationLoader";

export const dynamic = "force-dynamic";

const requestWindows = globalThis.__munetiosHelpChatbotWindows || new Map();
globalThis.__munetiosHelpChatbotWindows = requestWindows;

const stopWords = new Set([
  "about",
  "and",
  "are",
  "can",
  "does",
  "for",
  "from",
  "help",
  "how",
  "into",
  "munetios",
  "please",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "with",
  "you",
  "your",
]);

function response(payload, status = 200) {
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

function fingerprint(request) {
  return String(
    request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "local",
  )
    .split(",")[0]
    .trim();
}

function isAllowed(request) {
  const key = fingerprint(request);
  const now = Date.now();
  const recent = (requestWindows.get(key) || []).filter(
    (timestamp) => now - timestamp < 60_000,
  );
  if (recent.length >= 30) return false;
  recent.push(now);
  requestWindows.set(key, recent);
  return true;
}

function tokens(value) {
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .match(/[a-z0-9]+/g) || [],
    ),
  ].filter((token) => token.length > 2 && !stopWords.has(token));
}

function plainText(lines) {
  return lines
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rankSections(documents, prompt, context) {
  const promptTokens = tokens(prompt);
  if (promptTokens.includes("available")) promptTokens.push("availability");
  if (promptTokens.includes("countries"))
    promptTokens.push("country", "locations");
  if (promptTokens.includes("country"))
    promptTokens.push("countries", "location");
  const contextSlug = String(context || "").replace(/^\/+|\/+$/g, "");
  return documents
    .flatMap((document) =>
      document.sections.map((section) => {
        const content = plainText(section.markdown);
        const searchable =
          `${document.appId} ${document.title} ${document.summary} ${section.title} ${content}`.toLowerCase();
        const headingText = `${document.title} ${section.title}`.toLowerCase();
        const score = promptTokens.reduce(
          (total, token) =>
            total +
            (searchable.includes(token) ? 2 : 0) +
            (headingText.includes(token) ? 3 : 0),
          document.slug === contextSlug ? 0.25 : 0,
        );
        return { content, document, score, section };
      }),
    )
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

export async function POST(request) {
  if (!isAllowed(request)) {
    return response({ error: "rate_limited" }, 429);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_json" }, 400);
  }

  const prompt = String(payload?.prompt || "")
    .trim()
    .slice(0, 1000);
  if (!prompt) return response({ error: "missing_prompt" }, 400);

  const matches = rankSections(
    await loadDocumentation(),
    prompt,
    payload?.context,
  );
  if (!matches.length) {
    return response({
      answer:
        "I could not find that in the current documentation. I can help with Munetios Calendar, Meet, Tasks, and general Munetios resources. Try asking about events, meetings, recordings, task lists, sharing, settings, privacy, availability, or the changelog.",
      sources: [],
    });
  }

  const primary = matches[0];
  const supporting = matches
    .slice(1)
    .filter((entry) => entry.document.slug !== primary.document.slug);
  const excerpts = [primary, ...supporting]
    .map((entry) => entry.content)
    .filter(Boolean)
    .map((content) => content.slice(0, 420));
  const answer = excerpts.join(" ").slice(0, 1100);

  return response({
    answer,
    sources: matches
      .filter(
        (entry, index, entries) =>
          entries.findIndex(
            (candidate) => candidate.document.slug === entry.document.slug,
          ) === index,
      )
      .map((entry) => ({
        href: `/help/${entry.document.slug}#${entry.section.id}`,
        label: `${entry.document.title} · ${entry.section.title}`,
      })),
  });
}
