// Munetios Mail translations for all 17 Munetios locales.
// Sources: /mail/i18n/core.js (American English) plus one file per language. MunetiosLocales.compose() derives the
// regional variants (en-GB, es-ES/es-419/es-US, fr-CA, pt-PT, zh-TW) and applies the Munetios wording rules:
// Configuración in es-419/es-US (Ajustes in es-ES), Configurações and Buscar in pt-BR.
// Munetios Mail uses Definições for Settings in European Portuguese.
(() => {
  "use strict";
  const S = window.MunetiosMailI18n || {};
  const own = { en: S.en || {}, es: S.es, fr: S.fr, de: S.de, it: S.it, pt: S.pt, "zh-CN": S.zh, ko: S.ko, ar: S.ar, hi: S.hi, co: S.co };
  for (const key of Object.keys(own)) if (!own[key]) delete own[key];
  const L = window.MunetiosLocales;
  const out = L ? L.compose(own, {}, { es: "419", pt: "BR" }) : { "en-US": own.en };
  const pt = out["pt-PT"];
  if (pt) {
    for (const [key, value] of Object.entries(pt)) {
      if (typeof value !== "string") continue;
      pt[key] = value.replace(/\bdos ajustes\b/g, "das definições").replace(/\bnos ajustes\b/g, "nas definições").replace(/\bos ajustes\b/g, "as definições").replace(/\bOs ajustes\b/g, "As definições")
        .replace(/\bAjustes\b/g, "Definições").replace(/\bajustes\b/g, "definições");
    }
  }
  window.MunetiosMailTranslations = Object.freeze(out);
})();
