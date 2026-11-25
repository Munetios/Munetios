(() => {
    'use strict';
    const trigger = document.getElementById('dictionaryMoreOptionsBtn');
    const dictionary = window.OmniSpellcheck.dictionary;
    const id = 'omniDictionary';
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
                        <button class="mu-btn mu-btn-primary" type="submit" data-action="add">${label('add')}</button>
                        <button class="mu-btn mu-btn-primary" type="submit" data-action="save" hidden>${label('save')}</button>
                        <button class="mu-btn mu-btn-ghost" type="button" data-action="cancel" hidden>${label('cancel')}</button>
                    </form>
                    <p class="mu-muted" role="status"></p>
                    <div class="mu-group" role="list"></div>
                </section>`
        });
        if (!modal) return;
        modal.classList.add('omni-dictionary');
        const words = modal.querySelector('[data-mu-panel="words"]');
        const autocorrect = modal.querySelector('[data-mu-panel="autocorrect"]');
        const wordForm = words.querySelector('form');
        const replacementForm = autocorrect.querySelector('form');
        const { from, to } = replacementForm.elements;
        const add = replacementForm.querySelector('[data-action="add"]');
        const save = replacementForm.querySelector('[data-action="save"]');
        const cancel = replacementForm.querySelector('[data-action="cancel"]');
        const tabList = modal.querySelector('[role="tablist"]');
        const tabs = [...tabList.querySelectorAll('[role="tab"]')];
        const collator = new Intl.Collator(document.documentElement.lang || undefined);
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
            add.hidden = false;
            save.hidden = true;
            cancel.hidden = true;
            from.focus();
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
            if (!button || button.type === 'submit') return;
            const action = button.dataset.action;
            if (action === 'cancel') {
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
                    add.hidden = true;
                    save.hidden = false;
                    cancel.hidden = false;
                    to.focus();
                    to.select();
                }
            }
        });
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
