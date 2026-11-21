(() => {
    'use strict';
    const dictionaryUrl = new URL('spellcheck-en.txt', document.currentScript.src);
    const personalKey = 'omniwrite-personal-dictionary';
    const selector = '.document-page-editor, .split-editor';
    const tokenPattern = /[\p{L}\p{N}_]+(?:['’][\p{L}]+)*/gu;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const builtIn = ['a', 'i', 'munetios', 'omniwrite', "can't", "won't", "shan't", "ain't"];
    const excluded = 'a, code, pre, [contenteditable="false"]';
    const blockSelector = 'address, article, aside, blockquote, div, figcaption, h1, h2, h3, h4, h5, h6, li, p, section, td, th';
    const commonMisspellings = new Map(Object.entries({
        accomodate: 'accommodate', alot: 'a lot', becuase: 'because', definately: 'definitely',
        embarass: 'embarrass', occured: 'occurred', recieve: 'receive', seperate: 'separate',
        teh: 'the', thier: 'their', untill: 'until', wierd: 'weird'
    }));
    const grammarRules = [
        // Keep the first word and its formatting. Delete the repeated word and preceding space.
        [/\b(the|a|an)[ \t]+(\1)\b/dgi, 2, '', true],
        [/\b(?:could|should|would|might|must)[ \t]+(of)\b/dgi, 1, 'have'],
        [/\bI[ \t]+(is|are)\b/dgi, 1, 'am'],
        [/\b(?:he|she|it)[ \t]+(are|am)\b/dgi, 1, 'is'],
        [/\b(?:you|we|they)[ \t]+(is|am)\b/dgi, 1, 'are'],
        [/(?<![\p{L}\p{N}_./-])(i)(?=[ \t]+(?:am|was|have|had|will|would|can|could|should|must|think|feel|want|need)\b|['’](?:m|ve|ll|d)\b)/dgu, 1, 'I'],
        // Limit article corrections to prefixes with predictable pronunciation.
        [/\b(a)(?=[ \t]+(?:apple|orange|egg|hour|honest|umbrella|animal|answer|example|image|object|idea|error|issue)\b)/dgi, 1, 'an'],
        [/\b(an)(?=[ \t]+(?:university|uniform|unicorn|user|useful|European|one)\b)/dgi, 1, 'a']
    ];
    let words = null;
    let loading = null;
    let enabled = true;
    let timer;
    let replacing = false;
    const canHighlight = typeof Highlight === 'function' && CSS.highlights;
    const english = editor => /^en(?:-|$)/i.test(editor.lang || document.documentElement.lang || 'en');
    const normalize = value => value.normalize('NFC').toLowerCase().replaceAll('’', "'");
    const validWord = value => /^[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*$/u.test(value);
    const readPersonal = () => {
        const saved = JSON.parse(localStorage.getItem(personalKey) || '{}');
        return {
            words: new Map(Array.isArray(saved?.words)
                ? saved.words.filter(word => typeof word === 'string' && validWord(word)).map(word => [normalize(word), word]) : []),
            replacements: new Map(Array.isArray(saved?.replacements)
                ? saved.replacements.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && validWord(entry[0])
                    && typeof entry[1] === 'string' && entry[1].trim() && !/[\r\n]/.test(entry[1]))
                    .map(([from, to]) => [normalize(from), [from, to]]) : [])
        };
    };
    const loadPersonal = () => {
        try { return readPersonal(); }
        catch { return { words: new Map(), replacements: new Map() }; }
    };
    let personal = loadPersonal();
    let sortedWords;

    function updatePersonal(update) {
        const next = loadPersonal();
        update(next);
        localStorage.setItem(personalKey, JSON.stringify({
            words: [...next.words.values()], replacements: [...next.replacements.values()]
        }));
        personal = next;
        configure(enabled);
    }

    function isWord(value) {
        const word = normalize(value);
        if (personal.words.has(word)) return true;
        if (commonMisspellings.has(word)) return false;
        if (words?.has(word)) return true;
        const stem = word.replace(/(?:n't|'(?:s|m|re|ll|d|ve))$/, '');
        return stem !== word && (personal.words.has(stem) || words?.has(stem));
    }
    function wordRanges(node) {
        if (!node.parentElement || node.parentElement.closest(excluded)) return [];
        const result = [];
        for (const match of node.textContent.matchAll(tokenPattern)) {
            if (!/^[a-z]+(?:['’][a-z]+)*$/i.test(match[0]) || isWord(match[0])) continue;
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            result.push(range);
        }
        return result;
    }
    function matchCase(original, replacement) {
        if (original === original.toUpperCase()) return replacement.toUpperCase();
        if (/^[A-Z]/.test(original) && replacement) return replacement[0].toUpperCase() + replacement.slice(1);
        return replacement;
    }
    function textRuns(editor) {
        const runs = [];
        let current;
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE && node.matches(excluded)) {
                    current = null;
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches(blockSelector + ', br, hr')) current = null;
                continue;
            }
            const block = node.parentElement.closest(blockSelector) || editor;
            if (current?.block !== block) {
                current = { block, text: '', parts: [] };
                runs.push(current);
            }
            current.parts.push({ node, start: current.text.length });
            current.text += node.data;
        }
        return runs;
    }
    function grammarFindings(run) {
        const findings = [];
        for (const [pattern, group, replacement, duplicate] of grammarRules) {
            for (const match of run.text.matchAll(pattern)) {
                const [start, end] = match.indices[group];
                const from = duplicate ? match.index + match[1].length : start;
                const first = run.parts.find(part => part.start + part.node.length > from);
                const last = run.parts.find(part => part.start + part.node.length >= end);
                if (!first || !last) continue;
                const range = document.createRange();
                range.setStart(first.node, from - first.start);
                range.setEnd(last.node, end - last.start);
                findings.push({ range, alternatives: [matchCase(match[group], replacement)], kind: 'grammar', label: duplicate ? match[1] : null });
            }
        }
        return findings;
    }
    function refresh() {
        if (!canHighlight) return;
        if (!enabled) {
            CSS.highlights.delete('omni-misspelled');
            CSS.highlights.delete('omni-grammar');
            return;
        }
        const spelling = new Highlight();
        const grammar = new Highlight();
        for (const editor of document.querySelectorAll(selector)) {
            if (!editor.isContentEditable || !english(editor) || !editor.closest('.page.active')) continue;
            for (const run of textRuns(editor)) {
                if (words) for (const { node } of run.parts) {
                    for (const range of wordRanges(node)) spelling.add(range);
                }
                for (const { range } of grammarFindings(run)) grammar.add(range);
            }
        }
        CSS.highlights.set('omni-misspelled', spelling);
        CSS.highlights.set('omni-grammar', grammar);
    }
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(refresh, 240);
    }
    function loadDictionary() {
        if (words) return Promise.resolve(words);
        if (!loading) {
            loading = fetch(dictionaryUrl).then(response => {
                if (!response.ok) throw new Error('Dictionary unavailable');
                return response.text();
            }).then(source => {
                words = new Set([...source.trim().split(/\r?\n/), ...builtIn]);
                if (canHighlight) {
                    for (const editor of document.querySelectorAll(selector)) {
                        if (english(editor) && enabled) editor.spellcheck = false;
                    }
                }
                schedule();
                return words;
            }).finally(() => { loading = null; });
        }
        return loading;
    }
    function configure(active) {
        enabled = active;
        if (active && document.querySelector(selector)) loadDictionary().catch(() => {});
        schedule();
    }
    function suggestions(value) {
        const word = normalize(value);
        const preferred = commonMisspellings.get(word);
        const candidates = new Set(preferred ? [preferred] : []);
        const add = candidate => { if (candidate !== word && words.has(candidate)) candidates.add(candidate); };
        for (let i = 0; i < word.length - 1; i++) {
            add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
        }
        for (let i = 0; i <= word.length; i++) {
            const before = word.slice(0, i), after = word.slice(i), tail = after.slice(1);
            if (after.length) add(before + tail);
            for (const letter of alphabet) {
                if (after.length) add(before + letter + tail);
                add(before + letter + after);
            }
        }
        return [...candidates].slice(0, 6).map(candidate => matchCase(value, candidate));
    }
    function correctionsAt(editor, caret, selected) {
        if (!enabled || !english(editor) || !caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return [];
        const { startContainer: node, startOffset: offset } = caret;
        const atCaret = range => selected
            ? selected.compareBoundaryPoints(Range.START_TO_START, range) === 0 && selected.compareBoundaryPoints(Range.END_TO_END, range) === 0
            : range.isPointInRange(node, offset);
        const run = textRuns(editor).find(run => run.parts.some(part => part.node === node));
        const grammar = run ? grammarFindings(run).filter(finding => atCaret(finding.range)) : [];
        if (!words) return grammar;
        const range = wordRanges(node).find(atCaret);
        if (!range) return grammar;
        const alternatives = suggestions(range.toString());
        return alternatives.length ? [...grammar, { range, alternatives, kind: 'spelling' }] : grammar;
    }
    document.addEventListener('beforeinput', event => {
        const editor = event.target;
        if (!personal.replacements.size || replacing || event.isComposing || event.defaultPrevented ||
            !event.cancelable || !editor.matches?.(selector) || !editor.isContentEditable) return;
        const lineBreak = ['insertParagraph', 'insertLineBreak'].includes(event.inputType);
        if (!lineBreak && (event.inputType !== 'insertText' || !/^[\s.,!?;:…)"\]}]$/u.test(event.data || ''))) return;
        const selection = getSelection();
        const node = selection?.anchorNode;
        if (!selection?.isCollapsed || node?.nodeType !== Node.TEXT_NODE ||
            !editor.contains(node) || node.parentElement.closest(excluded)) return;
        const end = selection.anchorOffset;
        if (/^[\p{L}\p{M}\p{N}_'’]/u.test(node.data.slice(end))) return;
        const block = node.parentElement.closest(blockSelector) || editor;
        const prefix = document.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(node, end);
        const match = prefix.toString().match(/(?:^|[\s“"([{])([\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*)$/u);
        if (!match || !node.data.slice(0, end).endsWith(match[1])) return;
        const entry = personal.replacements.get(normalize(match[1]));
        if (!entry || match[1] === entry[1]) return;
        const original = selection.getRangeAt(0).cloneRange();
        const word = original.cloneRange();
        word.setStart(node, end - match[1].length);
        selection.removeAllRanges();
        selection.addRange(word);
        replacing = true;
        try {
            if (document.execCommand('insertText', false, entry[1] + (lineBreak ? '' : event.data))) {
                if (!lineBreak) event.preventDefault();
            } else {
                selection.removeAllRanges();
                selection.addRange(original);
            }
        } finally { replacing = false; }
    });
    window.addEventListener('storage', event => {
        if (event.key !== null && event.key !== personalKey) return;
        personal = loadPersonal();
        schedule();
    });
    document.addEventListener('input', event => { if (event.target.closest?.(selector)) schedule(); });
    document.addEventListener('focusin', event => { if (event.target.matches?.(selector) && !words && enabled) configure(true); });
    window.OmniSpellcheck = {
        configure, correctionsAt,
        dictionary: {
            validWord,
            listWords: () => [...personal.words.values()],
            listReplacements: () => [...personal.replacements.values()],
            async listBuiltIn() {
                const dictionary = await loadDictionary();
                return sortedWords ||= [...dictionary].sort();
            },
            addWord(word) {
                if (!validWord(word)) return false;
                updatePersonal(data => data.words.set(normalize(word), word));
                return true;
            },
            removeWord: word => updatePersonal(data => data.words.delete(normalize(word))),
            setReplacement(from, to) {
                if (!validWord(from) || !to.trim() || /[\r\n]/.test(to)) return false;
                updatePersonal(data => data.replacements.set(normalize(from), [from, to.trim()]));
                return true;
            },
            removeReplacement: from => updatePersonal(data => data.replacements.delete(normalize(from)))
        },
        usesBuiltIn: editor => Boolean(enabled && words && canHighlight && english(editor))
    };
})();
