/*
 * OmniWrite Sheets file formats: native .msheet, CSV/TSV, and .xlsx (Office Open XML).
 * - .xlsx export writes an uncompressed (stored) zip with values, formulas, widths, and merges.
 * - .xlsx import reads stored or deflated zips with the browser's DecompressionStream.
 */
(function (root) {
    'use strict';
    const E = root.SheetsEngine;

    /* ------------------------------------------------------------ CSV */
    function detectDelimiter(text) {
        const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
        const counts = { ',': 0, ';': 0, '\t': 0 };
        let quoted = false;
        for (const ch of sample) { if (ch === '"') quoted = !quoted; else if (!quoted && ch in counts) counts[ch]++; }
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
    }
    function parseCSV(text, delimiter) {
        text = String(text || '').replace(/^﻿/, '');
        const d = delimiter || detectDelimiter(text);
        const rows = [];
        let row = [], field = '', i = 0, quoted = false;
        while (i < text.length) {
            const ch = text[i];
            if (quoted) {
                if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
                field += ch; i++; continue;
            }
            if (ch === '"' && field === '') { quoted = true; i++; continue; }
            if (ch === d) { row.push(field); field = ''; i++; continue; }
            if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2; continue; }
            if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
            field += ch; i++;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        return rows;
    }
    function toCSV(matrix, delimiter = ',') {
        return matrix.map(row => row.map(value => {
            const s = value === null || value === undefined ? '' : String(value);
            return /[",\r\n\t;]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(delimiter)).join('\r\n');
    }

    /* ------------------------------------------------------------ zip */
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function zipStore(files) {
        const enc = new TextEncoder();
        const chunks = [], central = [];
        let offset = 0;
        const now = new Date();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        for (const file of files) {
            const name = enc.encode(file.name);
            const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
            const crc = crc32(data);
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
            local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
            local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
            chunks.push(new Uint8Array(local.buffer), name, data);
            const cen = new DataView(new ArrayBuffer(46));
            cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
            cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
            cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
            central.push(new Uint8Array(cen.buffer), name);
            offset += 30 + name.length + data.length;
        }
        const centralSize = central.reduce((n, c) => n + c.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
        return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
    async function unzip(buffer) {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('notZip');
        const count = view.getUint16(eocd + 10, true);
        let ptr = view.getUint32(eocd + 16, true);
        const files = new Map();
        const dec = new TextDecoder();
        for (let n = 0; n < count; n++) {
            if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('badZip');
            const method = view.getUint16(ptr + 10, true);
            const compSize = view.getUint32(ptr + 20, true);
            const nameLen = view.getUint16(ptr + 28, true), extraLen = view.getUint16(ptr + 30, true), commentLen = view.getUint16(ptr + 32, true);
            const localOffset = view.getUint32(ptr + 42, true);
            const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
            const localName = view.getUint16(localOffset + 26, true), localExtra = view.getUint16(localOffset + 28, true);
            const start = localOffset + 30 + localName + localExtra;
            files.set(name, { method, data: bytes.subarray(start, start + compSize) });
            ptr += 46 + nameLen + extraLen + commentLen;
        }
        return {
            has: name => files.has(name),
            async text(name) {
                const entry = files.get(name);
                if (!entry) return null;
                if (entry.method === 0) return dec.decode(entry.data);
                if (entry.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('unsupportedZip');
                const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                return dec.decode(await new Response(stream).arrayBuffer());
            }
        };
    }

    /* ------------------------------------------------------------ xlsx export */
    const xmlEscape = s => String(s).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    function exportXLSX(book, evaluator) {
        const files = [];
        const sheets = book.sheets;
        files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' });
        files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
        files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${xmlEscape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' });
        files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
        // Styles: 0 general, 1 date, 2 time, 3 date-time, 4 percent, 5 two decimals, 6 currency.
        files.push({ name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="m/d/yyyy h:mm"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="21" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>' });
        const styleFor = fmt => {
            const t = fmt && fmt.t;
            return t === 'date' || t === 'longdate' ? 1 : t === 'time' ? 2 : t === 'datetime' ? 3 : t === 'percent' ? 4 : t === 'number' ? 5 : t === 'currency' || t === 'accounting' ? 6 : 0;
        };
        sheets.forEach((sheet, index) => {
            const rows = new Map();
            for (const key of Object.keys(sheet.cells)) {
                const [r, c] = key.split(':').map(Number);
                if (!rows.has(r)) rows.set(r, []);
                rows.get(r).push(c);
            }
            const rowXml = [...rows.keys()].sort((a, b) => a - b).map(r => {
                const cells = rows.get(r).sort((a, b) => a - b).map(c => {
                    const cell = sheet.cells[r + ':' + c];
                    const ref = E.refName(r, c);
                    const raw = cell && cell.v;
                    if (raw === null || raw === undefined || raw === '') return '';
                    const value = evaluator.value(sheet, r, c);
                    const explicit = cell.s && cell.s.fmt && cell.s.fmt.t !== 'auto' ? cell.s.fmt : null;
                    const fmt = explicit || (typeof raw === 'string' && raw[0] === '=' ? evaluator.inferredFormat(sheet, r, c) : E.parseLiteral(raw).fmt);
                    const s = typeof value === 'number' ? styleFor(fmt) : 0;
                    const sAttr = s ? ` s="${s}"` : '';
                    const formula = typeof raw === 'string' && raw[0] === '=' ? `<f>${xmlEscape(raw.slice(1))}</f>` : '';
                    if (E.isErr(value)) return `<c r="${ref}" t="e">${formula}<v>${xmlEscape(value.code)}</v></c>`;
                    if (typeof value === 'number') return `<c r="${ref}"${sAttr}>${formula}<v>${value}</v></c>`;
                    if (typeof value === 'boolean') return `<c r="${ref}" t="b">${formula}<v>${value ? 1 : 0}</v></c>`;
                    if (formula) return `<c r="${ref}" t="str">${formula}<v>${xmlEscape(value ?? '')}</v></c>`;
                    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value ?? '')}</t></is></c>`;
                }).join('');
                const height = sheet.rowHeights && sheet.rowHeights[r];
                return `<row r="${r + 1}"${height ? ` ht="${Math.round(height * 0.75)}" customHeight="1"` : ''}>${cells}</row>`;
            }).join('');
            const widths = Object.entries(sheet.colWidths || {}).map(([c, w]) => `<col min="${+c + 1}" max="${+c + 1}" width="${Math.max(1, (w - 5) / 7).toFixed(2)}" customWidth="1"/>`).join('');
            const merges = (sheet.merges || []).map(m => `<mergeCell ref="${E.rangeName(m)}"/>`).join('');
            files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + (widths ? `<cols>${widths}</cols>` : '') + `<sheetData>${rowXml}</sheetData>` + (merges ? `<mergeCells count="${sheet.merges.length}">${merges}</mergeCells>` : '') + '</worksheet>' });
        });
        return zipStore(files);
    }

    /* ------------------------------------------------------------ xlsx import */
    const DATE_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
    const TIME_IDS = new Set([18, 19, 20, 21, 45, 46, 47]);
    async function importXLSX(buffer) {
        const zip = await unzip(buffer);
        const parse = text => new DOMParser().parseFromString(text, 'application/xml');
        const workbook = parse(await zip.text('xl/workbook.xml') || '');
        const relsText = await zip.text('xl/_rels/workbook.xml.rels');
        const rels = new Map();
        if (relsText) for (const rel of parse(relsText).getElementsByTagName('Relationship')) rels.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
        const shared = [];
        const sst = await zip.text('xl/sharedStrings.xml');
        if (sst) for (const si of parse(sst).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
        // Number formats per style index.
        const styleFmt = [];
        const stylesText = await zip.text('xl/styles.xml');
        if (stylesText) {
            const styles = parse(stylesText);
            const custom = new Map();
            for (const f of styles.getElementsByTagName('numFmt')) custom.set(+f.getAttribute('numFmtId'), f.getAttribute('formatCode') || '');
            const xfs = styles.getElementsByTagName('cellXfs')[0];
            if (xfs) for (const xf of xfs.getElementsByTagName('xf')) {
                const id = +xf.getAttribute('numFmtId');
                const code = (custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
                let fmt = null;
                if (DATE_IDS.has(id)) fmt = { t: 'date' };
                else if (TIME_IDS.has(id)) fmt = { t: 'time' };
                else if (id === 9 || id === 10 || /%/.test(code)) fmt = { t: 'percent', d: id === 10 ? 2 : (code.split('.')[1] || '').replace(/[^0]/g, '').length };
                else if (/[ymd]/i.test(code) && /[hs]/i.test(code)) fmt = { t: 'datetime' };
                else if (/[yd]/i.test(code) || /m{3,}/i.test(code)) fmt = { t: 'date' };
                else if (/[hs]/i.test(code)) fmt = { t: 'time' };
                else if (/[$€£¥]/.test(custom.get(id) || '') || (id >= 5 && id <= 8)) fmt = { t: 'currency', d: 2 };
                else if (id === 2 || id === 4) fmt = { t: 'number', d: 2 };
                styleFmt.push(fmt);
            }
        }
        const sheets = [];
        const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        for (const sheetEl of workbook.getElementsByTagName('sheet')) {
            const name = sheetEl.getAttribute('name') || 'Sheet' + (sheets.length + 1);
            const rid = sheetEl.getAttributeNS(ns, 'id') || sheetEl.getAttribute('r:id');
            let target = rels.get(rid) || `worksheets/sheet${sheets.length + 1}.xml`;
            target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
            const text = await zip.text('xl/' + target);
            if (!text) continue;
            const doc = parse(text);
            const cells = {}, colWidths = {}, rowHeights = {}, merges = [];
            const sharedFormulas = new Map();
            let maxR = 0, maxC = 0;
            for (const col of doc.getElementsByTagName('col')) {
                const min = +col.getAttribute('min'), max = Math.min(+col.getAttribute('max'), min + 200), width = +col.getAttribute('width');
                if (width && col.getAttribute('customWidth') === '1') for (let c = min; c <= max; c++) colWidths[c - 1] = Math.round(width * 7 + 5);
            }
            for (const row of doc.getElementsByTagName('row')) {
                const r = +row.getAttribute('r') - 1;
                if (row.getAttribute('customHeight') === '1' && row.getAttribute('ht')) rowHeights[r] = Math.round(+row.getAttribute('ht') / 0.75);
            }
            for (const c of doc.getElementsByTagName('c')) {
                const ref = E.parseA1(c.getAttribute('r') || '');
                if (!ref) continue;
                const type = c.getAttribute('t') || 'n';
                const vEl = c.getElementsByTagName('v')[0];
                const fEl = c.getElementsByTagName('f')[0];
                const isEl = c.getElementsByTagName('is')[0];
                let raw = null;
                if (fEl) {
                    let formula = fEl.textContent;
                    const si = fEl.getAttribute('si');
                    if (fEl.getAttribute('t') === 'shared' && si !== null) {
                        if (formula) sharedFormulas.set(si, { formula: '=' + formula, r: ref.r, c: ref.c });
                        else if (sharedFormulas.has(si)) { const base = sharedFormulas.get(si); formula = E.shiftFormula(base.formula, ref.r - base.r, ref.c - base.c).slice(1); }
                    }
                    if (formula) raw = '=' + formula.replace(/_xlfn\./gi, '');
                }
                if (raw === null) {
                    const v = vEl ? vEl.textContent : '';
                    if (type === 's') raw = shared[+v] ?? '';
                    else if (type === 'inlineStr') raw = isEl ? [...isEl.getElementsByTagName('t')].map(t => t.textContent).join('') : '';
                    else if (type === 'b') raw = v === '1' ? 'TRUE' : 'FALSE';
                    else if (type === 'str' || type === 'e') raw = v;
                    else raw = v;
                    if (typeof raw === 'string' && raw !== '' && (type === 's' || type === 'inlineStr' || type === 'str')) {
                        // Keep text that looks like a number or formula as text.
                        const lit = E.parseLiteral(raw);
                        if (typeof lit.value !== 'string' || raw[0] === '=') raw = "'" + raw;
                    }
                }
                if (raw === null || raw === '') continue;
                const cell = { v: raw };
                const s = c.getAttribute('s');
                if (s !== null && styleFmt[+s] && type === 'n') cell.s = { fmt: styleFmt[+s] };
                cells[ref.r + ':' + ref.c] = cell;
                maxR = Math.max(maxR, ref.r); maxC = Math.max(maxC, ref.c);
            }
            for (const m of doc.getElementsByTagName('mergeCell')) { const range = E.parseRangeA1(m.getAttribute('ref') || ''); if (range) merges.push(range); }
            sheets.push({ name, cells, colWidths, rowHeights, merges, rows: Math.max(100, maxR + 21), cols: Math.max(26, maxC + 3) });
        }
        if (!sheets.length) throw new Error('emptyWorkbook');
        return sheets;
    }

    function exportNativeWorkbook(book) {
        return root.OmniNativeFiles.encode('msheet', {
            title: book.title, activeSheet: book.activeSheet, sheets: book.sheets
        });
    }

    async function importNativeWorkbook(file) {
        const { read, isRecord } = root.OmniNativeFiles;
        const { title, activeSheet, sheets } = await read(file, 'msheet');
        if (typeof title !== 'string' || !Array.isArray(sheets) || !sheets.length) throw new Error('Invalid spreadsheet file');
        const validIndex = value => Number.isSafeInteger(value) && value >= 0;
        const id = value => typeof value === 'string' && /^[a-z0-9._-]+$/i.test(value);
        const css = (value, property) => typeof value === 'string' && !/[<>;&{}\\\r\n]/.test(value) &&
            !/url\s*\(/i.test(value) && CSS.supports(property, value);
        const color = value => css(value, 'color') && !value.includes('"');
        const cellFormats = new Set(['auto', 'text', 'number', 'percent', 'currency', 'accounting', 'scientific', 'date', 'longdate', 'time', 'datetime', 'duration']);
        const chartTypes = new Set(['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'radar']);
        const axisSizes = (values, length) => Object.fromEntries(Object.entries(isRecord(values) ? values : {}).filter(
            ([key, value]) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < length && Number.isFinite(value) && value > 0
        ));
        function formatCell(source) {
            if (!isRecord(source)) return {};
            const style = {};
            for (const key of ['b', 'i', 'u', 'st', 'wrap']) if (typeof source[key] === 'boolean') style[key] = source[key];
            if (Number.isFinite(source.fs) && source.fs > 0) style.fs = source.fs;
            if (['left', 'center', 'right'].includes(source.ha)) style.ha = source.ha;
            if (['top', 'middle', 'bottom'].includes(source.va)) style.va = source.va;
            for (const key of ['bg', 'fc']) if (color(source[key])) style[key] = source[key];
            for (const [key, property] of [['ff', 'font-family'], ['ffs', 'font-feature-settings'], ['fvs', 'font-variation-settings']]) {
                if (css(source[key], property)) style[key] = source[key];
            }
            if (isRecord(source.bd)) {
                const borders = Object.fromEntries(['t', 'r', 'b', 'l'].filter(side => css(source.bd[side], 'border') && !source.bd[side].includes('"'))
                    .map(side => [side, source.bd[side]]));
                if (Object.keys(borders).length) style.bd = borders;
            }
            const fmt = source.fmt;
            if (isRecord(fmt) && cellFormats.has(fmt.t)) {
                style.fmt = { t: fmt.t };
                if (validIndex(fmt.d)) style.fmt.d = fmt.d;
                if (typeof fmt.cur === 'string' && /^[$€£¥₹₩]$/.test(fmt.cur)) style.fmt.cur = fmt.cur;
                if (typeof fmt.code === 'string' && /^[a-z]{3}$/i.test(fmt.code)) style.fmt.code = fmt.code;
            }
            return style;
        }
        const sheetIds = new Set();
        const workbook = sheets.map(source => {
            if (!isRecord(source) || !id(source.id) || sheetIds.has(source.id) || typeof source.name !== 'string' ||
                !validIndex(source.rows) || !validIndex(source.cols) || !source.rows || !source.cols ||
                !E.parseA1(E.refName(source.rows - 1, source.cols - 1)) || !isRecord(source.cells)) throw new Error('Invalid spreadsheet tab');
            sheetIds.add(source.id);
            const { rows, cols } = source;
            const range = value => isRecord(value) && [value.r1, value.c1, value.r2, value.c2].every(validIndex) &&
                value.r1 <= value.r2 && value.c1 <= value.c2 && value.r2 < rows && value.c2 < cols;
            const bounds = ({ r1, c1, r2, c2 }) => ({ r1, c1, r2, c2 });
            const cells = {};
            for (const [key, value] of Object.entries(source.cells)) {
                if (!/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(key) || !isRecord(value)) throw new Error('Invalid spreadsheet cell');
                const [r, c] = key.split(':').map(Number);
                if (r >= rows || c >= cols) throw new Error('Spreadsheet cell is outside its tab');
                const cell = {};
                if (typeof value.v === 'string' || typeof value.v === 'boolean' || Number.isFinite(value.v)) cell.v = String(value.v);
                if (typeof value.note === 'string') cell.note = value.note;
                if (typeof value.link === 'string' && /^(https?:\/\/|mailto:)/i.test(value.link.trim())) cell.link = value.link.trim();
                if (value.chk === true) cell.chk = true;
                if (Array.isArray(value.dd)) cell.dd = value.dd.filter(option => typeof option === 'string');
                const style = formatCell(value.s);
                if (Object.keys(style).length) cell.s = style;
                cells[key] = cell;
            }
            const tab = {
                id: source.id, name: source.name, rows, cols, cells,
                color: color(source.color) ? source.color : null,
                colWidths: axisSizes(source.colWidths, cols), rowHeights: axisSizes(source.rowHeights, rows),
                merges: Array.isArray(source.merges) ? source.merges.filter(range).map(bounds) : [],
                charts: [], cf: []
            };
            if (range(source.filter)) {
                const hidden = Object.fromEntries(Object.entries(isRecord(source.filter.hidden) ? source.filter.hidden : {}).filter(
                    ([key, values]) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < cols && Array.isArray(values)
                ).map(([key, values]) => [key, values.filter(value => typeof value === 'string')]));
                tab.filter = { ...bounds(source.filter), hidden };
            }
            if (isRecord(source.freeze) && validIndex(source.freeze.rows) && validIndex(source.freeze.cols)) {
                tab.freeze = { rows: Math.min(rows - 1, source.freeze.rows), cols: Math.min(cols - 1, source.freeze.cols) };
            }
            for (const chart of Array.isArray(source.charts) ? source.charts : []) {
                if (!isRecord(chart) || !id(chart.id) || !chartTypes.has(chart.type) || typeof chart.range !== 'string' ||
                    !E.parseRangeA1(chart.range.slice(chart.range.lastIndexOf('!') + 1)) ||
                    ![chart.x, chart.y, chart.w, chart.h].every(Number.isFinite)) continue;
                const { type, range, x, y, w, h } = chart;
                tab.charts.push({ id: chart.id, type, range, x, y, w, h, title: typeof chart.title === 'string' ? chart.title : '',
                    headers: chart.headers !== false, labels: chart.labels !== false, legend: chart.legend !== false, seriesInRows: chart.seriesInRows === true });
            }
            for (const rule of Array.isArray(source.cf) ? source.cf : []) {
                if (!isRecord(rule) || !id(rule.id) || typeof rule.type !== 'string' || typeof rule.range !== 'string' || !E.parseRangeA1(rule.range)) continue;
                const validated = { id: rule.id, type: rule.type, range: rule.range };
                for (const key of ['a', 'b']) if (typeof rule[key] === 'string') validated[key] = rule[key];
                for (const key of ['bg', 'fc', 'minColor', 'maxColor']) if (color(rule[key])) validated[key] = rule[key];
                if (rule.bold === true) validated.bold = true;
                tab.cf.push(validated);
            }
            return tab;
        });
        return { title, activeSheet, sheets: workbook };
    }

    root.SheetsFiles = { parseCSV, toCSV, exportXLSX, importXLSX, exportNativeWorkbook, importNativeWorkbook, zipStore, crc32 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
