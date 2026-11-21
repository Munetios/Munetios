'use strict';

const net = require('node:net');

const FETCH_TIMEOUT_MS = 6000;
const MAX_ICON_BYTES = 1024 * 1024; // 1 MB
const MAX_HTML_BYTES = 512 * 1024; // 512 KB
const MAX_REDIRECTS = 4;
const MAX_META_REFRESHES = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day for found icons
const MISS_TTL_MS = 10 * 60 * 1000; // 10 minutes for failures

function createFaviconRoute({ lookup, sharePending = true }) {
  /* ── SSRF protection: never let the proxy reach private or local addresses ── */
  const blocked = new net.BlockList();
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, "ipv4"));
  [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, "ipv6"));

  function isBlockedAddress(address) {
    const family = net.isIP(address);
    if (family === 4) return blocked.check(address, "ipv4");
    if (family === 6) {
      const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
      if (mapped) return blocked.check(mapped[1], "ipv4");
      return blocked.check(address, "ipv6");
    }
    return true;
  }

  async function assertPublicUrl(url) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
    if (url.username || url.password) throw new Error("Credentials not allowed");
    if (url.port && url.port !== "80" && url.port !== "443") {
      throw new Error("Port not allowed");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(hostname)) {
      if (isBlockedAddress(hostname)) throw new Error("Address not allowed");
      return;
    }
    const records = await lookup(hostname, { all: true });
    if (!records.length || records.some((record) => isBlockedAddress(record.address))) {
      throw new Error("Address not allowed");
    }
  }

  /* ── Upstream fetching ── */
  // With truncate=true an oversized body is cut at maxBytes instead of rejected
  // (favicon <link> tags sit in the <head>, so the start of a large page is enough).
  async function readLimited(response, maxBytes, truncate) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        if (!truncate) throw new Error("Response too large");
        chunks.push(value.subarray(0, value.length - (total - maxBytes)));
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  async function fetchPublic(startUrl, accept, maxBytes, truncate) {
    let url = new URL(startUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(url);
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        referrerPolicy: "no-referrer",
        credentials: "omit",
        headers: { Accept: accept, "User-Agent": "Mozilla/5.0 (compatible; FaviconProxy/1.0)" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Redirect without location");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Upstream status " + response.status);
      }
      return { url, body: await readLimited(response, maxBytes, truncate) };
    }
    throw new Error("Too many redirects");
  }

  // Trust the bytes, not the upstream Content-Type header.
  function sniffImageType(buffer) {
    if (buffer.length < 4) return null;
    if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return "image/x-icon";
    if (buffer[0] === 0x89 && buffer.toString("latin1", 1, 4) === "PNG") return "image/png";
    if (buffer.toString("latin1", 0, 3) === "GIF") return "image/gif";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "image/webp";
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
    const head = buffer.toString("utf8", 0, Math.min(buffer.length, 1024)).replace(/^﻿/, "").trimStart();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
    return null;
  }

  async function fetchIcon(url) {
    const { body } = await fetchPublic(url, "image/*,*/*;q=0.5", MAX_ICON_BYTES);
    const type = sniffImageType(body);
    if (!type) throw new Error("Not an image");
    return { type, body };
  }

  function readAttribute(tag, name) {
    const match = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
    return match ? (match[1] || match[2] || match[3] || "").replace(/&amp;/g, "&").trim() : "";
  }

  function findIconLinks(html, baseUrl) {
    const links = [];
    const tagPattern = /<link\b[^>]*>/gi;
    let match;
    while ((match = tagPattern.exec(html))) {
      const tag = match[0];
      const rel = readAttribute(tag, "rel").toLowerCase();
      const href = readAttribute(tag, "href");
      if (!/(^|\s)(icon|apple-touch-icon(-precomposed)?)(\s|$)/.test(rel)) continue;
      if (!href || /^data:/i.test(href)) continue;
      // Declared pixel size; icons without one (usually multi-resolution .ico) count as 48.
      const sizes = readAttribute(tag, "sizes").toLowerCase();
      const declared = /(\d+)x(\d+)/.exec(sizes);
      const size = declared ? Math.max(Number(declared[1]), Number(declared[2])) : sizes === "any" ? 512 : 48;
      try {
        links.push({ url: new URL(href, baseUrl), apple: rel.includes("apple"), size });
      } catch (_) {}
    }
    // Regular icons before apple-touch icons, and sharper icons first within each group,
    // so a 16x16 entry listed first in the page does not win over the real favicon.
    return links
      .sort((a, b) => Number(a.apple) - Number(b.apple) || b.size - a.size)
      .map((link) => link.url);
  }

  function findMetaRefresh(html, baseUrl) {
    const tagPattern = /<meta\b[^>]*>/gi;
    let match;
    while ((match = tagPattern.exec(html))) {
      const tag = match[0];
      if (readAttribute(tag, "http-equiv").toLowerCase() !== "refresh") continue;
      const target = /url\s*=\s*(.+)$/i.exec(readAttribute(tag, "content"));
      const value = target && target[1].replace(/^['"]|['"]$/g, "").trim();
      if (!value) continue;
      try {
        return new URL(value, baseUrl).href;
      } catch (_) {}
    }
    return null;
  }

  async function resolveFavicon(domain) {
    try {
      return await fetchIcon("https://" + domain + "/favicon.ico");
    } catch (_) {}
    // Some sites answer "/" with a tiny page that meta-refreshes elsewhere
    // (e.g. calendar.munetios.com -> /new), so follow a few of those hops.
    let pageUrl = "https://" + domain + "/";
    for (let hop = 0; hop <= MAX_META_REFRESHES && pageUrl; hop++) {
      const page = await fetchPublic(pageUrl, "text/html,*/*;q=0.5", MAX_HTML_BYTES, true);
      const html = page.body.toString("utf8");
      for (const iconUrl of findIconLinks(html, page.url)) {
        try {
          return await fetchIcon(iconUrl);
        } catch (_) {}
      }
      pageUrl = findMetaRefresh(html, page.url);
    }
    throw new Error("No favicon found");
  }

  /* ── In-memory cache (icon bytes only, expires by time) ── */
  const cache = new Map(); // domain -> { expires, icon | null }
  const pending = new Map(); // domain -> Promise

  let sweepAt = 0;

  function getFavicon(domain) {
    const now = Date.now();
    if (now >= sweepAt) {
      for (const [name, entry] of cache) if (entry.expires <= now) cache.delete(name);
      sweepAt = now + 10 * 60 * 1000;
    }
    const cached = cache.get(domain);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.icon);
    if (sharePending && pending.has(domain)) return pending.get(domain);
    const job = resolveFavicon(domain)
      .then((icon) => {
        cache.set(domain, { expires: Date.now() + CACHE_TTL_MS, icon });
        return icon;
      })
      .catch(() => {
        cache.set(domain, { expires: Date.now() + MISS_TTL_MS, icon: null });
        return null;
      })
      .finally(() => { if (sharePending) pending.delete(domain); });
    if (sharePending) pending.set(domain, job);
    return job;
  }

  function normalizeDomain(input) {
    if (typeof input !== "string" || !input || input.length > 2048) return null;
    let hostname;
    try {
      hostname = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : "https://" + input).hostname;
    } catch (_) {
      return null;
    }
    hostname = hostname.toLowerCase().replace(/\.$/, "");
    if (hostname.length > 253 || !hostname.includes(".")) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)) return null;
    if (net.isIP(hostname)) return null;
    return hostname;
  }

  /* ── Routes ── */
  return async function favicon(req, res) {
    const domain = normalizeDomain(req.query.domain);
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      // Proxied icons (SVG in particular) must never run scripts on this origin.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    if (!domain) return res.status(400).type("text/plain").send("Invalid domain");
    const icon = await getFavicon(domain);
    if (!icon) {
      res.set("Cache-Control", "public, max-age=600");
      return res.status(404).type("text/plain").send("Favicon not found");
    }
    res.set("Cache-Control", "public, max-age=86400");
    res.type(icon.type).send(icon.body);
  };
}

module.exports = { createFaviconRoute };
