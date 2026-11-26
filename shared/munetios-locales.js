/*
 * Munetios global locales. Every Munetios and Ganetios app offers exactly these languages.
 * resolve() maps any browser or saved language tag onto one of them.
 *
 * Regional conventions the catalogs follow:
 *   en-US "Couldn't …"            en-GB "Could not …", British spelling
 *   es-419 / es-US  Configuración, Home page = Principal     es-ES  Ajustes, Home page = Inicio
 *   Home as a personal house = Casa in every Spanish locale
 *   pt-BR  Buscar, Configurações  pt-PT  Pesquisar, Ajustes
 */
(() => {
  "use strict";
  const LOCALES = Object.freeze([
    { code: "en-US", name: "English (United States)", base: "en", dir: "ltr" },
    { code: "en-GB", name: "English (United Kingdom)", base: "en", dir: "ltr" },
    { code: "es-419", name: "Español (Latinoamérica)", base: "es", dir: "ltr" },
    { code: "es-ES", name: "Español (España)", base: "es", dir: "ltr" },
    { code: "es-US", name: "Español (Estados Unidos)", base: "es", dir: "ltr" },
    { code: "fr-FR", name: "Français (France)", base: "fr", dir: "ltr" },
    { code: "fr-CA", name: "Français (Canada)", base: "fr", dir: "ltr" },
    { code: "de", name: "Deutsch", base: "de", dir: "ltr" },
    { code: "it", name: "Italiano", base: "it", dir: "ltr" },
    { code: "pt-BR", name: "Português (Brasil)", base: "pt", dir: "ltr" },
    { code: "pt-PT", name: "Português (Portugal)", base: "pt", dir: "ltr" },
    { code: "zh-CN", name: "中文（简体）", base: "zh", dir: "ltr" },
    { code: "zh-TW", name: "中文（繁體）", base: "zh", dir: "ltr" },
    { code: "ko", name: "한국어", base: "ko", dir: "ltr" },
    { code: "ar", name: "العربية", base: "ar", dir: "rtl" },
    { code: "hi", name: "हिन्दी", base: "hi", dir: "ltr" },
    { code: "co", name: "Corsu", base: "co", dir: "ltr" },
  ]);
  const CODES = LOCALES.map((l) => l.code);
  const BY_CODE = Object.fromEntries(LOCALES.map((l) => [l.code.toLowerCase(), l]));

  // English that keeps "Couldn't" and US spelling; every other English region uses en-GB.
  const US_ENGLISH = new Set(["", "us", "ca", "ph", "pr", "um", "as", "gu", "vi", "mp"]);
  const PORTUGAL = new Set(["pt", "ao", "mz", "cv", "gw", "st", "tl", "mo", "gq", "ch", "lu"]);
  const TRADITIONAL = new Set(["tw", "hk", "mo", "hant"]);

  function resolve(tag) {
    if (!tag || typeof tag !== "string" || tag === "auto") return null;
    const parts = tag.replace(/_/g, "-").toLowerCase().split("-");
    const base = parts[0];
    const rest = parts.slice(1);
    const region = rest.find((p) => /^([a-z]{2}|\d{3})$/.test(p)) || "";
    const script = rest.find((p) => /^[a-z]{4}$/.test(p)) || "";
    const exact = BY_CODE[tag.replace(/_/g, "-").toLowerCase()];
    if (exact) return exact.code;
    switch (base) {
      case "en": return US_ENGLISH.has(region) ? "en-US" : "en-GB";
      case "es": return region === "es" || (!region && !script) ? "es-ES" : region === "us" ? "es-US" : "es-419";
      case "fr": return region === "ca" ? "fr-CA" : "fr-FR";
      case "pt": return PORTUGAL.has(region) ? "pt-PT" : "pt-BR";
      case "zh": return TRADITIONAL.has(script) || TRADITIONAL.has(region) ? "zh-TW" : "zh-CN";
      case "de": case "gsw": return "de";
      case "it": return "it";
      case "ko": return "ko";
      case "ar": return "ar";
      case "hi": return "hi";
      case "co": return "co";
      default: return null;
    }
  }

  function detect(list) {
    const tags = list || (typeof navigator !== "undefined" ? (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) : []);
    for (const tag of tags) { const code = resolve(tag); if (code) return code; }
    return "en-US";
  }

  // Locale chain from most to least specific: e.g. es-US → es-US, es-419, es, en-US, en.
  function chain(code) {
    const c = resolve(code) || "en-US";
    const base = BY_CODE[c.toLowerCase()].base;
    const out = [c];
    if (c === "es-US") out.push("es-419");
    if (c === "fr-CA") out.push("fr-FR");
    if (c === "en-GB") out.push("en-US");
    if (c === "zh-TW") out.push("zh-Hant");
    out.push(base);
    if (c === "pt-PT") out.push("pt-BR");
    if (base !== "en") out.push("en-US");
    out.push("en");
    return [...new Set(out)];
  }

  // British English: "Couldn't" → "Could not", US spellings → British.
  const GB_WORDS = [["Couldn't", "Could not"], ["couldn't", "could not"], ["Color", "Colour"], ["color", "colour"], ["Favorites", "Favourites"], ["favorites", "favourites"], ["Favorite", "Favourite"], ["favorite", "favourite"], ["Kilometers", "Kilometres"], ["kilometers", "kilometres"], ["Center", "Centre"], ["center", "centre"], ["Organize", "Organise"], ["organize", "organise"], ["Customize", "Customise"], ["customize", "customise"], ["Canceled", "Cancelled"], ["canceled", "cancelled"], ["Gray", "Grey"], ["gray", "grey"], ["Analyze", "Analyse"], ["analyze", "analyse"], ["Recognize", "Recognise"], ["recognize", "recognise"], ["Synchronize", "Synchronise"], ["synchronize", "synchronise"], ["Behavior", "Behaviour"], ["behavior", "behaviour"], ["Catalog", "Catalogue"], ["catalog", "catalogue"], ["Dialog", "Dialogue"]];
  function toBritish(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const [us, gb] of GB_WORDS) out = out.replace(new RegExp(`(?<![\\p{L}])${us}(?![\\p{L}])`, "gu"), gb);
    return out;
  }
  function britishCatalog(catalog) {
    const out = {};
    for (const [k, v] of Object.entries(catalog || {})) { const gb = toBritish(v); if (gb !== v) out[k] = gb; }
    return out;
  }

  // pt-BR search wording ("Pesquisar" → "Buscar").
  function toBrazilianSearch(text) {
    if (typeof text !== "string") return text;
    return text.replace(/Pesquisar/g, "Buscar").replace(/pesquisar/g, "buscar").replace(/Pesquisando/g, "Buscando").replace(/pesquisando/g, "buscando")
      .replace(/Pesquise/g, "Busque").replace(/pesquise/g, "busque").replace(/Pesquisas/g, "Buscas").replace(/pesquisas/g, "buscas").replace(/Pesquisa/g, "Busca").replace(/pesquisa/g, "busca");
  }
  // pt-PT settings wording ("Configurações"/"Definições" → "Ajustes").
  function toPortugalSettings(text) {
    if (typeof text !== "string") return text;
    return text.replace(/Configurações/g, "Ajustes").replace(/configurações/g, "ajustes").replace(/Definições/g, "Ajustes").replace(/definições/g, "ajustes")
      .replace(/\bas ajustes/g, "os ajustes").replace(/\bdas ajustes/g, "dos ajustes").replace(/\bsuas ajustes/g, "seus ajustes").replace(/\bàs ajustes/g, "aos ajustes").replace(/\bnas ajustes/g, "nos ajustes");
  }
  // pt-PT vocabulary (Brazilian → European Portuguese), plus Ajustes and Pesquisar.
  const PT_WORDS = [
    ["Configurações", "Ajustes"], ["configurações", "ajustes"], ["Definições", "Ajustes"], ["definições", "ajustes"],
    ["Arquivos", "Ficheiros"], ["arquivos", "ficheiros"], ["Arquivo", "Ficheiro"], ["arquivo", "ficheiro"], ["Lixeira", "Lixo"], ["lixeira", "lixo"],
    ["Usuários", "Utilizadores"], ["usuários", "utilizadores"], ["Usuário", "Utilizador"], ["usuário", "utilizador"],
    ["Aplicativos", "Aplicações"], ["aplicativos", "aplicações"], ["Aplicativo", "Aplicação"], ["aplicativo", "aplicação"],
    ["Telas", "Ecrãs"], ["telas", "ecrãs"], ["Tela", "Ecrã"], ["tela", "ecrã"], ["Senha", "Palavra-passe"], ["senha", "palavra-passe"],
    ["Salvando", "A guardar"], ["salvando", "a guardar"], ["Salvar", "Guardar"], ["salvar", "guardar"], ["Salve", "Guarde"], ["salve", "guarde"],
    ["Salvos", "Guardados"], ["salvos", "guardados"], ["Salvas", "Guardadas"], ["salvas", "guardadas"], ["Salvo", "Guardado"], ["salvo", "guardado"], ["Salva", "Guardada"], ["salva", "guardada"],
    ["Carregando", "A carregar"], ["carregando", "a carregar"], ["Enviando", "A enviar"], ["enviando", "a enviar"], ["Baixando", "A transferir"], ["baixando", "a transferir"], ["Baixar", "Transferir"], ["baixar", "transferir"],
    ["Buscando", "A pesquisar"], ["buscando", "a pesquisar"], ["Pesquisando", "A pesquisar"], ["pesquisando", "a pesquisar"], ["Buscar", "Pesquisar"], ["buscar", "pesquisar"], ["Busque", "Pesquise"], ["busque", "pesquise"], ["Busca", "Pesquisa"], ["busca", "pesquisa"],
    ["Procurando", "A procurar"], ["procurando", "a procurar"], ["Calculando", "A calcular"], ["calculando", "a calcular"], ["Excluindo", "A eliminar"], ["excluindo", "a eliminar"],
    ["Compartilhamento", "Partilha"], ["compartilhamento", "partilha"], ["Compartilhar", "Partilhar"], ["compartilhar", "partilhar"], ["Compartilhe", "Partilhe"], ["compartilhe", "partilhe"], ["Compartilhado", "Partilhado"], ["compartilhado", "partilhado"],
    ["Excluir", "Eliminar"], ["excluir", "eliminar"], ["Exclua", "Elimine"], ["exclua", "elimine"], ["Excluídos", "Eliminados"], ["excluídos", "eliminados"], ["Excluídas", "Eliminadas"], ["excluídas", "eliminadas"], ["Excluído", "Eliminado"], ["excluído", "eliminado"], ["Excluída", "Eliminada"], ["excluída", "eliminada"],
    ["Ônibus", "Autocarro"], ["ônibus", "autocarro"], ["Trem", "Comboio"], ["trem", "comboio"], ["Celular", "Telemóvel"], ["celular", "telemóvel"], ["Mouse", "Rato"], ["Cadastrar", "Registar"], ["cadastrar", "registar"],
    ["Registrar", "Registar"], ["registrar", "registar"], ["Contato", "Contacto"], ["contato", "contacto"], ["Contatos", "Contactos"], ["contatos", "contactos"],
    ["Você pode", "Pode"], ["você pode", "pode"], ["Você deseja", "Pretende"], ["você deseja", "pretende"], ["Você tem", "Tem"], ["você tem", "tem"], ["Você não", "Não"], ["você não", "não"], ["Você está", "Está"], ["você está", "está"],
    ["Backup", "Cópia de segurança"], ["backup", "cópia de segurança"],
  ];
  function toEuropeanPortuguese(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const [br, pt] of PT_WORDS) out = out.replace(new RegExp(`(?<![\\p{L}])${br}(?![\\p{L}])`, "gu"), pt);
    return out.replace(/\bas ajustes/g, "os ajustes").replace(/\bdas ajustes/g, "dos ajustes").replace(/\bsuas ajustes/g, "os seus ajustes").replace(/\bàs ajustes/g, "aos ajustes").replace(/\bnas ajustes/g, "nos ajustes")
      .replace(/\ba lixo/g, "o lixo").replace(/\bda lixo/g, "do lixo").replace(/\bna lixo/g, "no lixo").replace(/\bo cópia de segurança/g, "a cópia de segurança").replace(/\bum cópia de segurança/g, "uma cópia de segurança");
  }
  function mapCatalog(catalog, fn) {
    const out = {};
    for (const [k, v] of Object.entries(catalog || {})) { const next = fn(v); if (next !== v) out[k] = next; }
    return out;
  }

  window.MunetiosLocales = Object.freeze({ LOCALES, CODES, resolve, detect, chain, toBritish, britishCatalog, toBrazilianSearch, toPortugalSettings, toEuropeanPortuguese, mapCatalog,
    name: (code) => (BY_CODE[String(resolve(code) || "").toLowerCase()] || {}).name || code,
    dir: (code) => (BY_CODE[String(resolve(code) || "").toLowerCase()] || {}).dir || "ltr" });
})();
