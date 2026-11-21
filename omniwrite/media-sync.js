(() => {
  'use strict';
  const CHUNK = 2 * 1024 * 1024;
  const PREFIX = 'omniwrite-media:';
  const kinds = { image: 'images', video: 'videos', audio: 'audios' };
  const validId = value => /^[a-f0-9]{32}$/.test(value || '');
  const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('mediaStorageFailed')); });
  function base64(bytes) { let out = ''; for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(out); }
  function bytes(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
  function metadata(data) { return { kind: data.kind, syncId: data.syncId, index: data.index, total: data.total, size: data.size, type: data.type, name: data.name, workspaceId: data.workspaceId, created: data.created }; }
  const itemKey = data => `${PREFIX}${data.kind}:${data.syncId}:${data.index}`;
  function walk(value, transform) {
    if (typeof value === 'string') return /<(?:img|video|audio)\b/i.test(value) ? transform(value) : value;
    if (Array.isArray(value)) return value.map(item => walk(item, transform));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, transform)]));
    return value;
  }
  function create({ getDB, getAccount }) {
    let chunkDB;
    let assets = new Map(), allAssets = new Map();
    async function chunks() {
      if (!chunkDB) chunkDB = new Promise((resolve, reject) => {
        const req = indexedDB.open('omniwrite-sync-media-v1', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('chunks', { keyPath: 'key' });
        req.onsuccess = () => resolve(req.result); req.onerror = () => { chunkDB = null; reject(req.error); };
        req.onblocked = () => { chunkDB = null; reject(new Error('mediaStorageBlocked')); };
      });
      return chunkDB;
    }
    async function records(kind) {
      const db = getDB();
      if (!db?.objectStoreNames.contains(kinds[kind])) return [];
      return request(db.transaction(kinds[kind]).objectStore(kinds[kind]).getAll());
    }
    async function refreshAssets() {
      const account = getAccount(); if (!account) return;
      const next = new Map(), all = new Map();
      for (const kind of Object.keys(kinds)) {
        const db = getDB();
        for (const record of await records(kind)) {
          if (!(record.file instanceof Blob)) continue;
          if (record.syncOwner && record.syncOwner !== account.id) { if (validId(record.syncId)) all.set(`${kind}:${record.syncId}`, { kind, record }); continue; }
          if (!validId(record.syncId) || !record.syncOwner) {
            const tx = db.transaction(kinds[kind], 'readwrite'), completion = done(tx), store = tx.objectStore(kinds[kind]);
            const current = await request(store.get(record.id));
            if (!current || (current.syncOwner && current.syncOwner !== account.id)) { await completion; continue; }
            current.syncId = validId(current.syncId) ? current.syncId : crypto.randomUUID().replaceAll('-', ''); current.syncOwner = account.id;
            store.put(current); await completion; Object.assign(record, current);
          }
          next.set(`${kind}:${record.syncId}`, { kind, record });
          all.set(`${kind}:${record.syncId}`, { kind, record });
        }
      }
      assets = next; allAssets = all;
    }
    function describe(asset, index) {
      const file = asset.record.file;
      return { kind: asset.kind, syncId: asset.record.syncId, index, total: Math.max(1, Math.ceil(file.size / CHUNK)), size: file.size, type: file.type || '', name: file.name || asset.record.name || asset.kind, workspaceId: asset.record.workspaceId || 'workspace-personal', created: Number(asset.record.created) || 0 };
    }
    function transformDocument(doc, importing) {
      return walk(doc, html => {
        const template = document.createElement('template'); template.innerHTML = html;
        for (const kind of Object.keys(kinds)) {
          const idAttr = `data-omniwrite-${kind}-id`, syncAttr = `data-omniwrite-${kind}-sync-id`;
          for (const node of template.content.querySelectorAll(`${kind === 'image' ? 'img' : kind}[${idAttr}],${kind === 'image' ? 'img' : kind}[${syncAttr}]`)) {
            let asset;
            if (importing) asset = assets.get(`${kind}:${node.getAttribute(syncAttr)}`);
            else asset = [...allAssets.values()].find(value => value.kind === kind && String(value.record.id) === node.getAttribute(idAttr)) || allAssets.get(`${kind}:${node.getAttribute(syncAttr)}`);
            if (!asset) {
              node.removeAttribute(idAttr);
              continue;
            }
            node.setAttribute(syncAttr, asset.record.syncId);
            if (importing) node.setAttribute(idAttr, asset.record.id); else node.removeAttribute(idAttr);
            node.removeAttribute('src');
            node.querySelectorAll('source').forEach(source => { if (/^blob:/i.test(source.getAttribute('src') || '')) source.removeAttribute('src'); });
          }
        }
        return template.innerHTML;
      });
    }
    const provider = {
      id: 'omniwrite-media', prefix: PREFIX, preserveLocal: true, retainMissing: true, paginated: true, batchSize: 1,
      hash: data => JSON.stringify(metadata(data)),
      async snapshot() {
        await refreshAssets(); const items = [];
        for (const asset of assets.values()) {
          const total = Math.max(1, Math.ceil(asset.record.file.size / CHUNK));
          for (let index = 0; index < total; index++) { const data = describe(asset, index); items.push({ key: itemKey(data), data, updatedAt: 0 }); }
        }
        return items;
      },
      async loadItem(data) {
        const asset = assets.get(`${data.kind}:${data.syncId}`);
        if (!asset) throw new Error('mediaNotAvailable');
        return { ...data, bytes: base64(new Uint8Array(await asset.record.file.slice(data.index * CHUNK, (data.index + 1) * CHUNK).arrayBuffer())) };
      },
      async apply(items) {
        const account = getAccount(); if (!account) throw new Error('signedOut');
        const storage = await chunks(); let changed = false; const pending = new Map();
        for (const item of items) {
          if (item.deleted) continue;
          const data = item.data;
          if (!data || !kinds[data.kind] || !validId(data.syncId) || !Number.isSafeInteger(data.size) || data.size < 0 || !Number.isSafeInteger(data.index) || data.index < 0 || data.total !== Math.max(1, Math.ceil(data.size / CHUNK)) || data.index >= data.total || typeof data.bytes !== 'string' || data.bytes.length > Math.ceil(CHUNK / 3) * 4 || typeof data.type !== 'string' || typeof data.name !== 'string' || item.key !== itemKey(data)) throw new Error('invalidMedia');
          const content = bytes(data.bytes);
          if (content.length !== Math.min(CHUNK, data.size - data.index * CHUNK)) throw new Error('invalidMedia');
          const tx = storage.transaction('chunks', 'readwrite'), completion = done(tx);
          tx.objectStore('chunks').put({ key: `${account.id}:${item.key}`, ...metadata(data), file: new Blob([content]) }); await completion;
          pending.set(`${data.kind}:${data.syncId}`, data);
        }
        for (const [identity, data] of pending) {
          const parts = [], tx = storage.transaction('chunks'), store = tx.objectStore('chunks');
          const reads = Array.from({ length: data.total }, (_, index) => request(store.get(`${account.id}:${itemKey({ ...data, index })}`)));
          for (const part of await Promise.all(reads)) {
            if (!part || part.kind !== data.kind || part.syncId !== data.syncId || part.size !== data.size || part.total !== data.total || part.type !== data.type || part.name !== data.name || part.workspaceId !== data.workspaceId || part.created !== data.created) break;
            parts.push(part.file);
          }
          if (parts.length !== data.total) continue;
          const file = new File(parts, data.name, { type: data.type });
          const db = getDB(), existing = (await records(data.kind)).find(record => record.syncId === data.syncId && record.syncOwner === account.id);
          const write = db.transaction(kinds[data.kind], 'readwrite'), completion = done(write);
          const record = { ...(existing || {}), file, name: data.name, type: data.type, created: Number(data.created) || 0, workspaceId: data.workspaceId || 'workspace-personal', syncId: data.syncId, syncOwner: account.id };
          const nativeId = await request(write.objectStore(kinds[data.kind]).put(record)); await completion; record.id = nativeId;
          assets.set(identity, { kind: data.kind, record }); changed = true;
          const clear = storage.transaction('chunks', 'readwrite'), cleared = done(clear);
          for (let index = 0; index < data.total; index++) clear.objectStore('chunks').delete(`${account.id}:${itemKey({ ...data, index })}`);
          await cleared;
        }
        if (changed) document.dispatchEvent(new CustomEvent('omniwrite-media-synced'));
        return changed;
      }
    };
    return {
      provider,
      async exportDocument(doc) { return transformDocument(doc, false); },
      async importDocument(doc) { await refreshAssets(); return transformDocument(doc, true); },
      canPush(doc, syncItems) {
        let ready = true;
        walk(doc, html => {
          const template = document.createElement('template'); template.innerHTML = html;
          for (const kind of Object.keys(kinds)) for (const node of template.content.querySelectorAll(`[data-omniwrite-${kind}-sync-id]`)) {
            const asset = assets.get(`${kind}:${node.getAttribute(`data-omniwrite-${kind}-sync-id`)}`);
            if (!asset) continue;
            for (let index = 0, total = describe(asset, 0).total; index < total; index++) { const data = describe(asset, index); if (syncItems[itemKey(data)]?.h !== provider.hash(data)) ready = false; }
          }
          return html;
        });
        return ready;
      }
    };
  }
  window.OmniWriteMediaSync = { create };
})();
