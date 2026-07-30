export const dynamic = "force-dynamic";

const supportedTargets = new Set([
  "de",
  "en",
  "es",
  "es-419",
  "es-ES",
  "es-MX",
  "es-US",
  "fr",
  "pt-BR",
  "pt-PT",
]);
const translationCache = globalThis.__munetiosHelpTranslationCache || new Map();
globalThis.__munetiosHelpTranslationCache = translationCache;

function response(payload, status = 200) {
  return Response.json(payload, {
    headers: { "Cache-Control": "private, max-age=3600" },
    status,
  });
}

function applySpanishGlossary(value, target) {
  if (!target.startsWith("es")) return value;
  const isSpain = new Set(["es", "es-ES"]).has(target);
  return String(value)
    .replace(
      /\b(?:Settings|Ajustes|Configuraci[oó]n)\b/giu,
      isSpain ? "Ajustes" : "Configuración",
    )
    .replace(
      /\b(?:Add|A[nñ]adir|Agregar)\b/giu,
      isSpain ? "Añadir" : "Agregar",
    );
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, 400);
  }

  const target = String(payload?.target || "").replaceAll("_", "-");
  const texts = Array.isArray(payload?.texts)
    ? payload.texts
        .slice(0, 50)
        .map((value) => String(value || "").slice(0, 6000))
    : [];
  if (!supportedTargets.has(target) || texts.length === 0) {
    return response({ error: "invalid_translation_request" }, 400);
  }
  if (target === "en") {
    return response({ translated: true, translations: texts });
  }

  const key = JSON.stringify([target, texts]);
  if (translationCache.has(key)) {
    return response({
      cached: true,
      translated: true,
      translations: translationCache.get(key),
    });
  }

  const endpoint =
    process.env.MUNETIOS_LIBRETRANSLATE_URL ||
    "https://api.munetios.com/libretranslate/translate";
  try {
    const translated = [];
    for (const text of texts) {
      const upstream = await fetch(endpoint, {
        body: JSON.stringify({
          api_key: process.env.MUNETIOS_LIBRETRANSLATE_API_KEY || undefined,
          format: "text",
          q: text,
          source: "en",
          target: target.split("-")[0],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(12_000),
      });
      if (!upstream.ok) throw new Error("translation_failed");
      const result = await upstream.json();
      translated.push(
        applySpanishGlossary(result?.translatedText || text, target),
      );
    }
    translationCache.set(key, translated);
    return response({ translated: true, translations: translated });
  } catch {
    return response({
      translated: false,
      translations: texts.map((text) => applySpanishGlossary(text, target)),
    });
  }
}
