/*!
 * Munetios WebFilter extension packager (runs in the WebFilter console)
 * - Workspace signing key (RSA 2048, WebCrypto) -> stable Chrome/Edge extension ID
 * - ZIP writer (deflate-raw via CompressionStream, stored when that isn't smaller)
 * - CRX3 signer for the self-hosted update URL
 * - Icons: icon.svg is rasterized to 16/32/48/128 px PNGs on a canvas
 * - Bundles Munetios UI v4 Font and Google Sans Flex as
 *   web_accessible_resource so Chromebooks render it locally under any CSP.
 * No third-party libraries, no network requests except same-origin file reads.
 */
(function () {
  "use strict";
  const script = document.currentScript;
  const BASE = new URL(".", script ? script.src : location.href).href;
  const ROOT = new URL("../", BASE).href;
  const encoder = new TextEncoder();

  /* ------------------------------------------------------------- bytes */

  function concat(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    parts.forEach(part => { out.set(part, offset); offset += part.length; });
    return out;
  }
  const u32 = value => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0, true); return b; };
  const u16 = value => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value & 0xffff, true); return b; };
  const toBase64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflate(bytes) {
    if (typeof CompressionStream !== "function") return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      return null;
    }
  }

  function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  // files: [{ name, data: Uint8Array | string }]
  async function zip(files) {
    const stamp = dosDateTime(new Date());
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);
      const packed = await deflate(data);
      const useDeflate = packed && packed.length < data.length;
      const body = useDeflate ? packed : data;
      const method = useDeflate ? 8 : 0;
      const header = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(stamp.time), u16(stamp.day),
        u32(crc), u32(body.length), u32(data.length), u16(name.length), u16(0), name]);
      locals.push(header, body);
      centrals.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(stamp.time), u16(stamp.day),
        u32(crc), u32(body.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
      offset += header.length + body.length;
    }
    const central = concat(centrals);
    const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
    return concat(locals.concat([central, end]));
  }

  /* ------------------------------------------------------- signing key */

  const KEY_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

  async function extensionIdFromSpki(spki) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", spki));
    return Array.from(hash.slice(0, 16)).map(byte => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join("");
  }

  // Returns { privateJwk, spki (base64), extensionId }.
  async function createSigningKey() {
    const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    return { privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey), spki: toBase64(spki), extensionId: await extensionIdFromSpki(spki) };
  }

  function protoField(field, bytes) {
    const varint = value => { const out = []; while (value > 0x7f) { out.push((value & 0x7f) | 0x80); value >>>= 7; } out.push(value); return new Uint8Array(out); };
    return concat([varint((field << 3) | 2), varint(bytes.length), bytes]);
  }

  // CRX3: "Cr24", version 3, header length, CrxFileHeader protobuf, then the ZIP.
  async function crx(zipBytes, key) {
    const spki = fromBase64(key.spki);
    const privateKey = await crypto.subtle.importKey("jwk", key.privateJwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const crxId = new Uint8Array(await crypto.subtle.digest("SHA-256", spki)).slice(0, 16);
    const signedData = protoField(1, crxId);
    const toSign = concat([encoder.encode("CRX3 SignedData\x00"), u32(signedData.length), signedData, zipBytes]);
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, toSign));
    const header = concat([protoField(2, concat([protoField(1, spki), protoField(2, signature)])), protoField(10000, signedData)]);
    return concat([encoder.encode("Cr24"), u32(3), u32(header.length), header, zipBytes]);
  }

  /* ------------------------------------------------------------- files */

  async function readBytes(url) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
    if (!response.ok) throw new Error("Could not read " + url);
    return new Uint8Array(await response.arrayBuffer());
  }
  async function readText(url) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
    if (!response.ok) throw new Error("Could not read " + url);
    return response.text();
  }

  // SVG -> PNG on a canvas, one image per icon size.
  async function svgToPng(svgText, size) {
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, size, size);
      const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new Uint8Array(await png.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function icons() {
    const sizes = [16, 32, 48, 128];
    try {
      const svg = await readText(BASE + "icon.svg");
      return await Promise.all(sizes.map(async size => ({ size, data: await svgToPng(svg, size) })));
    } catch (error) {
      // Prebuilt PNGs (rendered from the same SVG) if the canvas can't decode it.
      return Promise.all(sizes.map(async size => ({ size, data: await readBytes(BASE + "icons/icon-" + size + ".png") })));
    }
  }

  const CHROME_LOCALES = { en: "en-US", es: "es-ES", es_419: "es-419", pt_BR: "pt-BR", pt_PT: "pt-PT", fr: "fr" };

  // Same chain as webfilter-i18n.js: English, then each fallback file, then the locale's own file.
  async function catalogFor(locale, index, english) {
    const chain = [];
    const seen = new Set();
    let code = locale;
    while (code && !seen.has(code)) {
      seen.add(code);
      if (index.languages.includes(code) && code !== "en-US") chain.unshift(code);
      code = index.fallbacks[code];
    }
    const files = await Promise.all(chain.map(name => readText(BASE + "languages/" + name + ".json").then(JSON.parse)));
    return Object.assign({}, english, ...files);
  }

  async function locales() {
    const [english, index] = await Promise.all([
      readText(BASE + "languages/en-US.json").then(JSON.parse),
      readText(BASE + "languages/index.json").then(JSON.parse),
    ]);
    const out = [];
    for (const [folder, file] of Object.entries(CHROME_LOCALES)) {
      const catalog = await catalogFor(file, index, english);
      const messages = {};
      // Extension pages use chrome.i18n: their own strings plus the policy report and category names.
      Object.keys(english).filter(key => /^(ext_|v_|cat_)/.test(key)).forEach(key => { messages[key] = { message: catalog[key] }; });
      out.push({ name: "_locales/" + folder + "/messages.json", data: JSON.stringify(messages, null, 2) });
    }
    return out;
  }

  const MANAGED_SCHEMA = {
    type: "object",
    properties: {
      serverUrl: { title: "WebFilter server URL", description: "Origin of the Munetios WebFilter server, for example https://webfilter.school.example", type: "string" },
      orgId: { title: "Organization ID", description: "Munetios WebFilter organization ID", type: "string" },
      enrollToken: { title: "Enrollment token", description: "Lets devices read policy and report status", type: "string" },
      classId: { title: "Class ID", description: "Assigns this device to a class", type: "string" },
      deviceName: { title: "Device name", description: "Name shown in Remote Devices", type: "string" },
      studentName: { title: "Student", description: "Student shown in Remote Devices", type: "string" },
    },
  };

  /**
   * options: { version, key, config: { serverUrl, orgId, enrollToken }, policy, updateUrl }
   * Returns the list of files in the extension bundle.
   */
  async function extensionFiles(options) {
    const [engine, categories, background, screenPrivacy, content, youtubePolicy, pagesCss, popupHtml, popupJs, editorHtml, editorJs, editorCss, font, googleFont, license, iconList, localeFiles] = await Promise.all([
      readText(BASE + "webfilter-engine.js"),
      readText(BASE + "webfilter-categories.js"),
      readText(BASE + "extension/background.js"),
      readText(BASE + "extension/screen-privacy.js"),
      readText(BASE + "extension/content.js"),
      readText(BASE + "extension/youtube-policy.js"),
      readText(BASE + "extension/pages.css"),
      readText(BASE + "extension/popup.html"),
      readText(BASE + "extension/popup.js"),
      readText(BASE + "extension/editor.html"),
      readText(BASE + "extension/editor.js"),
      readText(BASE + "extension/editor.css"),
      readBytes(ROOT + "fonts/google-sans-flex/munetios-ui-v4-font.ttf"),
      readBytes(ROOT + "fonts/google-sans-flex/googlesansflex.ttf"),
      readText(ROOT + "fonts/google-sans-flex/OFL.txt"),
      icons(),
      locales(),
    ]);
    const iconMap = {};
    iconList.forEach(icon => { iconMap[String(icon.size)] = "icons/icon-" + icon.size + ".png"; });
    const manifest = {
      manifest_version: 3,
      name: "Munetios WebFilter",
      short_name: "WebFilter",
      version: options.version,
      description: "__MSG_ext_description__",
      default_locale: "en",
      minimum_chrome_version: "116",
      icons: iconMap,
      action: { default_title: "Munetios WebFilter", default_popup: "popup.html", default_icon: iconMap },
      background: { service_worker: "background.js" },
      permissions: ["storage", "tabs", "webNavigation", "webRequest", "alarms", "scripting", "identity", "identity.email", "sidePanel", "declarativeNetRequest", "enterprise.deviceAttributes"],
      side_panel: { default_path: "editor.html" },
      host_permissions: ["<all_urls>"],
      content_scripts: [
        { matches: ["http://*/*", "https://*/*"], js: ["screen-privacy.js"], run_at: "document_start", all_frames: true, match_origin_as_fallback: true },
        { matches: ["<all_urls>"], js: ["policy-engine.js", "content.js"], run_at: "document_start", all_frames: false },
        {
          matches: ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*", "*://*.youtubeeducation.com/*", "*://youtu.be/*"],
          js: ["policy-engine.js", "youtube-policy.js"], run_at: "document_start", all_frames: true,
        },
      ],
      web_accessible_resources: [{ resources: ["fonts/munetios-ui-v4-font.ttf", "fonts/googlesansflex.ttf", "icons/icon-48.png"], matches: ["<all_urls>"] }],
      storage: { managed_schema: "schema.json" },
    };
    if (options.key && options.key.spki) manifest.key = options.key.spki;
    if (options.updateUrl) manifest.update_url = options.updateUrl;
    const policy = Object.assign({}, options.policy || { global: {}, classes: [] });
    return [
      { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
      { name: "config.json", data: JSON.stringify(options.config || {}, null, 2) },
      { name: "policy.json", data: JSON.stringify(policy, null, 2) },
      { name: "schema.json", data: JSON.stringify(MANAGED_SCHEMA, null, 2) },
      { name: "policy-engine.js", data: engine },
      { name: "categories.js", data: categories },
      { name: "background.js", data: background },
      { name: "screen-privacy.js", data: screenPrivacy },
      { name: "content.js", data: content },
      { name: "youtube-policy.js", data: youtubePolicy },
      { name: "pages.css", data: pagesCss },
      { name: "popup.html", data: popupHtml },
      { name: "popup.js", data: popupJs },
      { name: "editor.html", data: editorHtml },
      { name: "editor.js", data: editorJs },
      { name: "editor.css", data: editorCss },
      { name: "fonts/munetios-ui-v4-font.ttf", data: font },
      { name: "fonts/googlesansflex.ttf", data: googleFont },
      { name: "fonts/OFL.txt", data: license },
    ].concat(iconList.map(icon => ({ name: "icons/icon-" + icon.size + ".png", data: icon.data })), localeFiles);
  }

  async function buildZip(options) {
    return zip(await extensionFiles(options));
  }

  async function buildCrx(options) {
    if (!options.key || !options.key.privateJwk) throw new Error("A signing key is required.");
    return crx(await buildZip(options), options.key);
  }

  function download(bytes, filename, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.MunetiosWebFilterPackage = Object.freeze({
    zip,
    crc32,
    crx,
    createSigningKey,
    extensionIdFromSpki,
    extensionFiles,
    buildZip,
    buildCrx,
    svgToPng,
    download,
    fromBase64,
    toBase64,
  });
})();
