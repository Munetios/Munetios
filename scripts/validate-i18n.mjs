import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { featureTranslations } from "../app/languages/featureTranslations.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const languagesDirectory = path.join(projectDirectory, "app", "languages");
const sourceDirectory = path.join(projectDirectory, "app");

const localeFileMap = {
  "ar-SA": "ar_SA.json",
  "co-FR": "co_FR.json",
  "da-DK": "da_DK.json",
  "de-CH": "de_CH.json",
  "de-DE": "de_DE.json",
  en: "en_US.json",
  "en-GB": "en_GB.json",
  "es-419": "es_419.json",
  "es-ES": "es_ES.json",
  "es-MX": "es_MX.json",
  "es-PR": "es_PR.json",
  "es-US": "es_US.json",
  "fr-FR": "fr_FR.json",
  "fur-IT": "fur_IT.json",
  "gl-ES": "gl_ES.json",
  "he-IL": "he_IL.json",
  "hi-IN": "hi_IN.json",
  "id-ID": "id_ID.json",
  "it-CH": "it_CH.json",
  "it-IT": "it_IT.json",
  "ja-JP": "ja_JP.json",
  "ko-KR": "ko_KR.json",
  "ms-MY": "ms_MY.json",
  "nl-NL": "nl_NL.json",
  "pl-PL": "pl_PL.json",
  "pt-BR": "pt_BR.json",
  "pt-PT": "pt_PT.json",
  "ru-RU": "ru_RU.json",
  "sv-SE": "sv_SE.json",
  "th-TH": "th_TH.json",
  "tr-TR": "tr_TR.json",
  "vi-VN": "vi_VN.json",
  "zh-CN": "zh_CN.json",
  "zh-TW": "zh_TW.json",
};

const windows1252Reverse = new Map([
  ["\u20ac", 0x80],
  ["\u201a", 0x82],
  ["\u0192", 0x83],
  ["\u201e", 0x84],
  ["\u2026", 0x85],
  ["\u2020", 0x86],
  ["\u2021", 0x87],
  ["\u02c6", 0x88],
  ["\u2030", 0x89],
  ["\u0160", 0x8a],
  ["\u2039", 0x8b],
  ["\u0152", 0x8c],
  ["\u017d", 0x8e],
  ["\u2018", 0x91],
  ["\u2019", 0x92],
  ["\u201c", 0x93],
  ["\u201d", 0x94],
  ["\u2022", 0x95],
  ["\u2013", 0x96],
  ["\u2014", 0x97],
  ["\u02dc", 0x98],
  ["\u2122", 0x99],
  ["\u0161", 0x9a],
  ["\u203a", 0x9b],
  ["\u0153", 0x9c],
  ["\u017e", 0x9e],
  ["\u0178", 0x9f],
]);
const suspiciousCodePoints = new Set([
  0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00d0, 0x00d1, 0x00d8, 0x00d9, 0x00e1,
  0x00e2, 0x00e3, 0x00e5, 0x00e6, 0x00ea, 0x00eb, 0x00ec, 0x00f0,
]);
const forbiddenValueCodePoints = new Set([
  0x200b, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068,
  0x2069, 0xfeff,
]);
const protectedBrandTokens = [
  "Cash App",
  "Google Material Design",
  "Google Material UI",
  "Google Sans Flex",
  "Microsoft Fluent",
  "Munetios",
  "OmniWrite",
  "PayPal",
  "Stripe",
  "SupaNotes",
  "Vercel UI",
];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const errors = [];

function addError(message) {
  errors.push(message);
}

function sorted(values) {
  return [...values].sort((first, second) => first.localeCompare(second, "en"));
}

function sameValues(first, second) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function suspiciousScore(value) {
  let score = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === 0xfffd) {
      score += 100;
    } else if (windows1252Reverse.has(character)) {
      score += 5;
    } else if (suspiciousCodePoints.has(codePoint)) {
      score += 1;
    }
  }

  return score;
}

function encodeWindows1252(value) {
  const bytes = [];

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (windows1252Reverse.has(character)) {
      bytes.push(windows1252Reverse.get(character));
    } else if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else {
      return null;
    }
  }

  return Uint8Array.from(bytes);
}

