import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const languages = path.join(root, "app", "languages");
const englishPath = path.join(languages, "en_US.json");
const greekPath = path.join(languages, "el_GR.json");
const endpoints = [
  process.env.MUNETIOS_LIBRETRANSLATE_URL,
  "https://api.munetios.com/libretranslate/translate",
  "https://translate.argosopentech.com/translate",
  "https://translate.terraprint.co/translate",
  "https://trans.zillyhuhn.com/translate",
  "https://lt.psf.lt/translate",
].filter(Boolean);
const protectedPatterns = [
  /\{[a-zA-Z][\w.-]*\}/gu,
  /https?:\/\/[^\s<>"']+/gu,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gu,
  /\b(?:Cash App|Google Material Design|Google Material UI|Google Sans Flex|Microsoft Fluent|Munetios|OmniWrite|PayPal|Stripe|SupaNotes|Vercel UI)\b/gu,
];
const greekOverrides = {
  accountProfileBio: "Βιογραφικό",
  accountProfileEmail: "Ηλεκτρονικό ταχυδρομείο",
  accountProfileFallbackBio: "Βιογραφικό",
  accountProfileFallbackEmail: "Ηλεκτρονικό ταχυδρομείο",
  accountProfileFontCursive: "Καλλιγραφική",
  accountProfilePictureEmoji: "Εικονίδιο έκφρασης",
  adminPlanPro: "Προηγμένο επιχειρηματικό",
  adminPlanStandard: "Τυπικό επιχειρηματικό",
  aiPlanPro: "Προηγμένο",
  aiPlanProLite: "Ελαφρύ προηγμένο",
  aiPricingPro: "Προηγμένο",
  aiPricingProLite: "Ελαφρύ προηγμένο",
  adminAnalytics: "Αναλυτικά στοιχεία",
  adminQuickCards: "Γρήγορες κάρτες",
  billingBillTo: "Χρέωση προς",
  businessFeedbackEmail: "Ηλεκτρονικό ταχυδρομείο",
  businessSignupEmail: "Ηλεκτρονικό ταχυδρομείο",
  demoBusinessPro: "Προηγμένο επιχειρηματικό",
  demoPlanBusinessPro: "Προηγμένο επιχειρηματικό",
  demoPlanBusinessStandard: "Τυπικό επιχειρηματικό",
  demoUpgradePro: "Προηγμένο επιχειρηματικό",
  demoUpgradeStandard: "Τυπικό επιχειρηματικό",
  featureCrossPlatformTitle: "Πολλαπλές πλατφόρμες",
  languageName: "Ελληνικά",
  privacyByDesignTitle: "Απόρρητο εκ σχεδιασμού",
  pricingBusinessProTitle: "Προηγμένο επιχειρηματικό",
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function protect(value) {
  const tokens = [];
  let protectedValue = value;
  for (const pattern of protectedPatterns) {
    protectedValue = protectedValue.replace(pattern, (token) => {
      const index = tokens.push(token) - 1;
      return `<span translate="no" data-munetios-token="${index}">${escapeHtml(token)}</span>`;
    });
  }
  return { protectedValue, tokens };
}

function restore(value, tokens) {
  let restored = String(value);
  for (let index = 0; index < tokens.length; index += 1) {
    const spanPattern = new RegExp(
      `<span[^>]*data-munetios-token=["']${index}["'][^>]*>[\\s\\S]*?<\\/span>`,
      "giu",
    );
    restored = restored.replace(spanPattern, tokens[index]);
  }
  return restored
    .replace(/<span[^>]*translate=["']no["'][^>]*>/giu, "")
    .replaceAll("</span>", "")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&")
    .normalize("NFC");
}

async function requestTranslation(values) {
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          api_key: process.env.MUNETIOS_LIBRETRANSLATE_API_KEY || undefined,
          format: "html",
          q: values,
          source: "en",
          target: "el",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(
          `${new URL(endpoint).host} returned ${response.status}`,
        );
      }
      const result = await response.json();
      const translated = result?.translatedText;
      if (Array.isArray(translated)) return translated;
      if (values.length === 1 && typeof translated === "string") {
        return [translated];
      }
      throw new Error("Translation service returned an unexpected response");
    } catch (error) {
      lastError = error;
    }
  }
  try {
    const separator = "\nZXQMUNETIOSSEPARATORQXZ\n";
    const parameters = new URLSearchParams({
      client: "gtx",
      dt: "t",
      q: values.join(separator),
      sl: "en",
      tl: "el",
    });
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?${parameters}`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!response.ok) {
      throw new Error(`Google translation returned ${response.status}`);
    }
    const payload = await response.json();
    const combined = Array.isArray(payload?.[0])
      ? payload[0].map((part) => part?.[0] || "").join("")
      : "";
    const translated = combined.split(separator);
    if (translated.length === values.length) return translated;
    if (values.length === 1 && combined) return [combined];
    throw new Error("Google translation did not preserve batch boundaries");
  } catch (error) {
    throw new AggregateError(
      [lastError, error].filter(Boolean),
      "No translation endpoint is available",
    );
  }
}

async function translateBatch(values) {
  try {
    return await requestTranslation(values);
  } catch (batchError) {
    if (values.length === 1) throw batchError;
    return Promise.all(
      values.map(async (value) => (await requestTranslation([value]))[0]),
    );
  }
}

const english = JSON.parse(await readFile(englishPath, "utf8"));
const greek = {};
const entries = Object.entries(english);
const batchSize = 25;

for (let offset = 0; offset < entries.length; offset += batchSize) {
  const batch = entries.slice(offset, offset + batchSize);
  const prepared = batch.map(([, value]) => protect(String(value)));
  const translated = await translateBatch(
    prepared.map(({ protectedValue }) => protectedValue),
  );
  for (let index = 0; index < batch.length; index += 1) {
    const [key] = batch[index];
    greek[key] = restore(translated[index], prepared[index].tokens);
  }
  await writeFile(greekPath, `${JSON.stringify(greek, null, 2)}\n`, "utf8");
  console.log(
    `Translated ${Math.min(offset + batch.length, entries.length)}/${entries.length}`,
  );
}

Object.assign(greek, greekOverrides);
await writeFile(greekPath, `${JSON.stringify(greek, null, 2)}\n`, "utf8");
