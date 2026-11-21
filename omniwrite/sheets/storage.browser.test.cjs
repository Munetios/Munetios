'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { createCipheriv, createDecipheriv } = require('node:crypto');
const express = require('express');
const { chromium } = require(process.env.SHEETS_PLAYWRIGHT_MODULE || 'playwright');
let browser, server, origin;
before(async () => {
    const root = path.resolve(__dirname, '../..'), app = express();
    for (const folder of ['omniwrite', 'account', 'munetios-ui', 'fonts']) app.use('/' + folder, express.static(path.join(root, folder)));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.SHEETS_BROWSER_PATH ? { executablePath: process.env.SHEETS_BROWSER_PATH } : { channel: 'chrome' }) });
});
after(async () => {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
});
async function context(t, init, accountConfig = { autoSync: false }) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    t.after(() => ctx.close());
    await ctx.addInitScript(config => { window.MunetiosAccountConfig = config; }, accountConfig);
    if (init) await ctx.addInitScript(init);
    await ctx.route('**/api/auth/**', route => route.fulfill({ json: { account: null, accounts: [] } }));
    await ctx.route(/^https:\/\//, route => route.abort());
    return ctx;
}
async function newBook(ctx) {
    const page = await ctx.newPage();
    await page.goto(origin + '/omniwrite/#/sheets/new');
    await page.waitForFunction(() => window.OmniSheets?.editor?.book);
    await saved(page);
    return page;
}
async function saved(page) {
    await page.waitForFunction(() => ['saved', 'e2e_encrypted'].some(key => document.getElementById('shSavingStatus').textContent === OmniSheets.t(key)));
}
async function cell(page, value) {
    await page.locator('#sheetsViewport').focus();
    await page.keyboard.press('F2');
    await page.locator('#sheetsCellEditor').fill(value);
}
async function reloadValue(page) {
    await page.reload();
    await page.waitForFunction(() => window.OmniSheets?.editor?.book);
    return page.evaluate(() => OmniSheets.editor.sheet.cells['0:0']?.v);
}
async function importFromCreate(page, file, item = '#createImportFileBtn') {
    await page.locator('#createBtn').click();
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator(item).click()
    ]);
    await chooser.setFiles(file);
}
function nativeFile(format, data, name = 'import.' + format) {
    return { name, mimeType: 'application/vnd.munetios.' + format + '+json', buffer: Buffer.from(JSON.stringify({ format, version: 1, data })) };
}
test('sign-in syncs 85 legacy local documents alongside the existing cloud document', async t => {
    const ctx = await context(t, undefined, { autoSync: true });
    const account = { id: 'sync-library', email: 'sync@example.invalid', displayName: 'Sync test' };
    const rawKey = Buffer.alloc(32, 9);
    const key = 'omniwrite:doc:cloud';
    const iv = Buffer.alloc(12, 1);
    const cipher = createCipheriv('aes-256-gcm', rawKey, iv);
    cipher.setAAD(Buffer.from(account.id + '|' + key));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ d: { id: 'cloud', title: 'Old beta document', content: '<p>Cloud copy</p>' }, u: 1 })), cipher.final(), cipher.getAuthTag()]);
    const remote = new Map([[key, { key, version: '1', iv: iv.toString('hex'), ciphertext: ciphertext.toString('base64') }]]);
    const batchBytes = [];
    let session = null, seq = 1, retrySmaller = true;
    await ctx.route('**/api/auth/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.endsWith('/session')) return route.fulfill({ json: { account: session, accounts: [] } });
        if (url.pathname.endsWith('/sync/items')) {
            const matches = [...remote.values()].filter(item => item.key.startsWith(url.searchParams.get('prefix')) && Number(item.version) > Number(url.searchParams.get('since')));
            return route.fulfill({ json: { items: matches.slice(0, 8), hasMore: matches.length > 8, seq: String(seq) } });
        }
        if (url.pathname.endsWith('/sync/batch')) {
            const { items } = request.postDataJSON();
            batchBytes.push(request.postDataBuffer().length);
            if (retrySmaller && items.length > 1) {
                retrySmaller = false;
                return route.fulfill({ status: 413, json: { error: 'payloadTooLarge' } });
            }
            const results = items.map(item => {
                const version = String(++seq);
                remote.set(item.key, { ...item, version });
                return { key: item.key, version, status: 'ok' };
            });
            return route.fulfill({ json: { results } });
        }
        return route.fulfill({ json: { used: 0, quota: 50000000000, groups: {} } });
    });
    const page = await ctx.newPage();
    await page.goto(origin + '/omniwrite/');
    await page.waitForFunction(() => window.OmniWriteSync && MunetiosAccount.state.ready);
    await page.evaluate(async raw => {
        const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('munetios-account', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('keys', { keyPath: 'accountId' });
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const tx = open.result.transaction('keys', 'readwrite');
                tx.objectStore('keys').put({ accountId: 'sync-library', key });
                tx.oncomplete = () => { open.result.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
        });
        for (let index = 0; index < 85; index++) {
            const content = index === 0 ? '<p>Legacy text</p><img data-omniwrite-image-id="999999">' : '<p>' + 'x'.repeat(index < 10 ? 400000 : 20) + '</p>';
            documents.push({ id: 'legacy-' + index, title: 'Legacy document ' + index, content, timestamp: 1, workspaceId: PERSONAL_WORKSPACE_ID });
        }
        documents.push({ id: 'other-account', title: 'Other account', content: '<p>Private</p>', localOnly: true, localSyncOwner: 'other' });
        await saveDocuments();
    }, [...rawKey]);
    await page.reload();
    await page.waitForFunction(() => window.OmniWriteSync && typeof documents !== 'undefined' && documents.filter(doc => doc.id.startsWith('legacy-') && doc.localOnly).length === 85);
    session = account;
    await page.evaluate(async () => { await MunetiosAccount.refresh(); });
    await page.waitForFunction(() => MunetiosAccount.state.status === 'synced');
    assert.equal(await page.evaluate(() => documents.filter(doc => doc.id.startsWith('legacy-') && !doc.localOnly).length), 85);
    assert.equal(await page.evaluate(() => documents.some(doc => doc.title === 'Old beta document')), true);
    assert.equal(await page.evaluate(() => documents.some(doc => doc.id === 'other-account' && doc.localOnly)), true);
    assert.equal([...remote.keys()].filter(key => key.startsWith('omniwrite:doc:')).length, 86);
    assert.equal(remote.has('omniwrite:doc:other-account'), false);
    assert.ok(batchBytes.length > 5 && batchBytes.every(bytes => bytes <= 4 * 1024 * 1024));
    assert.equal(retrySmaller, false);
    const uploaded = remote.get('omniwrite:doc:legacy-0');
    const encrypted = Buffer.from(uploaded.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', rawKey, Buffer.from(uploaded.iv, 'hex'));
    decipher.setAAD(Buffer.from(account.id + '|' + uploaded.key));
    decipher.setAuthTag(encrypted.subarray(-16));
    const plaintext = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]));
    assert.match(plaintext.d.content, /Legacy text/);
    assert.doesNotMatch(plaintext.d.content, /999999/);
    assert.match(await page.evaluate(() => documents.find(doc => doc.id === 'legacy-0').content), /999999/);
});
test('OmniWrite downloads and reopens editable .mwrite documents with local media', async t => {
    const page = await (await context(t)).newPage();
    await page.goto(origin + '/omniwrite/');
    await page.waitForFunction(() => typeof db !== 'undefined' && db && window.OmniNativeFiles);
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=';
    await importFromCreate(page, nativeFile('mwrite', {
        title: 'Native document',
        content: '<section class="omniwrite-page" data-page-index="1"><p style="color: purple"><strong>Editable text</strong><img src="' + image +
            '" onerror="window.nativeFileRan = true"><a href="javascript:void(0)">Unsafe link</a></p><script>window.nativeFileRan = true</script></section>',
        headerHtml: '<p>Document header</p>', headersFootersEnabled: true
    }));
    await page.waitForURL(/\/document\//);
    const firstId = page.url();
    const editor = page.locator('#editorPagesColumn .document-page-editor').first();
    await editor.locator('strong').waitFor();
    assert.equal(await editor.locator('strong').textContent(), 'Editable text');
    assert.equal(await editor.locator('a').getAttribute('href'), null);
    assert.equal(await editor.locator('script, [onerror]').count(), 0);
    await editor.locator('img[src^="blob:"]').waitFor();
    await page.locator('#downloadMoreOptionsBtn').dispatchEvent('mousedown');
    const downloading = page.waitForEvent('download');
    await page.locator('#downloadMwrite').click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'Native document.mwrite');
    const buffer = await readFile(await download.path());
    const exported = JSON.parse(buffer);
    assert.equal(exported.format, 'mwrite');
    assert.match(exported.data.content, /<strong>Editable text<\/strong>/);
    assert.ok(exported.data.content.includes(image));
    assert.equal(exported.data.headerHtml, '<p>Document header</p>');
    assert.equal(exported.data.id, undefined);
    await importFromCreate(page, { name: download.suggestedFilename(), mimeType: 'application/vnd.munetios.mwrite+json', buffer });
    await page.waitForFunction(oldUrl => location.href !== oldUrl, firstId);
    await editor.locator('strong').waitFor();
    assert.equal(await editor.getAttribute('contenteditable'), 'true');
});
test('Sheets downloads and reopens .msheet workbooks with formulas and formatting', async t => {
    const page = await newBook(await context(t));
    const file = nativeFile('msheet', {
        title: 'Native spreadsheet', activeSheet: 'totals',
        sheets: [
            { id: 'data', name: 'Data', rows: 100, cols: 26, cells: { '0:0': { v: '10' } } },
            { id: 'totals', name: 'Totals', rows: 100, cols: 26, freeze: { rows: 1, cols: 1 }, colWidths: { 0: 180 }, rowHeights: { 0: 48 },
                merges: [{ r1: 1, c1: 0, r2: 1, c2: 1 }],
                cf: [{ id: 'positive', range: 'A1', type: 'gt', a: '0', bg: '#e9ddff' }],
                cells: {
                    '0:0': { v: '=Data!A1*2', note: 'Double', s: { b: true, fc: '#700baa' } },
                    '0:1': { v: 'Style check', s: { bg: 'red" onmouseover="void(0)' } }
                } }
        ]
    });
    await page.locator('#shMoreEditorBtn').click();
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('menuitem', { name: 'Import Spreadsheet' }).click()
    ]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => OmniSheets.editor.book?.title === 'Native spreadsheet');
    const firstId = await page.evaluate(() => OmniSheets.editor.book.id);
    await page.locator('#shDownloadDocumentBtn').evaluate(button => button.click());
    const downloading = page.waitForEvent('download');
    await page.locator('[data-kind="msheet"]').click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'Native spreadsheet.msheet');
    const buffer = await readFile(await download.path());
    const exported = JSON.parse(buffer);
    assert.equal(exported.format, 'msheet');
    assert.equal(exported.data.workspaceId, undefined);
    assert.equal(exported.data.id, undefined);
    assert.deepEqual(exported.data.sheets.map(sheet => sheet.name), ['Data', 'Totals']);
    assert.equal(exported.data.sheets[1].cells['0:1'].s, undefined);
    assert.equal(exported.data.sheets[1].cf[0].bg, '#e9ddff');
    await importFromCreate(page, { ...file, buffer }, '#createImportSpreadsheetBtn');
    await page.waitForFunction(id => OmniSheets.editor.book?.title === 'Native spreadsheet' && OmniSheets.editor.book.id !== id, firstId);
    assert.deepEqual(await page.evaluate(() => {
        const { sheet, evaluator } = OmniSheets.editor;
        return {
            tab: sheet.name, cell: sheet.cells['0:0'], value: evaluator.value(sheet, 0, 0),
            width: sheet.colWidths[0], height: sheet.rowHeights[0], freeze: sheet.freeze, merges: sheet.merges
        };
    }), {
        tab: 'Totals', cell: { v: '=Data!A1*2', note: 'Double', s: { b: true, fc: '#700baa' } }, value: 20,
        width: 180, height: 48, freeze: { rows: 1, cols: 1 }, merges: [{ r1: 1, c1: 0, r2: 1, c2: 1 }]
    });
    const bookCount = await page.evaluate(() => OmniSheets.books.length);
    await page.locator('#shImportFileInput').setInputFiles(nativeFile('mwrite', { title: 'Wrong type', content: '' }, 'incorrect.msheet'));
    await page.waitForFunction(() => document.body.textContent.includes(OmniSheets.t('sheets_import_failed')));
    assert.equal(await page.evaluate(() => OmniSheets.books.length), bookCount);
});
test('the grid reuses visible cells and unloads distant rows and columns', async t => {
    const page = await newBook(await context(t));
    const box = page.locator('#sheetsNameBox');
    const viewport = page.locator('#sheetsViewport');
    const go = async address => { await box.fill(address); await box.press('Enter'); };
    await go('ZZ20000');
    await cell(page, 'far cell');
    await page.locator('#sheetsCellEditor').press('Enter');
    const farScroll = await viewport.evaluate(grid => ({ left: grid.scrollLeft, top: grid.scrollTop }));
    await go('A1');
    await cell(page, 'first cell');
    await page.locator('#sheetsCellEditor').press('Shift+Enter');
    await page.waitForFunction(() => document.querySelector('#sheetsCells [data-r="0"][data-c="0"]')?.textContent === 'first cell');
    const retained = await viewport.evaluate(async grid => {
        const cell = document.querySelector('#sheetsCells [data-r="0"][data-c="0"]');
        const { r, c } = OmniSheets.editor.sel;
        const scrolled = new Promise(resolve => grid.addEventListener('scroll', () => requestAnimationFrame(resolve), { once: true }));
        grid.scrollTo(1, 1);
        await scrolled;
        return cell.isConnected && OmniSheets.editor.sel.r === r && OmniSheets.editor.sel.c === c;
    });
    assert.equal(retained, true);
    await viewport.focus();
    await page.keyboard.press('F2');
    const editor = page.locator('#sheetsCellEditor');
    await editor.evaluate(field => field.setSelectionRange(3, 3));
    const scanCount = await viewport.evaluate(async (grid, scroll) => {
        const query = document.querySelectorAll;
        let scans = 0;
        document.querySelectorAll = function (selector) {
            if (selector === '.dropdown-wrapper[id], #virtualKeyboardPanel' ||
                selector === '.dropdown-wrapper, .omni-ctx-menu, .omni-custom-palette') scans++;
            return query.call(this, selector);
        };
        try {
            const scrolled = new Promise(resolve => grid.addEventListener('scroll', () => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }, { once: true }));
            grid.scrollTo(scroll);
            await scrolled;
            return scans;
        } finally {
            document.querySelectorAll = query;
        }
    }, farScroll);
    assert.equal(scanCount, 0);
    await page.waitForFunction(() => document.querySelector('#sheetsCells [data-r="19999"][data-c="701"]')?.textContent === 'far cell');
    assert.equal(await page.locator('#sheetsCells [data-r="0"][data-c="0"]').count(), 0);
    assert.equal(await page.locator('#sheetsRowHeadersInner [data-row="0"]').count(), 0);
    assert.equal(await page.locator('#sheetsColHeadersInner [data-col="0"]').count(), 0);
    assert.ok(await page.locator('#sheetsCells .sheets-cell').count() < 1000);
    assert.deepEqual(await editor.evaluate(field => ({
        focused: document.activeElement === field, caret: field.selectionStart,
        r: OmniSheets.editor.sel.r, c: OmniSheets.editor.sel.c
    })), { focused: true, caret: 3, r: 0, c: 0 });
    await viewport.evaluate(grid => grid.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('#sheetsCells [data-r="0"][data-c="0"]')?.textContent === 'first cell');
    assert.equal(await page.locator('#sheetsCells [data-r="19999"][data-c="701"]').count(), 0);
    await editor.press('Escape');

    await viewport.evaluate(grid => {
        OmniSheets.editor.sheet.freeze = { rows: 19000, cols: 650 };
        grid.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -1, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.querySelector('#sheetsPaneCorner .sheets-cell'));
    assert.ok(await page.locator('#sheetsGridCard .sheets-cell').count() < 1000);
    assert.equal(await page.locator('#sheetsRowHeadersFrozen [data-row="18999"]').count(), 0);
    assert.equal(await page.locator('#sheetsColHeadersFrozen [data-col="649"]').count(), 0);
});
test('row and column handles resize across redraws and support undo and redo', async t => {
    const page = await newBook(await context(t));
    const guide = page.locator('#sheetsResizeGuide');
    const resize = async (selector, dx, dy) => {
        const handle = await page.locator(selector).boundingBox();
        const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx / 2, y + dy / 2);
        assert.equal(await guide.isVisible(), true);
        const grid = page.locator('#sheetsViewport');
        await grid.evaluate(viewport => { viewport.scrollLeft = 200; viewport.scrollTop = 110; });
        await page.waitForFunction(() => !document.querySelector('#sheetsRowHeadersInner [data-row="0"]'));
        await grid.evaluate(viewport => { viewport.scrollLeft = 0; viewport.scrollTop = 0; });
        await page.waitForFunction(() => document.querySelector('#sheetsRowHeadersInner [data-row="0"]'));
        await page.mouse.move(x + dx, y + dy);
        await page.mouse.up();
        assert.equal(await guide.isVisible(), false);
    };
    await resize('#sheetsColHeadersInner [data-col-resize="0"]', 75, 0);
    assert.equal(await page.evaluate(() => OmniSheets.editor.sheet.colWidths[0]), 195);
    await resize('#sheetsRowHeadersInner [data-row-resize="0"]', 0, 50);
    assert.equal(await page.evaluate(() => OmniSheets.editor.sheet.rowHeights[0]), 86);
    await page.locator('#sheetsViewport').focus();
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => OmniSheets.editor.sheet.rowHeights[0]), undefined);
    await page.keyboard.press('Control+y');
    assert.equal(await page.evaluate(() => OmniSheets.editor.sheet.rowHeights[0]), 86);
    await saved(page);
    await page.reload();
    await page.waitForFunction(() => window.OmniSheets?.editor?.book);
    assert.deepEqual(await page.evaluate(() => [OmniSheets.editor.sheet.colWidths[0], OmniSheets.editor.sheet.rowHeights[0]]), [195, 86]);
});
test('a stationary pointer cannot scroll the sheet or extend the selection', async t => {
    const page = await newBook(await context(t));
    const viewport = page.locator('#sheetsViewport');
    const box = await viewport.boundingBox();
    await viewport.evaluate(grid => {
        grid.addEventListener('pointerdown', event => { grid.dataset.testPointer = event.pointerId; }, { once: true });
    });
    await page.mouse.move(box.x + 30, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + box.height - 5);
    await page.waitForFunction(() => OmniSheets.editor.sel.fr > OmniSheets.editor.sel.r);
    const held = await viewport.evaluate(grid => ({ top: grid.scrollTop, range: { ...OmniSheets.editor.sel } }));
    await page.waitForTimeout(200);
    assert.equal(held.top, 0);
    assert.deepEqual(await viewport.evaluate(grid => ({ top: grid.scrollTop, range: OmniSheets.editor.sel })), held);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => document.getElementById('sheetsViewport').scrollTop > 0);
    await viewport.evaluate(grid => grid.releasePointerCapture(Number(grid.dataset.testPointer)));
    await page.mouse.move(box.x + 31, box.y + box.height - 5);
    const stopped = await viewport.evaluate(grid => ({ top: grid.scrollTop, range: { ...OmniSheets.editor.sel } }));
    await page.waitForTimeout(200);
    assert.deepEqual(await viewport.evaluate(grid => ({ top: grid.scrollTop, range: OmniSheets.editor.sel })), stopped);
    assert.deepEqual(stopped.range, held.range);
    await page.mouse.up();
});
test('cancelled fill drags leave cells untouched and released drags still fill', async t => {
    const page = await newBook(await context(t));
    await cell(page, '2');
    await page.locator('#sheetsCellEditor').press('Shift+Enter');
    const grid = page.locator('#sheetsViewport');
    const handle = page.locator('#sheetsFillHandle');
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await grid.evaluate(viewport => {
        viewport.addEventListener('pointerdown', event => { viewport.dataset.testPointer = event.pointerId; }, { once: true });
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 54);
    await page.locator('#sheetsFillPreview').waitFor({ state: 'visible' });
    await grid.evaluate(viewport => {
        viewport.dispatchEvent(new PointerEvent('pointercancel', { pointerId: Number(viewport.dataset.testPointer), bubbles: true }));
    });
    await page.mouse.up();
    assert.equal(await page.locator('#sheetsFillPreview').isVisible(), false);
    assert.equal(await page.evaluate(() => OmniSheets.editor.sheet.cells['1:0']), undefined);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 54);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => OmniSheets.editor.sheet.cells['1:0']?.v), '2');
});
test('dragging a range into a formula keeps the caret in the formula bar', async t => {
    const page = await newBook(await context(t));
    const formula = page.locator('#sheetsFormulaInput');
    await formula.fill('=SUM(');
    const grid = await page.locator('#sheetsViewport').boundingBox();
    await page.mouse.move(grid.x + 260, grid.y + 15);
    await page.mouse.down();
    await page.mouse.move(grid.x + 260, grid.y + 55);
    await page.mouse.up();
    assert.equal(await formula.inputValue(), '=SUM(C1:C2');
    assert.equal(await formula.evaluate(field => document.activeElement === field), true);
    assert.equal(await formula.evaluate(field => field.selectionStart), '=SUM(C1:C2'.length);
});
test('selecting a large sheet paints before aggregating and discards superseded statistics', async t => {
    const page = await newBook(await context(t));
    const nameBox = page.locator('#sheetsNameBox');
    await nameBox.fill('Z12000');
    await nameBox.press('Enter');
    await nameBox.fill('A1');
    await nameBox.press('Enter');
    await saved(page);
    const viewport = page.locator('#sheetsViewport');
    const initial = await viewport.evaluate(async grid => {
        const { sheet } = OmniSheets.editor;
        sheet.cells['10500:0'] = { v: '=SUM(A1:B1)' };
        for (let r = 0; r < 10000; r++) {
            for (let c = 0; c < 10; c++) sheet.cells[r + ':' + c] = { v: '2' };
        }
        sheet.cells['10500:1'] = { v: 'text' };
        sheet.cells['10500:2'] = { v: '=""' };
        sheet.cells['10500:3'] = { s: { b: true } };
        grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return {
            range: document.getElementById('sheetsNameBox').value,
            highlight: document.getElementById('sheetsSelection').style.display,
            stats: document.getElementById('sheetsStats').textContent
        };
    });
    assert.deepEqual(initial, { range: 'A1:Z12000', highlight: 'block', stats: '' });
    const countLabel = await page.evaluate(() => OmniSheets.t('sheets_count'));
    const stats = page.locator('#sheetsStats');
    await page.waitForFunction(label => document.getElementById('sheetsStats').textContent.endsWith(label + ': 100002'), countLabel);
    assert.match(await stats.textContent(), /200[,.\s]?004/);

    const superseded = await page.evaluate(async () => {
        const grid = document.getElementById('sheetsViewport');
        const stats = document.getElementById('sheetsStats');
        const { evaluator } = OmniSheets.editor;
        const value = evaluator.value;
        let offscreenReads = 0;
        evaluator.value = (sheet, r, c) => {
            if (r === 10500 && c === 0) offscreenReads++;
            return value(sheet, r, c);
        };
        document.getElementById('sheetsCorner').click();
        const range = document.getElementById('sheetsNameBox').value;
        const pending = stats.textContent;
        await new Promise(resolve => requestAnimationFrame(resolve));
        grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { range, pending, stats: stats.textContent, offscreenReads };
    });
    assert.deepEqual(superseded, { range: 'A1:Z12000', pending: '', stats: '', offscreenReads: 0 });
    assert.equal(await nameBox.inputValue(), 'B1');
});
test('an uncommitted cell and its formula persist through reload while data stays encrypted', async t => {
    const page = await newBook(await context(t));
    await cell(page, '=SUM(2,3)');
    await saved(page);
    assert.equal(await page.evaluate(() => !!OmniSheets.editor.editing), true);
    const encrypted = await page.evaluate(async () => {
        const connection = await new Promise((resolve, reject) => { const r = indexedDB.open('omniwrite-sheets'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { return await new Promise((resolve, reject) => { const r = connection.transaction('books').objectStore('books').get(OmniSheets.editor.book.id); r.onsuccess = () => resolve(!!r.result?.iv && !!r.result?.data && !r.result.sheets); r.onerror = () => reject(r.error); }); }
        finally { connection.close(); }
    });
    assert.equal(encrypted, true);
    assert.equal(await reloadValue(page), '=SUM(2,3)');
});
test('formula-bar typing and a single keypress autosave without Enter', async t => {
    const page = await newBook(await context(t));
    await page.locator('#sheetsFormulaInput').fill('formula bar draft');
    await saved(page);
    assert.equal(await reloadValue(page), 'formula bar draft');
    await page.locator('#sheetsViewport').focus();
    await page.keyboard.press('z');
    await saved(page);
    assert.equal(await reloadValue(page), 'z');
});
test('Escape cancels an already autosaved draft and preserves the original value', async t => {
    const page = await newBook(await context(t));
    await cell(page, 'original'); await page.locator('#sheetsCellEditor').press('Enter'); await saved(page);
    await page.locator('#sheetsNameBox').fill('A1'); await page.locator('#sheetsNameBox').press('Enter');
    await cell(page, 'cancelled draft'); await saved(page);
    await page.locator('#sheetsCellEditor').press('Escape'); await saved(page);
    assert.equal(await reloadValue(page), 'original');
});
test('older slow saves cannot overwrite a newer edit', async t => {
    const page = await newBook(await context(t, () => {
        const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
        crypto.subtle.encrypt = async (...args) => {
            const text = new TextDecoder().decode(args[2]);
            if (text.includes('slow-old')) { window.__slowSaveStarted = true; await new Promise(resolve => setTimeout(resolve, 1400)); }
            return encrypt(...args);
        };
    }));
    await cell(page, 'slow-old');
    await page.waitForFunction(() => window.__slowSaveStarted);
    await page.locator('#sheetsCellEditor').fill('latest edit');
    await saved(page);
    assert.equal(await reloadValue(page), 'latest edit');
});
test('failed writes retain pending data and retry without another edit', async t => {
    const page = await newBook(await context(t, () => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'books' && window.__failWrites) throw new DOMException('Test storage quota failure', 'QuotaExceededError');
            return put.apply(this, args);
        };
    }));
    await page.evaluate(() => { window.__failWrites = true; });
    await cell(page, 'retry this value');
    await page.waitForFunction(() => document.getElementById('shSavingStatus').textContent === OmniSheets.t('sheets_save_failed'));
    await page.waitForTimeout(2700);
    assert.equal(await page.locator('#shSavingStatus').textContent(), await page.evaluate(() => OmniSheets.t('sheets_save_failed')));
    await page.evaluate(() => { window.__failWrites = false; window.dispatchEvent(new Event('online')); });
    await saved(page);
    assert.equal(await reloadValue(page), 'retry this value');
});
test('new tabs racing on first use share one persistent encryption key', async t => {
    const ctx = await context(t, () => {
        const generate = crypto.subtle.generateKey.bind(crypto.subtle);
        crypto.subtle.generateKey = async (...args) => { const key = await generate(...args); if (args[0]?.name === 'AES-GCM') await new Promise(resolve => setTimeout(resolve, 700)); return key; };
    });
    const a = await ctx.newPage(), b = await ctx.newPage();
    await Promise.all([a.goto(origin + '/omniwrite/#/sheets/new'), b.goto(origin + '/omniwrite/#/sheets/new')]);
    await Promise.all([a.waitForFunction(() => window.OmniSheets?.editor?.book), b.waitForFunction(() => window.OmniSheets?.editor?.book)]);
    await Promise.all([saved(a), saved(b)]);
    await cell(a, 'first tab'); await cell(b, 'second tab');
    await Promise.all([saved(a), saved(b)]);
    assert.equal(await reloadValue(a), 'first tab');
    assert.equal(await reloadValue(b), 'second tab');
    assert.equal(await b.evaluate(() => OmniSheets.books.length), 2);
});
test('reloading while a write is pending offers a chance to finish saving', async t => {
    const page = await newBook(await context(t, () => {
        const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
        crypto.subtle.encrypt = async (...args) => {
            if (new TextDecoder().decode(args[2]).includes('reload guard')) await new Promise(resolve => setTimeout(resolve, 900));
            return encrypt(...args);
        };
    }));
    await cell(page, 'reload guard');
    let guarded = false;
    page.once('dialog', async dialog => { assert.equal(dialog.type(), 'beforeunload'); guarded = true; await dialog.dismiss(); });
    await page.reload({ timeout: 2000 }).catch(() => {});
    assert.equal(guarded, true);
    await saved(page);
    assert.equal(await reloadValue(page), 'reload guard');
});
