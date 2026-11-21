(() => {
    "use strict";
    const $ = id => document.getElementById(id);
    const translations = window.MunetiosMailTranslations;
    const account = window.MunetiosAccount;
    let language;
    try { language = localStorage.getItem("munetiosLanguage") || navigator.language; } catch { language = navigator.language; }
    const base = language.split(/[-_]/)[0].toLowerCase();
    const locale = base === "es" ? (/^es[-_]es$/i.test(language) ? "es-ES" : "es-419")
        : base === "pt" ? (/^pt[-_]pt$/i.test(language) ? "pt-PT" : "pt-BR") : translations[base] ? base : "en";
    const t = key => translations[locale][key];
    document.documentElement.lang = locale;
    document.querySelectorAll("[data-label]").forEach(element => { element.textContent = t(element.dataset.label); });
    document.querySelectorAll("[data-label-aria]").forEach(element => { element.setAttribute("aria-label", t(element.dataset.labelAria)); });
    const status = $("mailStatus");
    const list = $("mailList");
    const form = $("composeForm");
    let folder = "inbox", next = null, selected = "", request = 0, opening = 0;
    const allowedElements = new Set(['a', 'b', 'blockquote', 'br', 'caption', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'hr', 'i', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul']);
    const discardedElements = new Set(['script', 'style', 'template', 'iframe', 'svg', 'math', 'object', 'embed', 'head', 'noscript']);
    const showImages = $('mailShowImages');
    let pendingImages = [];

    function messageContent(message) {
        const target = $('mailText');
        pendingImages = [];
        showImages.hidden = true;
        target.textContent = message.body || '';
        if (!message.html) return;
        const template = document.createElement('template');
        template.innerHTML = message.html;
        const clean = document.createDocumentFragment();
        const nodes = [...template.content.childNodes].reverse().map(node => [node, clean]);
        while (nodes.length) {
            const [node, parent] = nodes.pop();
            if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.data)); continue; }
            if (node.nodeType !== Node.ELEMENT_NODE || discardedElements.has(node.localName)) continue;
            if (node.localName === 'img') {
                try {
                    const url = new URL(node.getAttribute('src'));
                    if (url.protocol === 'https:' && !url.username && !url.password) {
                        const place = document.createComment('remote image');
                        parent.append(place);
                        pendingImages.push({ place, url: url.href, alt: node.getAttribute('alt') || '' });
                    }
                } catch {}
                continue;
            }
            let nextParent = parent;
            if (allowedElements.has(node.localName)) {
                nextParent = document.createElement(node.localName);
                if (node.localName === 'a') {
                    try {
                        const url = new URL(node.getAttribute('href'));
                        if (['https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password) {
                            nextParent.href = url.href;
                            nextParent.target = '_blank';
                            nextParent.rel = 'noopener noreferrer';
                        }
                    } catch {}
                }
                parent.append(nextParent);
            }
            for (let child = node.lastChild; child; child = child.previousSibling) nodes.push([child, nextParent]);
        }
        if (clean.textContent.trim() || pendingImages.length) target.replaceChildren(clean);
        showImages.hidden = !pendingImages.length;
    }
    showImages.addEventListener('click', () => {
        for (const { place, url, alt } of pendingImages) {
            const image = document.createElement('img');
            image.alt = alt;
            image.referrerPolicy = 'no-referrer';
            image.src = url;
            place.replaceWith(image);
        }
        pendingImages = [];
        showImages.hidden = true;
    });

    function signIn() { location.replace("/signin?continue=" + encodeURIComponent(location.pathname + location.search)); }
    function showStatus(label) {
        status.textContent = label ? t(label) : "";
        status.hidden = !label;
    }
    async function api(path, body) {
        const response = await fetch("/api/auth/mail" + path, {
            method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
            ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) {
                await account.refresh();
                if (!account.state.revocation && !account.state.account) signIn();
            }
            throw new Error(data.error || "unavailable");
        }
        return data;
    }
    async function openMessage(button, id) {
        const current = ++opening;
        try {
            const { message } = await api("/messages/" + encodeURIComponent(id));
            if (current !== opening) return;
            selected = id;
            list.querySelectorAll("button").forEach(item => { item.setAttribute("aria-pressed", String(item === button)); });
            $("mailSubject").textContent = message.subject || t("noSubject");
            $("mailMetadata").textContent = [message.sender + " → " + message.recipient, account.formatTime(message.createdAt)].join(" · ");
            messageContent(message);
            $("mailMessage").hidden = false;
        } catch { if (current === opening) showStatus("unavailable"); }
    }
    async function load(append = false) {
        const current = ++request;
        const before = append && next ? "&before=" + encodeURIComponent(next) : "";
        $("mailFolder").textContent = t(folder);
        $("mailRefresh").disabled = $("mailMore").disabled = true;
        try {
            const page = await api("/messages?folder=" + folder + before);
            if (current !== request) return;
            $("mailWorkspace").hidden = false;
            $('mailForwarding').hidden = !page.forwarding;
            $('mailForwardingAddress').textContent = page.forwarding ? page.email : '';
            showStatus("");
            if (!append) list.replaceChildren();
            for (const item of page.messages) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "mu-pick";
                button.setAttribute("aria-pressed", String(item.id === selected));
                const title = document.createElement("span");
                title.textContent = item.subject || t("noSubject");
                const detail = document.createElement("span");
                detail.className = "mu-muted";
                detail.textContent = folder === "inbox" ? item.sender : item.recipient;
                button.append(title, detail);
                button.addEventListener("click", () => openMessage(button, item.id));
                list.append(button);
            }
            next = page.next;
            $("mailMore").hidden = !next;
            $("mailEmpty").hidden = list.children.length > 0;
        } catch (error) {
            if (current === request) {
                if (error.message === "mailboxUnavailable") $("mailWorkspace").hidden = true;
                showStatus(error.message === "mailboxUnavailable" ? "mailboxUnavailable" : "unavailable");
            }
        } finally {
            if (current === request) $("mailRefresh").disabled = $("mailMore").disabled = false;
        }
    }
    function chooseFolder(nextFolder) {
        folder = nextFolder;
        selected = "";
        opening++;
        $("mailMessage").hidden = true;
        document.querySelectorAll("[data-folder]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.folder === folder));
        });
        return load();
    }
    document.querySelectorAll("[data-folder]").forEach(button => button.addEventListener("click", () => chooseFolder(button.dataset.folder)));
    $("mailRefresh").addEventListener("click", () => load());
    $("mailMore").addEventListener("click", () => load(true));
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const submit = event.submitter || form.querySelector('[type="submit"]');
        if (submit.disabled) return;
        submit.disabled = true;
        $("composeError").hidden = true;
        try {
            const result = await api("/send", Object.fromEntries(new FormData(form)));
            form.reset();
            window.MunetiosUI.closeModal("composeDialog");
            await chooseFolder("sent");
            showStatus(result.saved ? "sentNow" : "sentWithoutHistory");
        } catch {
            $("composeError").textContent = t("sendFailed");
            $("composeError").hidden = false;
        } finally { submit.disabled = false; }
    });
    account.on(state => {
        if (state.revocation) { $("mailWorkspace").hidden = true; return; }
        if (state.ready && !state.offline && !state.account) signIn();
    });
    showStatus("loading");
    load();
})();
