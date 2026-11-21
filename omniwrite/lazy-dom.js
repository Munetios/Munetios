/*
 * OmniWrite Lazy DOM
 *
 * Hidden pages and floating panels (inactive pages, dropdowns, the color
 * picker, the emoji picker, the virtual keyboard) are taken out of the live
 * DOM while they are hidden, so the browser doesn't spend style, layout and
 * memory work on them. A comment placeholder keeps their original spot.
 *
 * Existing code keeps working without changes:
 *   - document.getElementById / querySelector / querySelectorAll, and
 *     element.querySelector(All) / contains, also see parked elements.
 *   - Showing a parked element (class, style or hidden change through a held
 *     reference) puts it back before the next paint.
 *   - Layout reads restore panels only when they have been opened; inspecting
 *     a hidden element leaves the DOM unchanged. Focus and scroll actions can
 *     explicitly restore a parked element.
 *   - Elements are parked again once they have stayed hidden for a moment.
 *
 * Opt an element out with the attribute data-omni-keep-dom.
 * Call OmniLazyDom.show(el) to put an element back on purpose.
 *
 * Other apps (Ganetios) reuse this file by setting, before it loads:
 *   window.OmniLazyDomConfig = { candidates: [...selectors], parkInvisible: true }
 * parkInvisible also parks elements hidden with visibility:hidden.
 */
