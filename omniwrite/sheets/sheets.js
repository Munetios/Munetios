/*
 * OmniWrite Sheets
 * Spreadsheets as part of OmniWrite: the editor is a page inside OmniWrite (#sheetEditorApp),
 * and OmniWrite's sidebar, dashboard, search, templates, and trash list spreadsheets next to
 * documents through window.OmniSheets (see the API at the end of this file).
 *
 * Storage: IndexedDB "omniwrite-sheets", every workbook AES-GCM encrypted with a key kept on
 * this device (the same model OmniWrite uses for documents).
 * Sync: registers an "omniwrite-sheets" provider with ../account/account-core.js, so
 * workbooks sync end-to-end encrypted with the Munetios account, like OmniWrite documents.
 */
(() => {
    'use strict';
    const E = window.SheetsEngine;
    const Files = window.SheetsFiles;
    // The editor markup lives inside OmniWrite, so ids OmniWrite also uses carry an "sh" prefix
    // (editableTitle -> shEditableTitle). Code here keeps using the short names.
    const SHEET_PAGE_ID = 'sheetEditorApp';
    const PREFIXED_IDS = new Set(['alignGroupBtn', 'alignGroupedChoice', 'boldBtn', 'bordersBtn', 'currencyBtn', 'dataBtn', 'decimalDecreaseBtn', 'decimalIncreaseBtn',
        'documentInfoBtn', 'documentTitle', 'documentZoomBtn', 'documentZoomDisplay', 'downloadDocumentBtn', 'editableTitle', 'fillColorBar', 'fillColorBtn',
        'findCloseBtn', 'findCount', 'findInput', 'findMatchCase', 'findNextBtn', 'findPanel', 'findPrevBtn', 'fontFamilyBtn', 'fontFamilyText', 'fontSizeBtn',
        'fontSizeDecreaseBtn', 'fontSizeDisplay', 'fontSizeIncreaseBtn', 'formatGroupBtn', 'functionBtn', 'importFileInput', 'insertBtn', 'insertChartBtn',
        'italicBtn', 'lockDocumentBtn', 'mergeBtn', 'mobileEditorToolbar', 'mobileEditorToolsBtn', 'moreEditorBtn', 'numberFormatBtn', 'numberFormatLabel',
        'numberFormatText', 'percentBtn', 'pinDocumentBtn', 'redoBtn', 'replaceAllBtn', 'replaceInDocumentBtn', 'replaceInput', 'replaceOneBtn', 'replaceRow',
        'savingStatus', 'savingStatusIcon', 'savingStatusPill', 'shareDocumentBtn', 'textColorBar', 'textColorBtn', 'underlineBtn', 'undoBtn', 'versionHistoryBtn',
        'wrapBtn', 'addSheetBtn', 'allSheetsBtn', 'strikethroughBtn', 'readingModeBtn', 'previewBtn', 'splitScreenBtn']);
    const domId = id => (id === 'editorContent' ? SHEET_PAGE_ID : PREFIXED_IDS.has(id) ? 'sh' + id.charAt(0).toUpperCase() + id.slice(1) : id);
    const $ = id => document.getElementById(domId(id));
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const store = {
        get(key) { try { return localStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
        json(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
    };
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const MOD = isMac ? '⌘' : 'Ctrl';
    function makeId(length = 24) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const bytes = crypto.getRandomValues(new Uint8Array(length));
        let id = alphabet[bytes[0] % 52];
        for (let i = 1; i < length; i++) id += alphabet[bytes[i] % alphabet.length];
        return id;
    }
    const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

    /* ================================================================ i18n
       Strings live in ../languages/<locale>.json with OmniWrite's; English below is the fallback. */
    const EN = {
        sheets_app_name: 'Sheets', sheets_home: 'Home', sheets_spreadsheets: 'Spreadsheets', sheets_new: 'New Spreadsheet',
        sheets_search: 'Search spreadsheets', sheets_welcome_subtitle: 'Select or create a spreadsheet to get started.',
        sheets_tabs: 'Sheets', sheets_recent: 'Recent Spreadsheets', sheets_no_recent: 'No spreadsheets yet', sheets_no_recent_desc: 'Create a spreadsheet to get started.',
        sheets_no_sheets: 'No spreadsheets', sheets_highlight_formulas: 'Formulas', sheets_highlight_formulas_desc: 'Over 100 functions, from SUM and VLOOKUP to XLOOKUP and PMT.',
        sheets_highlight_charts_desc: 'Turn any range into a column, line, pie, or scatter chart that updates live.',
        sheets_highlight_privacy_desc: 'Spreadsheets are encrypted on this device and sync end to end encrypted.',
        sheets_templates_desc: 'Start from a ready-made spreadsheet with formulas already in place.',
        sheets_trash_desc: 'Deleted spreadsheets stay here until you delete them forever.', sheets_trash_empty: 'Trash is empty.',
        sheets_untitled: 'Untitled Spreadsheet', sheets_sheet_name: 'Sheet{n}', sheets_toolbar: 'Spreadsheet toolbar',
        sheets_number_format: 'Number format', sheets_fill_color: 'Fill color', sheets_borders: 'Borders', sheets_merge: 'Merge cells',
        sheets_wrap: 'Wrap text', sheets_format_currency: 'Format as currency', sheets_format_percent: 'Format as percent',
        sheets_decimal_decrease: 'Decrease decimal places', sheets_decimal_increase: 'Increase decimal places', sheets_functions: 'Functions',
        sheets_find: 'Find', sheets_name_box: 'Cell reference', sheets_formula_input: 'Cell contents', sheets_select_all: 'Select all', sheets_grid: 'Spreadsheet',
        sheets_add_rows: 'Add {count} rows', sheets_add_sheet: 'Add sheet', sheets_all_sheets: 'All sheets', sheets_match_case: 'Match case',
        sheets_fmt_auto: 'Automatic', sheets_fmt_text: 'Plain text', sheets_fmt_number: 'Number', sheets_fmt_percent: 'Percent', sheets_fmt_scientific: 'Scientific',
        sheets_fmt_accounting: 'Accounting', sheets_fmt_currency: 'Currency', sheets_fmt_date: 'Date', sheets_fmt_longdate: 'Long date', sheets_fmt_time: 'Time',
        sheets_fmt_datetime: 'Date time', sheets_fmt_duration: 'Duration',
        sheets_align_left: 'Align left', sheets_align_center: 'Align center', sheets_align_right: 'Align right',
        sheets_align_top: 'Align top', sheets_align_middle: 'Align middle', sheets_align_bottom: 'Align bottom',
        sheets_resize_cells: 'Resize cells', sheets_column_width: 'Column width', sheets_row_height: 'Row height',
        sheets_border_all: 'All borders', sheets_border_outer: 'Outer borders', sheets_border_top: 'Top border', sheets_border_bottom: 'Bottom border',
        sheets_border_left: 'Left border', sheets_border_right: 'Right border', sheets_border_none: 'Clear borders', sheets_border_thick: 'Thick outer border',
        sheets_insert_checkbox: 'Checkbox', sheets_insert_dropdown: 'Dropdown', sheets_insert_note: 'Note', sheets_insert_date: "Today's date", sheets_insert_time: 'Current time',
        sheets_row_above: 'Row above', sheets_row_below: 'Row below', sheets_col_left: 'Column left', sheets_col_right: 'Column right',
        sheets_delete_rows: 'Delete rows', sheets_delete_cols: 'Delete columns', sheets_clear_contents: 'Clear contents',
        sheets_sort_az: 'Sort A to Z', sheets_sort_za: 'Sort Z to A', sheets_autofit: 'Fit column to content', sheets_all_functions: 'All functions',
        sheets_rename_sheet: 'Rename', sheets_duplicate_sheet: 'Duplicate', sheets_delete_sheet: 'Delete sheet', sheets_move_left: 'Move left', sheets_move_right: 'Move right',
        sheets_sheet_color: 'Color', sheets_delete_sheet_confirm: 'Delete the sheet "{name}"? You can undo this.', sheets_last_sheet: 'A spreadsheet needs at least one sheet.',
        sheets_name_taken: 'A sheet with this name already exists.', sheets_name_required: 'Enter a name.',
        sheets_chart_editor: 'Chart editor', sheets_chart_column: 'Column', sheets_chart_bar: 'Bar', sheets_chart_line: 'Line', sheets_chart_area: 'Area',
        sheets_chart_pie: 'Pie', sheets_chart_doughnut: 'Doughnut', sheets_chart_scatter: 'Scatter', sheets_chart_radar: 'Radar',
        sheets_data_range: 'Data range', sheets_use_selection: 'Use selection', sheets_first_row_headers: 'Use first row as headers',
        sheets_first_col_labels: 'Use first column as labels', sheets_show_legend: 'Show legend', sheets_chart_empty: 'Select a range with numbers to chart.',
        sheets_edit_chart: 'Edit chart', sheets_delete_chart: 'Delete chart', sheets_download_png: 'Download image (.png)', sheets_other: 'Other',
        sheets_invalid_range: 'Enter a valid range, like A1:C10.', sheets_dropdown_options: 'Options (one per line)', sheets_remove_dropdown: 'Remove dropdown',
        sheets_note_placeholder: 'Write a note…', sheets_link_text: 'Text', sheets_link_url: 'Link',
        sheets_invalid_link: 'Enter a link that starts with https://, http://, or mailto:.', sheets_remove_link: 'Remove link',
        sheets_download_xlsx: 'Microsoft Excel (.xlsx)', sheets_download_csv: 'Comma-separated values (.csv)', sheets_download_tsv: 'Tab-separated values (.tsv)',
        sheets_print_pdf: 'Print or save as PDF', sheets_share_file: 'Share file', sheets_copy_text: 'Copy as text', sheets_copied: 'Copied to clipboard.',
        sheets_share_desc: 'Spreadsheets stay end to end encrypted. Share a copy as a file, or copy the current sheet as text.',
        import_spreadsheet: 'Import Spreadsheet',
        sheets_imported: 'Imported "{name}".', sheets_import_failed: "Couldn't import this file.", sheets_moved_to_trash: 'Moved to Trash.',
        sheets_restored: 'Spreadsheet restored.', sheets_deleted_forever: 'Deleted forever.', sheets_confirm_delete_forever: 'Delete this spreadsheet forever? This cannot be undone.',
        sheets_confirm_empty_trash: 'Delete every spreadsheet in Trash forever? This cannot be undone.', sheets_copy_of: 'Copy of {name}',
        sheets_sum: 'Sum', sheets_average: 'Average', sheets_count: 'Count', sheets_cells: 'Cells', sheets_created: 'Created', sheets_updated: 'Last edited',
        sheets_encryption: 'Encryption', sheets_storage_error: "Couldn't open private storage. Changes are kept only until you close this tab.",
        sheets_save_failed: "Couldn't save this spreadsheet.", sheets_not_found: "This spreadsheet doesn't exist or was deleted.",
        sheets_shortcuts: 'Keyboard shortcuts', sheets_help_intro: 'Type a value or a formula that starts with = in any cell. Formulas update automatically and can refer to other sheets, like =Sheet2!A1.',
        sheets_shortcut_edit: 'Edit the selected cell', sheets_shortcut_newline: 'New line in a cell', sheets_shortcut_fill: 'Copy the cell above',
        sheets_shortcut_date: "Insert today's date", sheets_shortcut_select: 'Extend the selection', sheets_shortcut_jump: 'Jump to the edge of the data',
        sheets_no_matches: 'No matches', sheets_match_count: '{current} of {total}', sheets_replaced: 'Replaced {count}.',
        sheets_tpl_budget: 'Monthly budget', sheets_tpl_budget_desc: 'Track income and expenses with totals and a chart.',
        sheets_tpl_invoice: 'Invoice', sheets_tpl_invoice_desc: 'Line items, tax, and a grand total that calculate themselves.',
        sheets_tpl_tasks: 'Task tracker', sheets_tpl_tasks_desc: 'Checkboxes, owners, due dates, and status dropdowns.',
        sheets_tpl_grades: 'Gradebook', sheets_tpl_grades_desc: 'Scores, averages, and letter grades for a class.',
        sheets_tpl_sales: 'Sales report', sheets_tpl_sales_desc: 'Quarterly sales by region with growth and a chart.',
        sheets_tpl_schedule: 'Weekly schedule', sheets_tpl_schedule_desc: 'Plan each day of the week hour by hour.',
        sheets_workspace: 'Workspace', sheets_account_settings: 'Account settings', sheets_ref_invalid: 'Enter a cell like B4 or a range like A1:C10.',
        sheets_merge_keeps_top_left: 'Merged. Only the top-left value was kept.', sheets_cycle_help: 'Circular reference: this formula depends on its own result.',
        sheets_done: "Done",
        sheets_clear: "Clear",
        sheets_today: "Today",
        sheets_now: "Now",
        sheets_prev_month: "Previous month",
        sheets_next_month: "Next month",
        sheets_hour: "Hour",
        sheets_minute: "Minute",
        sheets_hex_color: "Hex color",
        sheets_hue: "Hue",
        sheets_color_area: "Saturation and brightness",
        sheets_eyedropper: "Pick a color from the screen",
        sheets_pick_date: "Date…",
        sheets_pick_time: "Time…",
        sheets_pick_datetime: "Date and time…",
        sheets_data: "Data",
        sheets_filter: "Filter",
        sheets_create_filter: "Create a filter",
        sheets_remove_filter: "Remove filter",
        sheets_blanks: "(Blanks)",
        sheets_conditional_formatting: "Conditional formatting",
        sheets_remove_duplicates: "Remove duplicates",
        sheets_trim_whitespace: "Trim whitespace",
        sheets_duplicates_removed: "Removed {count} duplicate rows.",
        sheets_trimmed: "Trimmed {count} cells.",
        sheets_split_text: "Split text to columns",
        sheets_separator: "Separator",
        sheets_sep_auto: "Detect automatically",
        sheets_sep_comma: "Comma",
        sheets_sep_semicolon: "Semicolon",
        sheets_sep_period: "Period",
        sheets_sep_space: "Space",
        sheets_sep_custom: "Custom separator",
        sheets_freeze: "Freeze",
        sheets_freeze_no_rows: "No frozen rows",
        sheets_freeze_one_row: "1 row",
        sheets_freeze_two_rows: "2 rows",
        sheets_freeze_up_to_row: "Up to row {row}",
        sheets_freeze_no_cols: "No frozen columns",
        sheets_freeze_one_col: "1 column",
        sheets_freeze_two_cols: "2 columns",
        sheets_freeze_up_to_col: "Up to column {col}",
        sheets_cf_gt: "Greater than",
        sheets_cf_gte: "Greater than or equal to",
        sheets_cf_lt: "Less than",
        sheets_cf_lte: "Less than or equal to",
        sheets_cf_eq: "Is equal to",
        sheets_cf_neq: "Is not equal to",
        sheets_cf_between: "Is between",
        sheets_cf_notBetween: "Is not between",
        sheets_cf_contains: "Text contains",
        sheets_cf_notContains: "Text does not contain",
        sheets_cf_startsWith: "Text starts with",
        sheets_cf_endsWith: "Text ends with",
        sheets_cf_empty: "Is empty",
        sheets_cf_notEmpty: "Is not empty",
        sheets_cf_formula: "Custom formula is",
        sheets_cf_scale: "Color scale",
        sheets_no_rules: "No rules yet. Add one below.",
        sheets_add_rule: "Add rule",
        sheets_apply_to_range: "Apply to range",
        sheets_format_cells_if: "Format cells if",
        sheets_value: "Value",
        sheets_value_and: "And",
        sheets_min_color: "Lowest value color",
        sheets_max_color: "Highest value color",
        sheets_rule_added: "Rule added.",
        sheets_version_desc: "Snapshots are saved automatically while you edit and stay encrypted on this device.",
        sheets_save_version: "Save version now",
        sheets_version_saved: "Version saved.",
        sheets_lock_desc: "Locking this spreadsheet makes it view-only and prevents editing, sharing, copying, downloading, and printing until it is unlocked.",
        sheets_passphrase_short: "Use at least 4 characters.",
        sheets_passphrase_mismatch: "Passphrases don't match.",
        sheets_locked_now: "Spreadsheet locked.",
        sheets_unlocked_session: "This spreadsheet is unlocked in this tab. Lock it again, or enter the passphrase to remove the lock.",
        sheets_remove_lock: "Remove lock",
        sheets_wrong_passphrase: "Wrong passphrase.",
        sheets_lock_removed: "Lock removed.",
        sheets_unlocked: "Spreadsheet unlocked.",
        sheets_locked_toast: "This spreadsheet is locked. Unlock it to make changes.",
        sheets_moved_workspace: "Moved to {name}.", sheets_sort_header_note: 'Sorted. The first row was kept as a header.',
        download_spreadsheet: 'Download Spreadsheet', lock_spreadsheet: "Lock Spreadsheet", unlock_spreadsheet: "Unlock Spreadsheet", lock_spreadsheet_btn: "Lock Spreadsheet", unlock_spreadsheet_desc: "Enter your passphrase to unlock this spreadsheet and restore full access.", lock_share_warning_sheet: "Sharing will be disabled while this spreadsheet is locked. To share again, unlock the spreadsheet first.", lock_prevent_viewing_desc_sheet: "Hide the spreadsheet contents and disable preview, reading mode, and split screen while locked.", sheet_locked_prevent_viewing_msg: "This spreadsheet is locked. Unlock it to view the contents.", pin_spreadsheet: "Pin Spreadsheet", unpin_spreadsheet: "Unpin Spreadsheet", spreadsheet_info: "Spreadsheet Info", rename_spreadsheet: "Rename Spreadsheet", spreadsheet_renamed: "Spreadsheet renamed.", spreadsheet_duplicated: "Spreadsheet duplicated.", customize_sheets_toolbar: "Customize Spreadsheet Toolbar", share_spreadsheet_title: 'Share Spreadsheet', share_copy_text: 'Copy Text', share_copy_markdown: 'Copy Markdown', share_system: 'System Share', share_system_unavailable: 'System share isn’t available in this browser.', sharing_disabled_sheet_desc: 'Sharing is disabled because this spreadsheet is locked. Unlock the spreadsheet to enable sharing.', split_this_spreadsheet: 'This spreadsheet', reading_row: 'Row {n}', font_settings_cells_hint: 'Applies to the selected cells.', exit_split_screen: 'Exit Split Screen', select_file_split: 'Select a File for Split View', download_as_xlsx: 'Download as XLSX', download_as_csv: 'Download as CSV', download_as_tsv: 'Download as TSV'
    };
    // Catalogs sit next to this folder: omniwrite/languages/ (resolved from this script, not the page).
    const LANGUAGE_FOLDER = new URL('../languages/', (document.currentScript && document.currentScript.src) || document.baseURI).href;
    let dict = Object.assign({}, EN);
    let languageIndex = { languages: ['en'], fallbacks: {} };
    async function readLanguage(name) {
        try {
            const response = await fetch(LANGUAGE_FOLDER + encodeURIComponent(name) + '.json', { cache: 'no-cache' });
            if (response.ok) return await response.json();
        } catch {}
        return null;
    }
    function resolveLang(lang) {
        let selected = String(lang || 'en').replace(/_/g, '-');
        try { selected = Intl.getCanonicalLocales(selected)[0] || 'en'; } catch {}
        const known = new Set([...(languageIndex.languages || []), ...Object.keys(languageIndex.fallbacks || {})]);
        if (known.has(selected)) return selected;
        const base = selected.split('-')[0];
        return known.has(base) ? base : 'en';
    }
    async function loadLanguage(lang) {
        languageIndex = (await readLanguage('index')) || languageIndex;
        const resolved = resolveLang(lang);
        const files = new Set(languageIndex.languages || []);
        const english = (await readLanguage('en')) || {};
        const chain = [];
        let cursor = resolved;
        const seen = new Set();
        while (cursor && cursor !== 'en' && !seen.has(cursor)) {
            seen.add(cursor);
            chain.unshift(cursor);
            cursor = (languageIndex.fallbacks || {})[cursor] || (cursor.includes('-') ? cursor.split('-')[0] : '');
        }
        const layers = [];
        for (const locale of chain) if (files.has(locale)) layers.push((await readLanguage(locale)) || {});
        dict = Object.assign({}, EN, english, ...layers);
        const byEnglish = new Map(Object.entries(english).map(([key, value]) => [String(value).trim().toLowerCase(), key]));
        for (const [key, value] of Object.entries(EN)) {
            if (key in english) continue;
            const shared = byEnglish.get(String(value).trim().toLowerCase());
            if (shared && dict[shared]) dict[key] = dict[shared];
        }
        return resolved; // OmniWrite sets <html lang/dir>.
    }
    function t(key, vars) {
        let text = dict[key] ?? EN[key] ?? key;
        if (vars) text = String(text).replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m));
        return text;
    }
    const currentLang = () => store.get('omniwrite-lang') || store.get('munetiosLanguage') || navigator.language || 'en';
    function numberLocale() {
        const lang = currentLang();
        try { return Intl.getCanonicalLocales(lang === 'en' ? 'en-US' : lang)[0]; } catch { return 'en-US'; }
    }
    function applyI18n(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const value = t(el.getAttribute('data-i18n'));
            if (el.textContent !== value) el.textContent = value;
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const value = t(el.getAttribute('data-i18n-title'));
            el.setAttribute('data-tooltip', value);
            el.setAttribute('aria-label', value);
            el.removeAttribute('title');
        });
        root.querySelectorAll('[data-i18n-aria-label]').forEach(el => el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label'))));
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
    }
    const meridiem = text => String(text).replace(/\bAM\b/g, 'NM').replace(/\bPM\b/g, 'AN');
    function formatDateTime(ms) {
        try { return meridiem(new Intl.DateTimeFormat(numberLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))); } catch { return new Date(ms).toISOString(); }
    }

    /* ================================================================ toasts, tooltips, dialogs */
    const TOAST_DURATION = 2600;
    function repositionToasts() {
        let offset = 20;
        [...document.querySelectorAll('.omniwrite-toast')].reverse().forEach(toast => { toast.style.top = offset + 'px'; offset += toast.getBoundingClientRect().height + 12; });
    }
    function removeToast(toast) {
        if (!toast || toast.dataset.closing === 'true') return;
        toast.dataset.closing = 'true';
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -20px) scale(0.95)';
        setTimeout(() => { toast.remove(); repositionToasts(); }, 300);
    }
    function showToast(message, options = {}) {
        const type = ['success', 'error', 'info', 'warning'].includes(options.type) ? options.type : 'info';
        const toast = document.createElement('div');
        toast.className = 'omniwrite-toast liquid-glass is-' + type + ' is-short';
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.innerHTML = `<span class="omniwrite-toast-icon" aria-hidden="true"><icon>${{ success: 'check_circle', error: 'error', info: 'info', warning: 'warning' }[type]}</icon></span><div class="omniwrite-toast-text"></div><div class="toast-progress-bar"></div>`;
        toast.querySelector('.omniwrite-toast-text').textContent = message;
        Object.assign(toast.style, { position: 'fixed', left: '50%', right: 'auto', top: '20px', zIndex: 999999, opacity: '0', transition: 'top 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.4,0,0.2,1)', transform: 'translate(-50%, -20px) scale(0.95)' });
        document.body.appendChild(toast);
        repositionToasts();
        const duration = options.duration || TOAST_DURATION;
        const bar = toast.querySelector('.toast-progress-bar');
        bar.style.transition = `width ${duration}ms linear`;
        setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translate(-50%, 0) scale(1)'; bar.style.width = '0'; repositionToasts(); }, 10);
        setTimeout(() => removeToast(toast), duration);
    }

    // Tooltips come from OmniWrite's tooltip system (it reads data-tooltip).

    let openDialogs = 0;
    function openDialog({ title, html, onMount, maxWidth = 640, onClose }) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const titleId = 'dlg' + makeId(8);
        modal.setAttribute('aria-labelledby', titleId);
        modal.innerHTML = `<div class="modal-content liquid-glass" style="position:relative;max-width:${maxWidth}px;">
            <span class="modal-content-close" role="button" tabindex="0" aria-label="${esc(t('close'))}" data-tooltip="${esc(t('close'))}"><icon>close</icon></span>
            <h2 id="${titleId}">${esc(title)}</h2>
            <div class="sheets-dialog-body">${html}</div></div>`;
        const previous = document.activeElement;
        document.body.appendChild(modal);
        openDialogs++;
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            openDialogs--;
            modal.remove();
            document.removeEventListener('keydown', onKey, true);
            if (onClose) onClose();
            if (previous && previous.focus && document.contains(previous)) previous.focus();
        };
        const onKey = event => {
            if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); }
            if (event.key === 'Tab') {
                const focusables = [...modal.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled && el.offsetParent !== null);
                if (!focusables.length) return;
                const first = focusables[0], last = focusables[focusables.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener('keydown', onKey, true);
        modal.addEventListener('mousedown', event => { if (event.target === modal) close(); });
        const closeBtn = modal.querySelector('.modal-content-close');
        closeBtn.addEventListener('click', close);
        closeBtn.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close(); } });
        if (onMount) onMount(modal, close);
        setTimeout(() => { const first = modal.querySelector('input:not([type=checkbox]), textarea, select, .sheets-primary'); (first || closeBtn).focus(); if (first && first.select && first.tagName === 'INPUT') first.select(); }, 30);
        return { modal, close };
    }
    function confirmDialog(message, { confirmLabel, danger = false, title } = {}) {
        return new Promise(resolve => {
            let answered = false;
            openDialog({
                title: title || t('confirm_to_delete'),
                maxWidth: 480,
                html: `<p>${esc(message)}</p><div class="sheets-form-actions"><button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="button" class="mu-btn ${danger ? 'mu-btn-danger' : 'mu-btn-primary'}" data-act="ok">${esc(confirmLabel || t('Delete'))}</button></div>`,
                onMount(modal, close) {
                    modal.querySelector('[data-act=cancel]').onclick = () => { answered = true; close(); resolve(false); };
                    modal.querySelector('[data-act=ok]').onclick = () => { answered = true; close(); resolve(true); };
                },
                onClose() { if (!answered) resolve(false); }
            });
        });
    }
    function promptDialog(title, label, value = '', { multiline = false, placeholder = '' } = {}) {
        return new Promise(resolve => {
            let answered = false;
            const field = multiline
                ? `<textarea class="mu-textarea" data-field rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
                : `<input class="mu-input" data-field type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`;
            openDialog({
                title, maxWidth: 520,
                html: `<form class="sheets-form"><label class="mu-field"><span class="mu-field-label">${esc(label)}</span>${field}</label><div class="sheets-form-actions"><button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="submit" class="mu-btn mu-btn-primary">${esc(t('save'))}</button></div></form>`,
                onMount(modal, close) {
                    const form = modal.querySelector('form');
                    form.onsubmit = event => { event.preventDefault(); answered = true; const v = modal.querySelector('[data-field]').value; close(); resolve(v); };
                    modal.querySelector('[data-act=cancel]').onclick = () => { answered = true; close(); resolve(null); };
                    if (multiline) modal.querySelector('textarea').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit(); });
                },
                onClose() { if (!answered) resolve(null); }
            });
        });
    }

    /* ================================================================ menus (OmniWrite dropdown component) */
    const menuEl = $('sheetsMenu');
    let menuState = null;
    function closeMenu(returnFocus = false) {
        if (!menuState) return;
        menuEl.style.display = 'none';
        menuEl.innerHTML = '';
        if (menuState.anchor && menuState.anchor.setAttribute) menuState.anchor.setAttribute('aria-expanded', 'false');
        const anchor = menuState.anchor;
        menuState = null;
        if (returnFocus && anchor && anchor.focus) anchor.focus();
    }
    function openMenu(anchor, items, { x, y, align = 'start' } = {}) {
        closeMenu();
        closeColorPicker();
        menuEl.innerHTML = '';
        const actions = [];
        const build = item => {
            if (item.sep) { menuEl.appendChild(document.createElement('hr')); return; }
            if (item.heading) { const h = document.createElement('div'); h.className = 'sheets-menu-label'; h.textContent = item.heading; menuEl.appendChild(h); return; }
            if (item.row) {
                const row = document.createElement('div');
                row.className = 'sheets-menu-row';
                item.row.forEach(sub => row.appendChild(makeItem(sub)));
                menuEl.appendChild(row);
                return;
            }
            menuEl.appendChild(makeItem(item));
        };
        const makeItem = item => {
            const el = document.createElement('div');
            el.className = 'dropdown-item' + (item.checked ? ' is-checked' : '');
            el.setAttribute('role', item.checked !== undefined ? 'menuitemradio' : 'menuitem');
            if (item.checked !== undefined) el.setAttribute('aria-checked', String(!!item.checked));
            el.tabIndex = -1;
            if (item.disabled) { el.setAttribute('aria-disabled', 'true'); el.style.opacity = '0.45'; el.style.pointerEvents = 'none'; }
            if (item.icon) { const icon = document.createElement('icon'); icon.textContent = item.icon; if (item.iconColor) icon.style.color = item.iconColor; el.appendChild(icon); }
            if (item.label) { const label = document.createElement('div'); label.className = 'menu-text'; label.textContent = item.label; if (item.font) label.style.fontFamily = item.font; el.appendChild(label); }
            if (item.tooltip) { el.setAttribute('data-tooltip', item.tooltip); el.setAttribute('aria-label', item.tooltip); }
            if (item.hint) { const hint = document.createElement('span'); hint.className = 'sheets-menu-hint'; hint.textContent = item.hint; el.appendChild(hint); }
            const run = () => { closeMenu(); if (item.action) item.action(); };
            el.addEventListener('click', run);
            actions.push(el);
            return el;
        };
        items.filter(Boolean).forEach(build);
        menuEl.style.display = 'block';
        menuEl.style.visibility = 'hidden';
        menuEl.style.left = '0px';
        menuEl.style.top = '0px';
        const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
        let left, top;
        if (anchor && anchor.getBoundingClientRect) {
            const rect = anchor.getBoundingClientRect();
            left = align === 'end' ? rect.right - mw : rect.left;
            top = rect.bottom + 8;
            if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 8);
        } else { left = x; top = y; if (top + mh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - mh - 8); }
        menuEl.style.left = clamp(left, 8, window.innerWidth - mw - 8) + 'px';
        menuEl.style.top = clamp(top, 8, Math.max(8, window.innerHeight - mh - 8)) + 'px';
        menuEl.style.visibility = '';
        if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
        menuState = { anchor, actions, index: -1 };
        return menuEl;
    }
    document.addEventListener('pointerdown', event => {
        if (menuState && !menuEl.contains(event.target) && !(menuState.anchor && menuState.anchor.contains && menuState.anchor.contains(event.target))) closeMenu();
    }, true);
    document.addEventListener('keydown', event => {
        if (!menuState) return;
        const items = menuState.actions;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); event.stopPropagation();
            menuState.index = (menuState.index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[menuState.index].focus();
        } else if ((event.key === 'Enter' || event.key === ' ') && menuEl.contains(document.activeElement)) {
            event.preventDefault(); event.stopPropagation(); document.activeElement.click();
        }
    }, true);
    window.addEventListener('resize', () => closeMenu());

    /* ================================================================ color, date, and time pickers (Munetios UI v4) */
    // The v4 color picker is OmniWrite's color picker (named swatches, area, hue, hex) redesigned for v4.
    const pickerLabels = () => ({
        done: t('sheets_done'), cancel: t('cancel'), reset: t('reset'), clear: t('sheets_clear'), today: t('sheets_today'), now: t('sheets_now'),
        previous: t('sheets_prev_month'), next: t('sheets_next_month'), hour: t('sheets_hour'), minute: t('sheets_minute'),
        color: t('Text Color'), hex: t('sheets_hex_color'), hue: t('sheets_hue'), area: t('sheets_color_area'), eyedropper: t('sheets_eyedropper'),
        date: t('sheets_fmt_date'), time: t('sheets_fmt_time')
    });
    function openColorPicker(anchor, current, onPick, label) {
        closeMenu();
        const labels = pickerLabels();
        if (label) labels.color = label;
        window.MunetiosUI.pickColor({ anchor, value: current || '', labels, locale: numberLocale(), onPick });
    }
    function closeColorPicker() { if (window.MunetiosUI && window.MunetiosUI.closePicker) window.MunetiosUI.closePicker(); }

    /* ================================================================ OmniWrite shell
       OmniWrite owns the theme, sidebar, navigation, and workspaces. Sheets follows along. */
    const isSheetPageActive = () => { const page = $(SHEET_PAGE_ID); return !!(page && page.classList.contains('active')); };
    // Charts read colors from the theme, so redraw them when OmniWrite switches light/dark.
    new MutationObserver(() => {
        const light = document.body.classList.contains('omni-light-mode');
        if (light === lastLightMode) return;
        lastLightMode = light;
        if (editor.book) {
            refreshCharts(true);
            scheduleRender();
        }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    let lastLightMode = document.body.classList.contains('omni-light-mode');
    window.addEventListener('resize', () => { if (isSheetPageActive()) { layoutEditorHeight(); scheduleRender(); } });
    // The sidebar collapsing or resizing changes the grid width.
    if (typeof ResizeObserver === 'function') {
        let resizeFrame = 0;
        new ResizeObserver(() => {
            if (!isSheetPageActive() || resizeFrame) return;
            resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; layoutEditorHeight(); scheduleRender(); });
        }).observe($('sheetsGridCard'));
    }
    // Tell OmniWrite that the list of spreadsheets changed (sidebar, dashboard, search, trash).
    function notifyOmniWrite() {
        try { if (typeof window.renderDocumentsList === 'function') window.renderDocumentsList(); } catch (error) { console.error(error); }
        try { if (typeof window.renderHomeDashboard === 'function') window.renderHomeDashboard(); } catch (error) { console.error(error); }
        try { const trash = document.getElementById('trashApp'); if (trash && trash.classList.contains('active') && typeof window.omniRenderTrash === 'function') window.omniRenderTrash(); } catch (error) { console.error(error); }
        document.dispatchEvent(new CustomEvent('omni-sheets-changed'));
    }

    /* ================================================================ workspaces (shared with OmniWrite) */
    const PERSONAL = 'workspace-personal';
    function workspaces() {
        const list = store.json('omniwrite-workspaces', []);
        const valid = Array.isArray(list) ? list.filter(ws => ws && ws.id && typeof ws.name === 'string' && !ws.locked) : [];
        if (!valid.some(ws => ws.id === PERSONAL)) valid.unshift({ id: PERSONAL, name: 'Personal' });
        return valid;
    }
    const workspaceLabel = ws => (ws.id === PERSONAL ? (window.MunetiosAccount ? window.MunetiosAccount.t('personal') : 'Personal') : ws.name);
    function activeWorkspace() {
        const id = store.get('omniwrite-active-workspace');
        return workspaces().find(ws => ws.id === id) || workspaces()[0];
    }

    /* ================================================================ storage (encrypted IndexedDB) */
    const DB_NAME = 'omniwrite-sheets';
    const DB_VERSION = 2; // 2 adds the local version history store
    let db = null, cryptoKey = null, memoryOnly = false;
    let books = [];
    // Saves wait for storage to finish opening, so nothing is encrypted before the key is loaded.
    let markStorageReady;
    const storageReady = new Promise(resolve => { markStorageReady = resolve; });
    let reconnecting = null;
    // version undefined opens whatever version exists (used when an upgrade is blocked by another tab).
    function openDB(version) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('books')) database.createObjectStore('books', { keyPath: 'id' });
                if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys', { keyPath: 'name' });
                if (!database.objectStoreNames.contains('versions')) database.createObjectStore('versions', { keyPath: 'id' }).createIndex('bookId', 'bookId');
            };
            request.onsuccess = () => {
                const connection = request.result;
                if (settled) { connection.close(); return; } // a fallback connection is already in use
                settled = true;
                // Another tab (or our own pending upgrade) needs a newer version: step aside, then reconnect.
                connection.onversionchange = () => {
                    connection.close();
                    if (db === connection) { db = null; reconnect(); }
                };
                resolve(connection);
            };
            request.onerror = () => { if (!settled) { settled = true; reject(request.error); } };
            // An older Sheets tab still holds the previous version. Don't wait forever: use the
            // current version for now; the upgrade finishes on its own once that tab lets go.
            request.onblocked = () => setTimeout(() => {
                if (!settled) { settled = true; reject(Object.assign(new Error('blocked'), { blocked: true })); }
            }, 2500);
        });
    }
    async function connectDB() {
        try { return await openDB(DB_VERSION); }
        catch (error) {
            if (!error || !error.blocked) throw error;
            console.warn('Sheets: another tab is using older storage; continuing without upgrading for now.');
            return openDB();
        }
    }
    function reconnect() {
        if (!reconnecting) {
            reconnecting = openDB()
                .then(connection => { db = connection; })
                .catch(error => { console.error('Sheets: storage reconnect failed', error); memoryOnly = true; showToast(t('sheets_storage_error'), { type: 'error', duration: 6000 }); })
                .finally(() => { reconnecting = null; });
        }
        return reconnecting;
    }
    async function database() {
        await storageReady;
        if (!db && !memoryOnly) await reconnect();
        return memoryOnly ? null : db;
    }
    const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const txDone = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || new Error('tx')); });
    async function loadKey() {
        const existing = await req(db.transaction('keys').objectStore('keys').get('main'));
        if (existing && existing.key) return crypto.subtle.importKey('raw', existing.key, 'AES-GCM', false, ['encrypt', 'decrypt']);
        const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const candidateRaw = await crypto.subtle.exportKey('raw', candidate);
        const tx = db.transaction('keys', 'readwrite'), finished = txDone(tx), keys = tx.objectStore('keys');
        let raw;
        const read = keys.get('main');
        read.onsuccess = () => {
            raw = read.result && read.result.key || candidateRaw;
            if (!read.result || !read.result.key) keys.put({ name: 'main', key: raw });
        };
        await finished;
        return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    async function encrypt(obj) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(obj)));
        return { iv, data: new Uint8Array(data) };
    }
    async function decrypt(record) {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv) }, cryptoKey, new Uint8Array(record.data));
        return JSON.parse(new TextDecoder().decode(plain));
    }
    async function initStorage() {
        try {
            await window.OmniLocalSignIn?.editorReady;
            db = await connectDB();
            cryptoKey = await loadKey();
            const records = await req(db.transaction('books').objectStore('books').getAll());
            const loaded = [];
            for (const record of records) {
                try { loaded.push(normalizeBook(await decrypt(record))); } catch (error) { console.warn('Sheets: a spreadsheet could not be decrypted and was skipped.', error); }
            }
            // Keep anything created while storage was still opening.
            const stored = new Set(loaded.map(b => b.id));
            books = [...books.filter(b => !stored.has(b.id)), ...loaded];
        } catch (error) {
            console.error('Sheets storage unavailable', error);
            memoryOnly = true;
            showToast(t('sheets_storage_error'), { type: 'error', duration: 6000 });
        } finally {
            markStorageReady();
        }
    }
    async function persistBook(book) {
        const conn = await database();
        if (!conn || !cryptoKey) throw new Error('Sheets persistent storage is unavailable');
        const record = Object.assign({ id: book.id }, await encrypt(book));
        const tx = conn.transaction('books', 'readwrite');
        tx.objectStore('books').put(record);
        await txDone(tx);
    }
    async function deleteBookRecord(id) {
        const conn = await database();
        if (!conn) return;
        const tx = conn.transaction('books', 'readwrite');
        tx.objectStore('books').delete(id);
        await txDone(tx);
    }

    /* ================================================================ workbook model */
    const DEFAULT_ROWS = 100, DEFAULT_COLS = 26, DEF_W = 120, DEF_H = 36, DEFAULT_PT = 14;
    const ROW_STEP = 100;
    const SYNC_ID = /^[A-Za-z0-9._-]{1,150}$/;
    function newSheet(name) {
        return { id: makeId(12), name, color: null, rows: DEFAULT_ROWS, cols: DEFAULT_COLS, colWidths: {}, rowHeights: {}, cells: {}, merges: [], charts: [] };
    }
    function normalizeSheet(sheet, index) {
        const s = Object.assign(newSheet(t('sheets_sheet_name', { n: index + 1 })), sheet || {});
        s.id = typeof s.id === 'string' && s.id ? s.id : makeId(12);
        s.name = String(s.name || t('sheets_sheet_name', { n: index + 1 })).slice(0, 100);
        s.rows = Math.max(1, Math.floor(Number(s.rows) || DEFAULT_ROWS));
        s.cols = Math.max(1, Math.floor(Number(s.cols) || DEFAULT_COLS));
        s.cells = s.cells && typeof s.cells === 'object' ? s.cells : {};
        s.colWidths = s.colWidths && typeof s.colWidths === 'object' ? s.colWidths : {};
        s.rowHeights = s.rowHeights && typeof s.rowHeights === 'object' ? s.rowHeights : {};
        s.merges = Array.isArray(s.merges) ? s.merges.filter(m => m && [m.r1, m.c1, m.r2, m.c2].every(Number.isInteger)) : [];
        s.charts = Array.isArray(s.charts) ? s.charts.filter(c => c && c.id) : [];
        s.cf = Array.isArray(s.cf) ? s.cf.filter(rule => rule && rule.id && rule.type) : [];
        if (s.filter && !E.parseRangeA1(E.rangeName(s.filter))) delete s.filter;
        if (s.freeze && typeof s.freeze !== 'object') delete s.freeze;
        for (const key of Object.keys(s.cells)) {
            const [r, c] = key.split(':').map(Number);
            if (r + 1 > s.rows) s.rows = r + 1;
            if (c + 1 > s.cols) s.cols = c + 1;
        }
        return s;
    }
    function normalizeBook(book) {
        const b = Object.assign({ id: makeId(), title: t('sheets_untitled'), created: Date.now(), updatedAt: Date.now(), workspaceId: activeWorkspace().id, pinned: false, trashed: false, sheets: [] }, book || {});
        if (!SYNC_ID.test(b.id)) b.id = makeId();
        // Older spreadsheets stored their lock as { salt, iterations, hash }; OmniWrite's lock model keeps it working.
        if (b.lock && b.lock.hash && !b.locked) {
            b.locked = true;
            b.lockPassphraseHash = { hash: b.lock.hash, salt: b.lock.salt, iterations: b.lock.iterations || 210000 };
        }
        delete b.lock;
        b.title = String(b.title || t('sheets_untitled')).slice(0, 200);
        b.sheets = (Array.isArray(b.sheets) && b.sheets.length ? b.sheets : [newSheet(t('sheets_sheet_name', { n: 1 }))]).map(normalizeSheet);
        if (!b.sheets.some(s => s.id === b.activeSheet)) b.activeSheet = b.sheets[0].id;
        return b;
    }
    function createBook({ title, sheets, activeSheet } = {}) {
        const book = normalizeBook({ title: title || t('sheets_untitled'), sheets: sheets || [newSheet(t('sheets_sheet_name', { n: 1 }))], activeSheet, workspaceId: activeWorkspace().id });
        books.unshift(book);
        return book;
    }
    let hiddenCloudBooks = new Set();
    const visibleBooks = () => books.filter(b => !hiddenCloudBooks.has(b.id) && ((b.workspaceId || PERSONAL) === activeWorkspace().id || (!workspaces().some(ws => ws.id === b.workspaceId) && activeWorkspace().id === PERSONAL && !store.json('omniwrite-workspaces', []).some(ws => ws && ws.id === b.workspaceId && ws.locked))));
    const liveBooks = () => {
        const accountId = String(window.MunetiosAccount?.state?.account?.id || '');
        return visibleBooks().filter(book => !book.trashed && book.collab?.savedToDocuments !== false && !book.collab?.inaccessible &&
            (book.collab?.viewerAccountId === undefined || book.collab.viewerAccountId === accountId))
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    };
    const findBook = id => books.find(b => b.id === id);

    /* ================================================================ templates */
    function sheetFrom(name, rows, extras = {}) {
        const sheet = newSheet(name);
        rows.forEach((row, r) => row.forEach((value, c) => {
            if (value === null || value === undefined || value === '') return;
            if (typeof value === 'object') { sheet.cells[r + ':' + c] = clone(value); return; }
            sheet.cells[r + ':' + c] = { v: String(value) };
        }));
        Object.assign(sheet, extras);
        return sheet;
    }
    const H = (v, more = {}) => ({ v, s: { bg: '#ede7fb', ...more } });
    const money = v => ({ v: String(v), s: { fmt: { t: 'currency', d: 2 } } });
    const moneyF = v => ({ v, s: { fmt: { t: 'currency', d: 2 } } });
    const TEMPLATES = [
        {
            id: 'budget', icon: 'savings', title: 'sheets_tpl_budget', desc: 'sheets_tpl_budget_desc', build() {
                const s = sheetFrom(t('sheets_tpl_budget'), [
                    [H('Category'), H('Planned'), H('Actual'), H('Difference')],
                    ['Rent', money(1400), money(1400), { v: '=B2-C2', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Groceries', money(450), money(512.4), { v: '=B3-C3', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Transport', money(160), money(132), { v: '=B4-C4', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Utilities', money(220), money(204.75), { v: '=B5-C5', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Savings', money(600), money(600), { v: '=B6-C6', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Fun', money(200), money(246.1), { v: '=B7-C7', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Total', moneyF('=SUM(B2:B7)'), moneyF('=SUM(C2:C7)'), moneyF('=B8-C8')]
                ], { colWidths: { 0: 180, 1: 150, 2: 150, 3: 150 } });
                s.charts.push({ id: makeId(10), type: 'column', range: 'A1:C7', title: 'Planned vs actual', headers: true, labels: true, legend: true, x: 640, y: 20, w: 560, h: 340 });
                return { title: t('sheets_tpl_budget'), sheets: [s] };
            }
        },
        {
            id: 'invoice', icon: 'receipt_long', title: 'sheets_tpl_invoice', desc: 'sheets_tpl_invoice_desc', build() {
                const s = sheetFrom(t('sheets_tpl_invoice'), [
                    [{ v: 'Invoice', s: { fs: 24 } }, '', '', { v: '=TODAY()', s: { fmt: { t: 'date' }, ha: 'right' } }],
                    ['Bill to:', 'Client name'],
                    [],
                    [H('Item'), H('Quantity'), H('Unit price'), H('Amount')],
                    ['Design work', '12', money(85), { v: '=B5*C5', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Development', '20', money(95), { v: '=B6*C6', s: { fmt: { t: 'currency', d: 2 } } }],
                    ['Hosting (1 year)', '1', money(240), { v: '=B7*C7', s: { fmt: { t: 'currency', d: 2 } } }],
                    [],
                    ['', '', { v: 'Subtotal', s: { ha: 'right' } }, moneyF('=SUM(D5:D7)')],
                    ['', '', { v: 'Tax rate', s: { ha: 'right' } }, '8%'],
                    ['', '', { v: 'Tax', s: { ha: 'right' } }, moneyF('=ROUND(D9*D10,2)')],
                    ['', '', { v: 'Total', s: { ha: 'right' } }, moneyF('=D9+D11')]
                ], { colWidths: { 0: 220, 1: 120, 2: 140, 3: 150 }, rowHeights: { 0: 48 } });
                return { title: t('sheets_tpl_invoice'), sheets: [s] };
            }
        },
        {
            id: 'tasks', icon: 'checklist', title: 'sheets_tpl_tasks', desc: 'sheets_tpl_tasks_desc', build() {
                const status = ['Not started', 'In progress', 'Blocked', 'Done'];
                const row = (done, task, owner, due, st) => [{ v: done ? 'TRUE' : 'FALSE', chk: true }, task, owner, { v: due, s: { fmt: { t: 'date' } } }, { v: st, dd: status }];
                const s = sheetFrom(t('sheets_tpl_tasks'), [
                    [H('Done'), H('Task'), H('Owner'), H('Due'), H('Status')],
                    row(true, 'Draft project brief', 'Alex', '2026-11-16', 'Done'),
                    row(false, 'Review budget', 'Sam', '2026-11-18', 'In progress'),
                    row(false, 'Book venue', 'Jordan', '2026-11-20', 'Not started'),
                    row(false, 'Send invitations', 'Alex', '2026-11-24', 'Blocked'),
                    [],
                    ['Completed', { v: '=COUNTIF(A2:A5,TRUE)&" of "&COUNTA(B2:B5)' }]
                ], { colWidths: { 0: 90, 1: 240, 2: 130, 3: 140, 4: 170 } });
                return { title: t('sheets_tpl_tasks'), sheets: [s] };
            }
        },
        {
            id: 'grades', icon: 'school', title: 'sheets_tpl_grades', desc: 'sheets_tpl_grades_desc', build() {
                const grade = r => `=IFS(E${r}>=90,"A",E${r}>=80,"B",E${r}>=70,"C",E${r}>=60,"D",TRUE,"F")`;
                const st = (r, name, a, b, c) => [name, a, b, c, { v: `=ROUND(AVERAGE(B${r}:D${r}),1)` }, { v: grade(r), s: { ha: 'center' } }];
                const s = sheetFrom(t('sheets_tpl_grades'), [
                    [H('Student'), H('Test 1'), H('Test 2'), H('Project'), H('Average'), H('Grade')],
                    st(2, 'Ana', 92, 88, 95), st(3, 'Ben', 78, 84, 80), st(4, 'Chen', 85, 91, 89), st(5, 'Dara', 64, 72, 70), st(6, 'Eli', 98, 94, 97),
                    [],
                    ['Class average', '=ROUND(AVERAGE(B2:B6),1)', '=ROUND(AVERAGE(C2:C6),1)', '=ROUND(AVERAGE(D2:D6),1)', '=ROUND(AVERAGE(E2:E6),1)']
                ], { colWidths: { 0: 180 } });
                return { title: t('sheets_tpl_grades'), sheets: [s] };
            }
        },
        {
            id: 'sales', icon: 'trending_up', title: 'sheets_tpl_sales', desc: 'sheets_tpl_sales_desc', build() {
                const r = (i, region, q) => [region, ...q.map(money), moneyF(`=SUM(B${i}:E${i})`), { v: `=IFERROR(E${i}/B${i}-1,0)`, s: { fmt: { t: 'percent', d: 1 } } }];
                const s = sheetFrom(t('sheets_tpl_sales'), [
                    [H('Region'), H('Q1'), H('Q2'), H('Q3'), H('Q4'), H('Total'), H('Growth')],
                    r(2, 'North', [42000, 45500, 47200, 51800]),
                    r(3, 'South', [38500, 36900, 40100, 43600]),
                    r(4, 'East', [29800, 33400, 35900, 38200]),
                    r(5, 'West', [46200, 48900, 47700, 52400]),
                    ['Total', moneyF('=SUM(B2:B5)'), moneyF('=SUM(C2:C5)'), moneyF('=SUM(D2:D5)'), moneyF('=SUM(E2:E5)'), moneyF('=SUM(F2:F5)'), { v: '=IFERROR(E6/B6-1,0)', s: { fmt: { t: 'percent', d: 1 } } }]
                ], { colWidths: { 0: 150, 1: 130, 2: 130, 3: 130, 4: 130, 5: 150, 6: 120 } });
                s.charts.push({ id: makeId(10), type: 'line', range: 'A1:E5', title: 'Quarterly sales by region', headers: true, labels: true, legend: true, seriesInRows: true, x: 40, y: 280, w: 620, h: 360 });
                return { title: t('sheets_tpl_sales'), sheets: [s] };
            }
        },
        {
            id: 'schedule', icon: 'calendar_month', title: 'sheets_tpl_schedule', desc: 'sheets_tpl_schedule_desc', build() {
                const days = [];
                for (let i = 0; i < 7; i++) {
                    try { days.push(new Intl.DateTimeFormat(numberLocale(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 16 + i)))); } catch { days.push(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]); }
                }
                const rows = [[H(''), ...days.map(d => H(d, { ha: 'center' }))]];
                for (let h = 7; h <= 20; h++) rows.push([{ v: (h < 10 ? '0' : '') + h + ':00', s: { fmt: { t: 'time' }, ha: 'right' } }]);
                const s = sheetFrom(t('sheets_tpl_schedule'), rows, { colWidths: { 0: 110, 1: 150, 2: 150, 3: 150, 4: 150, 5: 150, 6: 150, 7: 150 } });
                return { title: t('sheets_tpl_schedule'), sheets: [s] };
            }
        }
    ];

    /* ================================================================ lists (rendered by OmniWrite) */
    function bookStats(book) {
        let cells = 0, charts = 0;
        book.sheets.forEach(s => { cells += Object.keys(s.cells).length; charts += (s.charts || []).length; });
        return { cells, charts, sheets: book.sheets.length };
    }
    const omniT = (key, fallback) => { const value = typeof window._t === 'function' ? window._t(key) : ''; return value && value !== key ? value : (fallback !== undefined ? fallback : t(key)); };
    // A sidebar row with OmniWrite's document-item markup, a spreadsheet icon, pin and more actions.
    function sidebarItem(book) {
        const item = document.createElement('div');
        item.className = 'sidebarnav__item document-item sheets-file-item' + (editor.book && editor.book.id === book.id && isSheetPageActive() ? ' is-current' : '');
        item.dataset.sheetId = book.id;
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.innerHTML = `<div class="document-item-main"><icon>${book.collab?.id ? 'share' : 'table_view'}</icon><div class="menu-text"></div></div>
            <div class="document-item-actions"><button class="document-action-btn document-pin-action${book.pinned ? ' is-active' : ''}" type="button" data-act="pin"><icon>${book.pinned ? 'keep_off' : 'push_pin'}</icon></button>
            <button class="document-action-btn document-more-action" type="button" data-act="more" aria-haspopup="menu"><icon>more_horiz</icon></button></div>`;
        item.querySelector('.menu-text').textContent = book.title;
        const pinLabel = omniT(book.pinned ? 'unpin_spreadsheet' : 'pin_spreadsheet');
        const pinBtn = item.querySelector('[data-act=pin]');
        pinBtn.setAttribute('aria-label', pinLabel); pinBtn.setAttribute('data-tooltip', pinLabel);
        const moreBtn = item.querySelector('[data-act=more]');
        moreBtn.setAttribute('aria-label', omniT('more_options')); moreBtn.setAttribute('data-tooltip', omniT('more_options'));
        item.setAttribute('aria-label', book.title + ', ' + t('sheets_spreadsheets'));
        item.addEventListener('click', event => {
            const act = event.target.closest('[data-act]');
            if (act && act.dataset.act === 'pin') { event.stopPropagation(); togglePin(book); return; }
            if (act && act.dataset.act === 'more') { event.stopPropagation(); openBookMenu(book, act); return; }
            openBookRoute(book.id);
            if (typeof window.hideSidebarIfMobile === 'function') window.hideSidebarIfMobile();
        });
        item.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); openBookMenu(book, null, event.clientX, event.clientY); });
        return item;
    }
    function renderLists() {
        notifyOmniWrite();
        if (editor.book) updatePinButton();
    }
    // A card for OmniWrite's Trash page (same markup as its trashed documents).
    function trashCard(book) {
        const card = document.createElement('article');
        card.className = 'mu-group omni-workspace-entry sheets-trash-card';
        card.dataset.sheetId = book.id;
        card.innerHTML = `<div class="omni-workspace-item">
            <span class="mu-icon-circle" aria-hidden="true"><span class="mu-icon">table_view</span></span>
            <div class="mu-row-info"><h2 class="mu-h-title"></h2><span class="mu-muted"></span></div>
        </div>
        <div class="omni-workspace-actions">
            <button type="button" class="mu-btn" data-action="restore"><span class="mu-icon" aria-hidden="true">restore</span><span class="omni-trash-action-label"></span></button>
            <button type="button" class="mu-btn mu-btn-danger-outline" data-action="delete"><span class="mu-icon" aria-hidden="true">delete_forever</span><span class="omni-trash-action-label"></span></button>
        </div>`;
        card.querySelector('h2').textContent = book.title;
        card.querySelector('.mu-muted').textContent = t('sheets_spreadsheets') + ' · ' + formatDateTime(book.trashedAt || book.updatedAt);
        card.querySelector('[data-action=restore] .omni-trash-action-label').textContent = omniT('restore_spreadsheet', 'Restore Spreadsheet');
        card.querySelector('[data-action=delete] .omni-trash-action-label').textContent = omniT('delete_forever');
        card.querySelector('[data-action=restore]').addEventListener('click', () => restoreBook(book));
        card.querySelector('[data-action=delete]').addEventListener('click', () => deleteForever(book));
        return card;
    }
    function openBookMenu(book, anchor, x, y) {
        openMenu(anchor, [
            { icon: 'open_in_new', label: omniT('open'), action: () => openBookRoute(book.id) },
            { icon: 'drive_file_rename_outline', label: omniT('rename_spreadsheet'), action: () => renameBook(book) },
            { icon: book.pinned ? 'keep_off' : 'push_pin', label: omniT(book.pinned ? 'unpin_spreadsheet' : 'pin_spreadsheet'), action: () => togglePin(book) },
            { icon: 'content_copy', label: omniT('Make a Copy'), action: () => duplicateBook(book) },
            { icon: 'drive_file_move', label: omniT('move_to_folder'), action: () => window.moveOmniSpreadsheetToFolder?.(book) },
            { icon: 'workspaces', label: omniT('move_to_workspace'), action: () => openMoveToWorkspace(book, anchor) },
            { icon: 'download', label: t('download_spreadsheet'), action: () => { if (editor.book !== book) openBookRoute(book.id); setTimeout(() => openDownloadDialog(), editor.book === book ? 0 : 60); } },
            { sep: true },
            { icon: 'delete', label: omniT('Delete'), action: () => trashBook(book) }
        ], { x, y });
    }
    function togglePin(book) { book.pinned = !book.pinned; touchBook(book); renderLists(); updatePinButton(); }
    async function renameBook(book) {
        const name = await promptDialog(omniT('rename_spreadsheet'), t('sheets_link_text'), book.title);
        if (name === null || !name.trim()) return;
        book.title = name.trim().slice(0, 200);
        touchBook(book);
        renderLists();
        if (editor.book === book) { $('editableTitle').textContent = book.title; updateDocumentTitle(); }
        showToast(t('spreadsheet_renamed'), { type: 'success' });
    }
    function duplicateBook(book) {
        const copy = clone(book);
        copy.id = makeId();
        copy.title = t('sheets_copy_of', { name: book.title });
        copy.created = copy.updatedAt = Date.now();
        copy.pinned = false;
        delete copy.lock; delete copy.locked; delete copy.lockPassphraseHash; delete copy.lockPreventViewing;
        delete copy.collab; // a copy is a new private spreadsheet, not the shared one
        copy.sheets.forEach(s => (s.charts || []).forEach(c => { c.id = makeId(10); }));
        const normalized = normalizeBook(copy);
        books.unshift(normalized);
        saveBookNow(normalized);
        renderLists();
        showToast(t('spreadsheet_duplicated'), { type: 'success' });
    }
    function trashBook(book) {
        book.trashed = true;
        book.trashedAt = Date.now();
        touchBook(book);
        if (editor.book === book) goHome();
        renderLists();
        showToast(t('sheets_moved_to_trash'), { type: 'success' });
    }
    function restoreBook(book) { book.trashed = false; delete book.trashedAt; touchBook(book); renderLists(); showToast(t('sheets_restored'), { type: 'success' }); }
    async function deleteForever(book, skipConfirm = false) {
        if (!skipConfirm && !(await confirmDialog(t('sheets_confirm_delete_forever'), { danger: true, confirmLabel: omniT('delete_forever') }))) return;
        window.removeOmniSpreadsheetFromFolders?.(book);
        books = books.filter(b => b !== book);
        if (editor.book === book) goHome();
        try { await deleteBookRecord(book.id); await deleteSnapshots(book.id); } catch (error) { console.error(error); }
        renderLists();
        syncSoon();
        if (!skipConfirm) showToast(t('sheets_deleted_forever'), { type: 'success' });
    }

    /* ================================================================ saving & sync */
    let saveTimer = null, saving = null;
    const dirty = new Set(), saveRevisions = new Map();
    function touchBook(book) {
        book.updatedAt = Date.now();
        dirty.add(book.id);
        saveRevisions.set(book.id, (saveRevisions.get(book.id) || 0) + 1);
        window.dispatchEvent(new CustomEvent('omni-sheets-changed', { detail: { id: book.id } }));
        clearTimeout(saveTimer);
        if (editor.book === book) setStatus(t('saving'), 'sync');
        saveTimer = setTimeout(flushSaves, 450);
    }
    function snapshotBook(book) {
        const snapshot = clone(book);
        const edit = editor.book === book && editor.editing;
        if (edit && editor.sheet) {
            const sheet = snapshot.sheets.find(item => item.id === editor.sheet.id);
            const value = cellEditor.style.display === 'block' ? cellEditor.value : formulaInput.value;
            if (sheet && value !== edit.original) sheet.cells[edit.r + ':' + edit.c] = cellFromEntry(sheet.cells[edit.r + ':' + edit.c], value);
        }
        return snapshot;
    }
    function saveBookNow(book) { touchBook(book); return flushSaves(); }
    function flushSaves() {
        clearTimeout(saveTimer);
        if (saving) return saving;
        if (!dirty.size) return Promise.resolve(true);
        saving = (async () => {
            while (dirty.size) {
                let failed = false;
                for (const id of [...dirty]) {
                    const book = findBook(id);
                    if (!book) { dirty.delete(id); saveRevisions.delete(id); continue; }
                    const revision = saveRevisions.get(id), snapshot = snapshotBook(book);
                    try {
                        await persistBook(snapshot);
                        if (saveRevisions.get(id) === revision) dirty.delete(id);
                        saveSnapshot(snapshot).catch(error => console.warn('Sheets: version snapshot failed', error));
                    } catch (error) { failed = true; console.error('Sheets: workbook save failed', error); }
                }
                if (failed) { setStatus(t('sheets_save_failed'), 'error'); showToast(t('sheets_save_failed'), { type: 'error' }); return false; }
            }
            afterSave();
            return true;
        })().finally(() => { saving = null; });
        return saving;
    }
    function syncSignedIn() {
        const account = window.MunetiosAccount;
        return !!(account && account.state.account && account.state.status !== 'locked' && account.state.status !== 'signed-out');
    }
    function syncSoon() { if (window.MunetiosAccount && syncSignedIn()) window.MunetiosAccount.sync.schedule(1200); }
    let syncFailureShown = false;
    function afterSave() {
        if (!syncSignedIn()) { setStatus(t('saved'), 'cloud_done'); setTimeout(() => { if (!dirty.size && !saving) setStatus(t('e2e_encrypted')); }, 2500); return; }
        window.MunetiosAccount.sync.now().then(ok => {
            if (dirty.size || saving) return;
            if (ok) { syncFailureShown = false; setStatus(t('synced'), 'cloud_done'); setTimeout(() => { if (!dirty.size && !saving && window.MunetiosAccount.state.status === 'synced') setStatus(t('e2e_encrypted')); }, 3000); }
            else { syncFailureShown = true; setStatus(syncFailureText(), 'cloud_off'); }
        });
    }
    function syncFailureText() {
        const account = window.MunetiosAccount;
        const status = account && account.state.status;
        return status === 'paused' ? account.t('syncOff') : status === 'full' ? account.t('storageFull') : t('sync_failed_saved_locally');
    }
    function setStatus(text, icon) {
        const label = $('savingStatus'), iconEl = $('savingStatusIcon');
        const account = window.MunetiosAccount;
        if (account?.state.revocation && icon !== 'error') { text = account.t('sessionSyncPaused'); icon = 'cloud_off'; }
        const offline = navigator.onLine === false && icon !== 'error';
        label.textContent = offline ? t('you_are_offline') : text;
        iconEl.textContent = offline ? 'cloud_off' : icon || 'lock';
    }
    window.addEventListener('beforeunload', event => {
        if (!dirty.size && !saving) return;
        flushSaves();
        event.preventDefault();
        event.returnValue = '';
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty.size) flushSaves(); });

    function setupSync() {
        const start = () => {
            const account = window.MunetiosAccount;
            if (!account || window.__omniSheetsSyncStarted) return;
            window.__omniSheetsSyncStarted = true;
            account.setLocaleSource(() => store.get('omniwrite-lang') || store.get('munetiosLanguage') || navigator.language);
            account.sync.register({
                id: 'omniwrite-sheets', prefix: 'omniwrite-sheets:',
                async snapshot() {
                    return books.filter(b => SYNC_ID.test(b.id)).map(b => ({ key: 'omniwrite-sheets:book:' + b.id, data: snapshotBook(b), updatedAt: Number(b.updatedAt) || 0 }));
                },
                async apply(items, options = {}) {
                    const changed = new Set();
                    if (options.replace) {
                        const incoming = new Set(items.map(item => item.key));
                        for (const book of [...books]) if (!incoming.has('omniwrite-sheets:book:' + book.id)) { books = books.filter(b => b !== book); changed.add(book.id); await deleteBookRecord(book.id).catch(() => {}); }
                    }
                    for (const item of items) {
                        if (!item.key.startsWith('omniwrite-sheets:book:')) continue;
                        const id = item.key.slice('omniwrite-sheets:book:'.length);
                        const index = books.findIndex(b => b.id === id);
                        if (item.deleted) {
                            if (index >= 0) { books.splice(index, 1); changed.add(id); await deleteBookRecord(id).catch(() => {}); }
                            continue;
                        }
                        if (!item.data || item.data.id !== id) continue;
                        const book = normalizeBook(item.data);
                        if (index >= 0) books[index] = book; else books.unshift(book);
                        changed.add(id);
                        await persistBook(book);
                    }
                    if (!changed.size) return false;
                    renderLists();
                    refreshSplitSoon();
                    if (editor.book && changed.has(editor.book.id)) {
                        const fresh = findBook(editor.book.id);
                        if (!fresh || fresh.trashed) goHome();
                        else if (!editor.editing) loadBookIntoEditor(fresh, { keepSelection: true });
                    }
                    return true;
                }
            });
            const reloadWorkspaces = () => { if (editor.book && (editor.book.workspaceId || PERSONAL) !== activeWorkspace().id) goHome(); renderLists(); };
            document.addEventListener('munetios-sync-applied', event => { if (event.detail.providers.includes('ls:workspaces')) reloadWorkspaces(); });
            document.addEventListener('munetios-workspaces-changed', reloadWorkspaces);
            let lastStatus = account.state.status;
            let lastRevocation;
            const renderAccountSync = state => {
                if (state.revocation?.id !== lastRevocation) {
                    lastRevocation = state.revocation?.id;
                    hiddenCloudBooks = state.revocation ? account.cloudItems('omniwrite-sheets:book:', 'omniwrite-sheets') : new Set();
                    if (editor.book && hiddenCloudBooks.has(editor.book.id)) goHome();
                    renderLists();
                    setStatus(t('e2e_encrypted'));
                }
                if (state.status === lastStatus) return;
                lastStatus = state.status;
                if (['error', 'full', 'paused'].includes(state.status) && !dirty.size) { syncFailureShown = true; setStatus(syncFailureText(), 'cloud_off'); }
                else if (state.status === 'synced' && syncFailureShown) { syncFailureShown = false; setStatus(t('e2e_encrypted')); }
            };
            account.on(renderAccountSync);
            renderAccountSync(account.state);
        };
        if (window.MunetiosAccount) start(); else window.addEventListener('load', start, { once: true });
    }
    window.addEventListener('online', () => { if (dirty.size) flushSaves(); else setStatus(t('e2e_encrypted')); });
    window.addEventListener('offline', () => setStatus(t('you_are_offline'), 'cloud_off'));

    /* ================================================================ routing (OmniWrite's hash router calls showBook) */
    // URLs look like OmniWrite's documents: #/profile/<workspace>/sheet/<id>
    function workspaceHashPrefix() {
        try { if (typeof window.getWorkspaceHashPrefix === 'function') return window.getWorkspaceHashPrefix(); } catch {}
        return '#/profile/personal';
    }
    function openBookRoute(id) {
        const target = workspaceHashPrefix() + '/sheet/' + id;
        if (location.hash === target) showBook(id); else location.hash = target;
    }
    function goHome() {
        closeEditor();
        if (location.hash && location.hash !== '#' && location.hash !== '#/') location.hash = '';
        else if (typeof window.switchPage === 'function') window.switchPage('selectArea');
    }
    const BRAND = 'Munetios Sheets';
    function updateDocumentTitle() {
        if (editor.book && isSheetPageActive()) document.title = editor.book.title + ' - ' + BRAND;
    }
    let showRequest = 0;
    async function showBook(id) {
        const request = ++showRequest;
        await storageReady;
        if (request !== showRequest) return;
        if (hiddenCloudBooks.has(id)) { goHome(); return; }
        const book = findBook(id);
        if (!book || book.trashed) {
            showToast(t('sheets_not_found'), { type: 'error' });
            goHome();
            return;
        }
        if (editor.book !== book) { closeEditor(); loadBookIntoEditor(book); }
        if (typeof window.switchPage === 'function') window.switchPage(SHEET_PAGE_ID);
        else { document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === SHEET_PAGE_ID)); }
        renderLists();
    }
    // Called by OmniWrite's switchPage for every page change.
    function onPageChange(pageId) {
        document.body.classList.toggle('omni-sheets', pageId === SHEET_PAGE_ID);
        if (pageId === SHEET_PAGE_ID) {
            updateDocumentTitle();
            topbarSignature = '';
            requestAnimationFrame(applyTopbar);
            requestAnimationFrame(() => { layoutEditorHeight(); scheduleRender(); refreshCharts(true); });
            return;
        }
        endDrag();
        closeMenu();
        closeColorPicker();
        exitSplit(false);
        if (editor.book) {
            commitEdit();
            flushSaves();
            closeFind();
            renderLists();
        }
    }
    function newBlankBook() {
        const book = createBook();
        saveBookNow(book);
        renderLists();
        openBookRoute(book.id);
        return book;
    }

    /* ================================================================ editor state */
    const viewport = $('sheetsViewport');
    const canvasEl = $('sheetsCanvas');
    const cellsEl = $('sheetsCells');
    const cellEditor = $('sheetsCellEditor');
    const formulaInput = $('sheetsFormulaInput');
    const nameBox = $('sheetsNameBox');
    const editor = {
        book: null, sheet: null, evaluator: null,
        sel: { r: 0, c: 0, ar: 0, ac: 0, fr: 0, fc: 0 }, // active cell + anchor/focus of the range
        editing: null, // { r, c, original, mode: 'enter' | 'edit', source: 'cell' | 'bar' }
        zoom: 1, undo: [], redo: [], clipboard: null, selectedChart: null,
        fmtBrush: null
    };
    const live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');
    live.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';
    document.body.appendChild(live);

    const editorSessions = new WeakMap();
    function loadBookIntoEditor(book, { keepSelection = false } = {}) {
        endDrag();
        const session = !keepSelection ? editorSessions.get(book) : null;
        const prevSel = keepSelection ? clone(editor.sel) : session?.sel || null;
        const prevSheet = keepSelection && editor.sheet ? editor.sheet.id : session?.sheetId;
        hideCellEditor();
        if (split && editor.book && editor.book !== book) exitSplit(false);
        editor.book = book;
        editor.sheet = book.sheets.find(s => s.id === (prevSheet || book.activeSheet)) || book.sheets[0];
        editor.evaluator = E.createEvaluator(() => editor.book);
        if (!keepSelection) { editor.undo = session?.undo || []; editor.redo = session?.redo || []; editor.zoom = session?.zoom || 1; editor.selectedChart = null; }
        editor.sel = prevSel || { r: 0, c: 0, ar: 0, ac: 0, fr: 0, fc: 0 };
        $('editableTitle').textContent = book.title;
        updateDocumentTitle();
        setStatus(t('e2e_encrypted'));
        layoutDirty = true;
        destroyCharts();
        renderTabs();
        updatePinButton();
        updateLockButton();
        updateZoomLabel();
        afterDataChange({ save: false });
        if (!keepSelection) { viewport.scrollTop = session?.scrollTop || 0; viewport.scrollLeft = session?.scrollLeft || 0; }
        updateSelectionUI();
    }
    function closeEditor() {
        if (!editor.book) return;
        endDrag();
        commitEdit();
        cancelSelectionStats();
        flushSaves();
        editorSessions.set(editor.book, {
            sheetId: editor.sheet.id, sel: clone(editor.sel),
            undo: editor.undo, redo: editor.redo, zoom: editor.zoom,
            scrollTop: viewport.scrollTop, scrollLeft: viewport.scrollLeft
        });
        hideCellEditor();
        destroyCharts();
        clearGridCanvases();
        viewport.removeAttribute('aria-activedescendant');
        editor.book = null; editor.sheet = null;
    }
    function switchSheet(id) {
        if (!editor.book || editor.sheet.id === id) return;
        endDrag();
        commitEdit();
        const sheet = editor.book.sheets.find(s => s.id === id);
        if (!sheet) return;
        editor.sheet = sheet;
        editor.book.activeSheet = id;
        refreshSplitSoon();
        editor.sel = { r: 0, c: 0, ar: 0, ac: 0, fr: 0, fc: 0 };
        editor.selectedChart = null;
        layoutDirty = true;
        destroyCharts();
        viewport.scrollTop = 0; viewport.scrollLeft = 0;
        renderTabs();
        afterDataChange({ save: false });
        updateSelectionUI();
        touchBook(editor.book);
    }

    /* ================================================================ geometry */
    let layoutDirty = true;
    let layoutVersion = 0;
    let colX = new Float64Array(1), rowY = new Float64Array(1);
    const colW = c => Math.round((editor.sheet.colWidths[c] ?? DEF_W) * editor.zoom);
    // Rows hidden by a filter have zero height.
    let hiddenRows = new Set();
    const rowH = r => (hiddenRows.has(r) ? 0 : Math.round((editor.sheet.rowHeights[r] ?? DEF_H) * editor.zoom));
    function computeHiddenRows() {
        hiddenRows = new Set();
        const f = editor.sheet.filter;
        if (!f || !f.hidden) return;
        const sets = Object.entries(f.hidden).filter(([, list]) => Array.isArray(list) && list.length).map(([c, list]) => [Number(c), new Set(list)]);
        if (!sets.length) return;
        for (let r = f.r1 + 1; r <= f.r2; r++) {
            for (const [c, set] of sets) if (set.has(displayText(editor.sheet, r, c))) { hiddenRows.add(r); break; }
        }
    }
    const isRowHidden = r => hiddenRows.has(r);
    // Frozen rows and columns stay put while the rest of the grid scrolls.
    function freezeDims() {
        const f = editor.sheet.freeze || {};
        const fr = clamp(Math.floor(f.rows || 0), 0, Math.max(0, editor.sheet.rows - 1));
        const fc = clamp(Math.floor(f.cols || 0), 0, Math.max(0, editor.sheet.cols - 1));
        return { fr, fc, w: colX[fc] || 0, h: rowY[fr] || 0 };
    }
    function ensureLayout() {
        if (!layoutDirty || !editor.sheet) return;
        const { rows, cols } = editor.sheet;
        computeHiddenRows();
        colX = new Float64Array(cols + 1);
        for (let c = 0; c < cols; c++) colX[c + 1] = colX[c] + colW(c);
        rowY = new Float64Array(rows + 1);
        for (let r = 0; r < rows; r++) rowY[r + 1] = rowY[r] + rowH(r);
        layoutDirty = false;
        layoutVersion++;
        canvasEl.style.width = (colX[cols] + 60) + 'px';
        canvasEl.style.height = (rowY[rows] + 80) + 'px';
        const add = $('sheetsAddRowsBtn');
        add.style.top = (rowY[rows] + 18) + 'px';
        $('sheetsAddRowsLabel').textContent = t('sheets_add_rows', { count: ROW_STEP });
    }
    function search(arr, value, count) {
        let lo = 0, hi = count - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= value) lo = mid; else hi = mid - 1; }
        return clamp(lo, 0, count - 1);
    }
    const colAt = x => search(colX, x, editor.sheet.cols);
    const rowAt = y => search(rowY, y, editor.sheet.rows);
    function* visibleRowsBetween(first, last) {
        for (let row = first; row <= last; row++) {
            if (rowY[row + 1] === rowY[row]) row = rowAt(rowY[row]);
            if (row > last || rowY[row + 1] === rowY[row]) break;
            yield row;
        }
    }
    function mergeAt(r, c) {
        for (const m of editor.sheet.merges) if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
        return null;
    }
    function cellRect(r, c) {
        ensureLayout();
        const m = mergeAt(r, c);
        if (m) return { x: colX[m.c1], y: rowY[m.r1], w: colX[Math.min(m.c2, editor.sheet.cols - 1) + 1] - colX[m.c1], h: rowY[Math.min(m.r2, editor.sheet.rows - 1) + 1] - rowY[m.r1] };
        return { x: colX[c], y: rowY[r], w: colX[c + 1] - colX[c], h: rowY[r + 1] - rowY[r] };
    }
    function selRange() {
        const s = editor.sel;
        let r1 = Math.min(s.ar, s.fr), r2 = Math.max(s.ar, s.fr), c1 = Math.min(s.ac, s.fc), c2 = Math.max(s.ac, s.fc);
        // Grow to include merges that cross the edge.
        let grew = true;
        while (grew) {
            grew = false;
            for (const m of editor.sheet.merges) {
                if (m.r2 < r1 || m.r1 > r2 || m.c2 < c1 || m.c1 > c2) continue;
                if (m.r1 < r1) { r1 = m.r1; grew = true; }
                if (m.r2 > r2) { r2 = m.r2; grew = true; }
                if (m.c1 < c1) { c1 = m.c1; grew = true; }
                if (m.c2 > c2) { c2 = m.c2; grew = true; }
            }
        }
        return { r1, c1, r2: Math.min(r2, editor.sheet.rows - 1), c2: Math.min(c2, editor.sheet.cols - 1) };
    }
    const rangeRect = range => {
        ensureLayout();
        return { x: colX[range.c1], y: rowY[range.r1], w: colX[range.c2 + 1] - colX[range.c1], h: rowY[range.r2 + 1] - rowY[range.r1] };
    };
    function ensureSize(r, c) {
        const sheet = editor.sheet;
        let changed = false;
        if (r >= sheet.rows) { sheet.rows = r + 1; changed = true; }
        if (c >= sheet.cols) { sheet.cols = c + 1; changed = true; }
        if (changed) layoutDirty = true;
        return changed;
    }

    /* ================================================================ values & styles */
    const getCell = (r, c, sheet = editor.sheet) => sheet.cells[r + ':' + c] || null;
    function cellStyle(cell) { return (cell && cell.s) || {}; }
    function displayFormat(sheet, r, c, cell, evaluator = editor.evaluator) {
        const s = cellStyle(cell);
        if (s.fmt && s.fmt.t && s.fmt.t !== 'auto') return s.fmt;
        if (!cell || cell.v === undefined || cell.v === null) return null;
        if (typeof cell.v === 'string' && cell.v[0] === '=') {
            const inferred = evaluator.inferredFormat(sheet, r, c);
            if (s.fmt && Number.isFinite(s.fmt.d)) return Object.assign({}, inferred || { t: 'auto' }, { d: s.fmt.d });
            return inferred;
        }
        const lit = E.parseLiteral(cell.v).fmt;
        if (s.fmt && Number.isFinite(s.fmt.d)) return Object.assign({}, lit || { t: 'auto' }, { d: s.fmt.d });
        return lit;
    }
    function displayText(sheet, r, c, evaluator = editor.evaluator) {
        const cell = getCell(r, c, sheet);
        if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return '';
        const value = evaluator.value(sheet, r, c);
        const fmt = displayFormat(sheet, r, c, cell, evaluator);
        if (fmt && fmt.t === 'text' && !(typeof cell.v === 'string' && cell.v[0] === '=')) return String(cell.v);
        return E.formatValue(value, fmt, numberLocale());
    }
    const ptToPx = pt => pt * 96 / 72;
    function fontCss(s, zoom = 1) {
        const size = ptToPx(s.fs || DEFAULT_PT) * zoom;
        return `${s.i ? 'italic ' : ''}${s.b ? 700 : 400} ${size}px ${s.ff || "'Munetios UI v4 Font'"}, system-ui, sans-serif`;
    }
    const measureCtx = document.createElement('canvas').getContext('2d');
    const measureCache = new Map();
    function textWidth(text, font) {
        const key = font + '|' + text;
        let w = measureCache.get(key);
        if (w === undefined) {
            measureCtx.font = font;
            w = 0;
            for (const line of String(text).split('\n')) w = Math.max(w, measureCtx.measureText(line).width);
            if (measureCache.size > 5000) measureCache.clear();
            measureCache.set(key, w);
        }
        return w;
    }

    /* ================================================================ rendering */
    let renderQueued = false;
    let conditionalFormatLayout = -1;
    const renderedWindows = new WeakMap();
    const renderedCanvases = new WeakMap();
    const gridFonts = new Set();
    const GRID_TILE_STEP = 128;
    let gridFontVersion = 0;
    function renderWindow(element, key, build) {
        const versionedKey = layoutVersion + ':' + key;
        if (renderedWindows.get(element) === versionedKey) return;
        element.innerHTML = build();
        renderedWindows.set(element, versionedKey);
    }
    function scheduleRender() {
        if (renderQueued || !editor.sheet) return;
        renderQueued = true;
        requestAnimationFrame(() => { renderQueued = false; render(); });
    }
    document.fonts?.addEventListener('loadingdone', () => {
        measureCache.clear();
        gridFontVersion++;
        scheduleRender();
    });

    function clearGridCanvases() {
        for (const layer of $('sheetsGridCard').querySelectorAll('.sheets-cells')) {
            const [canvas, controls] = layer.children;
            canvas.width = canvas.height = 0;
            if (controls.firstChild) controls.replaceChildren();
            renderedCanvases.delete(canvas);
            renderedWindows.delete(controls);
        }
    }

    function gridTile(start, length, end) {
        if (length <= 0) return [0, 0];
        const origin = Math.floor(start / GRID_TILE_STEP) * GRID_TILE_STEP;
        const farEdge = Math.ceil((start + length) / GRID_TILE_STEP) * GRID_TILE_STEP;
        return [origin, Math.max(0, Math.min(end, farEdge) - origin)];
    }

    function renderCellWindow(element, [x, width], [y, height], rowBounds, colBounds, palette) {
        const [canvas, controls] = element.children;
        const ratio = window.devicePixelRatio || 1;
        const key = [layoutVersion, gridFontVersion, ratio, x, y, width, height, ...rowBounds, ...colBounds, ...Object.values(palette)].join(':');
        if (renderedCanvases.get(canvas) === key) return;
        renderedCanvases.set(canvas, key);

        const pixelWidth = Math.ceil(width * ratio), pixelHeight = Math.ceil(height * ratio);
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        Object.assign(canvas.style, { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' });
        const ctx = canvas.getContext('2d');
        if (ctx && width && height) {
            ctx.setTransform(ratio, 0, 0, ratio, -x * ratio, -y * ratio);
            ctx.clearRect(x, y, width, height);
            ctx.fillStyle = palette.grid;
        }

        const r0 = Math.max(rowBounds[0], rowAt(y));
        const r1 = Math.min(rowBounds[1], rowAt(y + height - 1));
        // Include possible spill sources to the left of the raster tile.
        const c0 = Math.max(colBounds[0], colAt(x) - 6);
        const c1 = Math.min(colBounds[1], colAt(x + width - 1));
        let html = '';
        if (width && height && r0 <= r1 && c0 <= c1) {
            visitRegion(r0, r1, c0, c1, (r, c, rect, merged, spill) => {
                const cell = getCell(r, c);
                const { filter } = editor.sheet;
                const hasFilter = filter && r === filter.r1 && c >= filter.c1 && c <= filter.c2;
                const s = cellStyle(cell);
                const hasValue = cell?.v !== undefined && cell.v !== null && cell.v !== '';
                const value = hasValue ? editor.evaluator.value(editor.sheet, r, c) : null;
                if (!ctx || hasFilter || cell?.chk || cell?.dd || cell?.note || value === E.ERR.CYCLE || s.ffs || s.fvs || s.bd) {
                    html += cellHtml(r, c, rect, merged, spill);
                } else {
                    paintGridCell(ctx, r, c, rect, merged, spill, cell, value, palette);
                }
            });
        }
        renderWindow(controls, [r0, r1, c0, c1, !!(width && height)].join(':'), () => html);
    }
    function isEmptyForSpill(cell) {
        if (!cell) return true;
        if (cell.v !== undefined && cell.v !== null && cell.v !== '') return false;
        if (cell.chk || cell.dd) return false;
        if (cell.s && (cell.s.bg || cell.s.bd)) return false;
        return true;
    }
    function borderCss(bd) {
        if (!bd) return '';
        let css = '';
        for (const [side, prop] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) if (bd[side]) css += `border-${prop}:${bd[side]};`;
        return css;
    }
    function render() {
        const sheet = editor.sheet;
        if (!sheet || !$('editorContent').classList.contains('active')) return;
        ensureLayout();
        const top = viewport.scrollTop, left = viewport.scrollLeft;
        const vh = viewport.clientHeight, vw = viewport.clientWidth;
        const { fr, fc, w, h } = freezeDims();
        const frozenWidth = Math.min(w, vw), frozenHeight = Math.min(h, vh);
        const rows = [Math.max(fr, rowAt(top + frozenHeight) - 2), h < vh ? Math.min(sheet.rows - 1, rowAt(top + vh) + 2) : -1];
        const cols = [Math.max(fc, colAt(left + frozenWidth) - 6), w < vw ? Math.min(sheet.cols - 1, colAt(left + vw) + 2) : -1];
        const frozenRows = [0, frozenHeight > 0 ? Math.min(fr - 1, rowAt(frozenHeight - 1)) : -1];
        const frozenCols = [0, frozenWidth > 0 ? Math.min(fc - 1, colAt(frozenWidth - 1)) : -1];
        const range = selRange();
        if (conditionalFormatLayout !== layoutVersion) {
            prepareConditionalFormats();
            conditionalFormatLayout = layoutVersion;
        }
        const style = getComputedStyle($('sheetsGridCard'));
        const palette = {
            paper: style.getPropertyValue('--sh-paper').trim(),
            ink: style.getPropertyValue('--sh-ink').trim(),
            grid: style.getPropertyValue('--sh-grid').trim()
        };
        const scrollX = gridTile(left + frozenWidth, vw - frozenWidth, colX[sheet.cols]);
        const scrollY = gridTile(top + frozenHeight, vh - frozenHeight, rowY[sheet.rows]);
        const unfrozenRows = [fr, sheet.rows - 1], unfrozenCols = [fc, sheet.cols - 1];
        renderCellWindow(cellsEl, scrollX, scrollY, unfrozenRows, unfrozenCols, palette);
        renderPanes({ scrollX, scrollY, unfrozenRows, unfrozenCols, frozenRows, frozenCols, w: frozenWidth, h: frozenHeight, left, top, vw, vh, range, palette });
        renderHeaders(rows, cols, frozenRows, frozenCols, frozenWidth, frozenHeight, range);
        updateGridAccessibility(sheet);
        positionOverlays();
    }
    function renderPanes({ scrollX, scrollY, unfrozenRows, unfrozenCols, frozenRows, frozenCols, w, h, left, top, vw, vh, range, palette }) {
        const show = (id, paneRows, paneCols, tileX, tileY, x, y, width, height, transform) => {
            const pane = $(id);
            const inner = pane.firstElementChild;
            const visible = paneRows[1] >= paneRows[0] && paneCols[1] >= paneCols[0];
            pane.style.display = visible ? 'block' : 'none';
            renderCellWindow(inner.firstElementChild, visible ? tileX : [0, 0], visible ? tileY : [0, 0], paneRows, paneCols, palette);
            if (!visible) return;
            Object.assign(pane.style, { width: width + 'px', height: height + 'px' });
            inner.style.transform = transform;
            const selection = paneSelectionHtml(range, x, y, width, height);
            renderWindow(inner.lastElementChild, selection, () => selection);
        };
        show('sheetsPaneTop', frozenRows, unfrozenCols, scrollX, [0, h], left, 0, vw, h, `translateX(${-left}px)`);
        show('sheetsPaneLeft', unfrozenRows, frozenCols, [0, w], scrollY, 0, top, w, vh, `translateY(${-top}px)`);
        show('sheetsPaneCorner', frozenRows, frozenCols, [0, w], [0, h], 0, 0, w, h, 'none');
    }
    function visibleSelectionRect(range, x, y, width, height) {
        if ((range.r1 === range.r2 && range.c1 === range.c2) || isWholeMerge(range)) return null;
        const rect = rangeRect(range);
        // Place clipped border edges just outside the viewport.
        const left = Math.max(rect.x, x - 1), top = Math.max(rect.y, y - 1);
        const w = Math.min(rect.x + rect.w, x + width + 1) - left;
        const h = Math.min(rect.y + rect.h, y + height + 1) - top;
        return w > 0 && h > 0 ? { x: left, y: top, w, h } : null;
    }
    function paneSelectionHtml(range, x, y, width, height) {
        let html = '';
        const rr = visibleSelectionRect(range, x, y, width, height);
        if (rr) {
            html += `<div class="sheets-selection" style="display:block;left:${rr.x}px;top:${rr.y}px;width:${rr.w}px;height:${rr.h}px"></div>`;
        }
        if (!editor.editing) {
            const ar = cellRect(editor.sel.r, editor.sel.c);
            html += `<div class="sheets-active-cell" style="display:block;left:${ar.x}px;top:${ar.y}px;width:${ar.w}px;height:${ar.h}px"></div>`;
        }
        return html;
    }
    function visitRegion(r0, r1, c0, c1, visitCell) {
        const sheet = editor.sheet;
        const covered = new Set();
        // Merged regions that touch the region render as one cell.
        for (const m of sheet.merges) {
            if (m.r2 < r0 || m.r1 > r1 || m.c2 < c0 || m.c1 > c1) continue;
            for (const r of visibleRowsBetween(Math.max(m.r1, r0), Math.min(m.r2, r1))) {
                for (let c = Math.max(m.c1, c0); c <= Math.min(m.c2, c1); c++) covered.add(r + ':' + c);
            }
            visitCell(m.r1, m.c1, cellRect(m.r1, m.c1), true, 0);
        }
        for (const r of visibleRowsBetween(r0, r1)) {
            for (let c = c0; c <= c1; c++) {
                const key = r + ':' + c;
                if (covered.has(key)) continue;
                const cell = sheet.cells[key];
                let w = colX[c + 1] - colX[c];
                let spill = 0;
                if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '' && !cell.chk && !cell.dd) {
                    const s = cellStyle(cell);
                    if (!s.wrap && (!s.ha || s.ha === 'left')) {
                        const value = editor.evaluator.value(sheet, r, c);
                        if (typeof value === 'string' && value) {
                            const need = textWidth(displayText(sheet, r, c), fontCss(s, editor.zoom)) + 18;
                            let cc = c + 1;
                            while (need > w && cc < sheet.cols && isEmptyForSpill(sheet.cells[r + ':' + cc]) && !mergeAt(r, cc) && cc <= c1 + 6) { w += colX[cc + 1] - colX[cc]; covered.add(r + ':' + cc); cc++; spill++; }
                        }
                    }
                }
                visitCell(r, c, { x: colX[c], y: rowY[r], w, h: rowY[r + 1] - rowY[r] }, false, spill);
            }
        }
    }

    /* ================================================================ conditional formatting */
    // Rule: { id, range: 'A1:B9', type, a, b, bg, fc, bold, minColor, maxColor }
    let cfRules = [];
    function prepareConditionalFormats() {
        const sheet = editor.sheet;
        cfRules = (sheet.cf || []).map(rule => {
            const range = E.parseRangeA1(String(rule.range || '').replace(/\$/g, ''));
            return range ? { rule, range, stats: null } : null;
        }).filter(Boolean);
    }
    function cfStats(entry) {
        if (entry.stats) return entry.stats;
        let min = Infinity, max = -Infinity;
        const sheet = editor.sheet;
        for (const key of Object.keys(sheet.cells)) {
            const [r, c] = key.split(':').map(Number);
            if (r < entry.range.r1 || r > entry.range.r2 || c < entry.range.c1 || c > entry.range.c2) continue;
            const v = editor.evaluator.value(sheet, r, c);
            if (typeof v === 'number') { if (v < min) min = v; if (v > max) max = v; }
        }
        entry.stats = { min, max };
        return entry.stats;
    }
    const mixHex = (a, b, t2) => {
        const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
        const ch = s => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
        const x = ch(pa), y = ch(pb);
        return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t2).toString(16).padStart(2, '0')).join('');
    };
    function cfMatches(rule, value, r, c, range) {
        const text = value === null || value === undefined ? '' : String(E.isErr(value) ? value.code : value).toLowerCase();
        const lit = x => E.parseLiteral(String(x ?? '')).value;
        const cmp = x => E.compareValues(value === null ? (typeof lit(x) === 'number' ? 0 : '') : value, lit(x));
        switch (rule.type) {
            case 'empty': return value === null || value === '';
            case 'notEmpty': return !(value === null || value === '');
            case 'gt': return value !== null && cmp(rule.a) > 0;
            case 'gte': return value !== null && cmp(rule.a) >= 0;
            case 'lt': return value !== null && cmp(rule.a) < 0;
            case 'lte': return value !== null && cmp(rule.a) <= 0;
            case 'eq': return cmp(rule.a) === 0;
            case 'neq': return cmp(rule.a) !== 0;
            case 'between': return value !== null && cmp(rule.a) >= 0 && cmp(rule.b) <= 0;
            case 'notBetween': return value !== null && (cmp(rule.a) < 0 || cmp(rule.b) > 0);
            case 'contains': return text.includes(String(rule.a ?? '').toLowerCase());
            case 'notContains': return !text.includes(String(rule.a ?? '').toLowerCase());
            case 'startsWith': return text.startsWith(String(rule.a ?? '').toLowerCase());
            case 'endsWith': return text.endsWith(String(rule.a ?? '').toLowerCase());
            case 'formula': {
                const formula = E.shiftFormula('=' + String(rule.a || '').replace(/^=/, ''), r - range.r1, c - range.c1);
                const result = editor.evaluator.evalFormula(editor.sheet, r, c, formula);
                return result === true || (typeof result === 'number' && result !== 0);
            }
        }
        return false;
    }
    function conditionalStyle(r, c, value) {
        let out = null;
        for (const entry of cfRules) {
            const { rule, range } = entry;
            if (r < range.r1 || r > range.r2 || c < range.c1 || c > range.c2) continue;
            if (rule.type === 'scale') {
                if (typeof value !== 'number') continue;
                const { min, max } = cfStats(entry);
                const t2 = max > min ? (value - min) / (max - min) : 1;
                out = Object.assign(out || {}, { bg: mixHex(rule.minColor || '#FFFFFF', rule.maxColor || '#57BB8A', clamp(t2, 0, 1)) });
                continue;
            }
            if (!cfMatches(rule, value, r, c, range)) continue;
            out = Object.assign(out || {}, rule.bg ? { bg: rule.bg } : {}, rule.fc ? { fc: rule.fc } : {}, rule.bold ? { bold: true } : {});
            break; // first matching rule wins, like other spreadsheet apps
        }
        return out;
    }

    const gridGraphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    function gridTextLines(ctx, text, width, wrap) {
        const paragraphs = text.split('\n');
        if (!wrap) return paragraphs;
        const lines = [];
        for (const paragraph of paragraphs) {
            let line = '';
            for (const word of paragraph.match(/\S+|\s+/gu) || []) {
                if (line && ctx.measureText(line + word).width > width) {
                    lines.push(line);
                    line = '';
                }
                if (ctx.measureText(word).width <= width) {
                    line += word;
                    continue;
                }
                const characters = gridGraphemes ? Array.from(gridGraphemes.segment(word), entry => entry.segment) : Array.from(word);
                for (const character of characters) {
                    if (line && ctx.measureText(line + character).width > width) {
                        lines.push(line);
                        line = '';
                    }
                    line += character;
                }
            }
            lines.push(line);
        }
        return lines;
    }

    function paintGridCell(ctx, r, c, { x, y, w, h }, merged, spill, cell, value, palette) {
        if (w <= 0 || h <= 0) return;
        const s = cellStyle(cell);
        const cf = cfRules.length ? conditionalStyle(r, c, value) : null;
        const background = cf?.bg || s.bg;
        if (background || merged) {
            ctx.fillStyle = palette.paper;
            if (background) ctx.fillStyle = background;
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = palette.grid;
        }
        ctx.fillRect(x, y + h - 1, w, 1);
        if (!spill) ctx.fillRect(x + w - 1, y, 1, h - 1);
        if (value === null) return;
        const text = displayText(editor.sheet, r, c);
        if (!text) return;

        const paintStyle = cf?.bold ? { ...s, b: true } : s;
        const font = fontCss(paintStyle, editor.zoom);
        const fontFace = fontCss({ ff: s.ff, b: paintStyle.b, i: s.i });
        if (document.fonts && !gridFonts.has(fontFace)) {
            gridFonts.add(fontFace);
            document.fonts.load(fontFace).catch(() => {});
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 8, y, Math.max(0, w - 16), h - 1);
        ctx.clip();
        ctx.font = font;
        ctx.textBaseline = 'middle';
        ctx.textAlign = s.ha || (typeof value === 'number' ? 'right' : typeof value === 'boolean' || E.isErr(value) ? 'center' : 'left');
        ctx.fillStyle = palette.ink;
        const foreground = E.isErr(value) ? '#c62828' : cell.link ? '#4c1fc7' : cf?.fc || s.fc;
        if (foreground) ctx.fillStyle = foreground;
        const textX = ctx.textAlign === 'right' ? x + w - 8 : ctx.textAlign === 'center' ? x + w / 2 : x + 8;
        const size = ptToPx(s.fs || DEFAULT_PT) * editor.zoom;
        const lineHeight = size * 1.25;
        const lines = gridTextLines(ctx, text, Math.max(1, w - 16), s.wrap);
        const blockHeight = lines.length * lineHeight;
        const blockY = s.va === 'top' ? y + 6 : s.va === 'bottom' ? y + h - 6 - blockHeight : y + (h - blockHeight) / 2;
        lines.forEach((line, index) => {
            const textY = blockY + (index + 0.5) * lineHeight;
            if (textY + lineHeight < y || textY - lineHeight > y + h) return;
            ctx.fillText(line, textX, textY);
            if (!s.u && !s.st && !cell.link) return;
            const width = ctx.measureText(line).width;
            const left = ctx.textAlign === 'right' ? textX - width : ctx.textAlign === 'center' ? textX - width / 2 : textX;
            if (s.u || cell.link) ctx.fillRect(left, textY + size * 0.4, width, 1);
            if (s.st) ctx.fillRect(left, textY, width, 1);
        });
        ctx.restore();
    }

    function cellHtml(r, c, rect, merged, spill) {
        const sheet = editor.sheet;
        const cell = sheet.cells[r + ':' + c];
        const s = cellStyle(cell);
        let style = `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;`;
        let cls = 'sheets-cell';
        if (merged) cls += ' is-merged';
        if (spill) cls += ' is-spill';
        const hasValue = !!cell && cell.v !== undefined && cell.v !== null && cell.v !== '';
        const cf = cfRules.length ? conditionalStyle(r, c, hasValue ? editor.evaluator.value(sheet, r, c) : null) : null;
        const f = sheet.filter;
        const filterBtn = f && r === f.r1 && c >= f.c1 && c <= f.c2
            ? `<span class="sheets-filter-btn${f.hidden && f.hidden[c] && f.hidden[c].length ? ' is-active' : ''}" data-filter-col="${c}" role="button" aria-label="${esc(t('sheets_filter'))}" data-tooltip="${esc(t('sheets_filter'))}">${f.hidden && f.hidden[c] && f.hidden[c].length ? 'filter_alt' : 'filter_list'}</span>`
            : '';
        if (!cell && !cf && !filterBtn) return `<div class="${cls}" style="${style}"></div>`;
        if (!cell) return `<div class="${cls}" style="${style}${cf && cf.bg ? `background-color:${cf.bg};` : ''}" data-r="${r}" data-c="${c}"><span class="sheets-text"></span>${filterBtn}</div>`;
        const bg = (cf && cf.bg) || s.bg, fc = (cf && cf.fc) || s.fc;
        if (bg) style += `background-color:${bg};`;
        if (fc) style += `color:${fc};`;
        if (s.b || (cf && cf.bold)) style += 'font-weight:700;';
        if (s.i) style += 'font-style:italic;';
        const deco = [s.u && 'underline', s.st && 'line-through'].filter(Boolean).join(' ');
        if (deco) style += `text-decoration:${deco};`;
        if (s.ff) style += `font-family:${s.ff.replace(/"/g, "'")}, system-ui, sans-serif;`;
        if (s.ffs) style += `font-feature-settings:${String(s.ffs).replace(/"/g, "'")};`;
        if (s.fvs) style += `font-variation-settings:${String(s.fvs).replace(/"/g, "'")};`;
        const size = ptToPx(s.fs || DEFAULT_PT) * editor.zoom;
        if (size !== 18) style += `font-size:${size}px;`;
        style += borderCss(s.bd);
        const value = cell.v !== undefined && cell.v !== null && cell.v !== '' ? editor.evaluator.value(sheet, r, c) : null;
        const ha = s.ha || (typeof value === 'number' ? 'right' : typeof value === 'boolean' || E.isErr(value) ? 'center' : 'left');
        cls += ' ha-' + ha;
        if (s.va === 'top') cls += ' va-top'; else if (s.va === 'bottom') cls += ' va-bottom';
        if (s.wrap) cls += ' is-wrap';
        if (E.isErr(value)) cls += ' is-error';
        if (cell.link) cls += ' is-link';
        let attrs = ` data-r="${r}" data-c="${c}"`;
        if (cell.note) { cls += ' has-note'; attrs += ` data-tooltip="${esc(cell.note)}"`; }
        else if (E.isErr(value) && value === E.ERR.CYCLE) attrs += ` data-tooltip="${esc(t('sheets_cycle_help'))}"`;
        let inner;
        if (cell.chk) {
            const checked = value === true || (typeof value === 'string' && value.toUpperCase() === 'TRUE');
            inner = `<span class="sheets-check${checked ? ' is-checked' : ''}" data-check="1" role="checkbox" aria-checked="${checked}">check</span>`;
        } else if (cell.dd) {
            const text = displayText(sheet, r, c);
            inner = text
                ? `<span class="sheets-dd-chip"><span class="sheets-text">${esc(text)}</span><span class="sheets-dd-arrow" data-dd="1">arrow_drop_down</span></span>`
                : `<span class="sheets-text"></span><span class="sheets-dd-arrow" data-dd="1">arrow_drop_down</span>`;
        } else {
            inner = `<span class="sheets-text">${esc(displayText(sheet, r, c))}</span>`;
        }
        return `<div class="${cls}" style="${style}"${attrs}>${inner}${filterBtn}</div>`;
    }
    function renderHeaders(rows, cols, frozenRows, frozenCols, w, h, range) {
        const colInner = $('sheetsColHeadersInner'), rowInner = $('sheetsRowHeadersInner');
        const sheet = editor.sheet;
        const fullCols = range.r1 === 0 && range.r2 === sheet.rows - 1;
        const fullRows = range.c1 === 0 && range.c2 === sheet.cols - 1;
        const colCell = c => {
            const active = c >= range.c1 && c <= range.c2;
            return `<div class="sheets-hcell${active ? (fullCols ? ' is-full' : ' is-active') : ''}" data-col="${c}" style="left:${colX[c]}px;width:${colX[c + 1] - colX[c]}px;">${E.colName(c)}</div><div class="sheets-resizer" data-col-resize="${c}" style="left:${colX[c + 1]}px"></div>`;
        };
        const rowCell = r => {
            const active = r >= range.r1 && r <= range.r2;
            return `<div class="sheets-hcell${active ? (fullRows ? ' is-full' : ' is-active') : ''}" data-row="${r}" style="top:${rowY[r]}px;height:${rowY[r + 1] - rowY[r]}px;">${r + 1}</div><div class="sheets-resizer" data-row-resize="${r}" style="top:${rowY[r + 1]}px"></div>`;
        };
        const renderCols = (el, [first, last]) => {
            renderWindow(el, [first, last, range.c1, range.c2, fullCols].join(':'), () => {
                let html = '';
                for (let c = first; c <= last; c++) html += colCell(c);
                return html;
            });
        };
        const renderRows = (el, [first, last]) => {
            renderWindow(el, [first, last, range.r1, range.r2, fullRows].join(':'), () => {
                let html = '';
                for (const r of visibleRowsBetween(first, last)) html += rowCell(r);
                return html;
            });
        };
        renderCols(colInner, cols);
        colInner.style.transform = `translateX(${-viewport.scrollLeft}px)`;
        renderRows(rowInner, rows);
        rowInner.style.transform = `translateY(${-viewport.scrollTop}px)`;
        // Frozen headers do not scroll.
        const colFrozen = $('sheetsColHeadersFrozen'), rowFrozen = $('sheetsRowHeadersFrozen');
        renderCols(colFrozen, frozenCols);
        renderRows(rowFrozen, frozenRows);
        colFrozen.style.width = w + 'px';
        colFrozen.style.display = w ? 'block' : 'none';
        rowFrozen.style.height = h + 'px';
        rowFrozen.style.display = h ? 'block' : 'none';
    }
    function positionOverlays() {
        if (!editor.sheet) return;
        const range = selRange();
        const selEl = $('sheetsSelection'), activeEl = $('sheetsActiveCell');
        const visible = visibleSelectionRect(range, viewport.scrollLeft, viewport.scrollTop, viewport.clientWidth, viewport.clientHeight);
        if (visible) {
            Object.assign(selEl.style, { display: 'block', left: visible.x + 'px', top: visible.y + 'px', width: visible.w + 'px', height: visible.h + 'px' });
        } else selEl.style.display = 'none';
        const ar = cellRect(editor.sel.r, editor.sel.c);
        // While typing, the editor's own border is the only outline.
        Object.assign(activeEl.style, { display: editor.editing ? 'none' : 'block', left: ar.x + 'px', top: ar.y + 'px', width: ar.w + 'px', height: ar.h + 'px' });
        // Fill handle sits at the bottom-right of the selection.
        const handle = $('sheetsFillHandle');
        const rr = rangeRect(range);
        handle.style.left = (rr.x + rr.w - ar.x - 6) + 'px';
        handle.style.top = (rr.y + rr.h - ar.y - 6) + 'px';
        handle.style.right = 'auto'; handle.style.bottom = 'auto';
        handle.style.display = editor.editing ? 'none' : 'block';
        positionLinkChip();
        if (editor.editing) positionCellEditor();
    }
    viewport.addEventListener('scroll', () => {
        $('sheetsColHeadersInner').style.transform = `translateX(${-viewport.scrollLeft}px)`;
        $('sheetsRowHeadersInner').style.transform = `translateY(${-viewport.scrollTop}px)`;
        $('sheetsPaneTop').firstElementChild.style.transform = `translateX(${-viewport.scrollLeft}px)`;
        $('sheetsPaneLeft').firstElementChild.style.transform = `translateY(${-viewport.scrollTop}px)`;
        scheduleRender();
    }, { passive: true });

    function layoutEditorHeight() {
        const shell = $('sheetsEditorShell');
        if (!shell || !$('editorContent').classList.contains('active')) return;
        const top = shell.getBoundingClientRect().top + (document.querySelector('.main-container')?.scrollTop || 0);
        const bar = $('mobileEditorToolbar');
        const barSpace = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().height + 20 : 0;
        const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        shell.style.height = Math.max(window.innerWidth <= 1025 ? 260 : 320, height - top - 12 - barSpace) + 'px';
    }
    new ResizeObserver(() => { layoutEditorHeight(); scheduleRender(); }).observe($('sheetsToolbar'));
    new ResizeObserver(() => scheduleRender()).observe(viewport);

    /* ================================================================ selection */
    function setSelection(r, c, { extend = false, keepAnchor = false, scroll = true } = {}) {
        const sheet = editor.sheet;
        r = clamp(r, 0, Number.MAX_SAFE_INTEGER);
        c = clamp(c, 0, Number.MAX_SAFE_INTEGER);
        if (ensureSize(r, c)) { touchBook(editor.book); }
        if (extend) { editor.sel.fr = r; editor.sel.fc = c; }
        else {
            const m = mergeAt(r, c);
            if (m) { r = m.r1; c = m.c1; }
            editor.sel = { r, c, ar: r, ac: c, fr: m ? m.r2 : r, fc: m ? m.c2 : c };
            if (!keepAnchor && m) { editor.sel.ar = m.r1; editor.sel.ac = m.c1; }
        }
        editor.selectedChart = null;
        document.querySelectorAll('.sheets-chart.is-selected').forEach(el => el.classList.remove('is-selected'));
        if (scroll) scrollIntoView(extend ? editor.sel.fr : editor.sel.r, extend ? editor.sel.fc : editor.sel.c);
        updateSelectionUI();
        void sheet;
    }
    function selectRange(r1, c1, r2, c2, activeR = r1, activeC = c1) {
        ensureSize(Math.max(r1, r2), Math.max(c1, c2));
        editor.sel = { r: activeR, c: activeC, ar: r1, ac: c1, fr: r2, fc: c2 };
        updateSelectionUI();
    }
    function scrollIntoView(r, c) {
        ensureLayout();
        const rr = Math.min(r, editor.sheet.rows - 1), cc = Math.min(c, editor.sheet.cols - 1);
        const rect = cellRect(rr, cc);
        const vw = viewport.clientWidth, vh = viewport.clientHeight;
        const { fr, fc, w: fw, h: fh } = freezeDims();
        // Frozen cells are always visible; other cells must clear the frozen panes.
        if (cc >= fc) {
            if (rect.x - fw < viewport.scrollLeft) viewport.scrollLeft = rect.x - fw;
            else if (rect.x + rect.w > viewport.scrollLeft + vw) viewport.scrollLeft = Math.min(rect.x - fw, rect.x + rect.w - vw);
        }
        if (rr >= fr) {
            if (rect.y - fh < viewport.scrollTop) viewport.scrollTop = rect.y - fh;
            else if (rect.y + rect.h > viewport.scrollTop + vh) viewport.scrollTop = Math.min(rect.y - fh, rect.y + rect.h - vh);
        }
    }
    function updateSelectionUI({ rangeOnly = false } = {}) {
        if (!editor.sheet) return;
        const range = selRange();
        const single = range.r1 === range.r2 && range.c1 === range.c2;
        if (document.activeElement !== nameBox) nameBox.value = single || isWholeMerge(range) ? E.refName(editor.sel.r, editor.sel.c) : E.rangeName(range);
        scheduleRender();
        if (rangeOnly) return;
        if (!editor.editing) {
            const cell = getCell(editor.sel.r, editor.sel.c);
            formulaInput.value = cell && cell.v !== undefined && cell.v !== null ? String(cell.v) : '';
        }
        updateToolbarState();
        const text = displayText(editor.sheet, editor.sel.r, editor.sel.c);
        live.textContent = E.refName(editor.sel.r, editor.sel.c) + (text ? ': ' + text : '');
        updateStats(range);
    }
    function updateGridAccessibility(sheet) {
        const row = $('sheetsAccessibleRow'), cell = $('sheetsAccessibleCell');
        const { r, c } = editor.sel;
        const text = displayText(sheet, r, c);
        if (cell.textContent !== text) cell.textContent = text;
        for (const [element, attribute, value] of [
            [viewport, 'aria-rowcount', sheet.rows], [viewport, 'aria-colcount', sheet.cols],
            [row, 'aria-rowindex', r + 1], [cell, 'aria-colindex', c + 1], [cell, 'aria-selected', 'true'],
            [viewport, 'aria-activedescendant', cell.id]
        ]) {
            if (element.getAttribute(attribute) !== String(value)) element.setAttribute(attribute, value);
        }
    }
    function isWholeMerge(range) { const m = mergeAt(range.r1, range.c1); return !!m && m.r1 === range.r1 && m.c1 === range.c1 && m.r2 === range.r2 && m.c2 === range.c2; }
    let statsFrame = 0;
    function cancelSelectionStats() {
        if (statsFrame) cancelAnimationFrame(statsFrame);
        statsFrame = 0;
    }
    function updateStats(range) {
        cancelSelectionStats();
        const el = $('sheetsStats');
        el.textContent = '';
        const count = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
        if (count < 2) return;
        let sum = 0, nums = 0, filled = 0;
        const { sheet, evaluator } = editor;
        const addValue = (key, r, c) => {
            const raw = sheet.cells[key]?.v;
            if (raw === undefined || raw === null || raw === '') return;
            const v = typeof raw === 'string' && raw.startsWith('=') ? evaluator.value(sheet, r, c) : E.parseLiteral(raw).value;
            if (v === null || v === '') return;
            filled++;
            if (typeof v === 'number') { sum += v; nums++; }
        };
        const showStats = () => {
            const { r, c } = editor.sel;
            const fmt = displayFormat(sheet, r, c, getCell(r, c));
            const f = v => E.formatValue(v, fmt && fmt.t !== 'text' && fmt.t !== 'date' && fmt.t !== 'time' && fmt.t !== 'datetime' ? fmt : null, numberLocale());
            el.textContent = nums ? `${t('sheets_sum')}: ${f(sum)} · ${t('sheets_average')}: ${f(sum / nums)} · ${t('sheets_count')}: ${filled}` : (filled ? `${t('sheets_count')}: ${filled}` : '');
        };
        if (count <= 64) {
            for (let r = range.r1; r <= range.r2; r++) {
                for (let c = range.c1; c <= range.c2; c++) addValue(r + ':' + c, r, c);
            }
            showStats();
            return;
        }
        // Walk stored cells in short slices so large selections can paint and accept input.
        let keys, index = 0;
        const scan = () => {
            statsFrame = 0;
            keys ??= Object.keys(sheet.cells);
            const deadline = performance.now() + 4;
            while (index < keys.length && performance.now() < deadline) {
                const key = keys[index++];
                const i = key.indexOf(':');
                const r = +key.slice(0, i), c = +key.slice(i + 1);
                if (r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2) addValue(key, r, c);
            }
            if (index < keys.length) statsFrame = requestAnimationFrame(scan);
            else showStats();
        };
        // Let the selection highlight paint before enumerating the sheet's cells.
        statsFrame = requestAnimationFrame(() => { statsFrame = requestAnimationFrame(scan); });
    }

    /* ================================================================ pointer interaction */
    // Screen point to grid coordinates; points over frozen panes don't scroll.
    function canvasPoint(clientX, clientY) {
        ensureLayout();
        const rect = viewport.getBoundingClientRect();
        const lx = clientX - rect.left, ly = clientY - rect.top;
        const { w, h } = freezeDims();
        return { x: lx < w ? lx : lx + viewport.scrollLeft, y: ly < h ? ly : ly + viewport.scrollTop };
    }
    function pointToCell(event) {
        const { x, y } = canvasPoint(event.clientX, event.clientY);
        return { r: rowAt(y), c: colAt(x), x, y };
    }
    const safeCapture = (el, id) => { try { el.setPointerCapture(id); } catch {} };
    let drag = null;
    let dragFrame = 0;
    let pendingDragPoint = null;
    function beginDrag(event, details, captureTarget) {
        drag = { ...details, pointerId: event.pointerId, sheet: editor.sheet, captureTarget, clientX: event.clientX, clientY: event.clientY };
        if (captureTarget) safeCapture(captureTarget, event.pointerId);
    }
    function gridPointerDown(event) {
        if (!editor.sheet || drag || event.button !== 0) return;
        if (event.target.closest('.sheets-chart') || event.target === cellEditor || event.target.closest('.sheets-link-chip')) return;
        if (event.target.closest('#sheetsAddRowsBtn')) return;
        const touch = event.pointerType === 'touch';
        const { r, c } = pointToCell(event);
        if (event.target.closest('#sheetsFillHandle')) {
            event.preventDefault();
            beginDrag(event, { kind: 'fill', origin: selRange(), r, c }, viewport);
            return;
        }
        // Clicking cells while typing a formula inserts references.
        if (editor.editing && canInsertRef()) {
            event.preventDefault();
            const m = mergeAt(r, c);
            const rr = m ? m.r1 : r, cc = m ? m.c1 : c;
            beginDrag(event, { kind: 'ref', r1: rr, c1: cc, r, c, editing: editor.editing }, viewport);
            insertRef({ r1: rr, c1: cc, r2: rr, c2: cc });
            return;
        }
        if (editor.editing) commitEdit();
        if (event.target.closest('[data-check]') && !event.shiftKey) {
            event.preventDefault();
            setSelection(r, c, { scroll: false });
            toggleChecks([{ r, c }]);
            viewport.focus({ preventScroll: true });
            return;
        }
        const filterBtn = event.target.closest('[data-filter-col]');
        if (filterBtn) { event.preventDefault(); openFilterDialog(Number(filterBtn.dataset.filterCol), filterBtn); return; }
        if (event.target.closest('[data-dd]')) {
            event.preventDefault();
            setSelection(r, c, { scroll: false });
            openDropdownMenu(r, c, event.target.closest('[data-dd]'));
            return;
        }
        if (touch) {
            beginDrag(event, { kind: 'tap', r, c, x: event.clientX, y: event.clientY, wasActive: editor.sel.r === r && editor.sel.c === c && !event.shiftKey });
            return;
        }
        event.preventDefault();
        viewport.focus({ preventScroll: true });
        if (event.shiftKey) setSelection(r, c, { extend: true, scroll: false });
        else setSelection(r, c, { scroll: false });
        beginDrag(event, { kind: 'select' }, viewport);
    }
    viewport.addEventListener('pointerdown', gridPointerDown);
    function updateDragSelection() {
        if (!drag.selectionChanged) {
            drag.selectionChanged = true;
            cancelSelectionStats();
            $('sheetsStats').textContent = '';
        }
        updateSelectionUI({ rangeOnly: true });
    }
    function moveDrag(point) {
        if (drag.kind === 'resize') { previewResize(drag, point); return; }
        const { r, c } = pointToCell(point);
        if (drag.kind === 'select') {
            if (editor.sel.fr !== r || editor.sel.fc !== c) { editor.sel.fr = r; editor.sel.fc = c; updateDragSelection(); }
        } else if (drag.kind === 'header') {
            const field = drag.axis === 'col' ? 'fc' : 'fr';
            const index = drag.axis === 'col' ? c : r;
            if (editor.sel[field] !== index) { editor.sel[field] = index; updateDragSelection(); }
        } else if (drag.r !== r || drag.c !== c) {
            drag.r = r;
            drag.c = c;
            if (drag.kind === 'fill') showFillPreview(drag);
            else if (drag.editing === editor.editing) replaceLastRef({ r1: Math.min(drag.r1, r), c1: Math.min(drag.c1, c), r2: Math.max(drag.r1, r), c2: Math.max(drag.c1, c) });
        }
    }
    window.addEventListener('pointermove', event => {
        if (drag?.pointerId !== event.pointerId) return;
        if (drag.sheet !== editor.sheet || !(event.buttons & 1)) { endDrag(); return; }
        if (drag.kind === 'tap') {
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) endDrag();
            return;
        }
        if (drag.clientX === event.clientX && drag.clientY === event.clientY) return;
        drag.clientX = event.clientX;
        drag.clientY = event.clientY;
        pendingDragPoint = { clientX: event.clientX, clientY: event.clientY };
        if (dragFrame) return;
        dragFrame = requestAnimationFrame(() => {
            dragFrame = 0;
            const point = pendingDragPoint;
            pendingDragPoint = null;
            if (drag?.sheet === editor.sheet && point) moveDrag(point);
        });
    }, { passive: true });
    function endDrag(event) {
        if (!drag || (event && event.pointerId !== drag.pointerId)) return;
        if (dragFrame) cancelAnimationFrame(dragFrame);
        dragFrame = 0;
        if (event?.type === 'pointerup' && drag.sheet === editor.sheet && pendingDragPoint) moveDrag(pendingDragPoint);
        pendingDragPoint = null;
        const d = drag;
        drag = null;
        if (d.selectionChanged && d.sheet === editor.sheet) updateSelectionUI();
        if (d.captureTarget?.hasPointerCapture(d.pointerId)) d.captureTarget.releasePointerCapture(d.pointerId);
        if (d.kind === 'fill') $('sheetsFillPreview').style.display = 'none';
        if (d.kind === 'resize') $('sheetsResizeGuide').hidden = true;
        if (event?.type !== 'pointerup' || d.sheet !== editor.sheet) return;
        if (d.kind === 'resize') { finishResize(d, event); return; }
        if (d.kind === 'fill') performFill(d);
        if (d.kind === 'tap' && Math.hypot(event.clientX - d.x, event.clientY - d.y) <= 10) {
            if (d.wasActive) startEdit(null);
            else setSelection(d.r, d.c, { scroll: false });
        }
        if (d.kind === 'ref' && d.editing === editor.editing) {
            const field = d.editing.source === 'bar' ? formulaInput : cellEditor;
            field.focus({ preventScroll: true });
        }
    }
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);
    window.addEventListener('lostpointercapture', event => {
        if (event.target === drag?.captureTarget) endDrag(event);
    }, true);
    window.addEventListener('blur', () => endDrag());
    document.addEventListener('visibilitychange', () => { if (document.hidden) endDrag(); });
    function gridDblClick(event) {
        if (event.target.closest('.sheets-chart') || event.target.closest('[data-check]') || event.target.closest('[data-dd]') || event.target.closest('[data-filter-col]') || event.target === cellEditor) return;
        const { r, c } = pointToCell(event);
        setSelection(r, c, { scroll: false });
        // Date and time cells open the Munetios UI v4 date/time picker; F2 still edits the text.
        const kind = pickerKindFor(editor.sel.r, editor.sel.c);
        if (kind) { openCellPicker(kind); return; }
        startEdit(null);
    }
    viewport.addEventListener('dblclick', gridDblClick);
    // Frozen panes sit above the grid; their clicks act on the grid underneath.
    ['sheetsPaneTop', 'sheetsPaneLeft', 'sheetsPaneCorner'].forEach(id => {
        const pane = $(id);
        pane.addEventListener('pointerdown', gridPointerDown);
        pane.addEventListener('dblclick', event => gridDblClick(event));
        pane.addEventListener('contextmenu', event => gridContextMenu(event));
        pane.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) return; event.preventDefault(); viewport.scrollBy({ left: event.deltaX, top: event.deltaY }); }, { passive: false });
    });
    function gridContextMenu(event) {
        if (event.target.closest('.sheets-chart') || event.target === cellEditor) return;
        event.preventDefault();
        const { r, c } = pointToCell(event);
        const range = selRange();
        if (r < range.r1 || r > range.r2 || c < range.c1 || c > range.c2) setSelection(r, c, { scroll: false });
        openCellContextMenu(event.clientX, event.clientY);
    }
    viewport.addEventListener('contextmenu', gridContextMenu);
    $('sheetsAddRowsBtn').addEventListener('click', () => {
        editStructure(() => { editor.sheet.rows += ROW_STEP; });
        layoutDirty = true;
        scheduleRender();
    });

    // Header selection and resizing
    function headerPointer(event, axis) {
        if (event.button !== 0 || !editor.sheet || drag) return;
        const resizer = event.target.closest(axis === 'col' ? '[data-col-resize]' : '[data-row-resize]');
        if (resizer) { startResize(event, axis, Number(resizer.dataset[axis === 'col' ? 'colResize' : 'rowResize'])); return; }
        const cellEl = event.target.closest(axis === 'col' ? '[data-col]' : '[data-row]');
        if (!cellEl) return;
        event.preventDefault();
        if (editor.editing) commitEdit();
        const index = Number(cellEl.dataset[axis]);
        const sheet = editor.sheet;
        if (axis === 'col') {
            if (event.shiftKey) { editor.sel.fc = index; editor.sel.ar = 0; editor.sel.fr = sheet.rows - 1; updateSelectionUI(); }
            else selectRange(0, index, sheet.rows - 1, index, viewportTopRow(), index);
        } else {
            if (event.shiftKey) { editor.sel.fr = index; editor.sel.ac = 0; editor.sel.fc = sheet.cols - 1; updateSelectionUI(); }
            else selectRange(index, 0, index, sheet.cols - 1, index, viewportLeftCol());
        }
        viewport.focus({ preventScroll: true });
        beginDrag(event, { kind: 'header', axis }, event.currentTarget);
    }
    const viewportTopRow = () => { ensureLayout(); return clamp(rowAt(viewport.scrollTop), 0, editor.sheet.rows - 1); };
    const viewportLeftCol = () => { ensureLayout(); return clamp(colAt(viewport.scrollLeft), 0, editor.sheet.cols - 1); };
    $('sheetsColHeaders').addEventListener('pointerdown', event => headerPointer(event, 'col'));
    $('sheetsRowHeaders').addEventListener('pointerdown', event => headerPointer(event, 'row'));
    $('sheetsColHeaders').addEventListener('dblclick', event => {
        const resizer = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-col-resize]');
        if (resizer && event.currentTarget.contains(resizer)) autoFitColumns([Number(resizer.dataset.colResize)]);
    });
    $('sheetsColHeaders').addEventListener('contextmenu', event => { event.preventDefault(); const h = event.target.closest('[data-col]'); if (h) { const c = Number(h.dataset.col); const range = selRange(); if (c < range.c1 || c > range.c2 || range.r1 !== 0) selectRange(0, c, editor.sheet.rows - 1, c, viewportTopRow(), c); } openCellContextMenu(event.clientX, event.clientY); });
    $('sheetsRowHeaders').addEventListener('contextmenu', event => { event.preventDefault(); const h = event.target.closest('[data-row]'); if (h) { const r = Number(h.dataset.row); const range = selRange(); if (r < range.r1 || r > range.r2 || range.c1 !== 0) selectRange(r, 0, r, editor.sheet.cols - 1, r, viewportLeftCol()); } openCellContextMenu(event.clientX, event.clientY); });
    $('sheetsCorner').addEventListener('click', () => { commitEdit(); selectRange(0, 0, editor.sheet.rows - 1, editor.sheet.cols - 1, editor.sel.r, editor.sel.c); viewport.focus({ preventScroll: true }); });
    function startResize(event, axis, index) {
        if (blockIfLocked()) return;
        event.preventDefault();
        ensureLayout();
        const sheet = editor.sheet;
        const column = axis === 'col';
        const sizes = column ? sheet.colWidths : sheet.rowHeights;
        const { fr, fc } = freezeDims();
        const frozen = index < (column ? fc : fr);
        const range = selRange();
        const first = column ? range.c1 : range.r1, last = column ? range.c2 : range.r2;
        const fullAxis = index >= first && index <= last && (column
            ? range.r1 === 0 && range.r2 === sheet.rows - 1
            : range.c1 === 0 && range.c2 === sheet.cols - 1);
        beginDrag(event, {
            kind: 'resize', axis, column, frozen, sizes,
            first: fullAxis ? first : index, last: fullAxis ? last : index,
            defaultSize: column ? DEF_W : DEF_H,
            startSize: sizes[index] ?? (column ? DEF_W : DEF_H),
            startEdge: (column ? colX : rowY)[index + 1],
            startPointer: column ? event.clientX : event.clientY,
            startScroll: frozen ? 0 : (column ? viewport.scrollLeft : viewport.scrollTop)
        }, event.currentTarget);
        const guide = $('sheetsResizeGuide');
        guide.dataset.axis = axis;
        guide.style.left = '';
        guide.style.top = '';
        previewResize(drag, event);
        guide.hidden = false;
    }
    function resizeSize(d, event) {
        const pointer = d.column ? event.clientX : event.clientY;
        const scroll = d.frozen ? 0 : (d.column ? viewport.scrollLeft : viewport.scrollTop);
        return Math.max(24, Math.round(d.startSize + (pointer - d.startPointer + scroll - d.startScroll) / editor.zoom));
    }
    function previewResize(d, event) {
        const scroll = d.frozen ? 0 : (d.column ? viewport.scrollLeft : viewport.scrollTop);
        const offset = d.column ? viewport.offsetLeft : viewport.offsetTop;
        const edge = d.startEdge + Math.round((resizeSize(d, event) - d.startSize) * editor.zoom) - scroll;
        $('sheetsResizeGuide').style[d.column ? 'left' : 'top'] = (offset + edge) + 'px';
    }
    function finishResize(d, event) {
        const size = resizeSize(d, event);
        if (size === d.startSize || blockIfLocked()) return;
        const before = [];
        const after = size === d.defaultSize ? undefined : size;
        for (let index = d.first; index <= d.last; index++) {
            if ((d.sizes[index] ?? d.defaultSize) !== size) before.push([index, d.sizes[index]]);
        }
        if (!before.length) return;
        const entry = { type: 'size', axis: d.axis, before, after };
        applySizeChange(d.sheet, entry, 'redo');
        pushHistory(entry);
        layoutDirty = true;
        touchBook(editor.book);
        scheduleRender();
        refreshCharts();
        refreshSplitSoon();
    }
    const seq = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; };

    /* ================================================================ history */
    function snapshotState() { return JSON.stringify({ sheets: editor.book.sheets, activeSheet: editor.sheet.id }); }
    function restoreState(json) {
        const state = JSON.parse(json);
        editor.book.sheets = state.sheets.map(normalizeSheet);
        editor.sheet = editor.book.sheets.find(s => s.id === state.activeSheet) || editor.book.sheets[0];
        editor.book.activeSheet = editor.sheet.id;
        layoutDirty = true;
        destroyCharts();
        renderTabs();
    }
    function pushHistory(entry) {
        entry.sel = clone(editor.sel);
        entry.sheetId = editor.sheet.id;
        editor.undo.push(entry);
        editor.redo = [];
        updateUndoButtons();
    }
    function applyCellChanges(changes, direction) {
        for (const ch of changes) {
            const sheet = editor.book.sheets.find(s => s.id === ch.sheetId);
            if (!sheet) continue;
            const value = direction === 'undo' ? ch.before : ch.after;
            if (value) sheet.cells[ch.key] = clone(value); else delete sheet.cells[ch.key];
        }
    }
    function applySizeChange(sheet, entry, direction) {
        const sizes = entry.axis === 'col' ? sheet.colWidths : sheet.rowHeights;
        for (const [index, previous] of entry.before) {
            const size = direction === 'undo' ? previous : entry.after;
            if (size === undefined) delete sizes[index]; else sizes[index] = size;
        }
    }
    function undo() {
        if (blockIfLocked()) return;
        commitEdit();
        const entry = editor.undo.pop();
        if (!entry) return;
        if (entry.type === 'cells') applyCellChanges(entry.changes, 'undo');
        else if (entry.type === 'size') applySizeChange(editor.book.sheets.find(sheet => sheet.id === entry.sheetId), entry, 'undo');
        else restoreState(entry.before);
        editor.redo.push(entry);
        restoreAfterHistory(entry);
    }
    function redo() {
        if (blockIfLocked()) return;
        commitEdit();
        const entry = editor.redo.pop();
        if (!entry) return;
        if (entry.type === 'cells') applyCellChanges(entry.changes, 'redo');
        else if (entry.type === 'size') applySizeChange(editor.book.sheets.find(sheet => sheet.id === entry.sheetId), entry, 'redo');
        else restoreState(entry.after);
        editor.undo.push(entry);
        restoreAfterHistory(entry);
    }
    function restoreAfterHistory(entry) {
        if (entry.sheetId && editor.sheet.id !== entry.sheetId) {
            const sheet = editor.book.sheets.find(s => s.id === entry.sheetId);
            if (sheet) { editor.sheet = sheet; editor.book.activeSheet = sheet.id; layoutDirty = true; destroyCharts(); renderTabs(); }
        }
        if (entry.sel) editor.sel = clone(entry.sel);
        updateUndoButtons();
        afterDataChange();
        updateSelectionUI();
    }
    function updateUndoButtons() {
        $('undoBtn').classList.toggle('is-disabled', !editor.undo.length);
        $('redoBtn').classList.toggle('is-disabled', !editor.redo.length);
    }
    // Locked spreadsheets are view-only until unlocked with the passphrase (OmniWrite's document lock).
    // OmniWrite's lock state: locked until unlocked for this session (window.isEffectivelyLocked).
    const isLocked = () => !!(editor.book && editor.book.locked && (typeof window.isEffectivelyLocked === 'function' ? window.isEffectivelyLocked(editor.book) : true));
    let lockToastAt = 0;
    // Real-time collaboration (../collab.js) marks spreadsheets opened with the View only role.
    const collabReadOnly = new Set();
    const isCollabReadOnly = () => !!(editor.book && collabReadOnly.has(editor.book.id));
    function blockIfLocked() {
        const readOnly = !isLocked() && isCollabReadOnly();
        if (!isLocked() && !readOnly) return false;
        if (Date.now() - lockToastAt > 1500) { lockToastAt = Date.now(); showToast(t(readOnly ? 'collab_view_only_toast' : 'sheets_locked_toast'), { type: 'info' }); }
        return true;
    }
    // Cell-level edits: fn receives set(r, c, cellOrNull) and get(r, c).
    function editCells(fn, { sheet = editor.sheet } = {}) {
        if (blockIfLocked()) return false;
        const changes = new Map();
        const get = (r, c) => sheet.cells[r + ':' + c] || null;
        const set = (r, c, cell) => {
            const key = r + ':' + c;
            if (!changes.has(key)) changes.set(key, { sheetId: sheet.id, key, before: clone(sheet.cells[key] || null) });
            const cleaned = cleanCell(cell);
            if (cleaned) sheet.cells[key] = cleaned; else delete sheet.cells[key];
            if (r + 1 > sheet.rows) { sheet.rows = r + 1; layoutDirty = true; }
            if (c + 1 > sheet.cols) { sheet.cols = c + 1; layoutDirty = true; }
        };
        fn(set, get);
        const list = [...changes.values()].map(ch => Object.assign(ch, { after: clone(sheet.cells[ch.key] || null) })).filter(ch => JSON.stringify(ch.before) !== JSON.stringify(ch.after));
        if (!list.length) return false;
        pushHistory({ type: 'cells', changes: list });
        afterDataChange();
        return true;
    }
    function editStructure(fn) {
        if (blockIfLocked()) return undefined;
        const before = snapshotState();
        const result = fn();
        const after = snapshotState();
        if (before !== after) { pushHistory({ type: 'state', before, after }); afterDataChange(); }
        return result;
    }
    function cleanCell(cell) {
        if (!cell) return null;
        const out = {};
        if (cell.v !== undefined && cell.v !== null && cell.v !== '') out.v = String(cell.v);
        if (cell.s) {
            const s = {};
            for (const [k, v] of Object.entries(cell.s)) if (v !== undefined && v !== null && v !== false && v !== '' && !(k === 'fmt' && (!v || (v.t === 'auto' && !Number.isFinite(v.d))))) s[k] = v;
            if (s.bd && !Object.keys(s.bd).length) delete s.bd;
            if (Object.keys(s).length) out.s = s;
        }
        if (cell.note) out.note = String(cell.note);
        if (cell.link) out.link = String(cell.link);
        if (cell.chk) out.chk = true;
        if (Array.isArray(cell.dd) && cell.dd.length) out.dd = cell.dd.map(String);
        return Object.keys(out).length ? out : null;
    }
    function afterDataChange({ save = true } = {}) {
        if (!editor.sheet) return;
        editor.evaluator.invalidate();
        layoutDirty = true;
        if (save) touchBook(editor.book);
        scheduleRender();
        updateStats(selRange());
        refreshCharts();
        updateUndoButtons();
        refreshSplitSoon();
    }

    /* ================================================================ editing */
    function startEdit(initial, { source = 'cell' } = {}) {
        if (!editor.sheet) return;
        if (blockIfLocked()) { if (source === 'bar') formulaInput.blur(); return; }
        const { r, c } = editor.sel;
        const cell = getCell(r, c);
        if (cell && cell.chk && initial === null) { toggleChecks([{ r, c }]); return; }
        const original = cell && cell.v !== undefined && cell.v !== null ? String(cell.v) : '';
        editor.editing = { r, c, original, mode: initial === null ? 'edit' : 'enter', source };
        const s = cellStyle(cell);
        cellEditor.style.font = fontCss(s, editor.zoom);
        cellEditor.style.color = s.fc || '';
        cellEditor.style.textAlign = s.ha === 'center' ? 'center' : s.ha === 'right' ? 'right' : 'left';
        cellEditor.style.whiteSpace = s.wrap ? 'pre-wrap' : 'pre';
        cellEditor.value = initial === null ? original : initial;
        formulaInput.value = cellEditor.value;
        if (initial !== null && String(initial) !== original) touchBook(editor.book);
        cellEditor.style.display = 'block';
        positionCellEditor();
        positionOverlays();
        if (source === 'cell') {
            cellEditor.focus({ preventScroll: true });
            const end = cellEditor.value.length;
            cellEditor.setSelectionRange(end, end);
        }
        updateRefHighlights();
    }
    function positionCellEditor() {
        if (!editor.editing) return;
        const rect = cellRect(editor.editing.r, editor.editing.c);
        const s = cellStyle(getCell(editor.editing.r, editor.editing.c));
        const font = fontCss(s, editor.zoom);
        const lines = cellEditor.value.split('\n');
        const needW = Math.max(...lines.map(line => textWidth(line || ' ', font))) + 24;
        // A frozen cell sits where its pane shows it, not where it scrolled to.
        const { fr, fc } = freezeDims();
        const x = rect.x + (editor.editing.c < fc ? viewport.scrollLeft : 0);
        const y = rect.y + (editor.editing.r < fr ? viewport.scrollTop : 0);
        const maxW = Math.max(rect.w, viewport.scrollLeft + viewport.clientWidth - x - 4);
        const width = s.wrap ? rect.w : clamp(needW, rect.w, maxW);
        const singleLine = lines.length === 1 && !s.wrap;
        cellEditor.style.lineHeight = singleLine ? (rect.h - 4) + 'px' : '1.25';
        Object.assign(cellEditor.style, { left: x + 'px', top: y + 'px', width: width + 'px', minHeight: rect.h + 'px', height: rect.h + 'px' });
        // Grow only when the text needs more room than the cell.
        if (!singleLine && cellEditor.scrollHeight > cellEditor.clientHeight) cellEditor.style.height = (cellEditor.scrollHeight + 4) + 'px';
    }
    function hideCellEditor() {
        editor.editing = null;
        cellEditor.style.display = 'none';
        cellEditor.value = '';
        $('sheetsRefLayer').innerHTML = '';
        closeAutocomplete();
    }
    function commitEdit(move) {
        const ed = editor.editing;
        if (!ed) return false;
        const value = cellEditor.style.display === 'block' ? cellEditor.value : formulaInput.value;
        hideCellEditor();
        if (value !== ed.original) {
            const text = normalizeEntry(value);
            editCells(set => {
                set(ed.r, ed.c, cellFromEntry(getCell(ed.r, ed.c), text));
            });
            const s = cellStyle(getCell(ed.r, ed.c));
            if (s.wrap || (s.fs && s.fs > DEFAULT_PT)) autoFitRows([ed.r]);
        }
        if (move) moveActive(move.dr, move.dc);
        else updateSelectionUI();
        if (ed.source === 'cell' || move) viewport.focus({ preventScroll: true });
        return true;
    }
    function cancelEdit() {
        if (!editor.editing) return;
        const changed = cellEditor.value !== editor.editing.original;
        hideCellEditor();
        if (changed) touchBook(editor.book);
        updateSelectionUI();
        viewport.focus({ preventScroll: true });
    }
    function cellFromEntry(current, value) {
        const cell = clone(current) || {}, text = normalizeEntry(value);
        cell.v = text;
        if (text.includes('\n')) cell.s = Object.assign({}, cell.s, { wrap: true });
        if (cell.chk && text !== '' && !/^(true|false)$/i.test(text) && text[0] !== '=') delete cell.chk;
        if (cell.link && !text) delete cell.link;
        return cell;
    }
    // Close unbalanced parentheses and quotes in formulas, like other spreadsheet apps.
    function normalizeEntry(text) {
        if (typeof text !== 'string' || text[0] !== '=' || text.length < 2) return text;
        let depth = 0, quoted = false;
        for (const ch of text) { if (ch === '"') quoted = !quoted; else if (!quoted && ch === '(') depth++; else if (!quoted && ch === ')') depth--; }
        let out = text;
        if (quoted) out += '"';
        if (depth > 0) out += ')'.repeat(depth);
        return out;
    }
    function moveActive(dr, dc) {
        const { r, c } = editor.sel;
        const m = mergeAt(r, c);
        let nr = r + dr, nc = c + dc;
        if (m) { if (dr > 0) nr = m.r2 + 1; if (dc > 0) nc = m.c2 + 1; }
        // Filtered-out rows are skipped.
        while (dr && nr >= 0 && isRowHidden(nr)) nr += dr > 0 ? 1 : -1;
        if (nr < 0) nr = r;
        setSelection(Math.max(0, nr), Math.max(0, nc));
    }
    function canInsertRef() {
        const ed = editor.editing;
        if (!ed) return false;
        const field = ed.source === 'bar' ? formulaInput : cellEditor;
        const text = field.value;
        if (text[0] !== '=') return false;
        const pos = field.selectionStart ?? text.length;
        const before = text.slice(0, pos).replace(/\s+$/, '');
        if (refInsertState && refInsertState.end === pos) return true;
        return /[=(,+\-*/^&<>:;%]$/.test(before);
    }
    let refInsertState = null; // { start, end } of the reference we inserted last
    function insertRef(range) {
        const ed = editor.editing;
        const field = ed.source === 'bar' ? formulaInput : cellEditor;
        const pos = field.selectionStart ?? field.value.length;
        let start = pos;
        if (refInsertState && refInsertState.end === pos) start = refInsertState.start;
        const prefix = editor.sheet.id !== ed.sheetId && ed.sheetId ? E.quoteSheet(editor.sheet.name) + '!' : '';
        const ref = prefix + E.rangeName(range);
        field.value = field.value.slice(0, start) + ref + field.value.slice(pos);
        const end = start + ref.length;
        field.setSelectionRange(end, end);
        refInsertState = { start, end };
        syncEditorFields(field);
    }
    function replaceLastRef(range) { if (refInsertState) insertRef(range); }
    function syncEditorFields(from) {
        if (editor.editing && editor.book) touchBook(editor.book);
        if (from === cellEditor) formulaInput.value = cellEditor.value; else cellEditor.value = formulaInput.value;
        positionCellEditor();
        updateRefHighlights();
    }
    const REF_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#008300', '#6250d6', '#e34948'];
    function updateRefHighlights() {
        const layer = $('sheetsRefLayer');
        const ed = editor.editing;
        if (!ed) { layer.innerHTML = ''; return; }
        const refs = E.formulaReferences(cellEditor.value || formulaInput.value);
        layer.innerHTML = refs.filter(ref => !ref.sheet || ref.sheet.toLowerCase() === editor.sheet.name.toLowerCase()).map((ref, i) => {
            ensureSize(ref.r2, ref.c2);
            const rect = rangeRect({ r1: ref.r1, c1: ref.c1, r2: Math.min(ref.r2, editor.sheet.rows - 1), c2: Math.min(ref.c2, editor.sheet.cols - 1) });
            const color = REF_COLORS[i % REF_COLORS.length];
            return `<div class="sheets-ref-box" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;border-color:${color};background:${color}14"></div>`;
        }).join('');
    }
    cellEditor.addEventListener('input', () => { refInsertState = null; syncEditorFields(cellEditor); showAutocomplete(cellEditor); });
    cellEditor.addEventListener('keydown', event => editorKeydown(event, cellEditor));
    cellEditor.addEventListener('blur', () => {
        setTimeout(() => {
            if (!editor.editing || editor.editing.source !== 'cell') return;
            const active = document.activeElement;
            if (active === cellEditor || active === formulaInput || drag || (menuState && menuEl.contains(active))) return;
            if (openDialogs) return;
            if (active && (active === viewport || viewport.contains(active))) return;
            commitEdit();
        }, 0);
    });
    function editorKeydown(event, field) {
        if (acState && handleAutocompleteKey(event)) return;
        const ed = editor.editing;
        if (!ed) return;
        if (event.key === 'Enter' && (event.altKey || (event.ctrlKey && !event.shiftKey && false))) {
            event.preventDefault();
            if (field === formulaInput) return;
            const pos = field.selectionStart;
            field.value = field.value.slice(0, pos) + '\n' + field.value.slice(field.selectionEnd);
            field.setSelectionRange(pos + 1, pos + 1);
            syncEditorFields(field);
            return;
        }
        if (event.key === 'Enter') { event.preventDefault(); commitEdit({ dr: event.shiftKey ? -1 : 1, dc: 0 }); return; }
        if (event.key === 'Tab') { event.preventDefault(); commitEdit({ dr: 0, dc: event.shiftKey ? -1 : 1 }); return; }
        if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); return; }
        if (ed.mode === 'enter' && field === cellEditor && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && !event.shiftKey) {
            if (canInsertRef()) {
                // Arrow keys pick a reference while typing a formula.
                event.preventDefault();
                const base = refInsertState ? lastRefCell() : { r: ed.r, c: ed.c };
                const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
                const r = Math.max(0, base.r + d[0]), c = Math.max(0, base.c + d[1]);
                insertRef({ r1: r, c1: c, r2: r, c2: c });
                return;
            }
            event.preventDefault();
            const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
            commitEdit({ dr: d[0], dc: d[1] });
        }
    }
    function lastRefCell() {
        const field = editor.editing.source === 'bar' ? formulaInput : cellEditor;
        const text = field.value.slice(refInsertState.start, refInsertState.end).split('!').pop();
        const range = E.parseRangeA1(text.split(':')[0]);
        return range ? { r: range.r1, c: range.c1 } : { r: editor.editing.r, c: editor.editing.c };
    }

    // Formula bar
    formulaInput.addEventListener('focus', () => {
        if (!editor.sheet) return;
        if (!editor.editing) startEdit(null, { source: 'bar' });
        else editor.editing.source = 'bar';
    });
    formulaInput.addEventListener('input', () => {
        if (!editor.editing) startEdit(null, { source: 'bar' });
        refInsertState = null;
        if (editor.editing.mode === 'enter') editor.editing.mode = 'edit';
        cellEditor.value = formulaInput.value;
        cellEditor.style.display = 'block';
        positionCellEditor();
        updateRefHighlights();
        if (editor.book) touchBook(editor.book);
        showAutocomplete(formulaInput);
    });
    formulaInput.addEventListener('keydown', event => editorKeydown(event, formulaInput));
    formulaInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (!editor.editing || editor.editing.source !== 'bar') return;
            const active = document.activeElement;
            if (active === formulaInput || active === cellEditor || drag || viewport.contains(active) && canInsertRef()) return;
            if (menuState && menuEl.contains(active)) return;
            commitEdit();
        }, 120);
    });

    // Name box: jump to a cell or select a range.
    nameBox.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); updateSelectionUI(); viewport.focus(); return; }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const range = E.parseRangeA1(nameBox.value.replace(/\$/g, '').trim());
        if (!range) { showToast(t('sheets_ref_invalid'), { type: 'error' }); return; }
        commitEdit();
        ensureSize(range.r2, range.c2);
        selectRange(range.r1, range.c1, range.r2, range.c2);
        scrollIntoView(range.r1, range.c1);
        viewport.focus({ preventScroll: true });
    });
    nameBox.addEventListener('focus', () => nameBox.select());
    nameBox.addEventListener('blur', () => updateSelectionUI());

    // Function name autocomplete while typing a formula.
    let acState = null;
    function showAutocomplete(field) {
        const text = field.value;
        const pos = field.selectionStart ?? text.length;
        const m = text[0] === '=' ? /([A-Za-z][A-Za-z0-9.]*)$/.exec(text.slice(0, pos)) : null;
        if (!m || /[A-Za-z]\d+$/.test(m[1]) && E.parseA1(m[1])) { closeAutocomplete(); return; }
        const before = text.slice(0, pos - m[1].length);
        if (!/[=(,+\-*/^&<>:;\s]$/.test(before)) { closeAutocomplete(); return; }
        const query = m[1].toUpperCase();
        const matches = E.FUNCTION_NAMES.filter(name => name.startsWith(query));
        if (!matches.length || (matches.length === 1 && matches[0] === query)) { closeAutocomplete(); return; }
        const anchorRect = field === cellEditor ? cellEditor.getBoundingClientRect() : formulaInput.getBoundingClientRect();
        acState = { field, start: pos - m[1].length, end: pos, matches, index: 0 };
        openMenu(null, matches.map((name, i) => ({ icon: 'function', label: name, checked: i === 0 ? true : undefined, action: () => acceptAutocomplete(name) })), { x: anchorRect.left, y: anchorRect.bottom + 6 });
        menuState.ac = true;
        field.focus();
    }
    function closeAutocomplete() { if (acState) { acState = null; if (menuState && menuState.ac) closeMenu(); } }
    function acceptAutocomplete(name) {
        const st = acState;
        if (!st) return;
        acState = null;
        const field = st.field;
        field.value = field.value.slice(0, st.start) + name + '(' + field.value.slice(st.end);
        const caret = st.start + name.length + 1;
        field.focus();
        field.setSelectionRange(caret, caret);
        syncEditorFields(field);
    }
    function handleAutocompleteKey(event) {
        if (!acState || !menuState || !menuState.ac) return false;
        const items = menuState.actions;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            items[acState.index].classList.remove('is-checked');
            acState.index = (acState.index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[acState.index].classList.add('is-checked');
            items[acState.index].scrollIntoView({ block: 'nearest' });
            return true;
        }
        if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); acceptAutocomplete(acState.matches[acState.index]); return true; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAutocomplete(); return true; }
        return false;
    }

    /* ================================================================ keyboard on the grid */
    viewport.addEventListener('keydown', event => {
        if (!editor.sheet || event.target !== viewport) return;
        const mod = event.ctrlKey || event.metaKey;
        const key = event.key;
        if (editor.selectedChart && (key === 'Delete' || key === 'Backspace')) { event.preventDefault(); deleteChart(editor.selectedChart); return; }
        const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (arrows[key]) {
            event.preventDefault();
            const [dr, dc] = arrows[key];
            const from = event.shiftKey ? { r: editor.sel.fr, c: editor.sel.fc } : { r: editor.sel.r, c: editor.sel.c };
            let target = mod ? jumpTarget(from.r, from.c, dr, dc) : { r: Math.max(0, from.r + dr), c: Math.max(0, from.c + dc) };
            if (!event.shiftKey && !mod) { moveActive(dr, dc); return; }
            setSelection(target.r, target.c, { extend: event.shiftKey });
            return;
        }
        if (key === 'Enter' && !mod) { event.preventDefault(); if (event.shiftKey) moveActive(-1, 0); else moveActive(1, 0); return; }
        if (key === 'Tab') { event.preventDefault(); moveActive(0, event.shiftKey ? -1 : 1); return; }
        if (key === 'F2') { event.preventDefault(); startEdit(null); return; }
        if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); clearContents(); return; }
        if (key === 'Escape') { editor.clipboard = editor.clipboard && editor.clipboard.cut ? null : editor.clipboard; return; }
        if (key === 'Home') { event.preventDefault(); setSelection(mod ? 0 : editor.sel.r, 0, { extend: event.shiftKey }); return; }
        if (key === 'End' && mod) { event.preventDefault(); const used = usedBounds(); setSelection(used.r, used.c, { extend: event.shiftKey }); return; }
        if (key === 'PageDown' || key === 'PageUp') {
            event.preventDefault();
            const rows = Math.max(1, Math.floor(viewport.clientHeight / (DEF_H * editor.zoom)) - 1);
            setSelection(Math.max(0, editor.sel.r + (key === 'PageDown' ? rows : -rows)), editor.sel.c, { extend: event.shiftKey });
            return;
        }
        if (key === ' ' && !mod) {
            const range = selRange();
            const checks = [];
            forEachInRange(range, (r, c) => { if (getCell(r, c)?.chk) checks.push({ r, c }); });
            if (checks.length) { event.preventDefault(); toggleChecks(checks); return; }
        }
        if (mod) {
            const k = key.toLowerCase();
            if (k === 'b') { event.preventDefault(); toggleStyle('b'); return; }
            if (k === 'i') { event.preventDefault(); toggleStyle('i'); return; }
            if (k === 'u') { event.preventDefault(); toggleStyle('u'); return; }
            if (k === '5' && event.shiftKey === false && event.altKey) { event.preventDefault(); toggleStyle('st'); return; }
            if (k === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
            if (k === 'y') { event.preventDefault(); redo(); return; }
            if (k === 'a') { event.preventDefault(); selectRange(0, 0, editor.sheet.rows - 1, editor.sheet.cols - 1, editor.sel.r, editor.sel.c); return; }
            if (k === 'f') { event.preventDefault(); openFind(false); return; }
            if (k === 'h') { event.preventDefault(); openFind(true); return; }
            if (k === 'd') { event.preventDefault(); fillDownRight('down'); return; }
            if (k === 'r') { event.preventDefault(); fillDownRight('right'); return; }
            if (k === 'k') { event.preventDefault(); openLinkDialog(); return; }
            if (key === ';') { event.preventDefault(); setActiveValue(event.shiftKey ? currentTimeText() : todayText()); return; }
            if (key === ':') { event.preventDefault(); setActiveValue(currentTimeText()); return; }
            if (key === '\\') { event.preventDefault(); clearFormatting(); return; }
            return;
        }
        if (key.length === 1 && !event.altKey) { event.preventDefault(); startEdit(key); return; }
        if (key === 'Process' || key === 'Unidentified' || key === 'Dead') startEdit('');
    });
    function jumpTarget(r, c, dr, dc) {
        const sheet = editor.sheet;
        const filled = (rr, cc) => { const cell = sheet.cells[rr + ':' + cc]; return !!(cell && cell.v !== undefined && cell.v !== ''); };
        const limitR = sheet.rows - 1, limitC = sheet.cols - 1;
        let nr = r, nc = c;
        const step = () => { nr += dr; nc += dc; };
        const inside = () => nr >= 0 && nc >= 0 && nr <= limitR && nc <= limitC;
        const startFilled = filled(r, c);
        step();
        if (!inside()) return { r: clamp(nr, 0, limitR), c: clamp(nc, 0, limitC) };
        if (startFilled && filled(nr, nc)) {
            while (inside() && filled(nr, nc)) step();
            nr -= dr; nc -= dc;
            return { r: nr, c: nc };
        }
        while (inside() && !filled(nr, nc)) step();
        if (!inside()) return { r: clamp(nr, 0, limitR), c: clamp(nc, 0, limitC) };
        return { r: nr, c: nc };
    }
    function usedBounds() {
        let r = 0, c = 0;
        for (const key of Object.keys(editor.sheet.cells)) { const [rr, cc] = key.split(':').map(Number); if (rr > r) r = rr; if (cc > c) c = cc; }
        return { r, c };
    }
    function forEachInRange(range, fn) {
        const sheet = editor.sheet;
        const cellsInRange = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
        if (cellsInRange > 20000) {
            // Large selections: only visit stored cells.
            for (const key of Object.keys(sheet.cells)) { const [r, c] = key.split(':').map(Number); if (r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2) fn(r, c); }
            return;
        }
        for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) fn(r, c);
    }
    const isLargeRange = range => (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) > 20000;
    function todayText() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    function currentTimeText() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    function setActiveValue(text) {
        const { r, c } = editor.sel;
        editCells(set => { const cell = clone(getCell(r, c)) || {}; cell.v = text; set(r, c, cell); });
        updateSelectionUI();
    }
    function clearContents() {
        const range = selRange();
        editCells(set => {
            forEachInRange(range, (r, c) => {
                const cell = getCell(r, c);
                if (!cell) return;
                const next = clone(cell);
                delete next.v; delete next.link;
                if (next.chk) next.v = 'FALSE';
                set(r, c, next);
            });
        });
        updateSelectionUI();
    }
    function toggleChecks(list) {
        const allChecked = list.every(({ r, c }) => editor.evaluator.value(editor.sheet, r, c) === true);
        editCells(set => list.forEach(({ r, c }) => { const cell = clone(getCell(r, c)) || {}; cell.chk = true; cell.v = allChecked ? 'FALSE' : 'TRUE'; set(r, c, cell); }));
        updateSelectionUI();
    }

    /* ================================================================ clipboard */
    function rangeMatrix(range, mapper) {
        const rows = [];
        for (let r = range.r1; r <= range.r2; r++) { const row = []; for (let c = range.c1; c <= range.c2; c++) row.push(mapper(r, c)); rows.push(row); }
        return rows;
    }
    function trimRangeToData(range) {
        if (!isLargeRange(range)) return range;
        const used = usedBounds();
        return { r1: range.r1, c1: range.c1, r2: Math.min(range.r2, used.r), c2: Math.min(range.c2, used.c) };
    }
    function copySelection(event, cut) {
        if (isLocked()) { if (event) event.preventDefault(); blockIfLocked(); return; }
        const range = trimRangeToData(selRange());
        const text = rangeMatrix(range, (r, c) => displayText(editor.sheet, r, c)).map(row => row.join('\t')).join('\n');
        const html = '<table>' + rangeMatrix(range, (r, c) => `<td>${esc(displayText(editor.sheet, r, c))}</td>`).map(row => `<tr>${row.join('')}</tr>`).join('') + '</table>';
        editor.clipboard = { text, cut, sheetId: editor.sheet.id, range, cells: rangeMatrix(range, (r, c) => clone(getCell(r, c))), merges: editor.sheet.merges.filter(m => m.r1 >= range.r1 && m.r2 <= range.r2 && m.c1 >= range.c1 && m.c2 <= range.c2).map(clone) };
        if (event && event.clipboardData) {
            event.clipboardData.setData('text/plain', text);
            event.clipboardData.setData('text/html', html);
            event.preventDefault();
        } else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    }
    function pasteText(text, { valuesOnly = false } = {}) {
        const target = selRange();
        const internal = editor.clipboard && editor.clipboard.text === text.replace(/\r\n/g, '\n').replace(/\n$/, '') ? editor.clipboard : (editor.clipboard && editor.clipboard.text === text ? editor.clipboard : null);
        if (internal && !valuesOnly) { pasteInternal(internal, target); return; }
        const rows = Files.parseCSV(text.replace(/\n$/, ''), text.includes('\t') ? '\t' : '\u0000');
        if (!rows.length) return;
        const single = rows.length === 1 && rows[0].length === 1;
        editCells(set => {
            if (single && (target.r2 > target.r1 || target.c2 > target.c1) && !isLargeRange(target)) {
                forEachInRange(target, (r, c) => { const cell = clone(getCell(r, c)) || {}; cell.v = rows[0][0]; set(r, c, cell); });
            } else {
                rows.forEach((row, i) => row.forEach((value, j) => {
                    const r = target.r1 + i, c = target.c1 + j;
                    const cell = clone(getCell(r, c)) || {};
                    cell.v = value;
                    set(r, c, cell);
                }));
                selectRange(target.r1, target.c1, target.r1 + rows.length - 1, target.c1 + Math.max(...rows.map(r => r.length)) - 1);
            }
        });
        updateSelectionUI();
    }
    function pasteInternal(clip, target) {
        const h = clip.cells.length, w = clip.cells[0].length;
        const repeatR = target.r2 - target.r1 + 1 > h && (target.r2 - target.r1 + 1) % h === 0 ? (target.r2 - target.r1 + 1) / h : 1;
        const repeatC = target.c2 - target.c1 + 1 > w && (target.c2 - target.c1 + 1) % w === 0 ? (target.c2 - target.c1 + 1) / w : 1;
        const sourceSheet = editor.book.sheets.find(s => s.id === clip.sheetId);
        const run = () => {
            if (clip.cut && sourceSheet) {
                for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) delete sourceSheet.cells[(clip.range.r1 + i) + ':' + (clip.range.c1 + j)];
                sourceSheet.merges = sourceSheet.merges.filter(m => !(m.r1 >= clip.range.r1 && m.r2 <= clip.range.r2 && m.c1 >= clip.range.c1 && m.c2 <= clip.range.c2));
            }
            for (let ry = 0; ry < repeatR; ry++) for (let rx = 0; rx < repeatC; rx++) {
                const baseR = target.r1 + ry * h, baseC = target.c1 + rx * w;
                for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
                    const r = baseR + i, c = baseC + j;
                    const src = clip.cells[i][j];
                    const key = r + ':' + c;
                    if (!src) { delete editor.sheet.cells[key]; continue; }
                    const cell = clone(src);
                    if (!clip.cut && typeof cell.v === 'string' && cell.v[0] === '=') cell.v = E.shiftFormula(cell.v, r - (clip.range.r1 + i), c - (clip.range.c1 + j));
                    editor.sheet.cells[key] = cell;
                    ensureSize(r, c);
                }
                editor.sheet.merges = editor.sheet.merges.filter(m => m.r2 < baseR || m.r1 > baseR + h - 1 || m.c2 < baseC || m.c1 > baseC + w - 1);
                clip.merges.forEach(m => editor.sheet.merges.push({ r1: m.r1 - clip.range.r1 + baseR, c1: m.c1 - clip.range.c1 + baseC, r2: m.r2 - clip.range.r1 + baseR, c2: m.c2 - clip.range.c1 + baseC }));
            }
        };
        editStructure(run);
        if (clip.cut) editor.clipboard = null;
        selectRange(target.r1, target.c1, target.r1 + h * repeatR - 1, target.c1 + w * repeatC - 1);
    }
    const gridHasFocus = () => document.activeElement === viewport;
    document.addEventListener('copy', event => { if (gridHasFocus() && editor.sheet && !editor.editing) copySelection(event, false); });
    document.addEventListener('cut', event => { if (gridHasFocus() && editor.sheet && !editor.editing) copySelection(event, true); });
    document.addEventListener('paste', event => {
        if (!gridHasFocus() || !editor.sheet || editor.editing) return;
        event.preventDefault();
        pasteText(event.clipboardData.getData('text/plain') || '');
    });
    async function clipboardAction(kind) {
        viewport.focus({ preventScroll: true });
        if (kind === 'copy' || kind === 'cut') {
            copySelection(null, kind === 'cut');
            return;
        }
        try {
            const text = await navigator.clipboard.readText();
            pasteText(text, { valuesOnly: kind === 'values' });
        } catch {
            if (editor.clipboard && kind !== 'values') pasteInternal(editor.clipboard, selRange());
            else showToast(isMac ? '⌘ V' : 'Ctrl + V', { type: 'info' });
        }
    }

    /* ================================================================ fill */
    function showFillPreview(d) {
        const o = d.origin;
        const area = fillArea(o, d.r, d.c);
        const rect = rangeRect(area.range);
        Object.assign($('sheetsFillPreview').style, { display: 'block', left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
    }
    function fillArea(o, r, c) {
        const down = r > o.r2 ? r - o.r2 : 0, up = r < o.r1 ? o.r1 - r : 0;
        const right = c > o.c2 ? c - o.c2 : 0, left = c < o.c1 ? o.c1 - c : 0;
        const vertical = Math.max(down, up) >= Math.max(right, left);
        if (vertical && (down || up)) return { dir: down ? 'down' : 'up', range: { r1: Math.min(o.r1, r), r2: Math.max(o.r2, r), c1: o.c1, c2: o.c2 } };
        if (!vertical && (right || left)) return { dir: right ? 'right' : 'left', range: { r1: o.r1, r2: o.r2, c1: Math.min(o.c1, c), c2: Math.max(o.c2, c) } };
        return { dir: null, range: o };
    }
    function performFill(d) {
        const o = d.origin;
        const { dir, range } = fillArea(o, d.r, d.c);
        if (!dir) return;
        const vertical = dir === 'down' || dir === 'up';
        editCells(set => {
            const lines = vertical ? seq(o.c1, o.c2) : seq(o.r1, o.r2);
            for (const line of lines) {
                const src = vertical ? seq(o.r1, o.r2).map(r => ({ r, c: line })) : seq(o.c1, o.c2).map(c => ({ r: line, c }));
                const cells = src.map(p => getCell(p.r, p.c));
                const nums = cells.map(cell => (cell && typeof cell.v === 'string' && cell.v[0] !== '=' ? E.parseLiteral(cell.v) : null));
                const numeric = nums.length > 1 && nums.every(n => n && typeof n.value === 'number');
                const step = numeric ? (nums[nums.length - 1].value - nums[0].value) / (nums.length - 1) : 0;
                const targets = vertical
                    ? (dir === 'down' ? seq(o.r2 + 1, range.r2) : seq(range.r1, o.r1 - 1).reverse())
                    : (dir === 'right' ? seq(o.c2 + 1, range.c2) : seq(range.c1, o.c1 - 1).reverse());
                targets.forEach((pos, k) => {
                    const r = vertical ? pos : line, c = vertical ? line : pos;
                    const srcIndex = dir === 'down' || dir === 'right' ? k % src.length : src.length - 1 - (k % src.length);
                    const from = src[srcIndex];
                    const cell = clone(cells[srcIndex]);
                    if (!cell) { set(r, c, null); return; }
                    if (numeric) {
                        const base = dir === 'down' || dir === 'right' ? nums[nums.length - 1].value : nums[0].value;
                        const value = base + step * (k + 1) * (dir === 'down' || dir === 'right' ? 1 : -1);
                        cell.v = String(Number(value.toPrecision(15)));
                        const lit = nums[0];
                        if (lit.fmt && !(cell.s && cell.s.fmt)) cell.s = Object.assign({}, cell.s, { fmt: lit.fmt });
                    } else if (typeof cell.v === 'string' && cell.v[0] === '=') {
                        cell.v = E.shiftFormula(cell.v, r - from.r, c - from.c);
                    } else if (src.length === 1 && typeof cell.v === 'string') {
                        // A single "Item 1" continues as "Item 2", "Item 3"; plain numbers copy.
                        const m = /^(.*?)(\d+)$/.exec(cell.v);
                        if (m && m[1] && typeof E.parseLiteral(cell.v).value === 'string') cell.v = m[1] + (Number(m[2]) + (k + 1) * (dir === 'down' || dir === 'right' ? 1 : -1));
                    }
                    set(r, c, cell);
                });
            }
        });
        selectRange(range.r1, range.c1, range.r2, range.c2, editor.sel.r, editor.sel.c);
    }
    function fillDownRight(dir) {
        const range = selRange();
        if (dir === 'down' && range.r1 === range.r2 && range.r1 > 0) { performFill({ origin: { ...range, r1: range.r1 - 1, r2: range.r1 - 1 }, r: range.r1, c: range.c2 }); return; }
        if (dir === 'right' && range.c1 === range.c2 && range.c1 > 0) { performFill({ origin: { ...range, c1: range.c1 - 1, c2: range.c1 - 1 }, r: range.r2, c: range.c1 }); return; }
        if (dir === 'down') performFill({ origin: { ...range, r2: range.r1 }, r: range.r2, c: range.c2 });
        else performFill({ origin: { ...range, c2: range.c1 }, r: range.r2, c: range.c2 });
    }

    /* ================================================================ formatting */
    function styleRange(mutator) {
        const range = selRange();
        editCells(set => {
            forEachInRange(range, (r, c) => {
                const cell = clone(getCell(r, c)) || {};
                cell.s = Object.assign({}, cell.s);
                mutator(cell.s, cell, r, c, range);
                set(r, c, cell);
            });
        });
        updateSelectionUI();
    }
    function activeStyle() { return cellStyle(getCell(editor.sel.r, editor.sel.c)); }
    function toggleStyle(prop) { const on = !activeStyle()[prop]; styleRange(s => { s[prop] = on || undefined; }); }
    function setNumberFormat(fmt) {
        styleRange((s, cell) => {
            if (!fmt || fmt.t === 'auto') { delete s.fmt; return; }
            s.fmt = Object.assign({}, fmt);
            if (fmt.t === 'text' && cell.v && typeof cell.v === 'string' && cell.v[0] === "'") cell.v = cell.v.slice(1);
        });
    }
    function changeDecimals(delta) {
        styleRange((s, cell, r, c) => {
            const fmt = s.fmt && s.fmt.t !== 'auto' ? s.fmt : displayFormat(editor.sheet, r, c, cell);
            const value = editor.evaluator.value(editor.sheet, r, c);
            let d = fmt && Number.isFinite(fmt.d) ? fmt.d : (typeof value === 'number' ? Math.min(10, (String(Number(value.toPrecision(12))).split('.')[1] || '').length) : 0);
            if (fmt && ['date', 'longdate', 'time', 'datetime', 'duration', 'text'].includes(fmt.t)) return;
            d = clamp(d + delta, 0, 10);
            s.fmt = Object.assign({ t: (fmt && fmt.t) || 'number' }, fmt || {}, { d });
            if (s.fmt.t === 'auto') s.fmt.t = 'number';
        });
    }
    function setFontSize(pt) {
        pt = clamp(Math.round(pt * 2) / 2, 1, 400);
        styleRange(s => { s.fs = pt === DEFAULT_PT ? undefined : pt; });
        const range = selRange();
        if (!isLargeRange(range)) autoFitRows(seq(range.r1, range.r2));
        $('fontSizeDisplay').textContent = String(pt);
    }
    const FONT_SIZE_STEPS = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72, 96];
    function stepFontSize(direction) {
        const current = activeStyle().fs || DEFAULT_PT;
        const next = direction > 0 ? FONT_SIZE_STEPS.find(s => s > current) ?? current + 12 : [...FONT_SIZE_STEPS].reverse().find(s => s < current) ?? Math.max(1, current - 1);
        setFontSize(next);
    }
    function clearFormatting() {
        styleRange((s, cell) => { Object.keys(s).forEach(k => delete s[k]); delete cell.chk; delete cell.dd; });
        const range = selRange();
        editStructure(() => { editor.sheet.merges = editor.sheet.merges.filter(m => m.r2 < range.r1 || m.r1 > range.r2 || m.c2 < range.c1 || m.c1 > range.c2); });
    }
    function applyBorders(kind) {
        const line = kind === 'thick' ? '3px solid #1d2433' : '1px solid #1d2433';
        styleRange((s, cell, r, c, range) => {
            const bd = Object.assign({}, s.bd);
            const top = r === range.r1, bottom = r === range.r2, left = c === range.c1, right = c === range.c2;
            switch (kind) {
                case 'all': bd.t = bd.b = bd.l = bd.r = line; break;
                case 'outer': case 'thick': if (top) bd.t = line; if (bottom) bd.b = line; if (left) bd.l = line; if (right) bd.r = line; break;
                case 'top': if (top) bd.t = line; break;
                case 'bottom': if (bottom) bd.b = line; break;
                case 'left': if (left) bd.l = line; break;
                case 'right': if (right) bd.r = line; break;
                case 'none': delete bd.t; delete bd.b; delete bd.l; delete bd.r; break;
            }
            s.bd = Object.keys(bd).length ? bd : undefined;
        });
    }
    function toggleMerge() {
        const range = selRange();
        const sheet = editor.sheet;
        const inside = sheet.merges.filter(m => !(m.r2 < range.r1 || m.r1 > range.r2 || m.c2 < range.c1 || m.c1 > range.c2));
        if (inside.length) {
            editStructure(() => { sheet.merges = sheet.merges.filter(m => !inside.includes(m)); });
            updateSelectionUI();
            return;
        }
        if (range.r1 === range.r2 && range.c1 === range.c2) return;
        if (isLargeRange(range)) return;
        let dropped = false;
        editStructure(() => {
            forEachInRange(range, (r, c) => {
                if (r === range.r1 && c === range.c1) return;
                const cell = sheet.cells[r + ':' + c];
                if (cell && cell.v !== undefined && cell.v !== '') { dropped = true; delete cell.v; if (!cleanCell(cell)) delete sheet.cells[r + ':' + c]; }
            });
            sheet.merges.push({ r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 });
        });
        editor.sel = { r: range.r1, c: range.c1, ar: range.r1, ac: range.c1, fr: range.r2, fc: range.c2 };
        updateSelectionUI();
        if (dropped) showToast(t('sheets_merge_keeps_top_left'), { type: 'info' });
    }
    function autoFitRows(rows) {
        const sheet = editor.sheet;
        const changes = {};
        for (const r of rows) {
            let need = DEF_H;
            let found = false;
            for (let c = 0; c < sheet.cols; c++) {
                const cell = sheet.cells[r + ':' + c];
                if (!cell) continue;
                const s = cellStyle(cell);
                const lineH = ptToPx(s.fs || DEFAULT_PT) * 1.25;
                if (s.fs && s.fs !== DEFAULT_PT) { need = Math.max(need, lineH + 14); found = true; }
                if (s.wrap && cell.v) {
                    found = true;
                    const width = (sheet.colWidths[c] ?? DEF_W) - 18;
                    const text = displayText(sheet, r, c);
                    const font = fontCss(s, 1);
                    let lines = 0;
                    for (const para of text.split('\n')) {
                        let line = '';
                        let count = 1;
                        for (const word of para.split(/(\s+)/)) {
                            const attempt = line + word;
                            if (textWidth(attempt, font) > width && line) { count++; line = word.trimStart(); } else line = attempt;
                        }
                        lines += count;
                    }
                    need = Math.max(need, lines * lineH + 14);
                }
            }
            const current = sheet.rowHeights[r] ?? DEF_H;
            const target = Math.ceil(need);
            if (found && target !== current && (target > current || current > DEF_H)) changes[r] = target === DEF_H ? undefined : target;
        }
        if (!Object.keys(changes).length) return;
        for (const [r, h] of Object.entries(changes)) { if (h === undefined) delete sheet.rowHeights[r]; else sheet.rowHeights[r] = h; }
        layoutDirty = true;
        touchBook(editor.book);
        scheduleRender();
    }
    function autoFitColumns(cols) {
        const sheet = editor.sheet;
        editStructure(() => {
            for (const c of cols) {
                let need = 40;
                for (const key of Object.keys(sheet.cells)) {
                    const [r, cc] = key.split(':').map(Number);
                    if (cc !== c) continue;
                    const cell = sheet.cells[key];
                    need = Math.max(need, textWidth(displayText(sheet, r, c), fontCss(cellStyle(cell), 1)) + 24 + (cell.dd ? 30 : 0));
                }
                const width = Math.ceil(need);
                if (width === DEF_W) delete sheet.colWidths[c]; else sheet.colWidths[c] = width;
            }
        });
        layoutDirty = true;
        scheduleRender();
    }

    /* ================================================================ toolbar */
    const FONTS = [
        ['Munetios UI v4 Font', "'Munetios UI v4 Font'"], ['Google Sans Flex', "'Google Sans Flex'"], ['Google Sans', "'Google Sans'"], ['Google Sans Code', "'Google Sans Code'"], ['Inter', "'Inter'"], ['Roboto', "'Roboto'"],
        ['Open Sans', "'Open Sans'"], ['Lexend', "'Lexend'"], ['Poppins', "'Poppins'"], ['System', 'system-ui'], ['Arial', 'Arial'], ['Verdana', 'Verdana'],
        ['Georgia', 'Georgia'], ['Times New Roman', "'Times New Roman'"], ['Courier New', "'Courier New'"]
    ];
    const NUMBER_FORMATS = [
        { t: 'auto', key: 'sheets_fmt_auto' }, { t: 'text', key: 'sheets_fmt_text' }, { sep: true },
        { t: 'number', d: 2, key: 'sheets_fmt_number', sample: 1234.56 }, { t: 'percent', d: 2, key: 'sheets_fmt_percent', sample: 0.1012 },
        { t: 'scientific', d: 2, key: 'sheets_fmt_scientific', sample: 1012 }, { sep: true },
        { t: 'accounting', d: 2, key: 'sheets_fmt_accounting', sample: -1234.56 }, { t: 'currency', d: 2, key: 'sheets_fmt_currency', sample: 1234.56 }, { sep: true },
        { t: 'date', key: 'sheets_fmt_date', sample: E.dateToSerial(2026, 11, 15) }, { t: 'longdate', key: 'sheets_fmt_longdate', sample: E.dateToSerial(2026, 11, 15) },
        { t: 'time', key: 'sheets_fmt_time', sample: 0.6458333 }, { t: 'datetime', key: 'sheets_fmt_datetime', sample: E.dateToSerial(2026, 11, 15) + 0.6458333 },
        { t: 'duration', key: 'sheets_fmt_duration', sample: 1.0423 }
    ];
    function updateToolbarState() {
        if (!editor.sheet) return;
        const cell = getCell(editor.sel.r, editor.sel.c);
        const s = cellStyle(cell);
        const set = (id, on) => { const el = $(id); if (!el) return; el.classList.toggle('is-active', !!on); if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(!!on)); };
        set('boldBtn', s.b); set('italicBtn', s.i); set('underlineBtn', s.u); set('strikethroughBtn', s.st); set('wrapBtn', s.wrap);
        const fmt = s.fmt && s.fmt.t ? s.fmt.t : 'auto';
        set('currencyBtn', fmt === 'currency'); set('percentBtn', fmt === 'percent');
        set('mergeBtn', !!mergeAt(editor.sel.r, editor.sel.c));
        $('numberFormatLabel').textContent = t((NUMBER_FORMATS.find(f => f.t === fmt) || NUMBER_FORMATS[0]).key);
        const font = FONTS.find(f => f[1] === s.ff);
        $('fontFamilyText').textContent = font ? font[0] : (primaryFamily(s.ff) || 'Munetios UI v4 Font');
        $('fontFamilyText').style.fontFamily = s.ff || "'Munetios UI v4 Font'";
        if (document.activeElement !== $('fontSizeDisplay')) $('fontSizeDisplay').textContent = String(s.fs || DEFAULT_PT);
        $('textColorBar').style.background = s.fc || 'currentColor';
        $('fillColorBar').style.background = s.bg || 'transparent';
        $('alignGroupedChoice').textContent = s.ha === 'center' ? 'format_align_center' : s.ha === 'right' ? 'format_align_right' : 'format_align_left';
    }
    // On phones some tools run from the Tools sheet; menus then anchor to where the tool was tapped.
    let pendingAnchor = null;
    const on = (id, fn) => {
        const el = $(id);
        el.addEventListener('click', event => {
            const anchor = pendingAnchor || el;
            pendingAnchor = null;
            if (!editor.sheet) return;
            commitEdit();
            fn(anchor, event);
        });
    };
    on('boldBtn', () => toggleStyle('b'));
    on('italicBtn', () => toggleStyle('i'));
    on('underlineBtn', () => toggleStyle('u'));
    on('wrapBtn', () => { const value = !activeStyle().wrap; styleRange(s => { s.wrap = value || undefined; }); const range = selRange(); if (!isLargeRange(range)) autoFitRows(seq(range.r1, range.r2)); });
    on('mergeBtn', toggleMerge);
    on('currencyBtn', () => setNumberFormat(activeStyle().fmt && activeStyle().fmt.t === 'currency' ? null : { t: 'currency', d: 2 }));
    on('percentBtn', () => setNumberFormat(activeStyle().fmt && activeStyle().fmt.t === 'percent' ? null : { t: 'percent', d: 0 }));
    on('decimalDecreaseBtn', () => changeDecimals(-1));
    on('decimalIncreaseBtn', () => changeDecimals(1));
    on('fontSizeDecreaseBtn', () => stepFontSize(-1));
    on('fontSizeIncreaseBtn', () => stepFontSize(1));
    on('undoBtn', undo);
    on('redoBtn', redo);
    on('textColorBtn', el => openColorPicker(el, activeStyle().fc, color => styleRange(s => { s.fc = color || undefined; }), t('Text Color')));
    on('fillColorBtn', el => openColorPicker(el, activeStyle().bg, color => styleRange(s => { s.bg = color || undefined; }), t('sheets_fill_color')));
    on('numberFormatBtn', el => {
        const current = (activeStyle().fmt && activeStyle().fmt.t) || 'auto';
        openMenu(el, NUMBER_FORMATS.map(f => f.sep ? f : ({
            icon: current === f.t ? 'check' : 'tag', label: t(f.key), checked: current === f.t,
            hint: f.sample !== undefined ? E.formatValue(f.sample, f, numberLocale()) : '',
            action: () => setNumberFormat(f.t === 'auto' ? null : { t: f.t, d: f.d })
        })));
    });
    const sizeDisplay = $('fontSizeDisplay');
    sizeDisplay.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); const n = parseFloat(sizeDisplay.textContent); if (Number.isFinite(n) && editor.sheet) setFontSize(n); viewport.focus(); }
        if (event.key === 'Escape') { event.preventDefault(); updateToolbarState(); viewport.focus(); }
        if (event.key.length === 1 && !/[\d.]/.test(event.key) && !event.ctrlKey && !event.metaKey) event.preventDefault();
    });
    sizeDisplay.addEventListener('blur', () => { const n = parseFloat(sizeDisplay.textContent); if (editor.sheet && Number.isFinite(n) && n !== (activeStyle().fs || DEFAULT_PT)) setFontSize(n); else updateToolbarState(); });
    sizeDisplay.addEventListener('focus', () => { const range = document.createRange(); range.selectNodeContents(sizeDisplay); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); });
    /* -------- OmniWrite's font picker, font size list, and alignment group, applied to cells -------- */
    const DEFAULT_FONT = "'Munetios UI v4 Font'";
    const primaryFamily = value => String(value || '').split(',')[0].replace(/['"]/g, '').trim();
    const floatingPanels = new Set();
    function placeFloating(panel, anchor) {
        const rect = anchor.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.margin = '0';
        panel.style.left = '0px';
        panel.style.top = '0px';
        const w = panel.offsetWidth, h = panel.offsetHeight;
        const left = document.documentElement.dir === 'rtl' ? rect.right - w : rect.left;
        panel.style.left = clamp(left, 8, Math.max(8, window.innerWidth - w - 8)) + 'px';
        let top = rect.bottom + 8;
        if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
        panel.style.top = top + 'px';
    }
    function closeFloatingPanels(except) {
        floatingPanels.forEach(panel => {
            if (panel === except) return;
            panel.style.display = panel.classList.contains('dropdown-item-groups') ? '' : 'none';
            panel.classList.remove('is-open');
            panel.setAttribute('aria-hidden', 'true');
            if (panel._anchor) panel._anchor.setAttribute('aria-expanded', 'false');
        });
    }
    function openFloating(panel, anchor) {
        closeMenu();
        closeColorPicker();
        closeFloatingPanels(panel);
        const open = panel.classList.contains('dropdown-item-groups') ? panel.classList.contains('is-open') : panel.style.display === 'block';
        if (open) { closeFloatingPanels(); return false; }
        panel._anchor = anchor;
        if (panel.classList.contains('dropdown-item-groups')) panel.classList.add('is-open'); else panel.style.display = 'block';
        panel.setAttribute('aria-hidden', 'false');
        anchor.setAttribute('aria-expanded', 'true');
        placeFloating(panel, anchor);
        return true;
    }
    document.addEventListener('pointerdown', event => {
        floatingPanels.forEach(panel => {
            const open = panel.classList.contains('is-open') || panel.style.display === 'block';
            if (open && !panel.contains(event.target) && !(panel._anchor && panel._anchor.contains(event.target))) closeFloatingPanels();
        });
    }, true);
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const open = [...floatingPanels].find(panel => panel.classList.contains('is-open') || panel.style.display === 'block');
        if (!open) return;
        event.preventDefault();
        const anchor = open._anchor;
        closeFloatingPanels();
        if (anchor && anchor.focus) anchor.focus();
    }, true);
    window.addEventListener('resize', () => closeFloatingPanels());
    const floatingHost = () => $('sheetsFloatingUi') || document.body;

    // Font family: OmniWrite's picker (search, Variable badges, Add / Upload / Detect Installed fonts,
    // and the Font settings pane with stylistic sets and variable axes).
    function fontPicker() {
        let picker = $('sheetsFontPicker');
        if (!picker) {
            picker = document.createElement('div');
            picker.id = 'sheetsFontPicker';
            picker.className = 'dropdown-wrapper liquid-glass';
            picker.dataset.fontScope = 'external';
            picker.setAttribute('data-omni-keep-dom', '');
            picker.setAttribute('aria-hidden', 'true');
            picker.style.display = 'none';
            floatingHost().appendChild(picker);
            floatingPanels.add(picker);
            picker._fontContext = () => {
                const s = activeStyle();
                return { font: s.ff || DEFAULT_FONT, ff: s.ffs || '', fv: s.fvs || '', weight: s.b ? 700 : 400 };
            };
            picker._applyFont = ({ font, ffString, fvString, kind }) => {
                if (blockIfLocked()) return;
                styleRange(s => {
                    s.ff = font === DEFAULT_FONT ? undefined : font;
                    if (kind === 'ff' || kind === 'all') s.ffs = ffString || undefined;
                    if (kind === 'fv' || kind === 'all') s.fvs = fvString || undefined;
                });
            };
            // Choosing a font (not its tune button) applies it and closes, like OmniWrite.
            picker.addEventListener('mousedown', event => {
                const row = event.target.closest('.omni-font-option[data-font]');
                if (!row || !picker.contains(row)) return;
                event.preventDefault();
                if (blockIfLocked()) return;
                const font = row.getAttribute('data-font');
                styleRange(s => { s.ff = font === DEFAULT_FONT ? undefined : font; delete s.fvs; });
                if (!event.target.closest('.omni-font-tune')) closeFloatingPanels();
            });
        }
        if (!picker.querySelector('.omni-font-picker') && typeof window.renderFontFamilyPicker === 'function') window.renderFontFamilyPicker(picker);
        return picker;
    }
    on('fontFamilyBtn', el => {
        if (!editor.sheet) return;
        commitEdit();
        const picker = fontPicker();
        if (!openFloating(picker, el)) return;
        if (window.OmniFontSettings) window.OmniFontSettings.refresh(undefined, picker);
        placeFloating(picker, el);
        const search = picker.querySelector('[id$="fontFamilySearchInput"]');
        if (search) { search.value = ''; search.dispatchEvent(new Event('input')); setTimeout(() => search.focus(), 30); }
    });

    // Font size: OmniWrite's size list (same component and sizes).
    function sizePicker() {
        let picker = $('sheetsFontSizePicker');
        if (picker) return picker;
        const source = document.getElementById('fontSizePicker');
        picker = source ? source.cloneNode(true) : document.createElement('div');
        picker.id = 'sheetsFontSizePicker';
        picker.className = 'dropdown-wrapper liquid-glass';
        picker.setAttribute('role', 'listbox');
        picker.setAttribute('data-omni-keep-dom', '');
        picker.style.cssText = 'display:none;min-width:80px;';
        if (!source) [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72].forEach(size => {
            picker.insertAdjacentHTML('beforeend', `<div class="dropdown-item" data-size="${size}"><div class="menu-text" style="font-size:${size}pt;">${size} pt</div></div>`);
        });
        picker.querySelectorAll('.dropdown-item[data-size]').forEach(item => { item.setAttribute('role', 'option'); item.tabIndex = -1; });
        picker.addEventListener('mousedown', event => {
            const item = event.target.closest('.dropdown-item[data-size]');
            if (!item) return;
            event.preventDefault();
            closeFloatingPanels();
            setFontSize(Number(item.dataset.size));
        });
        floatingHost().appendChild(picker);
        floatingPanels.add(picker);
        return picker;
    }
    $('fontSizeBtn').addEventListener('click', event => {
        if (!editor.sheet) return;
        const picker = sizePicker();
        if (!openFloating(picker, $('fontSizeBtn'))) return;
        const current = String(activeStyle().fs || DEFAULT_PT);
        picker.querySelectorAll('.dropdown-item[data-size]').forEach(item => {
            const on = item.dataset.size === current;
            item.classList.toggle('is-checked', on);
            item.setAttribute('aria-selected', String(on));
        });
        const selected = picker.querySelector('.is-checked');
        if (selected) selected.scrollIntoView({ block: 'nearest' });
        if (event.target !== $('fontSizeDisplay')) viewport.focus({ preventScroll: true });
    });

    // Alignment: OmniWrite's icon group (horizontal and vertical alignment for cells).
    function alignGroup() {
        let group = $('sheetsAlignGroup');
        if (group) return group;
        group = document.createElement('div');
        group.id = 'sheetsAlignGroup';
        group.className = 'dropdown-item-groups liquid-glass sheets-align-group';
        group.setAttribute('role', 'toolbar');
        group.setAttribute('data-omni-keep-dom', '');
        [['ha', 'left', 'format_align_left', 'sheets_align_left'], ['ha', 'center', 'format_align_center', 'sheets_align_center'], ['ha', 'right', 'format_align_right', 'sheets_align_right'],
            ['va', 'top', 'vertical_align_top', 'sheets_align_top'], ['va', 'middle', 'vertical_align_center', 'sheets_align_middle'], ['va', 'bottom', 'vertical_align_bottom', 'sheets_align_bottom']].forEach(([prop, value, icon, key], index) => {
            if (index === 3) group.appendChild(document.createElement('vl'));
            const item = document.createElement('div');
            item.className = 'toolbar-item';
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.dataset.prop = prop;
            item.dataset.value = value;
            item.innerHTML = `<icon aria-hidden="true">${icon}</icon>`;
            item.setAttribute('aria-label', t(key));
            item.setAttribute('data-tooltip', t(key));
            item.setAttribute('data-i18n-title', key);
            item.addEventListener('mousedown', event => event.preventDefault());
            item.addEventListener('click', () => {
                styleRange(st => { st[prop] = prop === 'va' && value === 'middle' ? undefined : value; });
                syncAlignGroup();
            });
            group.appendChild(item);
        });
        floatingHost().appendChild(group);
        floatingPanels.add(group);
        return group;
    }
    function syncAlignGroup() {
        const group = $('sheetsAlignGroup');
        if (!group) return;
        const s = activeStyle();
        group.querySelectorAll('.toolbar-item[data-prop]').forEach(item => {
            const current = item.dataset.prop === 'va' ? (s.va || 'middle') : (s.ha || 'left');
            const on = current === item.dataset.value;
            item.classList.toggle('is-active', on);
            item.setAttribute('aria-pressed', String(on));
        });
    }
    on('alignGroupBtn', el => {
        if (!editor.sheet) return;
        if (!openFloating(alignGroup(), el)) return;
        syncAlignGroup();
    });
    on('bordersBtn', el => openMenu(el, [
        { icon: 'border_all', label: t('sheets_border_all'), action: () => applyBorders('all') },
        { icon: 'border_outer', label: t('sheets_border_outer'), action: () => applyBorders('outer') },
        { icon: 'border_style', label: t('sheets_border_thick'), action: () => applyBorders('thick') },
        { icon: 'border_top', label: t('sheets_border_top'), action: () => applyBorders('top') },
        { icon: 'border_bottom', label: t('sheets_border_bottom'), action: () => applyBorders('bottom') },
        { icon: 'border_left', label: t('sheets_border_left'), action: () => applyBorders('left') },
        { icon: 'border_right', label: t('sheets_border_right'), action: () => applyBorders('right') },
        { sep: true },
        { icon: 'border_clear', label: t('sheets_border_none'), action: () => applyBorders('none') }
    ]));
    on('insertChartBtn', () => openChartDialog(null));
    const QUICK_FUNCTIONS = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'SUMIF', 'COUNTIF', 'VLOOKUP', 'XLOOKUP', 'ROUND', 'CONCAT', 'TODAY'];
    on('functionBtn', el => openMenu(el, [
        ...QUICK_FUNCTIONS.map(name => ({ icon: 'function', label: name, action: () => insertFunction(name) })),
        { sep: true },
        { icon: 'list', label: t('sheets_all_functions'), action: () => openHelp(true) }
    ]));
    on('insertBtn', el => openMenu(el, insertMenuItems()));
    function openCellSizeDialog() {
        if (!editor.sheet || blockIfLocked()) return;
        commitEdit();
        const sheet = editor.sheet;
        const range = selRange();
        openDialog({
            title: t('sheets_resize_cells'), maxWidth: 480,
            html: `<form class="sheets-form">
                <label class="mu-field"><span class="mu-field-label">${esc(t('sheets_column_width'))} (px)</span><input class="mu-input" name="cellWidth" type="number" min="24" step="1" required value="${sheet.colWidths[range.c1] ?? DEF_W}"></label>
                <label class="mu-field"><span class="mu-field-label">${esc(t('sheets_row_height'))} (px)</span><input class="mu-input" name="cellHeight" type="number" min="24" step="1" required value="${sheet.rowHeights[range.r1] ?? DEF_H}"></label>
                <div class="sheets-form-actions"><button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="submit" class="mu-btn mu-btn-primary">${esc(t('save'))}</button></div>
            </form>`,
            onMount(modal, close) {
                const form = modal.querySelector('form');
                form.querySelector('[data-act=cancel]').onclick = close;
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    if (!form.reportValidity() || editor.sheet !== sheet || blockIfLocked()) return;
                    const width = form.elements.cellWidth.valueAsNumber;
                    const height = form.elements.cellHeight.valueAsNumber;
                    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
                    editStructure(() => {
                        for (let c = range.c1; c <= range.c2; c++) sheet.colWidths[c] = width;
                        for (let r = range.r1; r <= range.r2; r++) sheet.rowHeights[r] = height;
                        layoutDirty = true;
                    });
                    close();
                });
            }
        });
    }
    on('formatGroupBtn', el => openMenu(el, [
        { icon: 'resize', label: t('sheets_resize_cells'), action: openCellSizeDialog },
        ...[['left', 'format_align_left'], ['center', 'format_align_center'], ['right', 'format_align_right']].map(([value, icon]) => ({ icon, label: t('sheets_align_' + value), checked: (activeStyle().ha || 'left') === value, action: () => styleRange(st => { st.ha = value; }) })),
        ...[['top', 'vertical_align_top'], ['middle', 'vertical_align_center'], ['bottom', 'vertical_align_bottom']].map(([value, icon]) => ({ icon, label: t('sheets_align_' + value), checked: (activeStyle().va || 'middle') === value, action: () => styleRange(st => { st.va = value === 'middle' ? undefined : value; }) })),
        { sep: true },
        { icon: 'strikethrough_s', label: t('strikethrough'), checked: !!activeStyle().st, hint: 'Alt ⇧ 5', action: () => toggleStyle('st') },
        { icon: 'format_clear', label: t('clear_formatting'), hint: MOD + ' \\', action: clearFormatting },
        { icon: 'backspace', label: t('sheets_clear_contents'), hint: 'Del', action: clearContents },
        { sep: true },
        { icon: 'fit_width', label: t('sheets_autofit'), action: () => { const range = selRange(); autoFitColumns(seq(range.c1, range.c2)); } },
        { sep: true },
        { icon: 'delete_sweep', label: t('sheets_delete_rows'), action: () => deleteRowsCols('row') },
        { icon: 'view_column', label: t('sheets_delete_cols'), action: () => deleteRowsCols('col') }
    ]));
    on('dataBtn', el => openMenu(el, dataMenuItems()));
    on('replaceInDocumentBtn', () => openFind(true));
    on('documentZoomBtn', el => openMenu(el, [50, 75, 90, 100, 110, 125, 150, 200].map(z => ({ icon: Math.round(editor.zoom * 100) === z ? 'check' : 'zoom_in', label: z + '%', checked: Math.round(editor.zoom * 100) === z, action: () => setZoom(z / 100) }))));
    function setZoom(z) {
        editor.zoom = clamp(z, 0.25, 4);
        layoutDirty = true;
        updateZoomLabel();
        if (editor.editing) positionCellEditor();
        scheduleRender();
        refreshCharts(true);
    }
    function updateZoomLabel() { $('documentZoomDisplay').textContent = String(Math.round(editor.zoom * 100)); }
    viewport.addEventListener('wheel', event => {
        if (!(event.ctrlKey || event.metaKey) || !editor.sheet) return;
        event.preventDefault();
        setZoom(Math.round((editor.zoom + (event.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10);
    }, { passive: false });

    function insertMenuItems() {
        return [
            { icon: 'insert_chart', label: t('insert_chart'), action: () => openChartDialog(null) },
            { icon: 'functions', label: t('sheets_functions'), action: () => insertFunction('SUM') },
            { icon: 'link', label: t('insert_link'), hint: MOD + ' K', action: openLinkDialog },
            { icon: 'check_box', label: t('sheets_insert_checkbox'), action: insertCheckboxes },
            { icon: 'arrow_drop_down_circle', label: t('sheets_insert_dropdown'), action: openDropdownDialog },
            { icon: 'sticky_note_2', label: t('sheets_insert_note'), action: openNoteDialog },
            { icon: 'calendar_month', label: t('sheets_pick_date'), action: () => openCellPicker('date') },
            { icon: 'schedule', label: t('sheets_pick_time'), action: () => openCellPicker('time') },
            { icon: 'event', label: t('sheets_pick_datetime'), action: () => openCellPicker('datetime') },
            { icon: 'today', label: t('sheets_insert_date'), hint: MOD + ' ;', action: () => setActiveValue(todayText()) },
            { icon: 'more_time', label: t('sheets_insert_time'), hint: MOD + ' ⇧ ;', action: () => setActiveValue(currentTimeText()) },
            { sep: true },
            { icon: 'arrow_upward', label: t('sheets_row_above'), action: () => insertRowsCols('row', 'before') },
            { icon: 'arrow_downward', label: t('sheets_row_below'), action: () => insertRowsCols('row', 'after') },
            { icon: 'arrow_back', label: t('sheets_col_left'), action: () => insertRowsCols('col', 'before') },
            { icon: 'arrow_forward', label: t('sheets_col_right'), action: () => insertRowsCols('col', 'after') },
            { sep: true },
            { icon: 'tab', label: t('sheets_add_sheet'), action: addSheet }
        ];
    }
    function openCellContextMenu(x, y) {
        openMenu(null, [
            { icon: 'resize', label: t('sheets_resize_cells'), action: openCellSizeDialog },
            { icon: 'content_cut', label: t('ctx_cut'), hint: MOD + ' X', action: () => clipboardAction('cut') },
            { icon: 'content_copy', label: t('ctx_copy'), hint: MOD + ' C', action: () => clipboardAction('copy') },
            { icon: 'content_paste', label: t('ctx_paste'), hint: MOD + ' V', action: () => clipboardAction('paste') },
            { icon: 'content_paste_go', label: t('ctx_paste_plain'), action: () => clipboardAction('values') },
            { sep: true },
            { icon: 'arrow_upward', label: t('sheets_row_above'), action: () => insertRowsCols('row', 'before') },
            { icon: 'arrow_downward', label: t('sheets_row_below'), action: () => insertRowsCols('row', 'after') },
            { icon: 'arrow_back', label: t('sheets_col_left'), action: () => insertRowsCols('col', 'before') },
            { icon: 'arrow_forward', label: t('sheets_col_right'), action: () => insertRowsCols('col', 'after') },
            { icon: 'delete_sweep', label: t('sheets_delete_rows'), action: () => deleteRowsCols('row') },
            { icon: 'view_column', label: t('sheets_delete_cols'), action: () => deleteRowsCols('col') },
            { sep: true },
            { icon: 'backspace', label: t('sheets_clear_contents'), action: clearContents },
            { icon: 'sort_by_alpha', label: t('sheets_sort_az'), action: () => sortRange(true) },
            { icon: 'sort', label: t('sheets_sort_za'), action: () => sortRange(false) },
            { sep: true },
            { icon: 'link', label: t('insert_link'), action: openLinkDialog },
            { icon: 'sticky_note_2', label: t('sheets_insert_note'), action: openNoteDialog },
            ...(window.OmniCollab ? [{ icon: 'add_comment', label: t('comment_add'), action: () => window.OmniCollab.openComments('spreadsheet', { compose: true }) }] : []),
            { icon: 'insert_chart', label: t('insert_chart'), action: () => openChartDialog(null) }
        ], { x, y });
    }
    function insertFunction(name) {
        const range = selRange();
        const multi = range.r1 !== range.r2 || range.c1 !== range.c2;
        if (multi && !isLargeRange(range)) {
            // Like AutoSum: the result goes under a column range (or right of a row range).
            const below = range.r2 > range.r1 || range.c1 === range.c2;
            const r = below ? range.r2 + 1 : range.r1, c = below ? range.c1 : range.c2 + 1;
            editCells(set => { const cell = clone(getCell(r, c)) || {}; cell.v = `=${name}(${E.rangeName(range)})`; set(r, c, cell); });
            setSelection(r, c);
            return;
        }
        startEdit('=' + name + '(');
    }

    /* ================================================================ rows & columns */
    function shiftRecord(obj, index, count) {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            const i = Number(k);
            if (count < 0 && i >= index && i < index - count) continue;
            out[i >= index ? i + count : i] = v;
        }
        return out;
    }
    function shiftStructure(sheet, axis, index, count) {
        const cells = {};
        for (const [key, cell] of Object.entries(sheet.cells)) {
            let [r, c] = key.split(':').map(Number);
            const pos = axis === 'row' ? r : c;
            if (count < 0 && pos >= index && pos < index - count) continue;
            if (pos >= index) { if (axis === 'row') r += count; else c += count; }
            cells[r + ':' + c] = cell;
        }
        sheet.cells = cells;
        if (axis === 'row') { sheet.rowHeights = shiftRecord(sheet.rowHeights, index, count); sheet.rows = Math.max(1, sheet.rows + count); }
        else { sheet.colWidths = shiftRecord(sheet.colWidths, index, count); sheet.cols = Math.max(1, sheet.cols + count); }
        const k1 = axis === 'row' ? 'r1' : 'c1', k2 = axis === 'row' ? 'r2' : 'c2';
        sheet.merges = sheet.merges.map(m => {
            const n = Object.assign({}, m);
            if (count > 0) { if (n[k1] >= index) n[k1] += count; if (n[k2] >= index) n[k2] += count; }
            else {
                const end = index - count;
                if (n[k1] >= index && n[k2] < end) return null;
                if (n[k1] >= end) n[k1] += count; else if (n[k1] >= index) n[k1] = index;
                if (n[k2] >= end) n[k2] += count; else if (n[k2] >= index) n[k2] = index - 1;
                if (n[k2] < n[k1]) return null;
            }
            return n.r1 === n.r2 && n.c1 === n.c2 ? null : n;
        }).filter(Boolean);
        // Formulas and chart ranges on every sheet follow the moved cells.
        for (const other of editor.book.sheets) {
            for (const cell of Object.values(other.cells)) {
                if (typeof cell.v === 'string' && cell.v[0] === '=') cell.v = E.adjustFormula(cell.v, other.name, sheet.name, axis, index, count);
            }
            for (const chart of other.charts || []) {
                const adjusted = E.adjustFormula('=' + chartRangeText(chart, other), other.name, sheet.name, axis, index, count).slice(1);
                chart.range = adjusted;
            }
        }
        // Conditional formats, the filter, and frozen panes follow the moved cells on this sheet.
        const moveRangeText = text => E.adjustFormula('=' + text, sheet.name, sheet.name, axis, index, count).slice(1);
        sheet.cf = (sheet.cf || []).map(rule => Object.assign({}, rule, { range: moveRangeText(rule.range) })).filter(rule => E.parseRangeA1(rule.range));
        if (sheet.filter) {
            const moved = E.parseRangeA1(moveRangeText(E.rangeName(sheet.filter)));
            if (!moved || (count < 0 && axis === 'row' && sheet.filter.r1 >= index && sheet.filter.r1 < index - count)) delete sheet.filter;
            else {
                const hidden = {};
                for (const [c, list] of Object.entries(sheet.filter.hidden || {})) {
                    let nc = Number(c);
                    if (axis === 'col') { if (count < 0 && nc >= index && nc < index - count) continue; if (nc >= index) nc += count; }
                    hidden[nc] = list;
                }
                sheet.filter = Object.assign({}, moved, { hidden });
            }
        }
        if (sheet.freeze) {
            const key = axis === 'row' ? 'rows' : 'cols';
            const n = sheet.freeze[key] || 0;
            if (index < n) sheet.freeze[key] = Math.max(0, count > 0 ? n + count : n - Math.min(-count, n - index));
        }
    }
    function chartRangeText(chart) { return chart.range || 'A1'; }
    function insertRowsCols(axis, where) {
        const range = selRange();
        const count = axis === 'row' ? Math.min(range.r2, editor.sheet.rows - 1) - range.r1 + 1 : Math.min(range.c2, editor.sheet.cols - 1) - range.c1 + 1;
        const index = axis === 'row' ? (where === 'before' ? range.r1 : range.r2 + 1) : (where === 'before' ? range.c1 : range.c2 + 1);
        const n = isLargeRange(range) ? 1 : count;
        editStructure(() => shiftStructure(editor.sheet, axis, index, n));
        if (axis === 'row') selectRange(index, range.c1, index + n - 1, range.c2, index, editor.sel.c);
        else selectRange(range.r1, index, range.r2, index + n - 1, editor.sel.r, index);
    }
    function deleteRowsCols(axis) {
        const range = selRange();
        const sheet = editor.sheet;
        const index = axis === 'row' ? range.r1 : range.c1;
        let count = axis === 'row' ? range.r2 - range.r1 + 1 : range.c2 - range.c1 + 1;
        const total = axis === 'row' ? sheet.rows : sheet.cols;
        if (count >= total) count = total - 1;
        if (count <= 0) return;
        editStructure(() => shiftStructure(sheet, axis, index, -count));
        setSelection(axis === 'row' ? Math.min(index, sheet.rows - 1) : editor.sel.r, axis === 'col' ? Math.min(index, sheet.cols - 1) : editor.sel.c);
    }
    function currentRegion(r, c) {
        const sheet = editor.sheet;
        const filled = (rr, cc) => { const cell = sheet.cells[rr + ':' + cc]; return !!(cell && cell.v !== undefined && cell.v !== ''); };
        let r1 = r, r2 = r, c1 = c, c2 = c, grew = true;
        while (grew) {
            grew = false;
            if (r1 > 0 && seq(c1, c2).some(cc => filled(r1 - 1, cc))) { r1--; grew = true; }
            if (r2 < sheet.rows - 1 && seq(c1, c2).some(cc => filled(r2 + 1, cc))) { r2++; grew = true; }
            if (c1 > 0 && seq(r1, r2).some(rr => filled(rr, c1 - 1))) { c1--; grew = true; }
            if (c2 < sheet.cols - 1 && seq(r1, r2).some(rr => filled(rr, c2 + 1))) { c2++; grew = true; }
        }
        return { r1, c1, r2, c2 };
    }
    function sortRange(ascending) {
        let range = trimRangeToData(selRange());
        const sheet = editor.sheet;
        let header = false;
        if (range.r1 === range.r2 && range.c1 === range.c2) {
            range = currentRegion(editor.sel.r, editor.sel.c);
            const firstRow = seq(range.c1, range.c2).map(c => editor.evaluator.value(sheet, range.r1, c));
            const secondRow = range.r2 > range.r1 ? seq(range.c1, range.c2).map(c => editor.evaluator.value(sheet, range.r1 + 1, c)) : [];
            header = range.r2 > range.r1 && firstRow.every(v => typeof v === 'string' && v) && secondRow.some(v => typeof v !== 'string');
        }
        const startRow = header ? range.r1 + 1 : range.r1;
        if (range.r2 <= startRow) return;
        const keyCol = clamp(editor.sel.c, range.c1, range.c2);
        const rows = seq(startRow, range.r2).map(r => ({ r, key: editor.evaluator.value(sheet, r, keyCol), cells: seq(range.c1, range.c2).map(c => sheet.cells[r + ':' + c] || null) }));
        rows.sort((a, b) => {
            const ae = a.key === null || a.key === '', be = b.key === null || b.key === '';
            if (ae !== be) return ae ? 1 : -1;
            const cmp = E.compareValues(E.isErr(a.key) ? '' : a.key, E.isErr(b.key) ? '' : b.key);
            return ascending ? cmp : -cmp;
        });
        editCells(set => rows.forEach((row, i) => row.cells.forEach((cell, j) => set(startRow + i, range.c1 + j, clone(cell)))));
        if (header) showToast(t('sheets_sort_header_note'), { type: 'info' });
    }

    /* ================================================================ links, notes, dropdowns, checkboxes */
    const safeUrl = url => /^(https?:\/\/|mailto:)/i.test(String(url || '').trim());
    function openLinkDialog() {
        if (!editor.sheet) return;
        const { r, c } = editor.sel;
        const cell = getCell(r, c);
        const text = cell && cell.v && cell.v[0] !== '=' ? cell.v : '';
        openDialog({
            title: t('insert_link'), maxWidth: 560,
            html: `<form class="sheets-form"><label class="mu-field"><span class="mu-field-label">${esc(t('sheets_link_text'))}</span><input class="mu-input" name="text" type="text" value="${esc(text)}" autocomplete="off"></label>
                <label class="mu-field"><span class="mu-field-label">${esc(t('sheets_link_url'))}</span><input class="mu-input" name="url" type="url" value="${esc(cell && cell.link || '')}" placeholder="https://" autocomplete="off"></label>
                <div class="sheets-form-actions">${cell && cell.link ? `<button type="button" data-act="remove" class="mu-btn mu-btn-danger-outline">${esc(t('sheets_remove_link'))}</button>` : ''}<button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="submit" class="mu-btn mu-btn-primary">${esc(t('save'))}</button></div></form>`,
            onMount(modal, close) {
                const form = modal.querySelector('form');
                modal.querySelector('[data-act=cancel]').onclick = close;
                const remove = modal.querySelector('[data-act=remove]');
                if (remove) remove.onclick = () => { editCells(set => { const next = clone(getCell(r, c)); delete next.link; set(r, c, next); }); close(); updateSelectionUI(); };
                setTimeout(() => form.url.focus(), 40);
                form.onsubmit = event => {
                    event.preventDefault();
                    const url = form.url.value.trim();
                    if (!safeUrl(url)) { showToast(t('sheets_invalid_link'), { type: 'error' }); return; }
                    editCells(set => { const next = clone(getCell(r, c)) || {}; next.link = url; next.v = form.text.value.trim() || (next.v && next.v[0] !== '=' ? next.v : url); set(r, c, next); });
                    close();
                    updateSelectionUI();
                };
            }
        });
    }
    function positionLinkChip() {
        const chip = $('sheetsLinkChip');
        const cell = editor.sheet && getCell(editor.sel.r, editor.sel.c);
        if (!cell || !cell.link || editor.editing || !safeUrl(cell.link)) { chip.style.display = 'none'; return; }
        const rect = cellRect(editor.sel.r, editor.sel.c);
        chip.innerHTML = '<icon>link</icon>';
        const a = document.createElement('a');
        a.href = cell.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = cell.link;
        chip.appendChild(a);
        Object.assign(chip.style, { display: 'flex', left: rect.x + 'px', top: (rect.y + rect.h + 6) + 'px' });
    }
    async function openNoteDialog() {
        if (!editor.sheet) return;
        const { r, c } = editor.sel;
        const cell = getCell(r, c);
        const note = await promptDialog(t('sheets_insert_note'), t('sheets_insert_note'), cell && cell.note || '', { multiline: true, placeholder: t('sheets_note_placeholder') });
        if (note === null) return;
        editCells(set => { const next = clone(getCell(r, c)) || {}; if (note.trim()) next.note = note.trim(); else delete next.note; set(r, c, next); });
    }
    function insertCheckboxes() {
        const range = selRange();
        if (isLargeRange(range)) return;
        editCells(set => forEachInRange(range, (r, c) => {
            const cell = clone(getCell(r, c)) || {};
            const value = editor.evaluator.value(editor.sheet, r, c);
            cell.chk = true;
            cell.v = value === true ? 'TRUE' : 'FALSE';
            delete cell.dd;
            set(r, c, cell);
        }));
    }
    function openDropdownDialog() {
        if (!editor.sheet) return;
        const range = selRange();
        if (isLargeRange(range)) return;
        const existing = getCell(editor.sel.r, editor.sel.c);
        const options = existing && existing.dd ? existing.dd.join('\n') : '';
        openDialog({
            title: t('sheets_insert_dropdown'), maxWidth: 520,
            html: `<form class="sheets-form"><label class="mu-field"><span class="mu-field-label">${esc(t('sheets_dropdown_options'))}</span><textarea class="mu-textarea" name="options" rows="6">${esc(options)}</textarea></label>
                <div class="sheets-form-actions">${existing && existing.dd ? `<button type="button" data-act="remove" class="mu-btn mu-btn-danger-outline">${esc(t('sheets_remove_dropdown'))}</button>` : ''}<button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="submit" class="mu-btn mu-btn-primary">${esc(t('save'))}</button></div></form>`,
            onMount(modal, close) {
                const form = modal.querySelector('form');
                modal.querySelector('[data-act=cancel]').onclick = close;
                const remove = modal.querySelector('[data-act=remove]');
                if (remove) remove.onclick = () => { editCells(set => forEachInRange(range, (r, c) => { const cell = clone(getCell(r, c)); if (cell) { delete cell.dd; set(r, c, cell); } })); close(); };
                form.onsubmit = event => {
                    event.preventDefault();
                    const list = [...new Set(form.options.value.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean))];
                    editCells(set => forEachInRange(range, (r, c) => { const cell = clone(getCell(r, c)) || {}; if (list.length) cell.dd = list; else delete cell.dd; delete cell.chk; set(r, c, cell); }));
                    close();
                };
            }
        });
    }
    function openDropdownMenu(r, c, anchor) {
        const cell = getCell(r, c);
        if (!cell || !cell.dd) return;
        const current = cell.v || '';
        openMenu(anchor, cell.dd.map(option => ({ icon: option === current ? 'radio_button_checked' : 'radio_button_unchecked', label: option, checked: option === current, action: () => { editCells(set => { const next = clone(getCell(r, c)); next.v = option; set(r, c, next); }); updateSelectionUI(); viewport.focus({ preventScroll: true }); } })));
    }

    /* ================================================================ sheet tabs */
    function renderTabs() {
        const tabs = $('sheetsTabs');
        tabs.replaceChildren(...editor.book.sheets.map(sheet => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'mu-btn mu-btn-ghost sheets-tab' + (sheet.id === editor.sheet.id ? ' is-active' : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(sheet.id === editor.sheet.id));
            tab.textContent = sheet.name;
            if (sheet.color) { const bar = document.createElement('span'); bar.className = 'sheets-tab-color'; bar.style.background = sheet.color; tab.appendChild(bar); }
            tab.addEventListener('click', () => switchSheet(sheet.id));
            tab.addEventListener('dblclick', () => renameSheetInline(sheet, tab));
            tab.addEventListener('contextmenu', event => { event.preventDefault(); openSheetMenu(sheet, null, event.clientX, event.clientY); });
            return tab;
        }));
        const active = tabs.querySelector('.is-active');
        if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function uniqueSheetName(base) {
        const names = new Set(editor.book.sheets.map(s => s.name.toLowerCase()));
        let n = editor.book.sheets.length + 1;
        let name = t('sheets_sheet_name', { n });
        while (names.has(name.toLowerCase())) name = t('sheets_sheet_name', { n: ++n });
        return base ? base : name;
    }
    function addSheet() {
        commitEdit();
        const sheet = newSheet(uniqueSheetName());
        editStructure(() => { editor.book.sheets.push(sheet); });
        switchSheet(sheet.id);
    }
    function validSheetName(name, sheet) {
        const clean = String(name || '').trim().replace(/[\[\]*?/\\:]/g, '').slice(0, 100);
        if (!clean) { showToast(t('sheets_name_required'), { type: 'error' }); return null; }
        if (editor.book.sheets.some(s => s !== sheet && s.name.toLowerCase() === clean.toLowerCase())) { showToast(t('sheets_name_taken'), { type: 'error' }); return null; }
        return clean;
    }
    function renameSheet(sheet, name) {
        const clean = validSheetName(name, sheet);
        if (!clean || clean === sheet.name) return;
        editStructure(() => {
            const old = sheet.name;
            for (const other of editor.book.sheets) {
                for (const cell of Object.values(other.cells)) if (typeof cell.v === 'string' && cell.v[0] === '=') cell.v = E.renameSheetInFormula(cell.v, old, clean);
                for (const chart of other.charts || []) chart.range = E.renameSheetInFormula('=' + chart.range, old, clean).slice(1);
            }
            sheet.name = clean;
        });
        renderTabs();
    }
    function renameSheetInline(sheet, tab) {
        const input = document.createElement('input');
        input.className = 'mu-input sheets-tab-rename';
        input.value = sheet.name;
        input.setAttribute('aria-label', t('sheets_rename_sheet'));
        tab.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = save => { if (done) return; done = true; if (save) renameSheet(sheet, input.value); renderTabs(); viewport.focus({ preventScroll: true }); };
        input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } if (event.key === 'Escape') { event.preventDefault(); finish(false); } });
        input.addEventListener('blur', () => finish(true));
    }
    function openSheetMenu(sheet, anchor, x, y) {
        const index = editor.book.sheets.indexOf(sheet);
        const colors = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#e91e8c', null];
        openMenu(anchor, [
            { icon: 'drive_file_rename_outline', label: t('sheets_rename_sheet'), action: () => { const tab = [...$('sheetsTabs').children][index]; if (tab) renameSheetInline(sheet, tab); } },
            { icon: 'content_copy', label: t('sheets_duplicate_sheet'), action: () => duplicateSheet(sheet) },
            { icon: 'chevron_left', label: t('sheets_move_left'), disabled: index === 0, action: () => moveSheet(sheet, -1) },
            { icon: 'chevron_right', label: t('sheets_move_right'), disabled: index === editor.book.sheets.length - 1, action: () => moveSheet(sheet, 1) },
            { heading: t('sheets_sheet_color') },
            { row: colors.map(color => ({ icon: color ? 'circle' : 'format_color_reset', iconColor: color || undefined, tooltip: color || t('reset'), action: () => { editStructure(() => { sheet.color = color; }); renderTabs(); } })) },
            { sep: true },
            { icon: 'delete', label: t('sheets_delete_sheet'), disabled: editor.book.sheets.length < 2, action: () => deleteSheet(sheet) }
        ], { x, y });
    }
    function duplicateSheet(sheet) {
        const copy = clone(sheet);
        copy.id = makeId(12);
        copy.name = validSheetName(t('sheets_copy_of', { name: sheet.name }), null) || uniqueSheetName();
        (copy.charts || []).forEach(c => { c.id = makeId(10); });
        editStructure(() => { editor.book.sheets.splice(editor.book.sheets.indexOf(sheet) + 1, 0, normalizeSheet(copy, 0)); });
        switchSheet(copy.id);
    }
    function moveSheet(sheet, delta) {
        const list = editor.book.sheets;
        const i = list.indexOf(sheet), j = i + delta;
        if (j < 0 || j >= list.length) return;
        editStructure(() => { list.splice(i, 1); list.splice(j, 0, sheet); });
        renderTabs();
    }
    async function deleteSheet(sheet) {
        if (editor.book.sheets.length < 2) { showToast(t('sheets_last_sheet'), { type: 'error' }); return; }
        if (Object.keys(sheet.cells).length && !(await confirmDialog(t('sheets_delete_sheet_confirm', { name: sheet.name }), { danger: true, confirmLabel: t('Delete') }))) return;
        const index = editor.book.sheets.indexOf(sheet);
        editStructure(() => {
            editor.book.sheets.splice(index, 1);
            if (editor.sheet === sheet) { editor.sheet = editor.book.sheets[Math.max(0, index - 1)]; editor.book.activeSheet = editor.sheet.id; }
        });
        layoutDirty = true;
        destroyCharts();
        renderTabs();
        afterDataChange();
        updateSelectionUI();
    }
    $('addSheetBtn').addEventListener('click', addSheet);
    $('allSheetsBtn').addEventListener('click', event => openMenu(event.currentTarget, editor.book ? editor.book.sheets.map(sheet => ({ icon: sheet.id === editor.sheet.id ? 'check' : 'tab', label: sheet.name, checked: sheet.id === editor.sheet.id, action: () => switchSheet(sheet.id) })) : []));

    /* ================================================================ charts */
    const CHART_TYPES = [
        ['column', 'bar_chart', 'sheets_chart_column'], ['bar', 'align_horizontal_left', 'sheets_chart_bar'], ['line', 'show_chart', 'sheets_chart_line'],
        ['area', 'area_chart', 'sheets_chart_area'], ['pie', 'pie_chart', 'sheets_chart_pie'], ['doughnut', 'donut_large', 'sheets_chart_doughnut'],
        ['scatter', 'scatter_plot', 'sheets_chart_scatter'], ['radar', 'radar', 'sheets_chart_radar']
    ];
    // Validated categorical palette for light chart surfaces (charts sit on the white grid).
    const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
    const chartInstances = new Map();
    function destroyCharts() {
        for (const inst of chartInstances.values()) { try { inst.chart && inst.chart.destroy(); } catch {} inst.el.remove(); }
        chartInstances.clear();
        $('sheetsChartsLayer').innerHTML = '';
    }
    function chartData(chart) {
        const text = chart.range || '';
        let sheet = editor.sheet, ref = text;
        const bang = text.lastIndexOf('!');
        if (bang > 0) {
            const name = text.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'");
            sheet = editor.book.sheets.find(s => s.name.toLowerCase() === name.toLowerCase());
            ref = text.slice(bang + 1);
        }
        const range = sheet && E.parseRangeA1(ref.replace(/\$/g, ''));
        if (!range) return null;
        let values = editor.evaluator.range(sheet, range);
        let labelsText = rangeMatrix(range, (r, c) => displayText(sheet, r, c));
        if (chart.seriesInRows) { values = values[0].map((_, c) => values.map(row => row[c])); labelsText = labelsText[0].map((_, c) => labelsText.map(row => row[c])); }
        const headers = chart.headers !== false && values.length > 1;
        const labelsCol = chart.labels !== false && values[0].length > 1;
        const start = headers ? 1 : 0;
        const labels = [];
        for (let i = start; i < values.length; i++) labels.push(labelsCol ? labelsText[i][0] : String(i - start + 1));
        const series = [];
        for (let j = labelsCol ? 1 : 0; j < values[0].length; j++) {
            series.push({ name: headers ? labelsText[0][j] || E.colName(range.c1 + j) : (chart.seriesInRows ? String(range.r1 + j + 1) : E.colName(range.c1 + j)), data: values.slice(start).map(row => (typeof row[j] === 'number' ? row[j] : null)) });
        }
        const usable = series.filter(s => s.data.some(v => v !== null));
        if (!usable.length || !labels.length) return null;
        // More than eight series fold into "Other", so colors never repeat.
        if (usable.length > SERIES.length) {
            const kept = usable.slice(0, SERIES.length - 1);
            const rest = usable.slice(SERIES.length - 1);
            kept.push({ name: t('sheets_other'), data: labels.map((_, i) => rest.reduce((sum, s) => sum + (s.data[i] || 0), 0)) });
            return { labels, series: kept, xNumeric: values.slice(start).map(row => (typeof row[0] === 'number' ? row[0] : null)) };
        }
        return { labels, series: usable, xNumeric: values.slice(start).map(row => (typeof row[0] === 'number' ? row[0] : null)) };
    }
    function chartConfig(chart, data) {
        const ink = '#1d2433', muted = '#52514e', grid = 'rgba(29,36,51,0.08)';
        const font = { family: "'Munetios UI v4 Font', system-ui, sans-serif", size: 18, weight: 400 };
        const locale = numberLocale();
        const fmt = v => (typeof v === 'number' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v) : v);
        const type = chart.type;
        const pieLike = type === 'pie' || type === 'doughnut';
        let datasets, labels = data.labels;
        if (pieLike) {
            let values = data.series[0].data.map(v => (v === null || v < 0 ? 0 : v));
            labels = [...data.labels];
            if (values.length > SERIES.length) {
                const other = values.slice(SERIES.length - 1).reduce((a, b) => a + b, 0);
                values = [...values.slice(0, SERIES.length - 1), other];
                labels = [...labels.slice(0, SERIES.length - 1), t('sheets_other')];
            }
            datasets = [{ label: data.series[0].name, data: values, backgroundColor: values.map((_, i) => SERIES[i]), borderColor: '#ffffff', borderWidth: 2, hoverOffset: 6 }];
        } else if (type === 'scatter') {
            const xs = data.xNumeric;
            const ys = data.series.length > 1 ? data.series.slice(1) : data.series;
            datasets = ys.map((s, i) => ({ label: s.name, data: s.data.map((y, k) => (y === null || xs[k] === null ? null : { x: data.series.length > 1 ? xs[k] : k + 1, y })).filter(Boolean), backgroundColor: SERIES[i], borderColor: '#ffffff', borderWidth: 2, pointRadius: 5, pointHoverRadius: 7 }));
        } else {
            datasets = data.series.map((s, i) => {
                const color = SERIES[i];
                const base = { label: s.name, data: s.data, borderColor: color, backgroundColor: color };
                if (type === 'line' || type === 'area' || type === 'radar') return Object.assign(base, { borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: color, pointBorderColor: '#ffffff', pointBorderWidth: 2, tension: 0.25, fill: type === 'area' ? 'origin' : false, backgroundColor: type === 'line' ? color : color + '33', spanGaps: true });
                return Object.assign(base, { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 64, categoryPercentage: 0.8, barPercentage: 0.9 });
            });
        }
        const showLegend = chart.legend !== false && (pieLike || datasets.length > 1);
        const options = {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            interaction: pieLike ? { mode: 'nearest', intersect: true } : { mode: type === 'scatter' ? 'nearest' : 'index', intersect: false },
            plugins: {
                legend: { display: showLegend, position: 'bottom', labels: { color: ink, font, usePointStyle: true, pointStyle: 'circle', pointStyleWidth: 12, boxWidth: 12, boxHeight: 12, padding: 16 } },
                tooltip: { backgroundColor: 'rgba(255,255,255,0.50)', titleColor: ink, bodyColor: ink, borderColor: 'rgba(29,36,51,0.14)', borderWidth: 1, padding: 12, titleFont: font, bodyFont: font, cornerRadius: 14, boxPadding: 6, callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${fmt(ctx.parsed && typeof ctx.parsed === 'object' ? (type === 'bar' ? ctx.parsed.x : ctx.parsed.y ?? ctx.parsed.r ?? ctx.raw) : ctx.raw)}` } }
            }
        };
        if (!pieLike && type !== 'radar') {
            const valueAxis = { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: muted, font, callback: v => fmt(v) } };
            const catAxis = { grid: { display: false }, border: { color: 'rgba(29,36,51,0.2)' }, ticks: { color: muted, font, maxRotation: 0, autoSkip: true } };
            options.scales = type === 'bar' ? { x: valueAxis, y: catAxis } : type === 'scatter' ? { x: Object.assign({}, valueAxis, { beginAtZero: false, type: 'linear' }), y: valueAxis } : { x: catAxis, y: valueAxis };
            if (type === 'bar') options.indexAxis = 'y';
        }
        if (type === 'radar') options.scales = { r: { grid: { color: grid }, angleLines: { color: grid }, pointLabels: { color: muted, font }, ticks: { display: false } } };
        return { type: type === 'column' || type === 'bar' ? 'bar' : type === 'area' ? 'line' : type, data: { labels, datasets }, options };
    }
    let chartRefreshTimer = null;
    function refreshCharts(force = false) {
        clearTimeout(chartRefreshTimer);
        chartRefreshTimer = setTimeout(() => renderCharts(force), force ? 0 : 120);
    }
    function renderCharts(force) {
        if (!editor.sheet) return;
        const layer = $('sheetsChartsLayer');
        const ids = new Set((editor.sheet.charts || []).map(c => c.id));
        for (const [id, inst] of chartInstances) if (!ids.has(id)) { try { inst.chart && inst.chart.destroy(); } catch {} inst.el.remove(); chartInstances.delete(id); }
        for (const chart of editor.sheet.charts || []) {
            let inst = chartInstances.get(chart.id);
            if (!inst) { inst = createChartElement(chart); layer.appendChild(inst.el); chartInstances.set(chart.id, inst); }
            const z = editor.zoom;
            Object.assign(inst.el.style, { left: chart.x * z + 'px', top: chart.y * z + 'px', width: chart.w * z + 'px', height: chart.h * z + 'px' });
            inst.el.classList.toggle('is-selected', editor.selectedChart === chart.id);
            inst.el.querySelector('.sheets-chart-title').textContent = chart.title || '';
            const data = chartData(chart);
            const body = inst.el.querySelector('.sheets-chart-body');
            const signature = JSON.stringify([chart.type, chart.legend, data, chart.title]);
            if (!force && signature === inst.signature) continue;
            inst.signature = signature;
            if (!data || typeof window.Chart !== 'function') {
                if (inst.chart) { inst.chart.destroy(); inst.chart = null; }
                body.innerHTML = `<div class="sheets-chart-empty">${esc(t('sheets_chart_empty'))}</div>`;
                continue;
            }
            const config = chartConfig(chart, data);
            if (inst.chart && inst.chart.config.type === config.type && !force) {
                inst.chart.data = config.data;
                inst.chart.options = config.options;
                inst.chart.update();
            } else {
                if (inst.chart) inst.chart.destroy();
                body.innerHTML = '<canvas role="img"></canvas>';
                const canvas = body.querySelector('canvas');
                canvas.setAttribute('aria-label', (chart.title || t('charts')) + ' · ' + data.series.map(s => s.name).join(', '));
                inst.chart = new window.Chart(canvas, config);
            }
        }
    }
    function createChartElement(chart) {
        const el = document.createElement('div');
        el.className = 'sheets-chart';
        el.dataset.chartId = chart.id;
        el.innerHTML = `<div class="sheets-chart-head"><span class="sheets-chart-title"></span><icon tabindex="0" role="button" data-act="edit">edit</icon><icon tabindex="0" role="button" data-act="more" aria-haspopup="menu">more_vert</icon></div><div class="sheets-chart-body"></div><div class="sheets-chart-resize" aria-hidden="true"></div>`;
        const editBtn = el.querySelector('[data-act=edit]'), moreBtn = el.querySelector('[data-act=more]');
        editBtn.setAttribute('aria-label', t('sheets_edit_chart')); editBtn.setAttribute('data-tooltip', t('sheets_edit_chart'));
        moreBtn.setAttribute('aria-label', t('more_options')); moreBtn.setAttribute('data-tooltip', t('more_options'));
        const findChart = () => editor.sheet.charts.find(c => c.id === chart.id);
        editBtn.addEventListener('click', () => openChartDialog(findChart()));
        moreBtn.addEventListener('click', () => openMenu(moreBtn, [
            { icon: 'edit', label: t('sheets_edit_chart'), action: () => openChartDialog(findChart()) },
            { icon: 'download', label: t('sheets_download_png'), action: () => downloadChartImage(findChart()) },
            { sep: true },
            { icon: 'delete', label: t('sheets_delete_chart'), action: () => deleteChart(chart.id) }
        ], { align: 'end' }));
        el.addEventListener('pointerdown', event => {
            if (event.target.closest('icon')) return;
            selectChart(chart.id);
            if (isLocked()) return;
            const resizing = event.target.closest('.sheets-chart-resize');
            const moving = event.target.closest('.sheets-chart-head');
            if (!resizing && !moving) return;
            event.preventDefault();
            const live = findChart();
            if (!live) return;
            const before = snapshotState();
            const start = { x: event.clientX, y: event.clientY, cx: live.x, cy: live.y, w: live.w, h: live.h };
            el.setPointerCapture(event.pointerId);
            const move = e => {
                const dx = (e.clientX - start.x) / editor.zoom, dy = (e.clientY - start.y) / editor.zoom;
                if (resizing) { live.w = Math.max(240, Math.round(start.w + dx)); live.h = Math.max(180, Math.round(start.h + dy)); }
                else { live.x = Math.max(0, Math.round(start.cx + dx)); live.y = Math.max(0, Math.round(start.cy + dy)); }
                const z = editor.zoom;
                Object.assign(el.style, { left: live.x * z + 'px', top: live.y * z + 'px', width: live.w * z + 'px', height: live.h * z + 'px' });
            };
            const up = () => {
                el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
                const after = snapshotState();
                if (after !== before) { pushHistory({ type: 'state', before, after }); touchBook(editor.book); }
            };
            el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        });
        return { el, chart: null, signature: null };
    }
    function selectChart(id) {
        if (editor.editing) commitEdit();
        editor.selectedChart = id;
        document.querySelectorAll('.sheets-chart').forEach(el => el.classList.toggle('is-selected', el.dataset.chartId === id));
        viewport.focus({ preventScroll: true });
    }
    function deleteChart(id) {
        editStructure(() => { editor.sheet.charts = editor.sheet.charts.filter(c => c.id !== id); });
        editor.selectedChart = null;
        refreshCharts(true);
    }
    function downloadChartImage(chart) {
        const inst = chart && chartInstances.get(chart.id);
        if (!inst || !inst.chart) return;
        const source = inst.chart.canvas;
        const out = document.createElement('canvas');
        out.width = source.width; out.height = source.height;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(source, 0, 0);
        out.toBlob(blob => blob && downloadBlob(blob, safeFileName(chart.title || t('charts')) + '.png'));
    }
    function openChartDialog(existing) {
        if (!editor.sheet) return;
        const range = selRange();
        const chart = existing ? clone(existing) : {
            id: makeId(10), type: 'column', title: '', headers: true, labels: true, legend: true,
            range: range.r1 === range.r2 && range.c1 === range.c2 ? E.rangeName(currentRegion(editor.sel.r, editor.sel.c)) : E.rangeName(trimRangeToData(range))
        };
        openDialog({
            title: t('sheets_chart_editor'), maxWidth: 720,
            html: `<form class="sheets-form">
                <div class="sheets-chart-types" role="radiogroup" aria-label="${esc(t('chart_type'))}">${CHART_TYPES.map(([type, icon, key]) => `<button type="button" class="mu-tile sheets-chart-type${chart.type === type ? ' is-selected' : ''}" role="radio" aria-checked="${chart.type === type}" data-type="${type}"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${icon}</span></span><span>${esc(t(key))}</span></button>`).join('')}</div>
                <label class="mu-field"><span class="mu-field-label">${esc(t('chart_title'))}</span><input class="mu-input" name="title" type="text" value="${esc(chart.title)}" autocomplete="off"></label>
                <div class="sheets-form-row"><label class="mu-field"><span class="mu-field-label">${esc(t('sheets_data_range'))}</span><input class="mu-input" name="range" type="text" value="${esc(chart.range)}" autocomplete="off" spellcheck="false"></label>
                <div class="sheets-form-label"><span>&nbsp;</span><button type="button" class="mu-btn" data-act="selection"><span class="mu-icon" aria-hidden="true">select_all</span>${esc(t('sheets_use_selection'))}</button></div></div>
                <label class="mu-check"><input name="headers" type="checkbox" ${chart.headers !== false ? 'checked' : ''}><span>${esc(t('sheets_first_row_headers'))}</span></label>
                <label class="mu-check"><input name="labels" type="checkbox" ${chart.labels !== false ? 'checked' : ''}><span>${esc(t('sheets_first_col_labels'))}</span></label>
                <label class="mu-check"><input name="legend" type="checkbox" ${chart.legend !== false ? 'checked' : ''}><span>${esc(t('sheets_show_legend'))}</span></label>
                <div class="sheets-form-actions">${existing ? `<button type="button" data-act="delete" class="mu-btn mu-btn-danger-outline">${esc(t('sheets_delete_chart'))}</button>` : ''}<button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="submit" class="mu-btn mu-btn-primary">${esc(existing ? t('save') : t('insert'))}</button></div>
            </form>`,
            onMount(modal, close) {
                const form = modal.querySelector('form');
                let type = chart.type;
                modal.querySelectorAll('.sheets-chart-type').forEach(btn => btn.addEventListener('click', () => {
                    type = btn.dataset.type;
                    modal.querySelectorAll('.sheets-chart-type').forEach(b => { b.classList.toggle('is-selected', b === btn); b.setAttribute('aria-checked', String(b === btn)); });
                }));
                modal.querySelector('[data-act=selection]').onclick = () => { form.range.value = E.rangeName(trimRangeToData(selRange())); };
                modal.querySelector('[data-act=cancel]').onclick = close;
                const del = modal.querySelector('[data-act=delete]');
                if (del) del.onclick = () => { close(); deleteChart(chart.id); };
                form.onsubmit = event => {
                    event.preventDefault();
                    const text = form.range.value.trim().replace(/\$/g, '');
                    const bang = text.lastIndexOf('!');
                    if (!E.parseRangeA1(bang > 0 ? text.slice(bang + 1) : text)) { showToast(t('sheets_invalid_range'), { type: 'error' }); return; }
                    Object.assign(chart, { type, title: form.title.value.trim(), range: text, headers: form.headers.checked, labels: form.labels.checked, legend: form.legend.checked });
                    editStructure(() => {
                        const list = editor.sheet.charts;
                        const i = list.findIndex(c => c.id === chart.id);
                        if (i >= 0) list[i] = chart;
                        else {
                            ensureLayout();
                            const z = editor.zoom;
                            // Place the chart beside its data so it never covers it.
                            const text = chart.range.slice(chart.range.lastIndexOf('!') + 1);
                            const dataRange = E.parseRangeA1(text) || selRange();
                            const right = colX[Math.min(dataRange.c2 + 1, editor.sheet.cols)] / z + 24;
                            const visibleLeft = viewport.scrollLeft / z, visibleRight = (viewport.scrollLeft + viewport.clientWidth) / z;
                            chart.x = Math.round(right + 560 <= visibleRight || right >= visibleLeft ? right : visibleLeft + 24);
                            chart.y = Math.round(Math.max(rowY[Math.min(dataRange.r1, editor.sheet.rows - 1)] / z, viewport.scrollTop / z + 16));
                            chart.w = 560; chart.h = 360;
                            list.push(chart);
                        }
                    });
                    close();
                    refreshCharts(true);
                    if (!existing) setTimeout(() => selectChart(chart.id), 50);
                };
            }
        });
    }

    /* ================================================================ find & replace */
    let findMatches = [], findIndex = -1;
    function openFind(replace) {
        if (!editor.sheet) return;
        commitEdit();
        $('findPanel').classList.add('is-open');
        $('replaceRow').style.display = replace ? 'flex' : 'none';
        $('findInput').focus();
        $('findInput').select();
        runFind();
    }
    function closeFind() { $('findPanel').classList.remove('is-open'); findMatches = []; }
    function runFind() {
        const query = $('findInput').value;
        const matchCase = $('findMatchCase').checked;
        findMatches = [];
        findIndex = -1;
        if (query && editor.sheet) {
            const q = matchCase ? query : query.toLowerCase();
            const keys = Object.keys(editor.sheet.cells).map(k => k.split(':').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            for (const [r, c] of keys) {
                const cell = getCell(r, c);
                const hay = [displayText(editor.sheet, r, c), cell.v || ''].map(s => (matchCase ? s : s.toLowerCase()));
                if (hay.some(s => s.includes(q))) findMatches.push({ r, c });
            }
            findIndex = findMatches.findIndex(m => m.r > editor.sel.r || (m.r === editor.sel.r && m.c >= editor.sel.c));
            if (findIndex < 0 && findMatches.length) findIndex = 0;
        }
        updateFindCount();
        if (findIndex >= 0) gotoMatch();
    }
    function updateFindCount() { $('findCount').textContent = !$('findInput').value ? '' : findMatches.length ? t('sheets_match_count', { current: findIndex + 1, total: findMatches.length }) : t('sheets_no_matches'); }
    function gotoMatch() { const m = findMatches[findIndex]; if (!m) return; setSelection(m.r, m.c); updateFindCount(); }
    function stepFind(delta) { if (!findMatches.length) return; findIndex = (findIndex + delta + findMatches.length) % findMatches.length; gotoMatch(); }
    function replaceIn(text, query, replacement, matchCase) {
        if (matchCase) return text.split(query).join(replacement);
        return text.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => replacement);
    }
    function replaceMatches(all) {
        const query = $('findInput').value;
        if (!query || !findMatches.length) return;
        const replacement = $('replaceInput').value;
        const matchCase = $('findMatchCase').checked;
        const targets = all ? findMatches : [findMatches[findIndex]];
        let count = 0;
        editCells(set => targets.forEach(({ r, c }) => {
            const cell = clone(getCell(r, c));
            if (!cell || cell.v === undefined) return;
            const next = replaceIn(String(cell.v), query, replacement, matchCase);
            if (next !== cell.v) { cell.v = next; set(r, c, cell); count++; }
        }));
        showToast(t('sheets_replaced', { count }), { type: 'success' });
        runFind();
    }
    $('findInput').addEventListener('input', runFind);
    $('findMatchCase').addEventListener('change', runFind);
    $('findInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); stepFind(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') { closeFind(); viewport.focus(); } });
    $('replaceInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); replaceMatches(false); } if (event.key === 'Escape') { closeFind(); viewport.focus(); } });
    $('findNextBtn').addEventListener('click', () => stepFind(1));
    $('findPrevBtn').addEventListener('click', () => stepFind(-1));
    $('findCloseBtn').addEventListener('click', () => { closeFind(); viewport.focus(); });
    $('replaceOneBtn').addEventListener('click', () => replaceMatches(false));
    $('replaceAllBtn').addEventListener('click', () => replaceMatches(true));

    /* ================================================================ files: import, export, print, share */
    const safeFileName = name => String(name || 'spreadsheet').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 120) || 'spreadsheet';
    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    function sheetMatrix(sheet, raw = false) {
        const used = { r: -1, c: -1 };
        for (const key of Object.keys(sheet.cells)) { const [r, c] = key.split(':').map(Number); if (r > used.r) used.r = r; if (c > used.c) used.c = c; }
        if (used.r < 0) return [];
        return rangeMatrix({ r1: 0, c1: 0, r2: used.r, c2: used.c }, (r, c) => (raw ? (getCell(r, c, sheet)?.v ?? '') : displayText(sheet, r, c)));
    }
    // Text encodings offered by OmniWrite's download dialog.
    const CP1252_HIGH = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
        0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
    function encodeText(text, encoding) {
        if (encoding === 'utf-8-bom') return { parts: ['﻿' + text], charset: 'utf-8' };
        if (encoding === 'utf-16le') {
            const bytes = new Uint8Array(2 + text.length * 2);
            bytes[0] = 0xFF; bytes[1] = 0xFE;
            for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); bytes[2 + i * 2] = code & 0xFF; bytes[3 + i * 2] = code >> 8; }
            return { parts: [bytes], charset: 'utf-16le' };
        }
        if (encoding === 'windows-1252') {
            const chars = [...text];
            const bytes = new Uint8Array(chars.length);
            chars.forEach((ch, i) => {
                const code = ch.codePointAt(0);
                bytes[i] = code < 0x80 || (code >= 0xA0 && code <= 0xFF) ? code : (CP1252_HIGH[code] || 0x3F);
            });
            return { parts: [bytes], charset: 'windows-1252' };
        }
        return { parts: [text], charset: 'utf-8' };
    }
    const htmlCellStyle = s => `${s.b ? 'font-weight:700;' : ''}${s.i ? 'font-style:italic;' : ''}${s.u ? 'text-decoration:underline;' : ''}${s.bg ? `background:${s.bg};` : ''}${s.fc ? `color:${s.fc};` : ''}`;
    function workbookHtml(book, charset) {
        const tables = book.sheets.map(sheet => `<h2>${esc(sheet.name)}</h2>${sheetTableHtml(sheet)}`).join('\n');
        return `<!DOCTYPE html>\n<html lang="${esc(document.documentElement.lang || 'en')}"><head><meta charset="${charset}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(book.title)}</title>
<style>body{font-family:'Munetios UI v4 Font',system-ui,sans-serif;margin:32px;color:#1d2433}h1{font-weight:300}h2{font-weight:300;margin-top:32px}table{border-collapse:collapse}td{border:1px solid #e4def3;padding:6px 10px;white-space:pre-wrap}</style></head>
<body><h1>${esc(book.title)}</h1>\n${tables}\n</body></html>\n`;
    }
    function workbookText(book) {
        return book.sheets.map(sheet => (book.sheets.length > 1 ? sheet.name + '\n' : '') + Files.toCSV(sheetMatrix(sheet), '\t')).join('\n\n');
    }
    function workbookMarkdown(book) {
        const cell = v => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
        return '# ' + book.title + '\n\n' + book.sheets.map(sheet => {
            const rows = sheetMatrix(sheet);
            if (!rows.length) return '## ' + sheet.name + '\n';
            const width = Math.max(...rows.map(row => row.length));
            const pad = row => Array.from({ length: width }, (_, i) => cell(row[i] ?? ''));
            const [head, ...body] = rows;
            return '## ' + sheet.name + '\n\n| ' + pad(head).join(' | ') + ' |\n| ' + Array(width).fill('---').join(' | ') + ' |\n' + body.map(row => '| ' + pad(row).join(' | ') + ' |').join('\n') + '\n';
        }).join('\n');
    }
    function exportFile(kind, encoding = 'utf-8') {
        if (!editor.book || blockIfLocked()) return;
        commitEdit();
        const book = editor.book;
        const base = safeFileName(book.title);
        const sheetBase = base + ' - ' + safeFileName(editor.sheet.name);
        const text = (content, type, name) => { const out = encodeText(content, encoding); downloadBlob(new Blob(out.parts, { type: type + ';charset=' + out.charset }), name); };
        if (kind === 'msheet') downloadBlob(Files.exportNativeWorkbook(book), base + '.msheet');
        else if (kind === 'xlsx') downloadBlob(Files.exportXLSX(book, editor.evaluator), base + '.xlsx');
        else if (kind === 'csv') text(Files.toCSV(sheetMatrix(editor.sheet), ','), 'text/csv', sheetBase + '.csv');
        else if (kind === 'tsv') text(Files.toCSV(sheetMatrix(editor.sheet), '\t'), 'text/tab-separated-values', sheetBase + '.tsv');
        else if (kind === 'txt') text(workbookText(book), 'text/plain', base + '.txt');
        else if (kind === 'html') text(workbookHtml(book, encodeText('', encoding).charset), 'text/html', base + '.html');
        else if (kind === 'md') text(workbookMarkdown(book), 'text/markdown', base + '.md');
        else if (kind === 'pdf') printSheet();
    }
    // Same dialog as OmniWrite's "Download Document", with spreadsheet formats.
    function openDownloadDialog() {
        if (!editor.book || blockIfLocked()) return;
        commitEdit();
        document.querySelectorAll('.omni-download-modal.sheets-download-modal').forEach(old => old.remove());
        const label = (key, fallback) => { const value = t(key); return value && value !== key ? value : fallback; };
        const formats = [
            ['msheet', 'table_view', label('download_as_msheet', 'Munetios Sheets Spreadsheet')],
            ['xlsx', 'table_view', label('download_as_xlsx', 'Download as XLSX')],
            ['csv', 'csv', label('download_as_csv', 'Download as CSV')],
            ['tsv', 'tsv', label('download_as_tsv', 'Download as TSV')],
            ['txt', 'text_snippet', label('download_as_txt', 'Download as TXT')],
            ['html', 'code', label('download_as_html', 'Download as HTML')],
            ['md', 'notes', label('download_as_md', 'Download as MD')],
            ['pdf', 'picture_as_pdf', label('download_as_pdf', 'Download as PDF')]
        ];
        const modal = document.createElement('div');
        modal.className = 'modal omni-download-modal sheets-download-modal';
        modal.innerHTML = `<div class="modal-content omni-doc-modal omni-download-dialog" role="dialog" aria-modal="true" aria-labelledby="sheetsDownloadTitle">
                <div class="omni-modal-header">
                    <div class="omni-modal-heading"><icon class="omni-modal-icon" aria-hidden="true">download</icon><h2 id="sheetsDownloadTitle">${esc(label('download_spreadsheet', 'Download Spreadsheet'))}</h2></div>
                    <button type="button" class="omni-modal-close" data-act="close" aria-label="${esc(t('close'))}"><icon aria-hidden="true">close</icon></button>
                </div>
                <p class="omni-modal-desc">${esc(label('download_format_intro', 'Choose format for'))} "${esc(editor.book.title)}":</p>
                <label class="omni-field">
                    <span class="omni-field-label">${esc(label('file_encoding', 'File encoding'))}</span>
                    <select class="mu-select" data-native-select data-encoding>
                        <option value="utf-8">${esc(label('encoding_utf8', 'UTF-8'))}</option>
                        <option value="utf-8-bom" selected>${esc(label('encoding_utf8_bom', 'UTF-8 with BOM'))}</option>
                        <option value="utf-16le">${esc(label('encoding_utf16le', 'UTF-16 LE'))}</option>
                        <option value="windows-1252">${esc(label('encoding_windows_1252', 'Windows-1252'))}</option>
                    </select>
                </label>
                <div class="omni-download-grid">${formats.map(([kind, icon, text]) => `<button type="button" class="omni-download-option" data-kind="${kind}"><icon aria-hidden="true">${icon}</icon><span class="omni-download-label">${esc(text)}</span><span class="omni-download-ext" aria-hidden="true">.${kind}</span></button>`).join('')}</div>
            </div>`;
        const previous = document.activeElement;
        const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); if (previous && previous.focus && document.contains(previous)) previous.focus(); };
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);
        modal.addEventListener('mousedown', event => { if (event.target === modal) close(); });
        modal.querySelector('[data-act=close]').addEventListener('click', close);
        modal.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => {
            const encoding = modal.querySelector('[data-encoding]').value;
            close();
            exportFile(button.dataset.kind, encoding);
        }));
        document.body.appendChild(modal);
        setTimeout(() => modal.querySelector('[data-kind]').focus(), 30);
    }
    function printSheet() {
        if (!editor.book || blockIfLocked()) return;
        commitEdit();
        const area = $('sheetsPrintArea');
        const rows = sheetMatrix(editor.sheet);
        area.innerHTML = `<h1>${esc(editor.book.title)} · ${esc(editor.sheet.name)}</h1><table>${rows.map((row, r) => `<tr>${row.map((v, c) => { const s = cellStyle(getCell(r, c)); return `<td style="${s.b ? 'font-weight:700;' : ''}${s.i ? 'font-style:italic;' : ''}${s.bg ? `background:${s.bg};` : ''}${s.fc ? `color:${s.fc};` : ''}text-align:${s.ha || (typeof editor.evaluator.value(editor.sheet, r, c) === 'number' ? 'right' : 'left')}">${esc(v)}</td>`; }).join('')}</tr>`).join('')}</table>`;
        window.print();
    }
    async function importFile(file) {
        try {
            await storageReady;
            const name = file.name.replace(/\.(msheet|csv|tsv|txt|xlsx)$/i, '') || t('sheets_untitled');
            let data;
            if (/\.msheet$/i.test(file.name)) {
                data = await Files.importNativeWorkbook(file);
                if (!data.title.trim()) data.title = name;
            } else {
                let sheets;
                if (/\.xlsx$/i.test(file.name)) sheets = await Files.importXLSX(await file.arrayBuffer());
                else {
                    const text = await file.text();
                    const rows = Files.parseCSV(text, /\.tsv$/i.test(file.name) ? '\t' : undefined);
                    const sheet = newSheet(name.slice(0, 100));
                    rows.forEach((row, r) => row.forEach((value, c) => { if (value !== '') sheet.cells[r + ':' + c] = { v: value }; }));
                    sheets = [sheet];
                }
                data = { title: name, sheets: sheets.map(s => Object.assign(newSheet(s.name), s, { id: makeId(12) })) };
            }
            if (typeof window.isCurrentWorkspaceWritable === 'function' && !window.isCurrentWorkspaceWritable('failed_save_documents')) return;
            const book = createBook(data);
            saveBookNow(book);
            renderLists();
            openBookRoute(book.id);
            window.hideSidebarIfMobile?.();
            showToast(t('sheets_imported', { name: book.title }), { type: 'success' });
        } catch (error) {
            console.error(error);
            showToast(t('sheets_import_failed'), { type: 'error' });
        }
    }
    $('importFileInput').addEventListener('change', event => { const file = event.target.files && event.target.files[0]; event.target.value = ''; if (file) importFile(file); });
    function pickImport() {
        if (typeof window.isCurrentWorkspaceWritable === 'function' && !window.isCurrentWorkspaceWritable('failed_save_documents')) return;
        $('importFileInput').click();
    }
    // Share: OmniWrite's Share dialog (same services and order), with spreadsheet text and a .xlsx file option.
    function workbookShareText(book) {
        return book.sheets.map(sheet => {
            const rows = sheetMatrix(sheet).map(row => row.join('\t').replace(/\t+$/, '')).filter(line => line.trim());
            return rows.length ? (book.sheets.length > 1 ? sheet.name + '\n' : '') + rows.join('\n') : '';
        }).filter(Boolean).join('\n\n');
    }
    async function copyToClipboard(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch {}
        try {
            const area = document.createElement('textarea');
            area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
            document.body.appendChild(area); area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok;
        } catch { return false; }
    }
    function showSharingLocked() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content liquid-glass" style="position:relative;max-width:400px;text-align:center;padding:32px 28px;">
            <icon style="font-size:48px;color:#e74c3c;" aria-hidden="true">lock</icon>
            <h2 style="margin:12px 0 8px;">${esc(omniT('sharing_disabled_title'))}</h2>
            <p style="opacity:0.8;line-height:1.6;">${esc(t('sharing_disabled_sheet_desc'))}</p>
            <button type="button" data-act="unlock" style="margin-top:20px;">${esc(t('unlock_spreadsheet'))}</button>
        </div>`;
        modal.querySelector('[data-act=unlock]').addEventListener('click', () => { modal.remove(); openLockDialog(); });
        modal.addEventListener('mousedown', event => { if (event.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        modal.querySelector('[data-act=unlock]').focus();
    }
    async function shareBook() {
        if (!editor.book) return;
        commitEdit();
        if (isLocked()) { showSharingLocked(); return; }
        const book = editor.book;
        const bodyText = workbookShareText(book);
        const pageUrl = window.location.href;
        const modal = document.createElement('div');
        modal.className = 'modal';
        const button = (id, icon, label, background, extra = '') => `<button type="button" data-share="${id}" style="justify-content: center; background: ${background};${extra}"><icon aria-hidden="true">${icon}</icon><span>${esc(label)}</span></button>`;
        modal.innerHTML = `<div class="modal-content liquid-glass" role="dialog" aria-modal="true" aria-labelledby="sheetsShareTitle" style="position:relative;max-width:500px;">
            <span class="modal-content-close" data-act="close" role="button" tabindex="0" aria-label="${esc(t('close'))}" style="position:absolute;top:18px;right:24px;cursor:pointer;font-size:28px;z-index:2;">&times;</span>
            <h2 id="sheetsShareTitle">${esc(t('share_spreadsheet_title'))}</h2>
            <p style="margin-bottom: 20px;">${esc(omniT('share_document_via'))} <span data-title></span></p>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                ${button('facebook', 'share', omniT('share_facebook'), '#1877f2')}
                ${button('gmail', 'email', omniT('share_gmail'), '#ea4335')}
                ${button('whatsapp', 'chat', omniT('share_whatsapp'), '#25d366')}
                ${button('linkedin', 'work', 'LinkedIn', '#0a66c2')}
                ${button('telegram', 'send', 'Telegram', '#229ed9')}
                ${button('reddit', 'forum', omniT('share_reddit'), '#ff4500')}
                ${button('link', 'link', omniT('share_copy_link'), '#5865f2')}
                ${button('text', 'article', t('share_copy_text'), '#4b5563')}
                ${button('markdown', 'code', t('share_copy_markdown'), '#374151')}
                ${button('native', 'ios_share', t('share_system'), '#7c3aed')}
                ${button('file', 'table_view', t('sheets_share_file') + ' (.xlsx)', '#4b5563')}
                ${button('pdf', 'download', omniT('download_as_pdf'), '#6c757d', ' margin-top: 10px;')}
            </div>
        </div>`;
        modal.querySelector('[data-title]').textContent = book.title;
        const previous = document.activeElement;
        const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); if (previous && previous.focus && document.contains(previous)) previous.focus(); };
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);
        modal.addEventListener('mousedown', event => { if (event.target === modal) close(); });
        const closeBtn = modal.querySelector('[data-act=close]');
        closeBtn.addEventListener('click', close);
        closeBtn.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close(); } });
        const open = url => window.open(url, '_blank', 'noopener,noreferrer');
        const enc = encodeURIComponent;
        const actions = {
            facebook: () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(pageUrl)}&quote=${enc(book.title + '\n\n' + bodyText)}`),
            gmail: () => open(`https://mail.google.com/mail/?view=cm&fs=1&su=${enc(book.title)}&body=${enc(bodyText + '\n\n' + pageUrl)}`),
            whatsapp: () => open(`https://web.whatsapp.com/send?text=${enc(book.title + '\n\n' + bodyText + '\n\n' + pageUrl)}`),
            linkedin: () => open(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(pageUrl)}`),
            telegram: () => open(`https://t.me/share/url?url=${enc(pageUrl)}&text=${enc(book.title + '\n\n' + bodyText)}`),
            reddit: () => open(`https://www.reddit.com/submit?url=${enc(pageUrl)}&title=${enc(book.title)}&text=${enc(bodyText)}`),
            // Like OmniWrite's Copy Link: a link that recreates this spreadsheet (the active sheet as CSV) for whoever opens it.
            link: async (btn) => {
                const link = window.location.origin + window.location.pathname + '#/sheets/create?name=' + enc(book.title) + '&csv=' + enc(Files.toCSV(sheetMatrix(editor.sheet, true), ','));
                if (await copyToClipboard(link)) {
                    const label = btn.querySelector('span');
                    label.textContent = omniT('share_link_copied');
                    setTimeout(() => { label.textContent = omniT('share_copy_link'); }, 2000);
                } else showToast(omniT('copy_document_text_failed'), { type: 'error' });
            },
            text: async () => { const ok = await copyToClipboard(bodyText); showToast(ok ? t('sheets_copied') : omniT('copy_document_text_failed'), { type: ok ? 'success' : 'error' }); },
            markdown: async () => { const ok = await copyToClipboard(workbookMarkdown(book)); showToast(ok ? t('sheets_copied') : omniT('copy_document_text_failed'), { type: ok ? 'success' : 'error' }); },
            native: async () => {
                if (!navigator.share) { showToast(t('share_system_unavailable'), { type: 'info' }); return; }
                try { await navigator.share({ title: book.title, text: bodyText.slice(0, 2000), url: pageUrl }); }
                catch (error) { if (error && error.name !== 'AbortError') showToast(t('share_system_unavailable'), { type: 'error' }); }
            },
            file: async () => {
                const file = new File([Files.exportXLSX(book, editor.evaluator)], safeFileName(book.title) + '.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                try {
                    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: book.title });
                    else downloadBlob(file, file.name);
                } catch (error) { if (error && error.name !== 'AbortError') downloadBlob(file, file.name); }
            },
            pdf: () => { close(); printSheet(); }
        };
        modal.querySelectorAll('[data-share]').forEach(btn => btn.addEventListener('click', () => actions[btn.dataset.share](btn)));
        document.body.appendChild(modal);
        setTimeout(() => modal.querySelector('[data-share]').focus(), 30);
    }
    // Opening a Copy Link creates the spreadsheet (OmniWrite's router calls this for #/sheets/create).
    async function createFromSharedLink(name, csv) {
        await storageReady;
        const rows = Files.parseCSV(String(csv || ''), ',');
        const sheet = newSheet(t('sheets_sheet_name', { n: 1 }));
        rows.forEach((row, r) => row.forEach((value, c) => { if (value !== '') sheet.cells[r + ':' + c] = { v: value }; }));
        const book = createBook({ title: String(name || t('sheets_untitled')).slice(0, 200), sheets: [normalizeSheet(sheet, 0)] });
        saveBookNow(book);
        renderLists();
        openBookRoute(book.id);
        showToast(t('sheets_imported', { name: book.title }), { type: 'success' });
    }
    function openInfo() {
        if (!editor.book) return;
        const stats = bookStats(editor.book);
        const encrypted = syncSignedIn() ? t('synced') + ' · ' + t('e2e_encrypted') : t('e2e_encrypted');
        openDialog({
            title: t('spreadsheet_info'), maxWidth: 560,
            html: `<div class="mu-group"><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">schedule</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(t('sheets_created'))}</span><span class="mu-row-subtitle">${esc(formatDateTime(editor.book.created))}</span></div></div><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">edit_calendar</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(t('sheets_updated'))}</span><span class="mu-row-subtitle">${esc(formatDateTime(editor.book.updatedAt))}</span></div></div><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">tab</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(t('sheets_tabs'))}</span><span class="mu-row-subtitle">${stats.sheets}</span></div></div><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">grid_on</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(t('sheets_cells'))}</span><span class="mu-row-subtitle">${new Intl.NumberFormat(numberLocale()).format(stats.cells)}</span></div></div><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">bar_chart</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(t('charts'))}</span><span class="mu-row-subtitle">${stats.charts}</span></div></div><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">lock</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(t('sheets_encryption'))}</span><span class="mu-row-subtitle">${esc(encrypted)}</span></div></div></div>`
        });
    }
    function updatePinButton() {
        const btn = $('pinDocumentBtn');
        if (!editor.book) return;
        const label = t(editor.book.pinned ? 'unpin_spreadsheet' : 'pin_spreadsheet');
        btn.textContent = 'push_pin';
        btn.classList.toggle('active', !!editor.book.pinned);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('data-tooltip', label);
        btn.setAttribute('data-i18n-title', editor.book.pinned ? 'unpin_spreadsheet' : 'pin_spreadsheet');
    }
    $('pinDocumentBtn').addEventListener('click', () => editor.book && togglePin(editor.book));
    $('lockDocumentBtn').addEventListener('click', openLockDialog);
    $('versionHistoryBtn').addEventListener('click', openVersionHistory);
    $('documentInfoBtn').addEventListener('click', openInfo);
    // Share opens real-time collaboration (../collab.js); its "More ways to share" opens shareBook.
    $('shareDocumentBtn').addEventListener('click', () => (window.OmniCollab ? window.OmniCollab.openShare('spreadsheet') : shareBook()));
    $('downloadDocumentBtn').addEventListener('click', () => openDownloadDialog());
    $('moreEditorBtn').addEventListener('click', event => {
        const book = editor.book;
        if (!book) return;
        applyTopbar();
        // Full menu, plus OmniWrite's "Editor topbar items" and "Editor toolbar items" sections when
        // the layout or customization moved buttons into More.
        openMenu(event.currentTarget, [
            ...topbarMoreMenuItems(),
            ...toolbarMoreMenuItems(),
            { icon: 'info', label: t('spreadsheet_info'), action: openInfo },
            { icon: 'drive_file_rename_outline', label: t('rename_spreadsheet'), action: () => renameBook(book) },
            { icon: 'push_pin', label: t(book.pinned ? 'unpin_spreadsheet' : 'pin_spreadsheet'), action: () => togglePin(book) },
            { icon: 'content_copy', label: t('Make a Copy'), action: () => duplicateBook(book) },
            { icon: 'history', label: t('version_history'), action: openVersionHistory },
            { icon: isLocked() ? 'lock_open' : 'lock', label: t(isLocked() ? 'unlock_spreadsheet' : 'lock_spreadsheet'), action: openLockDialog },
            { icon: 'drive_file_move', label: omniT('move_to_folder'), action: () => window.moveOmniSpreadsheetToFolder?.(book) },
            { icon: 'workspaces', label: t('move_to_workspace'), action: () => openMoveToWorkspace(book, $('moreEditorBtn')) },
            { icon: 'download', label: t('download_spreadsheet'), action: () => openDownloadDialog() },
            { icon: 'upload_file', label: t('import_spreadsheet'), action: pickImport },
            { icon: 'share', label: t('Share'), action: () => $('shareDocumentBtn').click() },
            ...(window.OmniCollab && window.OmniCollab.canReport('spreadsheet', book) ? [{ icon: 'flag', label: t('collab_report'), action: () => window.OmniCollab.openReport('spreadsheet') }] : []),
            { icon: 'print', label: t('print'), action: printSheet },
            { icon: 'edit_square', label: t('customize_sheets_toolbar'), action: () => window.OmniToolbarCustomization && window.OmniToolbarCustomization.open(toolbarContext) },
            { sep: true },
            { icon: 'delete', label: t('Delete'), action: () => trashBook(book) }
        ], { align: 'end' });
    });
    // Title rename in place
    const titleEl = $('editableTitle');
    titleEl.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); titleEl.blur(); } if (event.key === 'Escape') { titleEl.textContent = editor.book ? editor.book.title : ''; titleEl.blur(); } });
    titleEl.addEventListener('blur', () => {
        if (!editor.book) return;
        if (isLocked()) { titleEl.textContent = editor.book.title; return; }
        const name = titleEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!name) { titleEl.textContent = editor.book.title; return; }
        if (name !== editor.book.title) { editor.book.title = name; updateDocumentTitle(); touchBook(editor.book); renderLists(); }
        titleEl.textContent = editor.book.title;
    });
    titleEl.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, (event.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')); });

    /* ================================================================ topbar (same as OmniWrite's document topbar)
       Layout, customization (left / right / More / hidden), and the responsive More rules come from
       OmniWrite itself, so both topbars always match. */
    let topbarMoreKeys = [];
    let topbarSignature = '';
    const topbarNavbar = () => { const page = $(SHEET_PAGE_ID); return page ? page.querySelector('.navbar') : null; };
    function applyTopbar() {
        const navbar = topbarNavbar();
        if (!navbar || !isSheetPageActive() || typeof window.getOmniEditorTopbarConfig !== 'function') return;
        const left = navbar.querySelector('.navbar__left'), right = navbar.querySelector('.navbar__right');
        if (!left || !right) return;
        const config = window.getOmniEditorTopbarConfig(navbar.getBoundingClientRect().width || window.innerWidth);
        const signature = JSON.stringify(config.map(item => [item.key, item.location]));
        topbarMoreKeys = config.filter(item => item.location === 'more' && item.supportsMore !== false && item.key !== 'moreEditorBtn').map(item => item.key);
        if (signature === topbarSignature) return; // moving nodes would interrupt title editing
        topbarSignature = signature;
        const leftFragment = document.createDocumentFragment(), rightFragment = document.createDocumentFragment();
        config.forEach(item => {
            const node = item.key === 'toggleSidebar' ? navbar.querySelector('#toggleSidebar') : $(item.key);
            if (!node || !navbar.contains(node)) return;
            const location = item.required && (item.location === 'hidden' || item.location === 'more') ? 'right' : item.location;
            node.style.display = location === 'hidden' || location === 'more' ? 'none' : '';
            if (node.tagName === 'ICON') node.classList.toggle('liquid-glass', location === 'left');
            if (location === 'left') leftFragment.appendChild(node);
            else if (location === 'right') rightFragment.appendChild(node);
        });
        left.appendChild(leftFragment);
        right.appendChild(rightFragment);
        window.positionEditorTopbarCollaboration?.(right);
    }
    if (typeof ResizeObserver === 'function') {
        let topbarFrame = 0;
        new ResizeObserver(() => {
            if (topbarFrame) return;
            topbarFrame = requestAnimationFrame(() => { topbarFrame = 0; applyTopbar(); });
        }).observe(topbarNavbar() || document.body);
    }
    window.addEventListener('storage', event => { if (event.key && /topbar/i.test(event.key)) { topbarSignature = ''; applyTopbar(); } });
    const topbarLabel = key => {
        const book = editor.book;
        if (key === 'pinDocumentBtn') return omniT(book && book.pinned ? 'unpin_spreadsheet' : 'pin_spreadsheet');
        if (key === 'lockDocumentBtn') return t(isLocked() ? 'unlock_spreadsheet' : 'lock_spreadsheet');
        if (key === 'documentInfoBtn') return t('spreadsheet_info');
        if (key === 'splitScreenBtn' && split) return t('exit_split_screen');
        return typeof window.getOmniEditorTopbarActionLabel === 'function' ? window.getOmniEditorTopbarActionLabel(key) : key;
    };
    const topbarIcon = key => {
        const node = $(key);
        if (node && node.textContent.trim()) return node.textContent.trim();
        return typeof window.getOmniEditorTopbarActionIcon === 'function' ? window.getOmniEditorTopbarActionIcon(key) : 'circle';
    };
    // Items the layout moved into More open from there, like OmniWrite's "Editor topbar items" section.
    const TOPBAR_KEYS_IN_FULL_MENU = new Set(['pinDocumentBtn', 'lockDocumentBtn', 'versionHistoryBtn', 'documentInfoBtn', 'downloadDocumentBtn', 'shareDocumentBtn']);
    function topbarMoreMenuItems() {
        const keys = topbarMoreKeys.filter(key => !TOPBAR_KEYS_IN_FULL_MENU.has(key));
        if (!keys.length) return [];
        return [{ heading: omniT('editor_topbar_items') }, ...keys.map(key => ({ icon: topbarIcon(key), label: topbarLabel(key), action: () => $(key) && $(key).click() })), { sep: true }];
    }

    // Saving status pill: OmniWrite's Saving Status dialog with this spreadsheet's numbers.
    function openSavingStatus() {
        if (!editor.book || typeof window.showSavingStatusModal !== 'function') return;
        window.showSavingStatusModal({
            status: $('savingStatus').textContent,
            icon: $('savingStatusIcon').textContent || 'lock',
            countLabelKey: 'sheets_cells',
            count: new Intl.NumberFormat(numberLocale()).format(bookStats(editor.book).cells),
            queue: saving ? omniT('saving') : dirty.size ? omniT('queued') : omniT('clear')
        });
    }
    $('savingStatusPill').addEventListener('click', openSavingStatus);
    $('savingStatusPill').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSavingStatus(); } });

    // Tables shared by Preview, Split Screen, and HTML export.
    function sheetTableHtml(sheet, className = '') {
        const rows = sheetMatrix(sheet);
        if (!rows.length) return '';
        return `<table${className ? ` class="${className}"` : ''}>${rows.map((row, r) => `<tr>${row.map((v, c) => { const s = cellStyle(getCell(r, c, sheet)); return `<td style="${htmlCellStyle(s)}text-align:${s.ha || (typeof editor.evaluator.value(sheet, r, c) === 'number' ? 'right' : 'left')}">${esc(v)}</td>`; }).join('')}</tr>`).join('')}</table>`;
    }

    // Preview: OmniWrite's full-screen preview showing every sheet.
    $('previewBtn').addEventListener('click', () => {
        if (blockIfHidden()) return;
        if (!editor.book || typeof window.omniOpenPreview !== 'function') return;
        commitEdit();
        const content = document.createElement('div');
        content.className = 'sheets-preview';
        content.setAttribute('data-omni-no-translate', '');
        const showNames = editor.book.sheets.length > 1 || editor.book.sheets[0].name !== editor.book.title;
        content.innerHTML = editor.book.sheets.map(sheet => `${showNames ? `<h2>${esc(sheet.name)}</h2>` : ''}${sheetTableHtml(sheet, 'sheets-preview-table') || `<p>${esc(omniT('no_results'))}</p>`}`).join('');
        window.omniOpenPreview(editor.book.title, content);
    });

    // Reading Mode: OmniWrite's reading panel (voice, speed, play / pause / stop).
    // Reads the selected cells when several are selected, otherwise every sheet.
    // A header row turns each row into "Header: value" pairs; empty cells are skipped.
    function readingRows(sheet, range) {
        const rows = [];
        for (let r = range.r1; r <= range.r2; r++) {
            if (hiddenRowsFor(sheet).has(r)) continue;
            const row = [];
            for (let c = range.c1; c <= range.c2; c++) row.push(String(displayText(sheet, r, c) || '').trim());
            if (row.some(Boolean)) rows.push({ r, cells: row });
        }
        return rows;
    }
    function hiddenRowsFor(sheet) { return sheet === editor.sheet ? hiddenRows : new Set(); }
    function looksLikeHeader(rows) {
        if (rows.length < 2) return false;
        const first = rows[0].cells.filter(Boolean);
        return first.length >= 2 && first.every(v => !/^[-+$€£¥]?[\d.,%\s]+$/.test(v));
    }
    function appendReadingSection(content, title, rows, range) {
        if (!rows.length) return;
        if (title) {
            const heading = document.createElement('h2');
            heading.textContent = title;
            content.appendChild(heading);
        }
        const header = looksLikeHeader(rows) ? rows[0].cells : null;
        const list = document.createElement('div');
        list.className = 'sheets-reading-rows';
        (header ? rows.slice(1) : rows).forEach(({ r, cells }) => {
            const p = document.createElement('p');
            p.className = 'sheets-reading-row';
            const parts = cells.map((value, i) => {
                if (!value) return null;
                const label = header && header[i] ? header[i] : E.colName(range.c1 + i);
                return { label, value };
            }).filter(Boolean);
            if (!header) {
                const lead = document.createElement('span');
                lead.className = 'sheets-reading-label';
                lead.textContent = t('reading_row', { n: r + 1 }) + ': ';
                p.appendChild(lead);
                p.appendChild(document.createTextNode(parts.map(part => part.value).join(', ') + '.'));
            } else {
                parts.forEach((part, index) => {
                    const label = document.createElement('span');
                    label.className = 'sheets-reading-label';
                    label.textContent = part.label + ': ';
                    p.appendChild(label);
                    p.appendChild(document.createTextNode(part.value + (index === parts.length - 1 ? '.' : '; ')));
                });
            }
            list.appendChild(p);
        });
        content.appendChild(list);
    }
    $('readingModeBtn').addEventListener('click', () => {
        if (blockIfHidden()) return;
        if (!editor.book || typeof window.omniOpenReadingMode !== 'function') return;
        commitEdit();
        const content = document.createElement('div');
        content.className = 'sheets-reading';
        content.setAttribute('data-omni-no-translate', '');
        const title = document.createElement('h1');
        title.textContent = editor.book.title;
        content.appendChild(title);
        const range = selRange();
        const single = range.r1 === range.r2 && range.c1 === range.c2;
        if (!single) {
            appendReadingSection(content, editor.sheet.name + ' · ' + E.rangeName(range), readingRows(editor.sheet, range), range);
        } else {
            editor.book.sheets.forEach(sheet => {
                const used = usedRange(sheet);
                if (!used) return;
                const showName = editor.book.sheets.length > 1 || sheet.name !== editor.book.title;
                appendReadingSection(content, showName ? sheet.name : '', readingRows(sheet, used), used);
            });
        }
        window.omniOpenReadingMode(content, $(SHEET_PAGE_ID));
    });
    function usedRange(sheet) {
        let r2 = -1, c2 = -1;
        for (const key of Object.keys(sheet.cells)) { const [r, c] = key.split(':').map(Number); if (r > r2) r2 = r; if (c > c2) c2 = c; }
        return r2 < 0 ? null : { r1: 0, c1: 0, r2, c2 };
    }

    // Split Screen: keep a document, another sheet of this spreadsheet, or another spreadsheet beside the grid.
    // Documents stay editable and save normally; sheets show as a live grid with column letters and row numbers.
    let split = null; // { kind: 'doc' | 'sheet', id, sheetId }
    const SPLIT_WIDTH_KEY = 'omniwrite-sheets-split-width';
    function updateSplitButton() {
        const btn = $('splitScreenBtn');
        if (!btn) return;
        const label = split ? t('exit_split_screen') : omniT('split_screen');
        btn.textContent = split ? 'close_fullscreen' : 'vertical_split';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('data-tooltip', label);
        btn.setAttribute('data-i18n-title', split ? 'exit_split_screen' : 'split_screen');
        btn.classList.toggle('active', !!split);
    }
    const splitDocuments = () => { try { return typeof window.getWorkspaceDocuments === 'function' ? window.getWorkspaceDocuments() : []; } catch { return []; } };
    function openSplitPicker() {
        if (!editor.book) return;
        if (split) { exitSplit(true); return; }
        if (blockIfHidden()) return;
        commitEdit();
        document.querySelectorAll('.omni-split-modal.sheets-split-modal').forEach(old => old.remove());
        const modal = document.createElement('div');
        modal.className = 'modal omni-split-modal sheets-split-modal';
        modal.innerHTML = `<div class="modal-content omni-doc-modal omni-split-dialog" role="dialog" aria-modal="true" aria-labelledby="sheetsSplitTitle">
                <div class="omni-modal-header">
                    <div class="omni-modal-heading"><icon class="omni-modal-icon" aria-hidden="true">vertical_split</icon><h2 id="sheetsSplitTitle">${esc(t('select_file_split'))}</h2></div>
                    <button type="button" class="omni-modal-close" data-act="close" aria-label="${esc(t('close'))}"><icon aria-hidden="true">close</icon></button>
                </div>
                <label class="mu-search sheets-split-search"><span class="mu-icon" aria-hidden="true">search</span><input type="search" data-search autocomplete="off" spellcheck="false"></label>
                <div class="omni-pick-list" data-list role="listbox"></div>
            </div>`;
        const search = modal.querySelector('[data-search]');
        search.placeholder = omniT('search_docs_sheets');
        search.setAttribute('aria-label', omniT('search_docs_sheets'));
        const list = modal.querySelector('[data-list]');
        const previous = document.activeElement;
        const close = () => { modal.remove(); document.removeEventListener('keydown', onKey, true); if (previous && previous.focus && document.contains(previous)) previous.focus(); };
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
        const groups = () => [
            { title: t('split_this_spreadsheet'), items: editor.book.sheets.filter(s => s.id !== editor.sheet.id).map(s => ({ kind: 'sheet', id: editor.book.id, sheetId: s.id, icon: 'tab', title: s.name })) },
            { title: omniT('documents_section'), items: splitDocuments().map(doc => ({ kind: 'doc', id: doc.id, icon: 'description', title: doc.title || omniT('Untitled Document', 'Untitled Document') })) },
            { title: t('sheets_spreadsheets'), items: liveBooks().filter(book => book !== editor.book).map(book => ({ kind: 'sheet', id: book.id, icon: 'table_view', title: book.title })) }
        ];
        const draw = () => {
            const q = search.value.trim().toLowerCase();
            list.replaceChildren();
            let count = 0;
            groups().forEach(group => {
                const items = group.items.filter(item => !q || item.title.toLowerCase().includes(q));
                if (!items.length) return;
                const heading = document.createElement('div');
                heading.className = 'omni-font-section-title sheets-split-group';
                heading.textContent = group.title;
                list.appendChild(heading);
                items.forEach(item => {
                    count++;
                    const row = document.createElement('div');
                    row.className = 'sidebarnav__item';
                    row.tabIndex = 0;
                    row.setAttribute('role', 'option');
                    row.style.cssText = 'cursor:pointer;margin-bottom:8px;';
                    row.innerHTML = '<icon aria-hidden="true"></icon><div class="menu-text"></div>';
                    row.querySelector('icon').textContent = item.icon;
                    row.querySelector('.menu-text').textContent = item.title;
                    row.addEventListener('click', () => { close(); openSplit(item.kind, item.id, item.sheetId); });
                    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
                    list.appendChild(row);
                });
            });
            if (!count) list.innerHTML = `<p class="omni-files-empty">${esc(q ? omniT('no_results') : omniT('files_empty'))}</p>`;
        };
        search.addEventListener('input', draw);
        search.addEventListener('keydown', event => { if (event.key === 'Enter') { const first = list.querySelector('[role=option]'); if (first) first.click(); } if (event.key === 'ArrowDown') { event.preventDefault(); const first = list.querySelector('[role=option]'); if (first) first.focus(); } });
        list.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const rows = [...list.querySelectorAll('[role=option]')];
            const index = rows.indexOf(document.activeElement);
            const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
            if (next) next.focus(); else if (event.key === 'ArrowUp') search.focus();
        });
        draw();
        document.addEventListener('keydown', onKey, true);
        modal.addEventListener('mousedown', event => { if (event.target === modal) close(); });
        modal.querySelector('[data-act=close]').addEventListener('click', close);
        document.body.appendChild(modal);
        setTimeout(() => search.focus(), 30);
    }
    function splitPaneHeader(icon, title, onOpen) {
        const head = document.createElement('div');
        head.className = 'sheets-split-head';
        head.innerHTML = `<icon aria-hidden="true"></icon><span class="sheets-split-title"></span>
            <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-act="open-split"><span class="mu-icon" aria-hidden="true">open_in_new</span></button>
            <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-act="close-split"><span class="mu-icon" aria-hidden="true">close</span></button>`;
        head.querySelector('icon').textContent = icon;
        head.querySelector('.sheets-split-title').textContent = title;
        const label = (btn, text) => { btn.setAttribute('aria-label', text); btn.setAttribute('data-tooltip', text); };
        const openBtn = head.querySelector('[data-act=open-split]'), closeBtn = head.querySelector('[data-act=close-split]');
        label(openBtn, omniT('open') + ': ' + title);
        label(closeBtn, t('exit_split_screen'));
        openBtn.addEventListener('click', () => { exitSplit(false); onOpen(); });
        closeBtn.addEventListener('click', () => exitSplit(true));
        return head;
    }
    // An editable grid like the editor: column letters, row numbers, widths, formatting, and formulas.
    // Click or use arrow keys to select; type, Enter, F2, or double-click to edit; Delete clears.
    let splitSel = { r: 0, c: 0 };
    let splitFocusGrid = false;
    function splitDims(sheet) {
        const used = usedRange(sheet) || { r2: -1, c2: -1 };
        return { rows: Math.max(used.r2 + 6, 30), cols: Math.max(used.c2 + 3, 10) };
    }
    const bookLocked = book => !!(book && book.locked && (typeof window.isEffectivelyLocked !== 'function' || window.isEffectivelyLocked(book)));
    function splitGridHtml(book, sheet) {
        const { rows, cols } = splitDims(sheet);
        const evaluator = E.createEvaluator(() => book);
        const width = c => Math.max(48, Math.round((sheet.colWidths[c] ?? DEF_W) * 0.9));
        const head = `<thead><tr><th class="sheets-split-corner" scope="col"></th>${Array.from({ length: cols }, (_, c) => `<th scope="col" style="min-width:${width(c)}px;max-width:${width(c)}px">${E.colName(c)}</th>`).join('')}</tr></thead>`;
        const body = Array.from({ length: rows }, (_, r) => {
            const cells = Array.from({ length: cols }, (_, c) => {
                const cell = getCell(r, c, sheet);
                const s = cellStyle(cell);
                let text = '';
                try { text = cell && cell.chk ? (String(cell.v).toUpperCase() === 'TRUE' ? '☑' : '☐') : displayText(sheet, r, c, evaluator); } catch { text = ''; }
                const numeric = cell && typeof evaluator.value(sheet, r, c) === 'number';
                const style = `${htmlCellStyle(s)}${s.ff ? `font-family:${String(s.ff).replace(/"/g, "'")};` : ''}text-align:${s.ha || (numeric ? 'right' : 'left')};min-width:${width(c)}px;max-width:${width(c)}px;`;
                const selected = r === splitSel.r && c === splitSel.c;
                return `<td role="gridcell" data-r="${r}" data-c="${c}" aria-selected="${selected}"${selected ? ' class="is-selected"' : ''} style="${style}">${esc(text)}</td>`;
            }).join('');
            return `<tr><th scope="row">${r + 1}</th>${cells}</tr>`;
        }).join('');
        return `<table class="sheets-split-grid">${head}<tbody>${body}</tbody></table>`;
    }
    function commitSplitCell(book, sheet, r, c, raw) {
        if (book === editor.book) {
            // Same spreadsheet: undoable, recalculates formulas, and saves like any edit.
            editCells(set => set(r, c, cellFromEntry(getCell(r, c, sheet), raw)), { sheet });
            return;
        }
        if (bookLocked(book)) { showToast(t('sheets_locked_toast'), { type: 'error' }); return; }
        const key = r + ':' + c;
        const next = cleanCell(cellFromEntry(sheet.cells[key] || null, raw));
        const before = JSON.stringify(sheet.cells[key] || null);
        if (next) sheet.cells[key] = next; else delete sheet.cells[key];
        if (JSON.stringify(sheet.cells[key] || null) === before) return;
        if (r + 1 > sheet.rows) sheet.rows = r + 1;
        if (c + 1 > sheet.cols) sheet.cols = c + 1;
        touchBook(book);
        renderLists();
        renderSplit();
    }
    function bindSplitGrid(body, book, sheet) {
        const editable = !bookLocked(book) && !(book === editor.book && isLocked());
        const { rows, cols } = splitDims(sheet);
        const cellEl = (r, c) => body.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
        const select = (r, c) => {
            splitSel = { r: clamp(r, 0, rows - 1), c: clamp(c, 0, cols - 1) };
            body.querySelectorAll('td.is-selected').forEach(td => { td.classList.remove('is-selected'); td.setAttribute('aria-selected', 'false'); });
            const td = cellEl(splitSel.r, splitSel.c);
            if (td) { td.classList.add('is-selected'); td.setAttribute('aria-selected', 'true'); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
            body.setAttribute('aria-activedescendant', '');
        };
        const startEdit = initial => {
            if (!editable) { showToast(t('sheets_locked_toast'), { type: 'error' }); return; }
            const td = cellEl(splitSel.r, splitSel.c);
            if (!td || td.querySelector('input')) return;
            const cell = getCell(splitSel.r, splitSel.c, sheet);
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'sheets-split-input';
            input.spellcheck = false;
            input.setAttribute('aria-label', E.refName(splitSel.r, splitSel.c));
            input.value = initial !== undefined ? initial : (cell && cell.v !== undefined && cell.v !== null ? String(cell.v) : '');
            td.textContent = '';
            td.appendChild(input);
            input.focus();
            if (initial === undefined) input.select();
            let done = false;
            const finish = (commit, dr = 0, dc = 0) => {
                if (done) return;
                done = true;
                const at = { ...splitSel };
                splitSel = { r: clamp(at.r + dr, 0, rows - 1), c: clamp(at.c + dc, 0, cols - 1) };
                splitFocusGrid = true;
                if (commit) commitSplitCell(book, sheet, at.r, at.c, input.value);
                renderSplit();
            };
            input.addEventListener('keydown', event => {
                event.stopPropagation();
                if (event.key === 'Enter') { event.preventDefault(); finish(true, event.shiftKey ? -1 : 1, 0); }
                else if (event.key === 'Tab') { event.preventDefault(); finish(true, 0, event.shiftKey ? -1 : 1); }
                else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
            });
            input.addEventListener('blur', () => finish(true));
        };
        body.addEventListener('mousedown', event => {
            const td = event.target.closest('td[data-r]');
            if (!td || td.querySelector('input')) return;
            select(Number(td.dataset.r), Number(td.dataset.c));
            setTimeout(() => body.focus({ preventScroll: true }), 0);
        });
        body.addEventListener('dblclick', event => { if (event.target.closest('td[data-r]')) startEdit(); });
        body.addEventListener('keydown', event => {
            if (event.target !== body) return;
            const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
            if (moves[event.key]) { event.preventDefault(); const [dr, dc] = moves[event.key]; select(splitSel.r + dr, splitSel.c + dc); return; }
            if (event.key === 'Tab') { event.preventDefault(); select(splitSel.r, splitSel.c + (event.shiftKey ? -1 : 1)); return; }
            if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); startEdit(); return; }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                if (!editable) { showToast(t('sheets_locked_toast'), { type: 'error' }); return; }
                splitFocusGrid = true;
                commitSplitCell(book, sheet, splitSel.r, splitSel.c, '');
                renderSplit();
                return;
            }
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); startEdit(event.key); }
        });
        if (splitFocusGrid) {
            splitFocusGrid = false;
            requestAnimationFrame(() => { body.focus({ preventScroll: true }); select(splitSel.r, splitSel.c); });
        }
    }
    function docWordCount(doc) {
        const div = document.createElement('div');
        div.innerHTML = doc.content || '';
        const words = (div.textContent || '').trim().split(/\s+/).filter(Boolean).length;
        return new Intl.NumberFormat(numberLocale()).format(words);
    }
    function renderSplit() {
        const pane = $('sheetsSplitPane');
        if (!split || !pane) return;
        if (split.kind === 'doc') {
            const doc = splitDocuments().find(item => item.id === split.id);
            if (!doc) { exitSplit(false); return; }
            const existing = pane.querySelector('.sheets-split-doc');
            if (existing && existing.dataset.docId === doc.id) return; // keep the caret while typing
            pane.replaceChildren(splitPaneHeader('description', doc.title || '', () => { if (typeof window.openDocument === 'function') window.openDocument(doc.id); }));
            const body = document.createElement('div');
            body.className = 'sheets-split-doc';
            body.dataset.docId = doc.id;
            body.innerHTML = doc.content || ''; // the user's own document (same HTML OmniWrite's editor shows)
            const locked = typeof window.isEffectivelyLocked === 'function' && window.isEffectivelyLocked(doc);
            body.contentEditable = locked ? 'false' : 'true';
            body.setAttribute('role', 'textbox');
            body.setAttribute('aria-multiline', 'true');
            body.setAttribute('aria-label', doc.title || '');
            body.spellcheck = true;
            const footer = document.createElement('div');
            footer.className = 'sheets-split-foot';
            const updateCount = () => { footer.textContent = omniT('word_count') + ': ' + docWordCount(doc); };
            updateCount();
            if (!locked) body.addEventListener('input', () => {
                doc.content = body.innerHTML;
                doc.updatedAt = doc.timestamp = Date.now();
                if (typeof window.scheduleDocumentSave === 'function') window.scheduleDocumentSave();
                updateCount();
            });
            pane.append(body, footer);
            return;
        }
        const book = findBook(split.id);
        if (!book || book.trashed) { exitSplit(false); return; }
        const sameBook = book === editor.book;
        let sheet = book.sheets.find(s => s.id === split.sheetId) || book.sheets[0];
        if (sameBook && sheet === editor.sheet) sheet = book.sheets.find(s => s !== editor.sheet) || sheet;
        split.sheetId = sheet.id;
        const scrollBox = pane.querySelector('.sheets-split-sheet');
        const scroll = scrollBox ? { top: scrollBox.scrollTop, left: scrollBox.scrollLeft } : null;
        pane.replaceChildren(splitPaneHeader(sameBook ? 'tab' : 'table_view', sameBook ? sheet.name : book.title, () => { if (sameBook) switchSheet(sheet.id); else openBookRoute(book.id); }));
        const choices = book.sheets.filter(s => !(sameBook && s === editor.sheet));
        if (choices.length > 1) {
            const tabs = document.createElement('div');
            tabs.className = 'mu-segmented sheets-split-tabs';
            tabs.setAttribute('role', 'group');
            tabs.setAttribute('data-omni-no-translate', '');
            choices.forEach(s => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = s.name;
                b.setAttribute('aria-pressed', String(s.id === sheet.id));
                b.addEventListener('click', () => { split.sheetId = s.id; splitSel = { r: 0, c: 0 }; renderSplit(); });
                tabs.appendChild(b);
            });
            pane.appendChild(tabs);
        }
        const body = document.createElement('div');
        body.className = 'sheets-split-sheet';
        body.tabIndex = 0;
        body.setAttribute('role', 'grid');
        body.setAttribute('aria-label', sheet.name);
        body.setAttribute('data-omni-no-translate', '');
        body.innerHTML = splitGridHtml(book, sheet);
        pane.appendChild(body);
        if (scroll) { body.scrollTop = scroll.top; body.scrollLeft = scroll.left; }
        bindSplitGrid(body, book, sheet);
    }
    // Live: another sheet of this spreadsheet updates as you edit; documents update after edits elsewhere.
    let splitRefresh = 0;
    function refreshSplitSoon() {
        if (!split || split.kind !== 'sheet') return;
        clearTimeout(splitRefresh);
        splitRefresh = setTimeout(renderSplit, 120);
    }
    function openSplit(kind, id, sheetId) {
        split = { kind, id, sheetId: sheetId || null };
        splitSel = { r: 0, c: 0 };
        const pane = $('sheetsSplitPane');
        pane.hidden = false;
        $('sheetsSplitDivider').hidden = false;
        const saved = Number(store.get(SPLIT_WIDTH_KEY));
        pane.style.flexBasis = Number.isFinite(saved) && saved > 0 ? saved + 'px' : '';
        pane.replaceChildren();
        renderSplit();
        updateSplitButton();
        requestAnimationFrame(() => { layoutEditorHeight(); scheduleRender(); refreshCharts(true); });
        showToast(omniT('split_view_activated'), { type: 'success' });
    }
    function exitSplit(announce) {
        if (!split) return;
        split = null;
        clearTimeout(splitRefresh);
        const pane = $('sheetsSplitPane');
        pane.hidden = true;
        pane.replaceChildren();
        pane.style.flexBasis = '';
        $('sheetsSplitDivider').hidden = true;
        updateSplitButton();
        requestAnimationFrame(() => { scheduleRender(); refreshCharts(true); });
        if (announce) showToast(omniT('exited_split_view'), { type: 'info' });
    }
    $('splitScreenBtn').addEventListener('click', openSplitPicker);
    (function splitResize() {
        const divider = $('sheetsSplitDivider'), pane = $('sheetsSplitPane'), row = $('sheetsSplitRow');
        divider.setAttribute('aria-label', omniT('split_screen'));
        const setWidth = width => {
            const max = Math.max(280, row.getBoundingClientRect().width - 360);
            const next = clamp(width, 260, max);
            pane.style.flexBasis = next + 'px';
            store.set(SPLIT_WIDTH_KEY, String(Math.round(next)));
            scheduleRender();
        };
        let start = null;
        divider.addEventListener('pointerdown', event => { start = { x: event.clientX, w: pane.getBoundingClientRect().width }; divider.setPointerCapture(event.pointerId); divider.classList.add('dragging'); });
        divider.addEventListener('pointermove', event => { if (start) setWidth(start.w - (event.clientX - start.x) * (document.documentElement.dir === 'rtl' ? -1 : 1)); });
        const stop = () => { if (!start) return; start = null; divider.classList.remove('dragging'); refreshCharts(true); };
        divider.addEventListener('pointerup', stop);
        divider.addEventListener('pointercancel', stop);
        divider.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setWidth(pane.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 24 : -24));
        });
    })();

    /* ================================================================ search & help
       OmniWrite's search dialog lists matching spreadsheets through OmniSheets.search(). */
    function searchBooks(query) {
        const q = String(query || '').trim().toLowerCase();
        return liveBooks().filter(b => !q || b.title.toLowerCase().includes(q) || b.sheets.some(s => s.name.toLowerCase().includes(q) || Object.values(s.cells).some(cell => String(cell.v || '').toLowerCase().includes(q))));
    }
    function openHelp(functionsOnly = false) {
        const shortcuts = [
            ['Enter / F2', t('sheets_shortcut_edit')], ['Alt + Enter', t('sheets_shortcut_newline')], [MOD + ' + D', t('sheets_shortcut_fill')],
            [MOD + ' + ;', t('sheets_shortcut_date')], ['Shift + ↑↓←→', t('sheets_shortcut_select')], [MOD + ' + ↑↓←→', t('sheets_shortcut_jump')],
            [MOD + ' + B / I / U', t('Bold') + ' / ' + t('Italic') + ' / ' + t('Underline')], [MOD + ' + Z / Y', t('Undo') + ' / ' + t('Redo')],
            [MOD + ' + C / X / V', t('ctx_copy') + ' / ' + t('ctx_cut') + ' / ' + t('ctx_paste')], [MOD + ' + F / H', t('sheets_find') + ' / ' + t('find_replace')], [MOD + ' + K', t('insert_link')]
        ];
        openDialog({
            title: functionsOnly ? t('sheets_all_functions') : t('help'), maxWidth: 760,
            html: `${functionsOnly ? '' : `<p>${esc(t('sheets_help_intro'))}</p><h3>${esc(t('sheets_shortcuts'))}</h3><table class="sheets-help-table">${shortcuts.map(([k, v]) => `<tr><td>${k.split(' + ').map(part => '<kbd class="mu-kbd">' + esc(part) + '</kbd>').join(' + ')}</td><td>${esc(v)}</td></tr>`).join('')}</table><h3>${esc(t('sheets_all_functions'))}</h3>`}
                <div class="sheets-fn-list">${E.FUNCTION_NAMES.map(n => `<span class="mu-badge">${esc(n)}</span>`).join('')}</div>`
        });
    }
    function renderAllText() {
        applyI18n($(SHEET_PAGE_ID));
        applyI18n($('sheetsFloatingUi'));
        renderLists();
        updatePinButton();
        updateDocumentTitle();
        if (editor.book) { renderTabs(); updateSelectionUI(); layoutDirty = true; scheduleRender(); refreshCharts(true); }
    }

    /* ================================================================ date and time pickers in cells */
    function pickerKindFor(r, c) {
        const cell = getCell(r, c);
        const fmt = displayFormat(editor.sheet, r, c, cell);
        const value = cell && cell.v ? editor.evaluator.value(editor.sheet, r, c) : null;
        if (!fmt || (value !== null && typeof value !== 'number')) return null;
        if (cell && typeof cell.v === 'string' && cell.v[0] === '=') return null; // formulas stay formulas
        return fmt.t === 'date' || fmt.t === 'longdate' ? 'date' : fmt.t === 'time' ? 'time' : fmt.t === 'datetime' ? 'datetime' : null;
    }
    function serialToIso(serial, kind) {
        if (typeof serial !== 'number') return '';
        const d = E.serialToDate(serial);
        const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        return kind === 'date' ? date : kind === 'time' ? time : date + 'T' + time;
    }
    function activeCellAnchor() {
        const { r, c } = editor.sel;
        return { getBoundingClientRect() {
            const { x, y, w, h } = cellRect(r, c);
            const grid = viewport.getBoundingClientRect();
            const frozen = freezeDims();
            return new DOMRect(grid.left + x - (c < frozen.fc ? 0 : viewport.scrollLeft), grid.top + y - (r < frozen.fr ? 0 : viewport.scrollTop), w, h);
        } };
    }
    function openCellPicker(kind, anchor) {
        if (blockIfLocked()) return;
        commitEdit();
        const { r, c } = editor.sel;
        const value = getCell(r, c) && getCell(r, c).v ? editor.evaluator.value(editor.sheet, r, c) : null;
        const fn = { date: 'pickDate', time: 'pickTime', datetime: 'pickDateTime' }[kind];
        window.MunetiosUI[fn]({
            anchor: anchor || activeCellAnchor(), value: serialToIso(value, kind), locale: numberLocale(), labels: pickerLabels(), allowClear: true,
            onPick(iso) {
                editCells(set => {
                    const cell = clone(getCell(r, c)) || {};
                    if (!iso) delete cell.v; else cell.v = kind === 'datetime' ? iso.replace('T', ' ') : iso;
                    set(r, c, cell);
                });
                updateSelectionUI();
                viewport.focus({ preventScroll: true });
            }
        });
    }

    /* ================================================================ data tools */
    function dataRange() {
        const range = trimRangeToData(selRange());
        return range.r1 === range.r2 && range.c1 === range.c2 ? currentRegion(editor.sel.r, editor.sel.c) : range;
    }
    function toggleFilter() {
        const sheet = editor.sheet;
        if (sheet.filter) { editStructure(() => { delete sheet.filter; }); layoutDirty = true; scheduleRender(); return; }
        const range = dataRange();
        editStructure(() => { sheet.filter = { r1: range.r1, c1: range.c1, r2: Math.max(range.r2, range.r1 + 1), c2: range.c2, hidden: {} }; });
        layoutDirty = true;
        scheduleRender();
    }
    function openFilterDialog(c, anchor) {
        const sheet = editor.sheet;
        const f = sheet.filter;
        if (!f) return;
        const blank = t('sheets_blanks');
        const values = new Map();
        for (let r = f.r1 + 1; r <= f.r2; r++) { const text = displayText(sheet, r, c); values.set(text, (values.get(text) || 0) + 1); }
        const sorted = [...values.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, numberLocale(), { numeric: true })));
        const hidden = new Set((f.hidden && f.hidden[c]) || []);
        openDialog({
            title: t('sheets_filter') + ' · ' + E.colName(c), maxWidth: 520,
            html: `<div class="sheets-form">
                <div class="mu-btn-group"><button type="button" class="mu-btn" data-sort="asc"><span class="mu-icon" aria-hidden="true">sort_by_alpha</span>${esc(t('sheets_sort_az'))}</button><button type="button" class="mu-btn" data-sort="desc"><span class="mu-icon" aria-hidden="true">sort</span>${esc(t('sheets_sort_za'))}</button></div>
                <label class="mu-search"><span class="mu-icon" aria-hidden="true">search</span><input type="search" data-q placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" autocomplete="off"></label>
                <div class="mu-btn-group"><button type="button" class="mu-btn mu-btn-ghost" data-all>${esc(t('ctx_select_all'))}</button><button type="button" class="mu-btn mu-btn-ghost" data-none>${esc(t('sheets_clear'))}</button></div>
                <div class="sheets-filter-list" role="group">${sorted.map((v, i) => `<label class="mu-check" data-text="${esc(v.toLowerCase())}"><input type="checkbox" data-i="${i}" ${hidden.has(v) ? '' : 'checked'}>${esc(v === '' ? blank : v)} <span class="mu-muted">(${values.get(v)})</span></label>`).join('')}</div>
                <div class="sheets-form-actions"><button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="button" class="mu-btn mu-btn-primary" data-act="ok">${esc(t('sheets_done'))}</button></div></div>`,
            onMount(modal, close) {
                const boxes = [...modal.querySelectorAll('[data-i]')];
                modal.querySelector('[data-q]').addEventListener('input', event => {
                    const q = event.target.value.trim().toLowerCase();
                    modal.querySelectorAll('.sheets-filter-list .mu-check').forEach(label => { label.hidden = !!q && !label.dataset.text.includes(q); });
                });
                modal.querySelector('[data-all]').onclick = () => boxes.forEach(b => { if (!b.closest('label').hidden) b.checked = true; });
                modal.querySelector('[data-none]').onclick = () => boxes.forEach(b => { if (!b.closest('label').hidden) b.checked = false; });
                modal.querySelector('[data-act=cancel]').onclick = close;
                modal.querySelectorAll('[data-sort]').forEach(btn => btn.onclick = () => { close(); sortColumnInRange(f, c, btn.dataset.sort === 'asc'); });
                modal.querySelector('[data-act=ok]').onclick = () => {
                    const off = boxes.filter(b => !b.checked).map(b => sorted[Number(b.dataset.i)]);
                    editStructure(() => {
                        sheet.filter.hidden = Object.assign({}, sheet.filter.hidden);
                        if (off.length) sheet.filter.hidden[c] = off; else delete sheet.filter.hidden[c];
                    });
                    layoutDirty = true;
                    close();
                    scheduleRender();
                };
            }
        });
        void anchor;
    }
    function sortColumnInRange(range, c, ascending) {
        const sheet = editor.sheet;
        const start = range.r1 + 1;
        if (range.r2 <= start) return;
        const rows = seq(start, range.r2).map(r => ({ key: editor.evaluator.value(sheet, r, c), cells: seq(range.c1, range.c2).map(cc => sheet.cells[r + ':' + cc] || null) }));
        rows.sort((a, b) => {
            const ae = a.key === null || a.key === '', be = b.key === null || b.key === '';
            if (ae !== be) return ae ? 1 : -1;
            const cmp = E.compareValues(E.isErr(a.key) ? '' : a.key, E.isErr(b.key) ? '' : b.key);
            return ascending ? cmp : -cmp;
        });
        editCells(set => rows.forEach((row, i) => row.cells.forEach((cell, j) => set(start + i, range.c1 + j, clone(cell)))));
    }
    function removeDuplicates() {
        const range = dataRange();
        const sheet = editor.sheet;
        const seen = new Set();
        const keep = [];
        let removed = 0;
        for (let r = range.r1; r <= range.r2; r++) {
            const cells = seq(range.c1, range.c2).map(c => sheet.cells[r + ':' + c] || null);
            const key = JSON.stringify(seq(range.c1, range.c2).map(c => displayText(sheet, r, c)));
            if (seen.has(key)) { removed++; continue; }
            seen.add(key);
            keep.push(cells);
        }
        if (removed) {
            editCells(set => {
                for (let i = 0; i <= range.r2 - range.r1; i++) {
                    const row = keep[i];
                    seq(range.c1, range.c2).forEach((c, j) => set(range.r1 + i, c, row ? clone(row[j]) : null));
                }
            });
        }
        showToast(t('sheets_duplicates_removed', { count: removed }), { type: removed ? 'success' : 'info' });
    }
    function trimWhitespace() {
        const range = trimRangeToData(selRange());
        let count = 0;
        editCells(set => forEachInRange(range, (r, c) => {
            const cell = getCell(r, c);
            if (!cell || typeof cell.v !== 'string' || cell.v[0] === '=') return;
            const next = cell.v.replace(/[ \t ]+/g, ' ').trim();
            if (next !== cell.v) { const copy = clone(cell); copy.v = next; set(r, c, copy); count++; }
        }));
        showToast(t('sheets_trimmed', { count }), { type: count ? 'success' : 'info' });
    }
    function openSplitDialog() {
        if (blockIfLocked()) return;
        const range = trimRangeToData(selRange());
        const options = [['auto', 'sheets_sep_auto'], [',', 'sheets_sep_comma'], [';', 'sheets_sep_semicolon'], ['.', 'sheets_sep_period'], [' ', 'sheets_sep_space'], ['custom', 'sheets_sep_custom']];
        openDialog({
            title: t('sheets_split_text'), maxWidth: 520,
            html: `<form class="sheets-form">
                <div class="mu-field"><label class="mu-field-label" for="splitSep">${esc(t('sheets_separator'))}</label><select class="mu-select" data-native-select id="splitSep" name="sep">${options.map(([v, k]) => `<option value="${esc(v)}">${esc(t(k))}</option>`).join('')}</select></div>
                <label class="mu-field" data-custom hidden><span class="mu-field-label">${esc(t('sheets_sep_custom'))}</span><input class="mu-input" name="custom" type="text" autocomplete="off"></label>
                <div class="sheets-form-actions"><button type="button" class="mu-btn" data-act="cancel">${esc(t('cancel'))}</button><button type="submit" class="mu-btn mu-btn-primary">${esc(t('sheets_split_text'))}</button></div></form>`,
            onMount(modal, close) {
                const form = modal.querySelector('form');
                form.sep.addEventListener('change', () => { modal.querySelector('[data-custom]').hidden = form.sep.value !== 'custom'; });
                modal.querySelector('[data-act=cancel]').onclick = close;
                form.onsubmit = event => {
                    event.preventDefault();
                    let sep = form.sep.value === 'custom' ? form.custom.value : form.sep.value;
                    if (!sep) return;
                    const c = range.c1;
                    editCells(set => {
                        for (let r = range.r1; r <= range.r2; r++) {
                            const cell = getCell(r, c);
                            if (!cell || typeof cell.v !== 'string' || cell.v[0] === '=') continue;
                            let use = sep;
                            if (sep === 'auto') use = [',', ';', '\t', '|', ' '].find(s => cell.v.includes(s)) || ',';
                            const parts = cell.v.split(use).map(p => p.trim());
                            parts.forEach((part, j) => { const target = clone(getCell(r, c + j)) || {}; target.v = part; set(r, c + j, target); });
                        }
                    });
                    close();
                };
            }
        });
    }
    function setFreeze(rows, cols) {
        editStructure(() => { editor.sheet.freeze = { rows: Math.max(0, rows), cols: Math.max(0, cols) }; if (!rows && !cols) delete editor.sheet.freeze; });
        layoutDirty = true;
        scheduleRender();
    }
    function freezeMenuItems() {
        const f = editor.sheet.freeze || {};
        const r = editor.sel.r + 1, c = editor.sel.c + 1;
        return [
            { heading: t('sheets_freeze') },
            { icon: 'block', label: t('sheets_freeze_no_rows'), checked: !f.rows, action: () => setFreeze(0, f.cols || 0) },
            { icon: 'table_rows', label: t('sheets_freeze_one_row'), checked: f.rows === 1, action: () => setFreeze(1, f.cols || 0) },
            { icon: 'table_rows', label: t('sheets_freeze_two_rows'), checked: f.rows === 2, action: () => setFreeze(2, f.cols || 0) },
            r > 2 ? { icon: 'table_rows', label: t('sheets_freeze_up_to_row', { row: r }), checked: f.rows === r, action: () => setFreeze(r, f.cols || 0) } : null,
            { icon: 'block', label: t('sheets_freeze_no_cols'), checked: !f.cols, action: () => setFreeze(f.rows || 0, 0) },
            { icon: 'view_column', label: t('sheets_freeze_one_col'), checked: f.cols === 1, action: () => setFreeze(f.rows || 0, 1) },
            { icon: 'view_column', label: t('sheets_freeze_two_cols'), checked: f.cols === 2, action: () => setFreeze(f.rows || 0, 2) },
            c > 2 ? { icon: 'view_column', label: t('sheets_freeze_up_to_col', { col: E.colName(c - 1) }), checked: f.cols === c, action: () => setFreeze(f.rows || 0, c) } : null
        ];
    }
    function dataMenuItems() {
        const sheet = editor.sheet;
        return [
            { icon: 'sort_by_alpha', label: t('sheets_sort_az'), action: () => sortRange(true) },
            { icon: 'sort', label: t('sheets_sort_za'), action: () => sortRange(false) },
            { icon: sheet.filter ? 'filter_alt_off' : 'filter_alt', label: t(sheet.filter ? 'sheets_remove_filter' : 'sheets_create_filter'), action: toggleFilter },
            { icon: 'format_paint', label: t('sheets_conditional_formatting'), action: openConditionalDialog },
            { icon: 'arrow_drop_down_circle', label: t('sheets_insert_dropdown'), action: openDropdownDialog },
            { sep: true },
            { icon: 'filter_none', label: t('sheets_remove_duplicates'), action: removeDuplicates },
            { icon: 'format_strikethrough', label: t('sheets_trim_whitespace'), action: trimWhitespace },
            { icon: 'call_split', label: t('sheets_split_text'), action: openSplitDialog },
            { sep: true },
            ...freezeMenuItems()
        ];
    }

    /* ================================================================ conditional formatting dialog */
    const CF_TYPES = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between', 'notBetween', 'contains', 'notContains', 'startsWith', 'endsWith', 'empty', 'notEmpty', 'formula', 'scale'];
    const cfNeedsA = type => !['empty', 'notEmpty', 'scale'].includes(type);
    const cfNeedsB = type => type === 'between' || type === 'notBetween';
    function cfDescription(rule) {
        const name = t('sheets_cf_' + rule.type);
        if (rule.type === 'scale') return name;
        return cfNeedsB(rule.type) ? `${name} ${rule.a} – ${rule.b}` : cfNeedsA(rule.type) ? `${name} ${rule.a}` : name;
    }
    function openConditionalDialog() {
        if (blockIfLocked()) return;
        const sheet = editor.sheet;
        const range = E.rangeName(trimRangeToData(selRange()));
        const rulesHtml = () => (sheet.cf || []).length
            ? `<div class="mu-group">${sheet.cf.map(rule => `<div class="mu-row"><span class="sheets-cf-rule-swatch" style="background:${rule.type === 'scale' ? `linear-gradient(90deg, ${esc(rule.minColor || '#FFFFFF')}, ${esc(rule.maxColor || '#57BB8A')})` : esc(rule.bg || '#FFFFFF')}"></span><div class="mu-row-info"><span class="mu-row-title">${esc(cfDescription(rule))}</span><span class="mu-row-subtitle">${esc(rule.range)}</span></div><button type="button" class="mu-icon-btn mu-icon-btn-soft" data-del="${esc(rule.id)}" aria-label="${esc(t('Delete'))}" data-tooltip="${esc(t('Delete'))}"><span class="mu-icon" aria-hidden="true">delete</span></button></div>`).join('')}</div>`
            : `<p class="mu-muted">${esc(t('sheets_no_rules'))}</p>`;
        openDialog({
            title: t('sheets_conditional_formatting'), maxWidth: 640,
            html: `<div data-rules>${rulesHtml()}</div>
                <form class="sheets-form">
                    <h3 class="mu-h-title">${esc(t('sheets_add_rule'))}</h3>
                    <label class="mu-field"><span class="mu-field-label">${esc(t('sheets_apply_to_range'))}</span><input class="mu-input" name="range" type="text" value="${esc(range)}" spellcheck="false" autocomplete="off"></label>
                    <div class="mu-field"><label class="mu-field-label" for="cfType">${esc(t('sheets_format_cells_if'))}</label><select class="mu-select" data-native-select id="cfType" name="type">${CF_TYPES.map(type => `<option value="${type}">${esc(t('sheets_cf_' + type))}</option>`).join('')}</select></div>
                    <div class="sheets-form-row"><label class="mu-field" data-a><span class="mu-field-label">${esc(t('sheets_value'))}</span><input class="mu-input" name="a" type="text" autocomplete="off"></label>
                    <label class="mu-field" data-b hidden><span class="mu-field-label">${esc(t('sheets_value_and'))}</span><input class="mu-input" name="b" type="text" autocomplete="off"></label></div>
                    <div class="sheets-form-row" data-style>
                        <div class="mu-field"><span class="mu-field-label">${esc(t('sheets_fill_color'))}</span><button type="button" class="mu-picker-field" data-mu-picker="color" data-value="#F4C7C3" data-field="bg"></button></div>
                        <div class="mu-field"><span class="mu-field-label">${esc(t('Text Color'))}</span><button type="button" class="mu-picker-field" data-mu-picker="color" data-value="#B71C1C" data-field="fc"></button></div>
                    </div>
                    <label class="mu-check" data-bold><input type="checkbox" name="bold">${esc(t('Bold'))}</label>
                    <div class="sheets-form-row" data-scale hidden>
                        <div class="mu-field"><span class="mu-field-label">${esc(t('sheets_min_color'))}</span><button type="button" class="mu-picker-field" data-mu-picker="color" data-value="#FFFFFF" data-field="minColor"></button></div>
                        <div class="mu-field"><span class="mu-field-label">${esc(t('sheets_max_color'))}</span><button type="button" class="mu-picker-field" data-mu-picker="color" data-value="#57BB8A" data-field="maxColor"></button></div>
                    </div>
                    <div class="sheets-form-actions"><button type="button" class="mu-btn" data-act="cancel">${esc(t('close'))}</button><button type="submit" class="mu-btn mu-btn-primary"><span class="mu-icon" aria-hidden="true">add</span>${esc(t('sheets_add_rule'))}</button></div>
                </form>`,
            onMount(modal, close) {
                const form = modal.querySelector('form');
                const sync = () => {
                    const type = form.type.value;
                    modal.querySelector('[data-a]').hidden = !cfNeedsA(type);
                    modal.querySelector('[data-b]').hidden = !cfNeedsB(type);
                    modal.querySelector('[data-style]').hidden = type === 'scale';
                    modal.querySelector('[data-bold]').hidden = type === 'scale';
                    modal.querySelector('[data-scale]').hidden = type !== 'scale';
                    form.a.placeholder = type === 'formula' ? '=B2>100' : '';
                };
                form.type.addEventListener('change', sync);
                sync();
                const redrawRules = () => { modal.querySelector('[data-rules]').innerHTML = rulesHtml(); };
                modal.querySelector('[data-rules]').addEventListener('click', event => {
                    const del = event.target.closest('[data-del]');
                    if (!del) return;
                    editStructure(() => { sheet.cf = sheet.cf.filter(rule => rule.id !== del.dataset.del); });
                    redrawRules();
                });
                modal.querySelector('[data-act=cancel]').onclick = close;
                form.onsubmit = event => {
                    event.preventDefault();
                    const rangeText = form.range.value.trim().replace(/\$/g, '');
                    if (!E.parseRangeA1(rangeText)) { showToast(t('sheets_invalid_range'), { type: 'error' }); return; }
                    const type = form.type.value;
                    if (cfNeedsA(type) && !form.a.value.trim()) { form.a.focus(); return; }
                    const pick = field => modal.querySelector(`[data-field="${field}"]`).dataset.value || null;
                    const rule = { id: makeId(10), range: rangeText.toUpperCase(), type };
                    if (cfNeedsA(type)) rule.a = form.a.value.trim();
                    if (cfNeedsB(type)) rule.b = form.b.value.trim();
                    if (type === 'scale') { rule.minColor = pick('minColor') || '#FFFFFF'; rule.maxColor = pick('maxColor') || '#57BB8A'; }
                    else { rule.bg = pick('bg'); rule.fc = pick('fc'); rule.bold = form.bold.checked || undefined; }
                    editStructure(() => { sheet.cf = [...(sheet.cf || []), rule]; });
                    redrawRules();
                    form.a.value = ''; form.b.value = '';
                    showToast(t('sheets_rule_added'), { type: 'success' });
                };
            }
        });
    }

    /* ================================================================ version history (OmniWrite feature) */
    // Snapshots are encrypted like workbooks and stay on this device.
    const lastSnapshot = new Map();
    const SNAPSHOT_GAP = 10 * 60 * 1000;
    async function saveSnapshot(book, force = false) {
        const conn = await database();
        if (!conn || !cryptoKey || !conn.objectStoreNames.contains('versions')) return;
        const last = lastSnapshot.get(book.id) || 0;
        if (!force && Date.now() - last < SNAPSHOT_GAP) return;
        lastSnapshot.set(book.id, Date.now());
        const enc = await encrypt({ title: book.title, sheets: book.sheets, time: Date.now() });
        const tx = conn.transaction('versions', 'readwrite');
        tx.objectStore('versions').put(Object.assign({ id: makeId(), bookId: book.id, time: Date.now() }, enc));
        await txDone(tx);
    }
    async function listSnapshots(bookId) {
        const conn = await database();
        if (!conn || !conn.objectStoreNames.contains('versions')) return [];
        const records = await req(conn.transaction('versions').objectStore('versions').index('bookId').getAll(bookId));
        const out = [];
        for (const record of records) { try { out.push(Object.assign({ id: record.id, time: record.time }, await decrypt(record))); } catch {} }
        return out.sort((a, b) => b.time - a.time);
    }
    async function deleteSnapshots(bookId) {
        const conn = await database();
        if (!conn || !conn.objectStoreNames.contains('versions')) return;
        const keys = await req(conn.transaction('versions').objectStore('versions').index('bookId').getAllKeys(bookId));
        if (!keys.length) return;
        const tx = conn.transaction('versions', 'readwrite');
        keys.forEach(key => tx.objectStore('versions').delete(key));
        await txDone(tx);
    }
    async function openVersionHistory() {
        const book = editor.book;
        if (!book) return;
        commitEdit();
        await flushSaves();
        const versions = await listSnapshots(book.id);
        const rows = versions.map((v, i) => {
            const cells = v.sheets.reduce((n, s) => n + Object.keys(s.cells || {}).length, 0);
            return `<div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">history</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(formatDateTime(v.time))}</span><span class="mu-row-subtitle">${esc(v.title)} · ${v.sheets.length} ${esc(t('sheets_tabs'))} · ${new Intl.NumberFormat(numberLocale()).format(cells)} ${esc(t('sheets_cells'))}</span></div><button type="button" class="mu-btn" data-restore="${i}">${esc(t('restore_this_version'))}</button></div>`;
        }).join('');
        openDialog({
            title: t('version_history'), maxWidth: 680,
            html: `<p class="mu-muted">${esc(t('sheets_version_desc'))}</p>
                ${versions.length ? `<div class="mu-group">${rows}</div>` : `<div class="mu-group"><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">history</span></span><div class="mu-row-info"><span class="mu-row-title">${esc(t('no_versions_saved_yet'))}</span></div></div></div>`}
                <div class="sheets-form-actions"><button type="button" class="mu-btn mu-btn-primary" data-act="save"><span class="mu-icon" aria-hidden="true">bookmark_add</span>${esc(t('sheets_save_version'))}</button></div>`,
            onMount(modal, close) {
                modal.querySelector('[data-act=save]').onclick = async () => { await saveSnapshot(book, true); close(); showToast(t('sheets_version_saved'), { type: 'success' }); };
                modal.querySelectorAll('[data-restore]').forEach(btn => btn.onclick = async () => {
                    if (blockIfLocked()) return;
                    const version = versions[Number(btn.dataset.restore)];
                    await saveSnapshot(book, true); // the current state stays restorable
                    editStructure(() => {
                        book.sheets = clone(version.sheets).map(normalizeSheet);
                        editor.sheet = book.sheets[0];
                        book.activeSheet = editor.sheet.id;
                    });
                    editor.sel = { r: 0, c: 0, ar: 0, ac: 0, fr: 0, fc: 0 };
                    layoutDirty = true;
                    destroyCharts();
                    renderTabs();
                    afterDataChange();
                    updateSelectionUI();
                    close();
                    showToast(t('version_restored'), { type: 'success' });
                });
            }
        });
    }

    /* ================================================================ lock (OmniWrite feature) */
    // Lock: OmniWrite's lock dialog and lock model (locked, lockPassphraseHash, lockPreventViewing,
    // and its session unlock), with "Spreadsheet" wording.
    function updateLockButton() {
        const btn = $('lockDocumentBtn');
        if (!btn || !editor.book) return;
        const locked = isLocked();
        const key = locked ? 'unlock_spreadsheet' : 'lock_spreadsheet';
        btn.textContent = locked ? 'lock_open' : 'lock';
        btn.setAttribute('aria-label', t(key));
        btn.setAttribute('data-tooltip', t(key));
        btn.setAttribute('data-i18n-title', key);
        btn.classList.toggle('active', locked);
        document.body.classList.toggle('sheets-is-locked', locked);
        applyLockView();
    }
    // "Prevent Viewing" hides the cells until the spreadsheet is unlocked, like OmniWrite's blurred documents.
    const lockHidesContent = () => !!(editor.book && editor.book.lockPreventViewing && isLocked());
    function applyLockView() {
        const shell = $('sheetsEditorShell');
        if (!shell) return;
        const hide = lockHidesContent();
        shell.classList.toggle('sheets-lock-hidden', hide);
        let overlay = $('sheetsLockOverlay');
        if (hide && !overlay) {
            overlay = document.createElement('div');
            overlay.id = 'sheetsLockOverlay';
            overlay.className = 'sheets-lock-overlay liquid-glass';
            overlay.setAttribute('role', 'status');
            overlay.innerHTML = '<icon aria-hidden="true">lock</icon><p></p><button type="button" class="mu-btn mu-btn-primary"><span class="mu-icon" aria-hidden="true">lock_open</span><span></span></button>';
            overlay.querySelector('button').addEventListener('click', openLockDialog);
            shell.appendChild(overlay);
        }
        if (overlay) {
            overlay.hidden = !hide;
            overlay.querySelector('p').textContent = t('sheet_locked_prevent_viewing_msg');
            overlay.querySelector('button span:last-child').textContent = t('unlock_spreadsheet');
        }
        if (hide) { exitSplit(false); closeFind(); }
    }
    function blockIfHidden() {
        if (!lockHidesContent()) return false;
        showToast(t('sheet_locked_prevent_viewing_msg'), { type: 'error' });
        return true;
    }
    function openLockDialog() {
        const book = editor.book;
        if (!book || typeof window.showLockDocumentModal !== 'function') return;
        commitEdit();
        window.showLockDocumentModal(book, {
            kind: 'sheet',
            allowRelock: true,
            allowRemove: true,
            save: () => saveBookNow(book),
            onChange: () => { updateLockButton(); renderLists(); scheduleRender(); }
        });
    }

    /* ================================================================ move to workspace (OmniWrite feature) */
    function openMoveToWorkspace(book, anchor) {
        const current = book.workspaceId || PERSONAL;
        openMenu(anchor, [{ heading: t('move_to_workspace') }, ...workspaces().map(ws => ({
            icon: ws.id === current ? 'radio_button_checked' : 'radio_button_unchecked', label: workspaceLabel(ws), checked: ws.id === current,
            action() {
                if (ws.id === current) return;
                window.removeOmniSpreadsheetFromFolders?.(book, ws.id);
                book.workspaceId = ws.id;
                touchBook(book);
                renderLists();
                showToast(t('sheets_moved_workspace', { name: workspaceLabel(ws) }), { type: 'success' });
                if (editor.book === book && ws.id !== activeWorkspace().id) goHome();
            }
        }))], { align: 'end' });
    }

    /* ================================================================ phones (mirrors OmniWrite's mobile-layout.js) */
    /* ================================================================ toolbar (OmniWrite's toolbar system, spreadsheet buttons)
       OmniWrite's toolbar customization (order, pinned, More, hidden, dividers) runs on this toolbar with its
       own saved layout. Items placed in More show in the spreadsheet's More menu. */
    const toolbarMoreHolder = document.createElement('div');
    toolbarMoreHolder.id = 'sheetsToolbarMoreItems';
    toolbarMoreHolder.hidden = true;
    ($('sheetsFloatingUi') || document.body).appendChild(toolbarMoreHolder);
    const toolbarContext = {
        id: 'sheets',
        storageKey: 'omniwrite-sheets-toolbar-customization',
        titleKey: 'customize_sheets_toolbar',
        groups: [],
        toolbar: () => $('sheetsToolbar'),
        moreContainer: () => toolbarMoreHolder,
        cache: null,
        onApplied: null
    };
    function toolbarMoreMenuItems() {
        const items = [...toolbarMoreHolder.querySelectorAll(':scope > .toolbar-item')].filter(item => item.style.display !== 'none');
        if (!items.length) return [];
        return [{ heading: omniT('editor_toolbar_items') }, ...items.map(item => ({
            icon: (item.querySelector('icon') || {}).textContent || 'tune',
            label: item.getAttribute('aria-label') || item.id,
            action: () => { pendingAnchor = $('moreEditorBtn'); item.click(); pendingAnchor = null; }
        })), { sep: true }];
    }
    (function mobileLayout() {
        const mq = window.matchMedia('(max-width: 760px)');
        const toolbar = $('sheetsToolbar');
        const bottom = $('mobileEditorToolbar');
        const toolsBtn = $('mobileEditorToolsBtn');
        const holder = document.createElement('div');
        holder.hidden = true;
        document.body.appendChild(holder);
        const PRIMARY = new Set(['numberFormatBtn', 'fontFamilyBtn', 'fontSizeDecreaseBtn', 'fontSizeBtn', 'fontSizeIncreaseBtn', 'undoBtn', 'redoBtn']);
        const QUICK = ['boldBtn', 'italicBtn', 'textColorBtn', 'fillColorBtn', 'alignGroupBtn', 'functionBtn', 'insertBtn'];
        let sheet = null;
        // Phones: after OmniWrite's toolbar customization lays the toolbar out, move tools into the bottom bar.
        function moveForPhone() {
            if (mq.matches) {
                // Element ids carry the "sh" prefix in the DOM.
                const primaryIds = new Set([...PRIMARY].map(domId)), quickIds = new Set(QUICK.map(domId));
                for (const el of [...toolbar.children]) {
                    if (primaryIds.has(el.id) || quickIds.has(el.id)) continue;
                    holder.appendChild(el);
                }
                QUICK.forEach(id => { const el = $(id); if (el && el.parentElement === toolbar) bottom.insertBefore(el, toolsBtn); });
            } else {
                closeSheet();
            }
            requestAnimationFrame(() => { layoutEditorHeight(); scheduleRender(); });
        }
        toolbarContext.onApplied = moveForPhone;
        function layout() {
            if (window.OmniToolbarCustomization) { window.OmniToolbarCustomization.apply(toolbarContext); return; }
            // Without OmniWrite's engine, put everything back, then lay out for the screen size.
            [...holder.children].forEach(el => toolbar.appendChild(el));
            QUICK.forEach(id => { const el = $(id); if (el && el.parentElement === bottom) toolbar.appendChild(el); });
            moveForPhone();
        }
        function closeSheet() { if (sheet && sheet.open) sheet.close(); }
        toolsBtn.addEventListener('click', () => {
            if (sheet || !mq.matches) return;
            commitEdit();
            const dialog = document.createElement('dialog');
            sheet = dialog;
            dialog.id = 'mobileEditorToolsSheet';
            dialog.className = 'liquid-glass';
            dialog.setAttribute('aria-labelledby', 'mobileEditorToolsTitle');
            dialog.innerHTML = `<header><h2 id="mobileEditorToolsTitle"></h2><button type="button" class="omni-fab-icon" aria-label="${esc(t('close'))}"><icon aria-hidden="true">close</icon></button></header><div class="mobile-editor-tools-list"></div>`;
            dialog.querySelector('h2').textContent = t('mobile_formatting_tools');
            dialog.querySelector('header button').onclick = closeSheet;
            const list = dialog.querySelector('.mobile-editor-tools-list');
            for (const control of [...holder.querySelectorAll(':scope > .toolbar-item'), ...toolbarMoreHolder.querySelectorAll(':scope > .toolbar-item')]) {
                if (control.style.display === 'none') continue;
                const proxy = document.createElement('button');
                proxy.type = 'button';
                proxy.className = 'dropdown-item';
                proxy.innerHTML = '<icon aria-hidden="true"></icon><span></span>';
                proxy.querySelector('icon').textContent = control.querySelector('icon')?.textContent.trim() || 'tune';
                proxy.querySelector('span').textContent = control.getAttribute('aria-label') || '';
                if (control.classList.contains('is-active')) proxy.classList.add('is-checked');
                proxy.onclick = () => {
                    const rect = proxy.getBoundingClientRect();
                    const anchor = document.createElement('span');
                    anchor.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;`;
                    document.body.appendChild(anchor);
                    closeSheet();
                    pendingAnchor = anchor;
                    control.click();
                    pendingAnchor = null;
                    setTimeout(() => anchor.remove(), 400);
                };
                list.appendChild(proxy);
            }
            dialog.addEventListener('close', () => { toolsBtn.setAttribute('aria-expanded', 'false'); dialog.remove(); if (sheet === dialog) sheet = null; }, { once: true });
            dialog.addEventListener('click', event => {
                if (event.target !== dialog) return;
                const r = dialog.getBoundingClientRect();
                if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSheet();
            });
            document.body.appendChild(dialog);
            toolsBtn.setAttribute('aria-expanded', 'true');
            dialog.showModal();
        });
        const updateHeight = () => {
            const vv = window.visualViewport;
            const height = vv ? vv.height : window.innerHeight;
            document.documentElement.style.setProperty('--omni-mobile-height', height + 'px');
            document.documentElement.style.setProperty('--omni-mobile-bottom', Math.max(0, window.innerHeight - height - (vv ? vv.offsetTop : 0)) + 'px');
            layoutEditorHeight();
        };
        window.visualViewport?.addEventListener('resize', updateHeight, { passive: true });
        new MutationObserver(() => { if (!$('editorContent').classList.contains('active')) closeSheet(); }).observe($('editorContent'), { attributes: true, attributeFilter: ['class'] });
        mq.addEventListener('change', layout);
        // OmniWrite's toolbar engine and scroll arrows may finish loading after this script.
        const start = () => {
            if (window.setupOmniToolbarScrollControls) window.setupOmniToolbarScrollControls(toolbar);
            layout();
        };
        if (window.OmniToolbarCustomization) start(); else window.addEventListener('load', start, { once: true });
        updateHeight();
    })();

    /* ================================================================ templates for OmniWrite's gallery */
    function templatePreviewHtml(id) {
        const tpl = TEMPLATES.find(item => item.id === id);
        if (!tpl) return '';
        const built = normalizeBook(Object.assign({ id: 'preview' }, tpl.build()));
        const sheet = built.sheets[0];
        const evaluator = E.createEvaluator(() => built);
        let maxR = 0, maxC = 0;
        Object.keys(sheet.cells).forEach(key => { const [r, c] = key.split(':').map(Number); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); });
        const rows = [];
        for (let r = 0; r <= Math.min(maxR, 13); r++) {
            const cells = [];
            for (let c = 0; c <= Math.min(maxC, 7); c++) {
                const cell = getCell(r, c, sheet);
                const s = cellStyle(cell);
                let text = '';
                try { text = cell && cell.chk ? (String(cell.v).toUpperCase() === 'TRUE' ? '☑' : '☐') : displayText(sheet, r, c, evaluator); } catch { text = ''; }
                const numeric = cell && typeof evaluator.value(sheet, r, c) === 'number';
                cells.push(`<td style="${s.bg ? `background:${s.bg};` : ''}${s.fc ? `color:${s.fc};` : ''}text-align:${s.ha || (numeric ? 'right' : 'left')}">${esc(text)}</td>`);
            }
            rows.push(`<tr>${cells.join('')}</tr>`);
        }
        return `<table class="sheets-tpl-preview"><tbody>${rows.join('')}</tbody></table>`;
    }
    function createFromTemplate(id) {
        const tpl = TEMPLATES.find(item => item.id === id);
        if (!tpl) return null;
        const book = createBook(tpl.build());
        saveBookNow(book);
        renderLists();
        openBookRoute(book.id);
        return book;
    }

    /* ================================================================ init */
    async function init() {
        await loadLanguage(currentLang());
        applyI18n($(SHEET_PAGE_ID));
        applyI18n($('sheetsFloatingUi'));
        await initStorage();
        setupSync();
        updateUndoButtons();
        renderLists();
        // OmniWrite's router may have asked for a spreadsheet before storage was ready.
        const match = /\/sheet\/([A-Za-z0-9._-]+)/.exec(location.hash || '');
        if (match) showBook(match[1]);
        window.addEventListener('storage', event => {
            if (event.key === 'omniwrite-active-workspace' || event.key === 'omniwrite-workspaces') renderLists();
        });
        // OmniWrite sets <html lang> when the language changes in its settings.
        new MutationObserver(() => loadLanguage(currentLang()).then(renderAllText)).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }

    /* ================================================================ API used by OmniWrite */
    window.OmniSheets = {
        ready: storageReady,
        get editor() { return editor; },
        get books() { return books; },
        t,
        list: () => liveBooks(),
        trashed: () => visibleBooks().filter(b => b.trashed).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0)),
        find: findBook,
        currentId: () => (editor.book && isSheetPageActive() ? editor.book.id : null),
        sidebarItem,
        trashCard,
        menu: (id, anchor, x, y) => { const book = findBook(id); if (book) openBookMenu(book, anchor, x, y); },
        open: openBookRoute,
        show: showBook,
        onPageChange,
        isActive: isSheetPageActive,
        create: newBlankBook,
        importFile,
        pickImport,
        templates: () => TEMPLATES.map(tpl => ({ id: tpl.id, icon: tpl.icon, name: t(tpl.title), desc: t(tpl.desc) })),
        templatePreview: templatePreviewHtml,
        createFromTemplate,
        search: searchBooks,
        find: replace => { if (editor.book) openFind(!!replace); },
        createFromSharedLink,
        applyTopbar: () => { topbarSignature = ''; applyTopbar(); },
        restoreAll() { this.trashed().forEach(b => { b.trashed = false; delete b.trashedAt; touchBook(b); }); renderLists(); },
        async deleteAllTrashed() { for (const book of this.trashed()) await deleteForever(book, true); },
        flush: () => flushSaves(),
        legacyShare: () => shareBook(),
        // Bridge for real-time collaboration (../collab.js).
        collab: {
            current: () => (isSheetPageActive() && editor.book ? editor.book : null),
            all: () => books,
            isLocked: book => !!(book && book.locked && (typeof window.isEffectivelyLocked === 'function' ? window.isEffectivelyLocked(book) : true)),
            isEditing: book => editor.book === book && !!editor.editing,
            snapshot: book => {
                const copy = snapshotBook(book);
                return { title: copy.title, sheets: copy.sheets };
            },
            apply(book, snap) {
                if (editor.book === book && editor.editing) return false; // retried after the cell edit ends
                book.title = String(snap.title || t('sheets_untitled')).slice(0, 200);
                book.sheets = (Array.isArray(snap.sheets) && snap.sheets.length ? clone(snap.sheets) : [newSheet(t('sheets_sheet_name', { n: 1 }))]).map(normalizeSheet);
                if (!book.sheets.some(s => s.id === book.activeSheet)) book.activeSheet = book.sheets[0].id;
                if (editor.book === book) loadBookIntoEditor(book, { keepSelection: true });
                touchBook(book);
                renderLists();
                return true;
            },
            setReadOnly(book, readOnly) {
                if (!book) return;
                if (readOnly) collabReadOnly.add(book.id); else collabReadOnly.delete(book.id);
            },
            async create({ title, sheets, collab, open = true }) {
                await storageReady;
                if (window.isCurrentWorkspaceWritable?.() === false) return null;
                const book = createBook({ title: String(title || t('sheets_untitled')).slice(0, 200), sheets: (sheets || []).map(normalizeSheet) });
                book.collab = Object.assign({}, collab, { localId: book.id });
                saveBookNow(book);
                renderLists();
                if (open) openBookRoute(book.id);
                return book;
            },
            open: id => openBookRoute(id),
            save: book => touchBook(book),
            refreshLibrary: renderLists,
            addToLibrary(book) {
                if (window.isCurrentWorkspaceWritable?.() === false) return false;
                if (book.collab.savedToDocuments === false) book.workspaceId = activeWorkspace().id;
                book.collab.savedToDocuments = true;
                return true;
            },
            // Comments and live cursors
            selection() {
                if (!editor.sheet) return null;
                const range = selRange();
                return { sheetId: editor.sheet.id, r: editor.sel.r, c: editor.sel.c, r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 };
            },
            activeSheetId: () => (editor.sheet ? editor.sheet.id : null),
            sheetName: (book, id) => (book.sheets.find(sheet => sheet.id === id) || {}).name || '',
            cellName: (r, c) => E.refName(r, c),
            overlayLayer: () => { const active = $('sheetsActiveCell'); return active ? active.parentElement : null; },
            cellBox: (r, c) => (editor.sheet ? cellRect(r, c) : null),
            select(id, r, c) {
                if (!editor.book) return;
                if (editor.sheet.id !== id && editor.book.sheets.some(sheet => sheet.id === id)) switchSheet(id);
                setSelection(r, c);
                viewport.focus({ preventScroll: true });
            }
        }
    };
    init().catch(error => { console.error(error); showToast(t('sheets_save_failed'), { type: 'error' }); });
})();
