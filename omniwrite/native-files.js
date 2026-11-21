(function () {
    'use strict';

    const formats = {
        mwrite: 'application/vnd.munetios.mwrite+json',
        msheet: 'application/vnd.munetios.msheet+json'
    };
    const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
    function encode(format, data) {
        return new Blob([JSON.stringify({ format, version: 1, data })], { type: formats[format] });
    }
    async function read(file, format) {
        const parsed = JSON.parse(await file.text());
        if (!isRecord(parsed) || parsed.format !== format || parsed.version !== 1 || !isRecord(parsed.data)) {
            throw new Error('Unsupported Munetios file format');
        }
        return parsed.data;
    }
    function download(blob, title, extension) {
        const name = String(title || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().replace(/\.+$/, '') || extension;
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = name + '.' + extension;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const tags = new Set('a abbr audio b blockquote br caption cite code col colgroup dd del details div dl dt em figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s samp section small source span strike strong sub summary sup table tbody td tfoot th thead tr u ul var video munetios-youtube-player'.split(' '));
    const discard = new Set('base button embed form iframe input link math meta object script select style svg template textarea'.split(' '));
    const attributes = new Set('abbr align alt cite colspan controls dir download face height lang loop muted reversed rowspan scope size span start title type value width video-id video-title'.split(' '));
    const safeClasses = new Set(['omniwrite-page', 'omni-native-video', 'imported-pdf-document']);
    const styleProperties = new Set('background-color border border-bottom border-bottom-color border-bottom-style border-bottom-width border-collapse border-color border-left border-left-color border-left-style border-left-width border-radius border-right border-right-color border-right-style border-right-width border-spacing border-style border-top border-top-color border-top-style border-top-width border-width color display float font font-family font-feature-settings font-size font-style font-variant font-variation-settings font-weight height letter-spacing line-height list-style-type margin margin-bottom margin-left margin-right margin-top max-height max-width min-height min-width padding padding-bottom padding-left padding-right padding-top text-align text-decoration text-decoration-color text-decoration-line text-indent text-transform vertical-align white-space width word-break overflow-wrap'.split(' '));

    function safeDocumentUrl(value, tag, attr) {
        const url = String(value || '').trim();
        if (attr === 'href') return /^#[\w.-]+$|^(https?:\/\/|mailto:|tel:)|^data:application\/pdf;base64,[a-z0-9+/=]+$/i.test(url);
        if (/^https?:\/\//i.test(url)) return true;
        const media = tag === 'img' || attr === 'poster' ? /^(?:png|jpe?g|gif|webp|avif|bmp|x-icon)$/i : null;
        const match = /^data:(image|video|audio)\/([\w.+-]+);base64,[a-z0-9+/=]+$/i.exec(url);
        if (!match) return false;
        const category = match[1].toLowerCase();
        return media ? category === 'image' && media.test(match[2]) : category === tag || (tag === 'source' && category !== 'image');
    }

    function sanitizeDocumentHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = window.MunetiosYouTube?.prepareHTML(html) ?? html;
        for (const node of template.content.querySelectorAll('*')) {
            const tag = node.localName;
            if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || discard.has(tag)) { node.remove(); continue; }
            if (!tags.has(tag)) { node.replaceWith(...node.childNodes); continue; }
            const styles = Array.from(node.style).filter(property => styleProperties.has(property))
                .map(property => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
            const background = node.style.getPropertyValue('background-color');
            if (background && !styles.some(([property]) => property === 'background-color')) {
                styles.push(['background-color', background, node.style.getPropertyPriority('background-color')]);
            }
            for (const { name, value } of [...node.attributes]) {
                if ((name === 'href' && tag === 'a') ||
                    (name === 'src' && ['img', 'audio', 'video', 'source'].includes(tag)) ||
                    (name === 'poster' && tag === 'video')) {
                    if (!safeDocumentUrl(value, tag, name)) node.removeAttribute(name);
                } else if (name === 'class') {
                    const classes = value.split(/\s+/).filter(item => safeClasses.has(item));
                    if (classes.length) node.className = classes.join(' '); else node.removeAttribute(name);
                } else if (!(attributes.has(name) || (name === 'data-page-index' && tag === 'section' && /^\d+$/.test(value)))) {
                    node.removeAttribute(name);
                }
            }
            for (const [property, value, priority] of styles) node.style.setProperty(property, value, priority);
            if (tag === 'a') node.rel = 'noopener noreferrer';
            if (tag === 'img') node.loading = 'lazy';
            if (tag === 'audio' || tag === 'video') { node.controls = true; node.preload = 'metadata'; }
        }
        return template.innerHTML;
    }

    function documentData(data) {
        if (typeof data.title !== 'string' || typeof data.content !== 'string') throw new Error('Invalid document file');
        const doc = { title: data.title, content: sanitizeDocumentHtml(data.content) };
        for (const key of ['headerHtml', 'footerHtml']) {
            if (typeof data[key] === 'string') doc[key] = sanitizeDocumentHtml(data[key]);
        }
        if (typeof data.headersFootersEnabled === 'boolean') doc.headersFootersEnabled = data.headersFootersEnabled;
        for (const key of ['language', 'watermarkText']) if (typeof data[key] === 'string') doc[key] = data[key];
        if (Number.isFinite(data.zoomPercent)) doc.zoomPercent = data.zoomPercent;
        return doc;
    }

    window.OmniNativeFiles = { isRecord, encode, read, download, documentData };
})();
