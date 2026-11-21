(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const t = key => window.getTranslation(key);
  const searchInput = byId('searchInput');
  const filters = byId('ganetiosSearchFilters');
  const filterToggle = byId('ganetiosFilterToggle');
  const exact = byId('ganetiosExact');
  const site = byId('ganetiosSite');
  const file = byId('ganetiosFile');
  const clear = byId('clearGanetiosQuery');
  const share = byId('ganetiosCopySearch');
  const save = byId('ganetiosSaveSearch');
  const searchRoutes = {
    '/': 'searchInput',
    '/images': 'searchInput',
    '/videos': 'videoSearchInput',
    '/maps': 'mapSearchInput',
    '/news': 'newsSearchInput',
    '/wiki': 'wikiSearchInput',
    '/books': 'booksSearchInput'
  };
  let currentRoute = location.hash;
  let measurementStart;
  let measuring = false;
  let map;
  let restoring = false;
  const previousViews = [];
  const measurementSource = 'ganetios-distance';
  const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), document.documentElement.lang);
  const path = hash => hash.slice(1).split('?')[0] || '/';

  function iconButton(symbol, key, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mu-icon-btn';
    button.dataset.translateTitle = key;
    button.setAttribute('aria-label', t(key));
    button.title = t(key);
    const icon = document.createElement('span');
    icon.className = 'mu-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = symbol;
    button.append(icon);
    button.addEventListener('click', onClick);
    return button;
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      window.showToast(t('gtCopied'));
    } catch {
      window.prompt(t('gtCopyManually'), value);
    }
  }

  function searchQuery(raw) {
    if (!raw) return raw;
    const parts = [exact.checked ? `"${raw.replace(/["“”]/g, '')}"` : raw];
    const domain = site.value.trim();
    const format = file.value.trim().replace(/^\./, '');
    site.setCustomValidity('');
    file.setCustomValidity('');
    if (domain) {
      try {
        const url = new URL(/^https?:\/\//i.test(domain) ? domain : 'https://' + domain);
        if (!url.hostname.includes('.') || url.username || url.password || /\s/u.test(domain)) throw new Error('Domain');
        parts.push('site:' + url.hostname);
      } catch {
        setFilterVisibility(true);
        site.setCustomValidity(t('gtInvalid'));
        site.reportValidity();
        return null;
      }
    }
    if (format) {
      if (!/^[a-z0-9]+$/i.test(format)) {
        setFilterVisibility(true);
        file.setCustomValidity(t('gtInvalid'));
        file.reportValidity();
        return null;
      }
      parts.push('filetype:' + format.toLowerCase());
    }
    return parts.join(' ');
  }

  function setFilterVisibility(visible) {
    filters.hidden = !visible;
    filterToggle.setAttribute('aria-expanded', String(visible));
  }

  function syncSearchActions() {
    clear.hidden = !searchInput.value;
    save.hidden = location.hash === '#incognito';
  }

  function queryLink(query) {
    const url = new URL(location.pathname, location.origin);
    const mode = path(location.hash);
    url.hash = `${mode === '/images' ? '/images' : '/'}?${new URLSearchParams({ q: query })}`;
    return url.href;
  }

  function shareOrSave(isSave) {
    const raw = searchInput.value.trim();
    if (!raw) {
      window.showToast(t('pleaseEnterQuery'));
      searchInput.focus();
      return;
    }
    const query = searchQuery(raw);
    if (!query) return;
    const link = queryLink(query);
    if (isSave) {
      if (location.hash !== '#incognito') window.addBookmark({ title: query, link, description: t('navSearch'), favicon: '' });
    } else copy(link);
  }

  function syncRoute(initial = false) {
    const hash = location.hash;
    const route = path(hash);
    const previousRoute = path(currentRoute);
    const query = new URLSearchParams(hash.split('?')[1]).get('q');
    if (route === '/' || route === '/images') {
      if (query !== null) {
        searchInput.value = query;
        exact.checked = false;
        site.value = '';
        file.value = '';
      }
    } else if (route !== previousRoute && ['/','/images'].includes(previousRoute) && !initial) {
      const target = byId(searchRoutes[route]);
      const text = searchInput.value.trim();
      if (text && target && !target.value) {
        target.value = text;
        if (route === '/videos') target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    currentRoute = hash;
    syncSearchActions();
    if (route === '/maps') applyMapLink();
    else if (measuring) setMeasuring(false);
  }

  function filterWiki() {
    const container = byId('ganetiosWikiRefine');
    if (!container) return;
    const rows = Array.from(byId('wikiResults').querySelectorAll('.wiki-item'));
    container.hidden = !rows.length;
    const query = byId('ganetiosWikiFilter').value.trim().toLocaleLowerCase(document.documentElement.lang);
    let matches = 0;
    for (const row of rows) {
      row.hidden = !['.wiki-item-title', '.wiki-item-extract'].some(selector =>
        row.querySelector(selector).textContent.toLocaleLowerCase(document.documentElement.lang).includes(query));
      if (!row.hidden) matches++;
    }
    byId('ganetiosWikiNoMatches').hidden = matches > 0 || !rows.length;
  }

  function addCopyButton(actions, url) {
    actions.append(iconButton('content_copy', 'gfCopyLink', () => copy(url)));
  }

  function addVideoBookmark(actions, video) {
    actions.append(iconButton('bookmark_add', 'bookmarkLocation', () => {
      const link = 'https://www.youtube.com/watch?v=' + encodeURIComponent(video.id);
      window.addBookmark({ title: video.title, description: video.description, link, favicon: '' });
    }));
  }

  const wrap = lng => ((lng % 360 + 540) % 360) - 180;
  const fixed = (number, digits = 5) => String(Number(number.toFixed(digits)));

  function coordinates(value) {
    const normalized = value.trim().replace(/[−٫،]/g, character => ({ '−': '-', '٫': '.', '،': ',' }[character]));
    const number = '[+-]?(?:\\d+\\.?(?:\\d+)?|\\.\\d+)';
    const commaDecimal = number.replaceAll('\\.', '[.,]');
    const match = normalized.match(new RegExp(`^(${number})\\s*,\\s*(${number})$`)) ||
      normalized.match(new RegExp(`^(${commaDecimal})(?:\\s*;\\s*|\\s+)(${commaDecimal})$`));
    if (!match) return null;
    const [lat, lng] = match.slice(1).map(part => Number(part.replace(',', '.')));
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }

  function goToCoordinates(text) {
    const center = coordinates(text);
    if (!map || !center) return false;
    map.jumpTo({ center, zoom: Math.max(map.getZoom(), 13) });
    return true;
  }

  function camera() {
    const { lat, lng } = map.getCenter();
    return { center: [wrap(lng), lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }

  function coordinateText() {
    const [lng, lat] = camera().center;
    return `${fixed(lat)}, ${fixed(lng)}`;
  }

  function readMapLink() {
    const params = new URLSearchParams(location.hash.split('?')[1]);
    const center = coordinates(`${params.get('lat')}, ${params.get('lng')}`);
    const zoom = Number(params.get('z'));
    const bearing = Number(params.get('b'));
    const pitch = Number(params.get('p'));
    if (!center || !params.has('z') || !Number.isFinite(zoom) || zoom < 0 || zoom > 22) return null;
    return { center, zoom, bearing: Number.isFinite(bearing) ? bearing : 0, pitch: Number.isFinite(pitch) ? pitch : 0 };
  }

  function applyMapLink() {
    if (!map) return;
    const options = readMapLink();
    if (options) map.jumpTo(options);
  }

  function shareMap() {
    const { center: [lng, lat], zoom, bearing, pitch } = camera();
    const params = new URLSearchParams({ lat: fixed(lat), lng: fixed(lng), z: fixed(zoom, 2) });
    if (bearing) params.set('b', fixed(bearing, 1));
    if (pitch) params.set('p', fixed(pitch, 1));
    const url = new URL(location.pathname, location.origin);
    url.hash = '/maps?' + params;
    copy(url.href);
  }

  function showMeasurement(key, text) {
    const output = byId('ganetiosMapReadout');
    output.hidden = !key && !text;
    output.textContent = key ? t(key) : (text || '');
    if (key) output.dataset.translate = key;
    else delete output.dataset.translate;
  }

  function setMeasuring(enabled) {
    measuring = enabled;
    measurementStart = undefined;
    byId('ganetiosMeasure').setAttribute('aria-pressed', String(enabled));
    map.getCanvas().style.cursor = enabled ? 'crosshair' : '';
    map.getSource(measurementSource)?.setData({ type: 'FeatureCollection', features: [] });
    showMeasurement(enabled ? 'gfMeasureStart' : '');
  }

  function measure(point) {
    if (!measuring) return;
    if (!measurementStart) {
      measurementStart = point;
      map.getSource(measurementSource)?.setData({ type: 'FeatureCollection', features: [] });
      showMeasurement('gfMeasureEnd');
      return;
    }
    const a = measurementStart;
    const b = point;
    const length = a.distanceTo(b);
    const unit = length < 1000 ? 'meter' : 'kilometer';
    const formatted = new Intl.NumberFormat(document.documentElement.lang, {
      style: 'unit', unit, maximumFractionDigits: 2
    }).format(unit === 'meter' ? length : length / 1000);
    const longitude = a.lng + wrap(b.lng - a.lng);
    ensureMeasurementLayer();
    map.getSource(measurementSource)?.setData({
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [longitude, b.lat]] }
    });
    measurementStart = undefined;
    showMeasurement('', formatted);
  }

  function ensureMeasurementLayer() {
    if (map.getSource(measurementSource)) return;
    if (!map.isStyleLoaded()) return;
    map.addSource(measurementSource, {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: measurementSource, source: measurementSource, type: 'line',
      paint: { 'line-color': '#b886ff', 'line-width': 4 }
    });
  }

  function initMap(instance) {
    map = instance;
    const controls = byId('ganetiosMapActions');
    if (!controls || controls.dataset.ready) return;
    controls.dataset.ready = 'true';
    const prev = byId('ganetiosPreviousMap');
    const text = byId('ganetiosCoordinateText');
    applyMapLink();
    let lastView = camera();
    text.textContent = coordinateText();
    if (window.maplibregl.ScaleControl) map.addControl(new window.maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('move', () => { text.textContent = coordinateText(); });
    map.on('moveend', () => {
      const view = camera();
      if (!restoring && JSON.stringify(view) !== JSON.stringify(lastView)) previousViews.push(lastView);
      lastView = view;
      prev.disabled = !previousViews.length;
    });
    map.on('click', event => measure(event.lngLat));
    map.on('style.load', () => {
      if (measuring) setMeasuring(true);
    });
    prev.addEventListener('click', () => {
      const view = previousViews.pop();
      if (!view) return;
      map.stop();
      restoring = true;
      try { map.jumpTo(view); }
      finally { restoring = false; }
      prev.disabled = !previousViews.length;
    });
    byId('ganetiosCoordinates').addEventListener('click', () => copy(coordinateText()));
    byId('ganetiosNorth').addEventListener('click', () => map.resetNorth());
    byId('ganetiosMeasure').addEventListener('click', () => setMeasuring(!measuring));
    byId('ganetiosShareMap').addEventListener('click', shareMap);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && measuring) setMeasuring(false);
    });
  }

  window.GanetiosFeatures = { searchQuery, coordinates, goToCoordinates, initMap, filterWiki, addCopyButton, addVideoBookmark, byTitle };
  window.addEventListener('hashchange', () => syncRoute());
  document.addEventListener('DOMContentLoaded', () => {
    if (window.mapInstance) initMap(window.mapInstance);
    syncRoute(true);
  });
  clear.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.focus();
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  searchInput.addEventListener('input', syncSearchActions);
  searchInput.addEventListener('focus', syncSearchActions);
  filterToggle.addEventListener('click', () => setFilterVisibility(filters.hidden));
  filters.addEventListener('input', event => event.target.setCustomValidity(''));
  filters.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      byId('doSearch').click();
    }
  });
  share.disabled = false;
  save.disabled = false;
  share.addEventListener('click', () => shareOrSave(false));
  save.addEventListener('click', () => shareOrSave(true));
  document.addEventListener('change', event => {
    if (event.target.id === 'ganetiosBookmarksSort') window.renderBookmarksPage?.();
    if (event.target.id === 'ganetiosVideoSort') window.munetiosVideos?.render(byId('videoSearchInput')?.value || '');
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'ganetiosWikiFilter') filterWiki();
  });
})();