function findMojibakeRepair(value) {
  const bytes = encodeWindows1252(value);
  if (!bytes) {
    return null;
  }

  try {
    const candidate = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return suspiciousScore(candidate) < suspiciousScore(value)
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function getPlaceholders(value) {
  return sorted(
    new Set(
      [...value.matchAll(/\{([a-zA-Z][\w.-]*)\}/g)].map((match) => match[1]),
    ),
  );
}

function getForbiddenValueCodePoints(value) {
  return sorted(
    new Set(
      [...value]
        .map((character) => character.codePointAt(0))
        .filter((codePoint) => forbiddenValueCodePoints.has(codePoint))
        .map(
          (codePoint) =>
            `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
        ),
    ),
  );
}

function hasObviousQuestionMarkCorruption(value, englishValue) {
  if (!value.includes("?")) {
    return false;
  }

  if (/\?{2,}|\p{L}\?\p{L}|(?:^|[^\p{L}\p{N}])\?\p{Ll}/u.test(value)) {
    return true;
  }

  return typeof englishValue === "string" && !englishValue.includes("?");
}

function getEmails(value) {
  return sorted(
    [...value.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)].map(
      (match) => match[0],
    ),
  );
}

function getHttpUrls(value) {
  return sorted(
    [...value.matchAll(/https?:\/\/[^\s<>"'`]+/g)]
      .map((match) => match[0].replace(/[),.;:!?\]}]+$/u, ""))
      .filter(Boolean),
  );
}

