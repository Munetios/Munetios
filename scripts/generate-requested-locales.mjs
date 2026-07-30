import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const languages = path.join(root, "app", "languages");

async function readLocale(fileName) {
  return JSON.parse(await readFile(path.join(languages, fileName), "utf8"));
}

async function writeLocale(fileName, copy) {
  await writeFile(
    path.join(languages, fileName),
    `${JSON.stringify(copy, null, 2)}\n`,
    "utf8",
  );
}

function replaceSpanishTerms(copy, { add, languageName, settings }) {
  const result = {};
  for (const [key, value] of Object.entries(copy)) {
    result[key] = String(value)
      .replace(/\b(?:Ajustes|Configuración)\b/gu, settings)
      .replace(/\b(?:Añadir|Agregar)\b/gu, add);
  }
  result.languageName = languageName;
  result.settings = settings;
  result.add = add;
  return result;
}

const es419 = await readLocale("es_419.json");
const esEs = await readLocale("es_ES.json");
const esUs = await readLocale("es_US.json");

await writeLocale(
  "es.json",
  replaceSpanishTerms(esUs, {
    add: "Añadir",
    languageName: "Español",
    settings: "Configuración",
  }),
);
await writeLocale(
  "es_AR.json",
  replaceSpanishTerms(es419, {
    add: "Agregar",
    languageName: "Español (Argentina)",
    settings: "Configuración",
  }),
);
await writeLocale(
  "es_DO.json",
  replaceSpanishTerms(es419, {
    add: "Agregar",
    languageName: "Español (República Dominicana)",
    settings: "Configuración",
  }),
);
await writeLocale(
  "es_CO.json",
  replaceSpanishTerms(es419, {
    add: "Agregar",
    languageName: "Español (Colombia)",
    settings: "Configuración",
  }),
);
await writeLocale(
  "es_EQ.json",
  replaceSpanishTerms(esEs, {
    add: "Añadir",
    languageName: "Español (Ecuador)",
    settings: "Ajustes",
  }),
);
