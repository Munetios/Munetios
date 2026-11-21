(() => {
    'use strict';
    const trigger = document.getElementById('dictionaryMoreOptionsBtn');
    const dictionary = window.OmniSpellcheck.dictionary;
    const id = 'omniDictionary';
    const pageSize = 25;
    const label = key => escapeHtml(_t(key));
    const icon = name => `<span class="mu-icon" aria-hidden="true">${name}</span>`;
    const iconButton = (name, title, action) =>
        `<button type="button" class="mu-icon-btn mu-icon-btn-sm mu-btn-ghost" aria-label="${label(title)}" title="${label(title)}" data-action="${action}">${icon(name)}</button>`;
    const field = (name, title, attributes = '') => `<label class="mu-field">
        <span class="mu-field-label">${label(title)}</span>
        <input class="mu-input" name="${name}" type="text" autocomplete="off" spellcheck="false" ${attributes}>
    </label>`;
    const row = (word, replacement = '', actions = '') => `<div class="mu-row" role="listitem">
        <div class="mu-row-info">
            <span class="mu-row-title" dir="auto">${escapeHtml(word)}</span>
            ${replacement ? `<span class="mu-row-subtitle" dir="auto">${escapeHtml(replacement)}</span>` : ''}
        </div>${actions}
    </div>`;

    function openDictionary() {
        const modal = openWorkspaceDialog({
            id, icon: 'menu_book', title: _t('dictionary'),
            content: `
                <div class="mu-tabs" role="tablist" aria-label="${label('dictionary')}">
                    <button id="${id}WordsTab" type="button" role="tab" data-mu-tab="words" aria-controls="${id}Words" aria-selected="true">${label('dictionary_custom_words')}</button>
                    <button id="${id}AutocorrectTab" type="button" role="tab" data-mu-tab="autocorrect" aria-controls="${id}Autocorrect" aria-selected="false" tabindex="-1">${label('dictionary_autocorrect')}</button>
                    <button id="${id}EnglishTab" type="button" role="tab" data-mu-tab="english" aria-controls="${id}English" aria-selected="false" tabindex="-1">${label('dictionary_english_words')}</button>
                </div>
                <section id="${id}Words" role="tabpanel" data-mu-panel="words" aria-labelledby="${id}WordsTab">
                    <form>
                        ${field('word', 'dictionary_word', 'required')}
                        <button class="mu-btn mu-btn-primary" type="submit">${label('add')}</button>
                    </form>
                    <p class="mu-muted" role="status"></p>
                    <div class="mu-group" role="list"></div>
                </section>
                <section id="${id}Autocorrect" role="tabpanel" data-mu-panel="autocorrect" aria-labelledby="${id}AutocorrectTab" hidden>
                    <form>
                        ${field('from', 'replace', 'required placeholder="Muneios"')}
                        ${field('to', 'replace_with', 'required placeholder="Munetios"')}
                        <button class="mu-btn mu-btn-primary" type="submit">${label('add')}</button>
                        <button class="mu-btn mu-btn-ghost" type="button" data-action="cancel" hidden>${label('cancel')}</button>
                    </form>
                    <p class="mu-muted" role="status"></p>
                    <div class="mu-group" role="list"></div>
                </section>
                <section id="${id}English" role="tabpanel" data-mu-panel="english" aria-labelledby="${id}EnglishTab" hidden>
                    <label class="mu-field">
                        <span class="mu-field-label">${label('search')}</span>
                        <input class="mu-input" type="search" spellcheck="false" autocomplete="off">
                    </label>
                    <p class="mu-muted" role="status"></p>
                    <button class="mu-btn" type="button" data-action="retry" hidden>${label('retry')}</button>
                    <div class="mu-group" role="list"></div>
                    <nav class="mu-pagination" aria-label="${label('dictionary_english_words')}" hidden>
                        ${iconButton('chevron_backward', 'previous', 'previous')}
                        <span aria-live="polite"></span>
                        ${iconButton('chevron_forward', 'next', 'next')}
                    </nav>
                </section>`
        });
        if (!modal) return;
        modal.classList.add('omni-dictionary');
        const words = modal.querySelector('[data-mu-panel="words"]');
        const autocorrect = modal.querySelector('[data-mu-panel="autocorrect"]');
        const english = modal.querySelector('[data-mu-panel="english"]');
        const wordForm = words.querySelector('form');
        const replacementForm = autocorrect.querySelector('form');
        const { from, to } = replacementForm.elements;
        const save = replacementForm.querySelector('[type="submit"]');
        const cancel = replacementForm.querySelector('[data-action="cancel"]');
        const search = english.querySelector('input');
        const pagination = english.querySelector('nav');
        const retry = english.querySelector('[data-action="retry"]');
        const tabList = modal.querySelector('[role="tablist"]');
        const tabs = [...tabList.querySelectorAll('[role="tab"]')];
        const collator = new Intl.Collator(document.documentElement.lang || undefined);
        const number = new Intl.NumberFormat(document.documentElement.lang || undefined);
        const status = (panel, key) => { panel.querySelector('[role="status"]').textContent = key ? _t(key) : ''; };
        const showRows = (panel, html) => {
            const list = panel.querySelector('[role="list"]');
            list.hidden = !html;
            list.innerHTML = html;
        };
        const saveChange = (panel, action) => {
            try { return action(); }
            catch { status(panel, 'storage_save_unavailable'); return false; }
        };
        const valid = input => {
            if (dictionary.validWord(input.value.trim())) return true;
            input.setCustomValidity(_t('dictionary_invalid_word'));
            input.reportValidity();
            return false;
        };
        let savedWords;
        let savedReplacements;
        let builtIn;
        let matches = [];
        let page = 0;

        function renderPersonal() {
            savedWords = dictionary.listWords().sort(collator.compare);
            savedReplacements = dictionary.listReplacements().sort(([a], [b]) => collator.compare(a, b));
            showRows(words, savedWords.map(word => row(word, '', iconButton('delete', 'remove', 'remove'))).join(''));
            showRows(autocorrect, savedReplacements.map(([from, to]) => row(from, to,
                iconButton('edit', 'edit', 'edit') + iconButton('delete', 'remove', 'remove'))).join(''));
            status(words, savedWords.length ? '' : 'no_results');
            status(autocorrect, savedReplacements.length ? '' : 'no_results');
        }

        function resetReplacement() {
            replacementForm.reset();
            from.readOnly = false;
            save.textContent = _t('add');
            cancel.hidden = true;
            from.focus();
        }

        function renderEnglish() {
            showRows(english, matches.slice(page * pageSize, (page + 1) * pageSize).map(word => row(word)).join(''));
            status(english, matches.length ? '' : 'no_results');
            const total = Math.ceil(matches.length / pageSize);
            pagination.hidden = total <= 1;
            pagination.querySelector('[aria-live]').textContent = _t('sheets_match_count')
                .replace('{current}', number.format(page + 1)).replace('{total}', number.format(total));
            pagination.querySelector('[data-action="previous"]').disabled = page === 0;
            pagination.querySelector('[data-action="next"]').disabled = page + 1 >= total;
        }

        function filterEnglish() {
            if (!builtIn) return;
            const query = search.value.trim().toLowerCase().replaceAll('’', "'");
            matches = query ? builtIn.filter(word => word.includes(query)) : builtIn;
            page = 0;
            renderEnglish();
        }

        async function loadEnglish() {
            if (builtIn) return;
            status(english, 'loading_ellipsis');
            retry.hidden = true;
            try {
                builtIn = await dictionary.listBuiltIn();
                filterEnglish();
            } catch {
                status(english, 'dictionary_load_failed');
                retry.hidden = false;
            }
        }

        modal.querySelectorAll('input').forEach(input => input.addEventListener('input', () => input.setCustomValidity('')));
        wordForm.addEventListener('submit', event => {
            event.preventDefault();
            const input = wordForm.elements.word;
            if (!valid(input) || !saveChange(words, () => dictionary.addWord(input.value.trim()))) return;
            wordForm.reset();
            renderPersonal();
            input.focus();
        });
        replacementForm.addEventListener('submit', event => {
            event.preventDefault();
            if (!valid(from)) return;
            if (!to.value.trim()) {
                to.value = '';
                to.reportValidity();
                return;
            }
            if (!saveChange(autocorrect, () => dictionary.setReplacement(from.value.trim(), to.value))) return;
            resetReplacement();
            renderPersonal();
        });
        tabList.addEventListener('click', event => {
            const selected = event.target.closest('[role="tab"]');
            if (!selected) return;
            tabs.forEach(tab => { tab.tabIndex = tab === selected ? 0 : -1; });
            if (selected.dataset.muTab === 'english') loadEnglish();
        });
        tabList.addEventListener('keydown', event => {
            const index = tabs.indexOf(event.target);
            const direction = getComputedStyle(tabList).direction === 'rtl' ? -1 : 1;
            const next = {
                ArrowLeft: (index - direction + tabs.length) % tabs.length,
                ArrowRight: (index + direction + tabs.length) % tabs.length,
                Home: 0,
                End: tabs.length - 1
            }[event.key];
            if (index < 0 || next === undefined) return;
            event.preventDefault();
            tabs[next].click();
            tabs[next].focus();
        });
        modal.addEventListener('click', event => {
            const button = event.target.closest('[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            if (action === 'previous' || action === 'next') {
                page += action === 'next' ? 1 : -1;
                renderEnglish();
                if (button.disabled) pagination.querySelector('button:not(:disabled)')?.focus();
            } else if (action === 'retry') {
                loadEnglish();
            } else if (action === 'cancel') {
                resetReplacement();
            } else {
                const panel = button.closest('[data-mu-panel]');
                const entries = [...panel.querySelector('[role="list"]').children];
                const index = entries.indexOf(button.closest('[role="listitem"]'));
                if (panel === words) {
                    if (saveChange(words, () => { dictionary.removeWord(savedWords[index]); return true; })) {
                        renderPersonal();
                        wordForm.elements.word.focus();
                    }
                } else if (action === 'remove') {
                    if (saveChange(autocorrect, () => { dictionary.removeReplacement(savedReplacements[index][0]); return true; })) {
                        resetReplacement();
                        renderPersonal();
                    }
                } else {
                    from.setCustomValidity('');
                    [from.value, to.value] = savedReplacements[index];
                    from.readOnly = true;
                    save.textContent = _t('save');
                    cancel.hidden = false;
                    to.focus();
                    to.select();
                }
            }
        });
        search.addEventListener('input', filterEnglish);
        renderPersonal();
        window.MunetiosUI.openModal(id);
    }

    trigger.addEventListener('click', () => {
        const opener = document.getElementById('moreEditorBtn');
        trigger.closest('.dropdown-wrapper').style.display = 'none';
        opener?.focus();
        openDictionary();
    });
    trigger.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        trigger.click();
    });
})();