function countOccurrences(value, token) {
  let count = 0;
  let offset = 0;

  while (offset < value.length) {
    const index = value.indexOf(token, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + token.length;
  }

  return count;
}

function getProtectedBrandTokens(value) {
  const matches = [];

  for (const token of protectedBrandTokens) {
    const count = countOccurrences(value, token);
    for (let index = 0; index < count; index += 1) {
      matches.push(token);
    }
  }

  return sorted(matches);
}

function describeProtectedValues(values) {
  return values.length > 0
    ? values.map((value) => JSON.stringify(value)).join(", ")
    : "none";
}

function validateProtectedValues(
  fileName,
  key,
  label,
  englishValues,
  localeValues,
) {
  if (sameValues(englishValues, localeValues)) {
    return;
  }

  addError(
    `${fileName}:${key}: ${label} do not match en_US.json (expected ${describeProtectedValues(englishValues)}; found ${describeProtectedValues(localeValues)})`,
  );
}

async function readLocaleFile(fileName) {
  const filePath = path.join(languagesDirectory, fileName);
  let source;

  try {
    const bytes = await readFile(filePath);
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    addError(`${fileName}: not valid UTF-8 (${error.message})`);
    return null;
  }

  if (source.startsWith("\ufeff")) {
    addError(`${fileName}: UTF-8 BOM is not allowed`);
    return null;
  }

  try {
    const copy = JSON.parse(source);
    if (!copy || Array.isArray(copy) || typeof copy !== "object") {
      addError(`${fileName}: root must be a JSON object`);
      return null;
    }
    return copy;
  } catch (error) {
    addError(`${fileName}: invalid JSON (${error.message})`);
    return null;
  }
}

async function collectSourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entryPath !== languagesDirectory) {
        files.push(...(await collectSourceFiles(entryPath)));
      }
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectReferencedKeys(source) {
  const keys = new Set();
  const patterns = [
    /\bcopy(?:\.|\?\.)([a-zA-Z_$][\w$]*)/g,
    /\bcopy\s*\[\s*["'`]([a-zA-Z_$][\w$.-]*)["'`]\s*\]/g,
    /\bdata-(?:i18n|translate)(?:-[a-z-]+)?\s*=\s*(?:\{\s*)?["'`]([a-zA-Z_$][\w$.-]*)["'`](?:\s*\})?/g,
    /\b(?:ariaLabelKey|descriptionKey|labelKey|messageKey|nameKey|placeholderKey|titleKey|translationKey)\s*(?:=|:)\s*(?:\{\s*)?["'`]([a-zA-Z_$][\w$.-]*)["'`](?:\s*\})?/g,
    /\bkey\s*:\s*["'`]([a-zA-Z_$][\w$.-]*)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      keys.add(match[1]);
    }
  }

  return keys;
}

const expectedFileNames = sorted(Object.values(localeFileMap));
const actualFileNames = sorted(
  (await readdir(languagesDirectory)).filter((fileName) =>
    fileName.endsWith(".json"),
  ),
);

for (const fileName of expectedFileNames) {
  if (!actualFileNames.includes(fileName)) {
    addError(`${fileName}: expected locale file is missing`);
  }
}
for (const fileName of actualFileNames) {
  if (!expectedFileNames.includes(fileName)) {
    addError(`${fileName}: unexpected locale file`);
  }
}

const localeCopies = new Map();
for (const [locale, fileName] of Object.entries(localeFileMap)) {
  const fileCopy = await readLocaleFile(fileName);
  if (fileCopy) {
    localeCopies.set(locale, {
      ...fileCopy,
      ...(featureTranslations[locale] || {}),
    });
  }
}

const englishCopy = localeCopies.get("en");
const englishKeys = englishCopy ? sorted(Object.keys(englishCopy)) : [];

for (const [locale, copy] of localeCopies) {
  const localeKeys = sorted(Object.keys(copy));
  const fileName = localeFileMap[locale];
  const missingKeys = englishKeys.filter((key) => !(key in copy));
  const unexpectedKeys = localeKeys.filter(
    (key) => !(key in (englishCopy || {})),
  );

  if (missingKeys.length > 0) {
    addError(`${fileName}: missing keys: ${missingKeys.join(", ")}`);
  }
  if (unexpectedKeys.length > 0) {
    addError(
      `${fileName}: keys absent from en_US.json: ${unexpectedKeys.join(", ")}`,
    );
  }

  for (const [key, value] of Object.entries(copy)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      addError(`${fileName}:${key}: value must be a non-empty string`);
      continue;
    }
    const englishValue = englishCopy?.[key];

    if (/[\u0080-\u009f\ufffd]/u.test(value)) {
      addError(
        `${fileName}:${key}: contains a replacement or C1 control character`,
      );
    }
    const forbiddenCodePoints = getForbiddenValueCodePoints(value);
    if (forbiddenCodePoints.length > 0) {
      addError(
        `${fileName}:${key}: contains forbidden formatting characters: ${forbiddenCodePoints.join(", ")}`,
      );
    }
    if (value !== value.normalize("NFC")) {
      addError(`${fileName}:${key}: value must use NFC normalization`);
    }
    if (hasObviousQuestionMarkCorruption(value, englishValue)) {
      addError(`${fileName}:${key}: contains likely question-mark corruption`);
    }
    if (findMojibakeRepair(value)) {
      addError(`${fileName}:${key}: looks like UTF-8 mojibake`);
    }

    if (typeof englishValue === "string") {
      if (!sameValues(getPlaceholders(englishValue), getPlaceholders(value))) {
        addError(`${fileName}:${key}: placeholders do not match en_US.json`);
      }
      validateProtectedValues(
        fileName,
        key,
        "email addresses",
        getEmails(englishValue),
        getEmails(value),
      );
      validateProtectedValues(
        fileName,
        key,
        "HTTP(S) URLs",
        getHttpUrls(englishValue),
        getHttpUrls(value),
      );
      validateProtectedValues(
        fileName,
        key,
        "protected brand tokens",
        getProtectedBrandTokens(englishValue),
        getProtectedBrandTokens(value),
      );
    }
  }
}

const sourceFiles = await collectSourceFiles(sourceDirectory);
const referencedKeys = new Set();
for (const filePath of sourceFiles) {
  const source = await readFile(filePath, "utf8");
  for (const key of collectReferencedKeys(source)) {
    referencedKeys.add(key);
  }
}

for (const key of sorted(referencedKeys)) {
  if (!(key in (englishCopy || {}))) {
    addError(`source references missing translation key: ${key}`);
  }
}

const summary = {
  keysPerLocale: englishKeys.length,
  localeFiles: localeCopies.size,
  referencedKeys: referencedKeys.size,
  sourceFiles: sourceFiles.length,
};

if (errors.length > 0) {
  console.error(JSON.stringify({ ...summary, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ...summary, status: "ok" }, null, 2));
}