(function () {
    'use strict';
    if (window.OmniLazyDom) return;
    if (typeof MutationObserver !== 'function' || typeof DocumentFragment !== 'function') return;

    const config = window.OmniLazyDomConfig || {};
    // OmniWrite default. The editor page stays live: removing it would wipe its
    // undo history, selection and any playing media.
    const CANDIDATES = (Array.isArray(config.candidates) && config.candidates.length ? config.candidates : [
        '.page:not(#editorContent)',
        '.dropdown-wrapper',
        '.color-picker-wrapper',
        '#virtualKeyboardPanel',
        '#emojiPickerPanel'
    ]).join(',');
    const PARK_INVISIBLE = config.parkInvisible === true;
    const KEEP_ATTR = 'data-omni-keep-dom';
    const REPARK_DELAY_MS = 1200;

    const nativeGetById = Document.prototype.getElementById;
    const nativeDocQS = Document.prototype.querySelector;
    const nativeDocQSA = Document.prototype.querySelectorAll;
    const nativeElQS = Element.prototype.querySelector;
    const nativeElQSA = Element.prototype.querySelectorAll;
    const nativeContains = Node.prototype.contains;
    const nativeMatches = Element.prototype.matches;
    const nativeGetComputedStyle = window.getComputedStyle;

    /** root -> { ph: Comment, frag: DocumentFragment } */
    const parked = new Map();
    /** Roots under management, parked or live. */
    const managed = new Set();

    let sweepTimer = 0;
    let sweepIdle = 0;
    let ready = false;

    const escapeId = (id) => (window.CSS && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/["\\#.:\[\]()>+~*^$|=\s]/g, '\\$&'));

    function forget(root) {
        const rec = parked.get(root);
        if (!rec) return;
        parked.delete(root);
        if (rec.ph.parentNode) rec.ph.parentNode.removeChild(rec.ph);
        if (!root.isConnected) managed.delete(root);
    }

    /** Drops records for roots the app removed or moved while parked. */
    function isStillParked(root) {
        const rec = parked.get(root);
        if (!rec) return false;
        if (root.parentNode !== rec.frag) { forget(root); return false; }
        return true;
    }

    /** The innermost parked root that holds node (node itself counts). */
    function parkedRootOf(node) {
        let n = node;
        while (n) {
            if (parked.has(n)) return isStillParked(n) ? n : null;
            n = n.parentNode;
        }
        return null;
    }

    function isInScope(scope, node) {
        return scope === document ? node.isConnected : nativeContains.call(scope, node);
    }

    /** Parked roots whose placeholder sits directly inside scope. */
    function parkedRootsWithin(scope) {
        const out = [];
        for (const root of Array.from(parked.keys())) {
            if (!isStillParked(root)) continue;
            if (isInScope(scope, parked.get(root).ph)) out.push(root);
        }
        return out;
    }

    function park(root) {
        if (parked.has(root) || !root.isConnected || !root.parentNode) return;
        if (root.hasAttribute(KEEP_ATTR)) return;
        const active = document.activeElement;
        if (active && active !== document.body && nativeContains.call(root, active)) return;
        const label = root.id || (typeof root.className === 'string' ? root.className.split(/\s+/)[0] : '') || root.localName;
        const ph = document.createComment(' omni-lazy: ' + label + ' ');
        const frag = document.createDocumentFragment();
        root.parentNode.replaceChild(ph, root);
        frag.appendChild(root);
        parked.set(root, {
            ph, frag,
            className: root.getAttribute('class'),
            display: root.style.display,
            visibility: root.style.visibility
        });
    }

    function unpark(root) {
        if (!isStillParked(root)) return false;
        const rec = parked.get(root);
        if (!rec.ph.parentNode) { forget(root); return false; }
        parked.delete(root);
        rec.ph.parentNode.replaceChild(root, rec.ph);
        scheduleSweep();
        return true;
    }

    /** Puts node (and any parked ancestors) back into the live DOM. */
    function ensureLive(node) {
        if (!node || node.isConnected || !parked.size) return !!(node && node.isConnected);
        let root = parkedRootOf(node);
        while (root) {
            if (!unpark(root)) break;
            if (node.isConnected) return true;
            root = parkedRootOf(node);
        }
        return node.isConnected;
    }

    function ensureVisibleForLayout(node) {
        if (!node || node.isConnected || !parked.size) return !!node?.isConnected;
        let root = parkedRootOf(node);
        while (root) {
            const rec = parked.get(root);
            const style = nativeGetComputedStyle.call(window, root);
            if (root.hidden || style.display === 'none' || (PARK_INVISIBLE && style.visibility === 'hidden')) return false;
            if (root.style.display === 'none' || (PARK_INVISIBLE && root.style.visibility === 'hidden')) return false;
            // Detached elements can have an empty computed style. A panel
            // that has not changed its visibility signals is still closed.
            if (!style.display && root.getAttribute('class') === rec.className && root.style.display === rec.display && root.style.visibility === rec.visibility) return false;
            root = parkedRootOf(rec.ph);
        }
        return ensureLive(node);
    }

    function isHidden(el) {
        if (el.hidden) return true;
        const style = window.getComputedStyle(el);
        if (style.display === 'none') return true;
        return PARK_INVISIBLE && style.visibility === 'hidden';
    }

    // ---- Show detection through held references ----------------------------

    const displayFrom = (styleText) => {
        const m = /(?:^|;)\s*display\s*:\s*([^;!]+)/i.exec(styleText || '');
        return m ? m[1].trim().toLowerCase() : '';
    };

    const attrObserver = new MutationObserver((records) => {
        let touchedLive = false;
        for (const rec of records) {
            const root = rec.target;
            if (!parked.has(root)) { touchedLive = true; continue; }
            let mayShow = false;
            if (rec.attributeName === 'class') {
                mayShow = rec.oldValue !== root.getAttribute('class');
            } else if (rec.attributeName === 'hidden') {
                mayShow = !root.hidden;
            } else if (rec.attributeName === 'style') {
                const now = (root.style.display || '').toLowerCase();
                mayShow = now !== 'none' && now !== displayFrom(rec.oldValue);
            }
            if (mayShow) unpark(root);
        }
        if (touchedLive) scheduleSweep();
    });

    function manage(root) {
        if (managed.has(root)) return;
        managed.add(root);
        attrObserver.observe(root, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden'] });
    }

    // ---- Parking sweep ------------------------------------------------------

    function sweep() {
        sweepTimer = 0;
        sweepIdle = 0;
        nativeDocQSA.call(document, CANDIDATES).forEach(manage);
        for (const root of Array.from(managed)) {
            if (parked.has(root)) { isStillParked(root); continue; }
            if (!root.isConnected) { managed.delete(root); continue; }
            if (isHidden(root)) park(root);
        }
    }

    function scheduleSweep() {
        if (!ready || sweepTimer || sweepIdle) return;
        sweepTimer = setTimeout(() => {
            sweepTimer = 0;
            if (typeof window.requestIdleCallback === 'function') {
                sweepIdle = window.requestIdleCallback(sweep, { timeout: 2000 });
            } else {
                sweep();
            }
        }, REPARK_DELAY_MS);
    }

    // ---- Lookup patches -----------------------------------------------------

    function withItem(list) {
        Object.defineProperty(list, 'item', { value: (i) => list[i] || null, enumerable: false });
        return list;
    }

    /** Where node sits relative to scope, for ordering merged results. */
    function anchorIn(scope, node) {
        let n = node;
        while (!isInScope(scope, n)) {
            const root = parkedRootOf(n);
            if (!root) break;
            n = parked.get(root).ph;
        }
        return n;
    }

    function queryAllWithParked(scope, selector, nativeResult) {
        if (!parked.size) return nativeResult;
        const extra = [];
        for (const root of parkedRootsWithin(scope)) {
            if (nativeMatches.call(root, selector)) extra.push(root);
            const inner = Element.prototype.querySelectorAll.call(root, selector);
            for (let i = 0; i < inner.length; i++) extra.push(inner[i]);
        }
        if (!extra.length) return nativeResult;
        const all = Array.prototype.slice.call(nativeResult).concat(extra);
        const anchors = new Map(all.map((n) => [n, anchorIn(scope, n)]));
        all.sort((a, b) => {
            const aa = anchors.get(a), bb = anchors.get(b);
            if (aa === bb) return 0;
            return aa.compareDocumentPosition(bb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });
        return withItem(all);
    }

    function queryOneWithParked(scope, selector) {
        for (const root of parkedRootsWithin(scope)) {
            if (nativeMatches.call(root, selector)) return root;
            const hit = Element.prototype.querySelector.call(root, selector);
            if (hit) return hit;
        }
        return null;
    }

    const idCache = new Map();

    Document.prototype.getElementById = function (id) {
        const el = nativeGetById.call(this, id);
        if (el || this !== document || !parked.size) return el;
        const cached = idCache.get(id);
        if (cached && cached.id === id && parkedRootOf(cached)) return cached;
        idCache.delete(id);
        const found = queryOneWithParked(document, '#' + escapeId(id));
        if (found) idCache.set(id, found);
        return found;
    };

    Document.prototype.querySelector = function (selector) {
        const el = nativeDocQS.call(this, selector);
        if (el || this !== document || !parked.size) return el;
        return queryOneWithParked(document, selector);
    };

    Document.prototype.querySelectorAll = function (selector) {
        const list = nativeDocQSA.call(this, selector);
        if (this !== document) return list;
        return queryAllWithParked(document, selector, list);
    };

    Element.prototype.querySelector = function (selector) {
        const el = nativeElQS.call(this, selector);
        if (el || !parked.size) return el;
        return queryOneWithParked(this, selector);
    };

    Element.prototype.querySelectorAll = function (selector) {
        return queryAllWithParked(this, selector, nativeElQSA.call(this, selector));
    };

    Node.prototype.contains = function (other) {
        if (nativeContains.call(this, other)) return true;
        if (!other || !parked.size) return false;
        const root = parkedRootOf(other);
        if (!root || root === this) return false;
        return this.contains(parked.get(root).ph);
    };

    // ---- Layout and focus put elements back first ---------------------------

    function wrapMethod(proto, name, restore = ensureLive) {
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        if (!desc || typeof desc.value !== 'function') return;
        const original = desc.value;
        Object.defineProperty(proto, name, Object.assign({}, desc, {
            value: function () {
                if (parked.size && !this.isConnected) restore(this);
                return original.apply(this, arguments);
            }
        }));
    }

    function wrapGetter(proto, name) {
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        if (!desc || typeof desc.get !== 'function') return;
        const original = desc.get;
        Object.defineProperty(proto, name, Object.assign({}, desc, {
            get: function () {
                if (parked.size && !this.isConnected) ensureVisibleForLayout(this);
                return original.call(this);
            }
        }));
    }

    ['getBoundingClientRect', 'getClientRects']
        .forEach((name) => wrapMethod(Element.prototype, name, ensureVisibleForLayout));
    ['scrollIntoView', 'scrollTo', 'scrollBy', 'requestFullscreen']
        .forEach((name) => wrapMethod(Element.prototype, name));
    ['clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft']
        .forEach((name) => wrapGetter(Element.prototype, name));
    ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent']
        .forEach((name) => wrapGetter(HTMLElement.prototype, name));
    wrapMethod(HTMLElement.prototype, 'focus');

    window.getComputedStyle = function (el) {
        if (parked.size && el && el.nodeType === 1 && !el.isConnected) ensureVisibleForLayout(el);
        return nativeGetComputedStyle.apply(window, arguments);
    };

    // ---- Start --------------------------------------------------------------

    function start() {
        if (ready) return;
        ready = true;
        sweep();
    }

    if (document.readyState === 'complete') {
        setTimeout(start, 0);
    } else {
        window.addEventListener('load', () => setTimeout(start, 0), { once: true });
    }

    window.OmniLazyDom = Object.freeze({
        /** Puts an element (or the parked page/panel holding it) back into the DOM. */
        show: (el) => ensureLive(el),
        /** Parks hidden managed elements right away. */
        sweep: () => { if (ready) sweep(); },
        /** True while el is parked outside the DOM. */
        isParked: (el) => !!parkedRootOf(el),
        get parkedCount() { return parked.size; }
    });
})();
