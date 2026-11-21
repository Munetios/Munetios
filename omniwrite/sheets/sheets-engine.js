/*
 * OmniWrite Sheets formula engine
 *
 * - Cell values are stored as the text the user typed ("=SUM(A1:A3)", "12%", "hello").
 * - parseLiteral() turns typed text into a typed value plus an inferred display format.
 * - createEvaluator() evaluates formulas lazily with memoization and cycle detection.
 * - Ranges are matrices; binary operators broadcast over them (for SUMPRODUCT and friends).
 * - Dates are serial numbers (days since 1899-12-30), like other spreadsheet apps.
 * - Reference helpers shift formulas for copy/fill and rewrite them for row/column inserts.
 * No DOM access: this file also runs in Node for tests.
 */
(function (root) {
    'use strict';

    /* ------------------------------------------------------------ errors */
    class SheetError {
        constructor(code) { this.code = code; }
        toString() { return this.code; }
    }
    const ERR = {
        DIV0: new SheetError('#DIV/0!'), VALUE: new SheetError('#VALUE!'), REF: new SheetError('#REF!'),
        NAME: new SheetError('#NAME?'), NA: new SheetError('#N/A'), NUM: new SheetError('#NUM!'),
        ERROR: new SheetError('#ERROR!'), CYCLE: new SheetError('#CYCLE!')
    };
    const isErr = v => v instanceof SheetError;
    const errorFromCode = code => Object.values(ERR).find(e => e.code === code) || ERR.ERROR;

    /* ------------------------------------------------------------ addressing */
    function colName(index) {
        let name = '';
        let n = index + 1;
        while (n > 0) { const m = (n - 1) % 26; name = String.fromCharCode(65 + m) + name; n = Math.floor((n - 1) / 26); }
        return name;
    }
    function colIndex(name) {
        let n = 0;
        for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n - 1;
    }
    const cellKey = (r, c) => r + ':' + c;
    const refName = (r, c) => colName(c) + (r + 1);
    function parseA1(text) {
        const m = /^\s*\$?([A-Za-z]{1,4})\$?(\d{1,7})\s*$/.exec(String(text || ''));
        if (!m) return null;
        const r = Number(m[2]) - 1;
        if (r < 0) return null;
        return { r, c: colIndex(m[1]) };
    }
    function parseRangeA1(text) {
        const parts = String(text || '').split(':');
        if (parts.length === 1) { const a = parseA1(parts[0]); return a ? { r1: a.r, c1: a.c, r2: a.r, c2: a.c } : null; }
        if (parts.length !== 2) return null;
        const a = parseA1(parts[0]), b = parseA1(parts[1]);
        if (!a || !b) return null;
        return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
    }
    function rangeName(range) {
        const a = refName(range.r1, range.c1), b = refName(range.r2, range.c2);
        return a === b ? a : a + ':' + b;
    }
    const needsQuote = name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^[A-Za-z]{1,4}\d+$/.test(name);
    const quoteSheet = name => (needsQuote(name) ? "'" + String(name).replace(/'/g, "''") + "'" : name);

    /* ------------------------------------------------------------ dates */
    const EPOCH = Date.UTC(1899, 11, 30);
    const DAY = 86400000;
    const dateToSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
    function serialToDate(serial) { return new Date(EPOCH + Math.round(serial * DAY)); }
    function nowSerial() {
        const now = new Date();
        return (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()) - EPOCH) / DAY;
    }
    function todaySerial() { const now = new Date(); return dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate()); }

    /* ------------------------------------------------------------ literals */
    // Returns { value, fmt } where fmt is an inferred format for automatic display (or null).
    function parseLiteral(input) {
        if (input === null || input === undefined) return { value: null, fmt: null };
        const text = String(input);
        if (text === '') return { value: null, fmt: null };
        if (text[0] === "'") return { value: text.slice(1), fmt: null };
        const t = text.trim();
        if (/^(true|false)$/i.test(t)) return { value: t.toLowerCase() === 'true', fmt: null };
        if (/^#(DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|ERROR!)$/i.test(t)) return { value: errorFromCode(t.toUpperCase()), fmt: null };
        // Plain numbers, thousands separators, scientific notation.
        let m = /^([+-]?)(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?(e[+-]?\d+)?$/i.exec(t);
        if (m && (m[2] || m[4])) {
            const value = Number((m[1] || '') + (m[2] || '0').replace(/,/g, '') + (m[4] || '') + (m[5] || ''));
            if (Number.isFinite(value)) return { value, fmt: m[3] ? { t: 'number', d: decimalsOf(m[4]) } : m[5] ? { t: 'scientific', d: 2 } : null };
        }
        // Percent.
        m = /^([+-]?\d+(?:\.\d+)?)\s*%$/.exec(t);
        if (m) return { value: Number(m[1]) / 100, fmt: { t: 'percent', d: decimalsOf((m[1].split('.')[1] ? '.' + m[1].split('.')[1] : '')) } };
        // Currency with a leading symbol.
        m = /^([+-]?)([$€£¥₹₩])\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(t);
        if (m) return { value: Number((m[1] || '') + m[3].replace(/,/g, '') + (m[4] || '')), fmt: { t: 'currency', d: m[4] ? m[4].length - 1 : 0, cur: m[2] } };
        // ISO dates and date-times.
        m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
        if (m && validDate(+m[1], +m[2], +m[3])) {
            const serial = dateToSerial(+m[1], +m[2], +m[3]) + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +(m[6] || 0)) / 86400 : 0);
            return { value: serial, fmt: { t: m[4] ? 'datetime' : 'date' } };
        }
        // Month/day/year (US style, as typed in this app's default input).
        m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
        if (m && validDate(+m[3], +m[1], +m[2])) return { value: dateToSerial(+m[3], +m[1], +m[2]), fmt: { t: 'date' } };
        // Times: 9:30, 14:05:10, 9:30 NM / AN (also AM / PM).
        m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(NM|AN|AM|PM)?$/i.exec(t);
        if (m) {
            let h = +m[1];
            const suffix = (m[4] || '').toUpperCase();
            if (suffix && (h < 1 || h > 12)) return { value: text, fmt: null };
            if (suffix === 'AN' || suffix === 'PM') h = h % 12 + 12;
            else if (suffix === 'NM' || suffix === 'AM') h = h % 12;
            if (h < 24 && +m[2] < 60 && +(m[3] || 0) < 60) return { value: (h * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400, fmt: { t: 'time' } };
        }
        return { value: text, fmt: null };
    }
    const decimalsOf = frac => (frac ? Math.min(10, frac.length - 1) : 0);
    function validDate(y, m, d) {
        if (m < 1 || m > 12 || d < 1) return false;
        return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
    }

    /* ------------------------------------------------------------ tokenizer */
    const CELL_RE = /^(\$?)([A-Za-z]{1,4})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/;
    const COLRANGE_RE = /^(\$?)([A-Za-z]{1,4}):(\$?)([A-Za-z]{1,4})(?![A-Za-z0-9_(])/;
    const ROWRANGE_RE = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![0-9.])/;
    function tokenize(src) {
        const tokens = [];
        let i = 0;
        const push = (type, value, start, extra) => tokens.push(Object.assign({ type, value, start, end: i }, extra));
        while (i < src.length) {
            const ch = src[i];
            const start = i;
            if (/\s/.test(ch)) { i++; continue; }
            if (ch === '"') {
                let s = ''; i++;
                while (i < src.length) {
                    if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } break; }
                    s += src[i++];
                }
                if (src[i] !== '"') throw new SyntaxError('string');
                i++; push('str', s, start); continue;
            }
            // Sheet prefix: 'My Sheet'! or Sheet1!
            let sheet = null;
            const rest = src.slice(i);
            let pm = /^'((?:[^']|'')+)'!/.exec(rest) || /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(rest);
            if (pm) { sheet = pm[1].replace(/''/g, "'"); i += pm[0].length; }
            const after = src.slice(i);
            let m;
            if ((m = COLRANGE_RE.exec(after))) {
                i += m[0].length;
                push('colrange', m[0], start, { sheet, c1: colIndex(m[2]), c2: colIndex(m[4]), abs1: !!m[1], abs2: !!m[3] }); continue;
            }
            if ((m = CELL_RE.exec(after))) {
                i += m[0].length;
                push('cell', m[0], start, { sheet, c: colIndex(m[2]), r: Number(m[4]) - 1, absC: !!m[1], absR: !!m[3] }); continue;
            }
            if (sheet !== null && (m = ROWRANGE_RE.exec(after))) {
                i += m[0].length;
                push('rowrange', m[0], start, { sheet, r1: Number(m[2]) - 1, r2: Number(m[4]) - 1, abs1: !!m[1], abs2: !!m[3] }); continue;
            }
            if (sheet === null && (m = ROWRANGE_RE.exec(after)) && !/^\d+:\d+:/.test(after)) {
                i += m[0].length;
                push('rowrange', m[0], start, { sheet, r1: Number(m[2]) - 1, r2: Number(m[4]) - 1, abs1: !!m[1], abs2: !!m[3] }); continue;
            }
            if (sheet !== null) {
                if (/^#REF!/i.test(after)) { i += 5; push('err', '#REF!', start); continue; }
                throw new SyntaxError('ref');
            }
            if ((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(after))) { i += m[0].length; push('num', Number(m[0]), start); continue; }
            if ((m = /^#(DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|ERROR!|CYCLE!)/i.exec(after))) { i += m[0].length; push('err', m[0].toUpperCase(), start); continue; }
            if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(after))) { i += m[0].length; push('name', m[0], start); continue; }
            const two = src.substr(i, 2);
            if (two === '<=' || two === '>=' || two === '<>') { i += 2; push('op', two, start); continue; }
            if ('+-*/^&=<>%:'.includes(ch)) { i++; push('op', ch, start); continue; }
            if (ch === '(' || ch === ')' || ch === ',' || ch === ';') { i++; push(ch === ';' ? ',' : ch, ch, start); continue; }
            if (ch === '{' || ch === '}') { i++; push(ch, ch, start); continue; }
            throw new SyntaxError('char ' + ch);
        }
        return tokens;
    }

    /* ------------------------------------------------------------ parser */
    function parseFormula(src) {
        const tokens = tokenize(src);
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];
        const isOp = (t, ops) => t && t.type === 'op' && ops.includes(t.value);
        function expect(type) { const t = next(); if (!t || t.type !== type) throw new SyntaxError('expected ' + type); return t; }
        function comparison() {
            let left = concat();
            while (isOp(peek(), ['=', '<>', '<', '>', '<=', '>='])) { const op = next().value; left = { k: 'bin', op, a: left, b: concat() }; }
            return left;
        }
        function concat() {
            let left = additive();
            while (isOp(peek(), ['&'])) { next(); left = { k: 'bin', op: '&', a: left, b: additive() }; }
            return left;
        }
        function additive() {
            let left = multiplicative();
            while (isOp(peek(), ['+', '-'])) { const op = next().value; left = { k: 'bin', op, a: left, b: multiplicative() }; }
            return left;
        }
        function multiplicative() {
            let left = power();
            while (isOp(peek(), ['*', '/'])) { const op = next().value; left = { k: 'bin', op, a: left, b: power() }; }
            return left;
        }
        function power() {
            let left = unary();
            while (isOp(peek(), ['^'])) { next(); left = { k: 'bin', op: '^', a: left, b: unary() }; }
            return left;
        }
        function unary() {
            if (isOp(peek(), ['-', '+'])) { const op = next().value; const v = unary(); return op === '-' ? { k: 'neg', a: v } : v; }
            return postfix();
        }
        function postfix() {
            let v = range();
            while (isOp(peek(), ['%'])) { next(); v = { k: 'pct', a: v }; }
            return v;
        }
        function range() {
            let left = primary();
            while (isOp(peek(), [':'])) {
                next();
                const right = primary();
                if (left.k !== 'ref' || right.k !== 'ref') throw new SyntaxError('range');
                left = { k: 'range', sheet: left.sheet, r1: left.r, c1: left.c, r2: right.r, c2: right.c };
            }
            return left;
        }
        function primary() {
            const t = next();
            if (!t) throw new SyntaxError('eof');
            switch (t.type) {
                case 'num': return { k: 'num', v: t.value };
                case 'str': return { k: 'str', v: t.value };
                case 'err': return { k: 'err', v: errorFromCode(t.value) };
                case 'cell': return { k: 'ref', sheet: t.sheet, r: t.r, c: t.c };
                case 'colrange': return { k: 'range', sheet: t.sheet, r1: 0, c1: Math.min(t.c1, t.c2), r2: Infinity, c2: Math.max(t.c1, t.c2) };
                case 'rowrange': return { k: 'range', sheet: t.sheet, r1: Math.min(t.r1, t.r2), c1: 0, r2: Math.max(t.r1, t.r2), c2: Infinity };
                case '(': { const e = comparison(); expect(')'); return e; }
                case '{': {
                    const rows = [[]];
                    while (peek() && peek().type !== '}') {
                        const tk = peek();
                        if (tk.type === ',') { next(); continue; }
                        if (tk.type === 'op' && tk.value === ';') { next(); rows.push([]); continue; }
                        const node = unary();
                        rows[rows.length - 1].push(node);
                    }
                    expect('}');
                    return { k: 'array', rows };
                }
                case 'name': {
                    const upper = t.value.toUpperCase();
                    if (peek() && peek().type === '(') {
                        next();
                        const args = [];
                        if (peek() && peek().type !== ')') {
                            for (;;) {
                                if (peek() && (peek().type === ',' || peek().type === ')')) args.push({ k: 'blank' });
                                else args.push(comparison());
                                if (peek() && peek().type === ',') { next(); continue; }
                                break;
                            }
                        }
                        expect(')');
                        return { k: 'fn', name: upper, args };
                    }
                    if (upper === 'TRUE') return { k: 'bool', v: true };
                    if (upper === 'FALSE') return { k: 'bool', v: false };
                    return { k: 'err', v: ERR.NAME };
                }
                default: throw new SyntaxError('unexpected ' + t.value);
            }
        }
        const ast = comparison();
        if (pos < tokens.length) throw new SyntaxError('trailing');
        return ast;
    }

    /* ------------------------------------------------------------ coercion */
    const isMatrix = v => v && v.matrix === true;
    const matrix = rows => ({ matrix: true, rows });
    function scalar(v) {
        if (isMatrix(v)) return v.rows.length && v.rows[0].length ? v.rows[0][0] : null;
        return v;
    }
    function toNumber(v) {
        v = scalar(v);
        if (isErr(v)) return v;
        if (v === null || v === undefined || v === '') return 0;
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return v ? 1 : 0;
        const parsed = parseLiteral(String(v));
        if (typeof parsed.value === 'number') return parsed.value;
        return ERR.VALUE;
    }
    function toText(v) {
        v = scalar(v);
        if (isErr(v)) return v;
        if (v === null || v === undefined) return '';
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        if (typeof v === 'number') return formatGeneral(v);
        return String(v);
    }
    function toBool(v) {
        v = scalar(v);
        if (isErr(v)) return v;
        if (v === null || v === undefined || v === '') return false;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        const s = String(v).toUpperCase();
        if (s === 'TRUE') return true;
        if (s === 'FALSE') return false;
        return ERR.VALUE;
    }
    function formatGeneral(n) {
        if (!Number.isFinite(n)) return String(n);
        if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
        const abs = Math.abs(n);
        if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, 'e');
        return String(Number(n.toPrecision(15)));
    }
    // Flatten arguments into a list of values (ranges contribute every cell).
    function flatten(args, { skipEmpty = true } = {}) {
        const out = [];
        const walk = v => {
            if (isMatrix(v)) { for (const row of v.rows) for (const x of row) if (!(skipEmpty && (x === null || x === undefined))) out.push({ v: x, fromRange: true }); }
            else out.push({ v: v === BLANK ? null : v, fromRange: false });
        };
        args.forEach(walk);
        return out;
    }
    // Numbers for aggregate functions: range text/booleans are ignored, direct arguments are coerced.
    function numbers(args) {
        const out = [];
        for (const { v, fromRange } of flatten(args)) {
            if (isErr(v)) return v;
            if (typeof v === 'number') out.push(v);
            else if (!fromRange) {
                if (v === null || v === undefined) continue;
                const n = toNumber(v);
                if (isErr(n)) return n;
                out.push(n);
            }
        }
        return out;
    }
    function toMatrix(v) {
        if (isMatrix(v)) return v.rows;
        return [[v]];
    }

    /* ------------------------------------------------------------ criteria */
    function makeCriteria(crit) {
        crit = scalar(crit);
        if (typeof crit === 'number' || typeof crit === 'boolean') return v => scalar(v) === crit || (typeof crit === 'number' && toNumber(v) === crit && v !== null && v !== '' && typeof v !== 'boolean');
        let s = crit === null || crit === undefined ? '' : String(crit);
        let op = '=';
        const m = /^(<=|>=|<>|=|<|>)(.*)$/s.exec(s);
        if (m) { op = m[1]; s = m[2]; }
        const lit = parseLiteral(s);
        const target = s === '' ? null : lit.value;
        if (typeof target === 'number') {
            return v => {
                v = scalar(v);
                if (v === null || v === '' || typeof v === 'boolean') return op === '<>';
                const n = typeof v === 'number' ? v : toNumber(v);
                if (isErr(n)) return op === '<>';
                switch (op) { case '=': return n === target; case '<>': return n !== target; case '<': return n < target; case '>': return n > target; case '<=': return n <= target; case '>=': return n >= target; }
                return false;
            };
        }
        if (target === null) {
            return v => { v = scalar(v); const empty = v === null || v === undefined || v === ''; return op === '<>' ? !empty : empty; };
        }
        const needle = String(target).toLowerCase();
        const wildcard = /[*?]/.test(needle);
        const re = wildcard ? new RegExp('^' + needle.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 's') : null;
        return v => {
            v = scalar(v);
            const text = toText(v);
            const hay = isErr(text) ? '' : text.toLowerCase();
            if (op === '=' || op === '<>') {
                const eq = re ? re.test(hay) : hay === needle;
                return op === '=' ? eq : !eq;
            }
            if (typeof v !== 'string') return false;
            const cmp = hay.localeCompare(needle);
            switch (op) { case '<': return cmp < 0; case '>': return cmp > 0; case '<=': return cmp <= 0; case '>=': return cmp >= 0; }
            return false;
        };
    }

    /* ------------------------------------------------------------ comparison */
    function compareValues(a, b) {
        const rank = v => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);
        const empty = v => v === null || v === undefined;
        if (empty(a)) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
        if (empty(b)) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (typeof a === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
        if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
        return a < b ? -1 : a > b ? 1 : 0;
    }

    /* ------------------------------------------------------------ functions */
    const F = {};
    const def = (names, fn, opts = {}) => names.split(' ').forEach(n => { F[n] = Object.assign(fn, opts); });
    const num1 = fn => (args) => { if (args.length < 1) return ERR.NA; const n = toNumber(args[0]); return isErr(n) ? n : finite(fn(n, args)); };
    const finite = v => (typeof v === 'number' && !Number.isFinite(v) ? ERR.NUM : v);
    const argN = (args, i, fallback) => (args.length > i && args[i] !== undefined && args[i] !== BLANK ? toNumber(args[i]) : fallback);
    const BLANK = Symbol('blank');
    function firstErr(...vals) { for (const v of vals) if (isErr(v)) return v; return null; }
    function roundTo(n, digits) {
        const f = Math.pow(10, digits);
        const x = Math.abs(n) * f;
        const r = Math.round(x + 1e-9 * Math.max(1, x));
        return Math.sign(n) * r / f;
    }

    // Math & aggregates
    def('SUM', args => { const ns = numbers(args); return isErr(ns) ? ns : ns.reduce((a, b) => a + b, 0); });
    def('AVERAGE', args => { const ns = numbers(args); if (isErr(ns)) return ns; return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : ERR.DIV0; });
    def('MIN', args => { const ns = numbers(args); return isErr(ns) ? ns : ns.length ? Math.min(...ns) : 0; });
    def('MAX', args => { const ns = numbers(args); return isErr(ns) ? ns : ns.length ? Math.max(...ns) : 0; });
    def('COUNT', args => flatten(args).filter(({ v, fromRange }) => typeof v === 'number' || (!fromRange && !isErr(toNumber(v)) && v !== null && typeof v !== 'boolean')).length);
    def('COUNTA', args => flatten(args).filter(({ v }) => v !== null && v !== undefined && v !== '').length);
    def('COUNTBLANK', args => flatten(args, { skipEmpty: false }).filter(({ v }) => v === null || v === undefined || v === '').length);
    def('PRODUCT', args => { const ns = numbers(args); return isErr(ns) ? ns : ns.reduce((a, b) => a * b, 1); });
    def('ABS', num1(Math.abs));
    def('SQRT', num1(n => (n < 0 ? ERR.NUM : Math.sqrt(n))));
    def('EXP', num1(Math.exp));
    def('LN', num1(n => (n <= 0 ? ERR.NUM : Math.log(n))));
    def('LOG10', num1(n => (n <= 0 ? ERR.NUM : Math.log10(n))));
    def('LOG', args => { const n = toNumber(args[0]); const b = argN(args, 1, 10); return firstErr(n, b) || (n <= 0 || b <= 0 || b === 1 ? ERR.NUM : Math.log(n) / Math.log(b)); });
    def('SIGN', num1(Math.sign));
    def('INT', num1(Math.floor));
    def('PI', () => Math.PI);
    def('SIN', num1(Math.sin)); def('COS', num1(Math.cos)); def('TAN', num1(Math.tan));
    def('ASIN', num1(Math.asin)); def('ACOS', num1(Math.acos)); def('ATAN', num1(Math.atan));
    def('ATAN2', args => { const x = toNumber(args[0]), y = toNumber(args[1]); return firstErr(x, y) || Math.atan2(y, x); });
    def('DEGREES', num1(n => n * 180 / Math.PI)); def('RADIANS', num1(n => n * Math.PI / 180));
    def('POWER', args => { const a = toNumber(args[0]), b = toNumber(args[1]); return firstErr(a, b) || finite(Math.pow(a, b)); });
    def('MOD', args => { const a = toNumber(args[0]), b = toNumber(args[1]); if (firstErr(a, b)) return firstErr(a, b); if (b === 0) return ERR.DIV0; return a - b * Math.floor(a / b); });
    def('QUOTIENT', args => { const a = toNumber(args[0]), b = toNumber(args[1]); if (firstErr(a, b)) return firstErr(a, b); if (b === 0) return ERR.DIV0; return Math.trunc(a / b); });
    def('ROUND', args => { const n = toNumber(args[0]), d = argN(args, 1, 0); return firstErr(n, d) || roundTo(n, Math.trunc(d)); });
    def('ROUNDUP', args => { const n = toNumber(args[0]), d = argN(args, 1, 0); if (firstErr(n, d)) return firstErr(n, d); const f = Math.pow(10, Math.trunc(d)); return Math.sign(n) * Math.ceil(Math.abs(n) * f - 1e-9) / f; });
    def('ROUNDDOWN', args => { const n = toNumber(args[0]), d = argN(args, 1, 0); if (firstErr(n, d)) return firstErr(n, d); const f = Math.pow(10, Math.trunc(d)); return Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-9) / f; });
    def('TRUNC', args => { const n = toNumber(args[0]), d = argN(args, 1, 0); if (firstErr(n, d)) return firstErr(n, d); const f = Math.pow(10, Math.trunc(d)); return Math.trunc(n * f) / f; });
    def('CEILING', args => { const n = toNumber(args[0]), s = argN(args, 1, 1); if (firstErr(n, s)) return firstErr(n, s); if (s === 0) return 0; return Math.ceil(n / s - 1e-9) * s; });
    def('FLOOR', args => { const n = toNumber(args[0]), s = argN(args, 1, 1); if (firstErr(n, s)) return firstErr(n, s); if (s === 0) return ERR.DIV0; return Math.floor(n / s + 1e-9) * s; });
    def('MROUND', args => { const n = toNumber(args[0]), s = toNumber(args[1]); if (firstErr(n, s)) return firstErr(n, s); if (s === 0) return 0; return Math.round(n / s) * s; });
    def('EVEN', num1(n => { const r = Math.ceil(Math.abs(n) / 2) * 2; return Math.sign(n) * r; }));
    def('ODD', num1(n => { let r = Math.ceil(Math.abs(n)); if (r % 2 === 0) r++; return (n < 0 ? -1 : 1) * r; }));
    def('FACT', num1(n => { if (n < 0) return ERR.NUM; let r = 1; for (let i = 2; i <= Math.floor(n); i++) r *= i; return r; }));
    def('GCD', args => { const ns = numbers(args); if (isErr(ns)) return ns; const g = (a, b) => (b ? g(b, a % b) : a); return ns.map(n => Math.floor(Math.abs(n))).reduce((a, b) => g(a, b), 0); });
    def('LCM', args => { const ns = numbers(args); if (isErr(ns)) return ns; const g = (a, b) => (b ? g(b, a % b) : a); return ns.map(n => Math.floor(Math.abs(n))).reduce((a, b) => (a === 0 || b === 0 ? 0 : a * b / g(a, b)), 1); });
    def('RAND', () => Math.random(), { volatile: true });
    def('RANDBETWEEN', args => { const a = toNumber(args[0]), b = toNumber(args[1]); if (firstErr(a, b)) return firstErr(a, b); const lo = Math.ceil(a), hi = Math.floor(b); if (hi < lo) return ERR.NUM; return lo + Math.floor(Math.random() * (hi - lo + 1)); }, { volatile: true });
    def('SUMSQ', args => { const ns = numbers(args); return isErr(ns) ? ns : ns.reduce((a, b) => a + b * b, 0); });
    def('SUMPRODUCT', args => {
        if (!args.length) return ERR.VALUE;
        const ms = args.map(toMatrix);
        const rows = ms[0].length, cols = ms[0][0].length;
        if (ms.some(m => m.length !== rows || m[0].length !== cols)) return ERR.VALUE;
        let total = 0;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            let p = 1;
            for (const m of ms) { const v = m[r][c]; if (isErr(v)) return v; p *= typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0; }
            total += p;
        }
        return total;
    });

    // Statistics
    const sorted = ns => [...ns].sort((a, b) => a - b);
    def('MEDIAN', args => { const ns = numbers(args); if (isErr(ns)) return ns; if (!ns.length) return ERR.NUM; const s = sorted(ns), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; });
    def('MODE MODE.SNGL', args => { const ns = numbers(args); if (isErr(ns)) return ns; const counts = new Map(); let best = null, bestN = 1; for (const n of ns) { const c = (counts.get(n) || 0) + 1; counts.set(n, c); if (c > bestN) { bestN = c; best = n; } } return best === null ? ERR.NA : best; });
    const variance = (ns, sample) => { const mean = ns.reduce((a, b) => a + b, 0) / ns.length; return ns.reduce((a, b) => a + (b - mean) ** 2, 0) / (ns.length - (sample ? 1 : 0)); };
    def('VAR VAR.S', args => { const ns = numbers(args); if (isErr(ns)) return ns; return ns.length < 2 ? ERR.DIV0 : variance(ns, true); });
    def('VARP VAR.P', args => { const ns = numbers(args); if (isErr(ns)) return ns; return ns.length < 1 ? ERR.DIV0 : variance(ns, false); });
    def('STDEV STDEV.S', args => { const ns = numbers(args); if (isErr(ns)) return ns; return ns.length < 2 ? ERR.DIV0 : Math.sqrt(variance(ns, true)); });
    def('STDEVP STDEV.P', args => { const ns = numbers(args); if (isErr(ns)) return ns; return ns.length < 1 ? ERR.DIV0 : Math.sqrt(variance(ns, false)); });
    def('LARGE', args => { const ns = numbers([args[0]]), k = toNumber(args[1]); if (firstErr(ns, k)) return firstErr(ns, k); const s = sorted(ns).reverse(); return k >= 1 && k <= s.length ? s[Math.ceil(k) - 1] : ERR.NUM; });
    def('SMALL', args => { const ns = numbers([args[0]]), k = toNumber(args[1]); if (firstErr(ns, k)) return firstErr(ns, k); const s = sorted(ns); return k >= 1 && k <= s.length ? s[Math.ceil(k) - 1] : ERR.NUM; });
    def('RANK RANK.EQ', args => { const n = toNumber(args[0]), ns = numbers([args[1]]), order = argN(args, 2, 0); if (firstErr(n, ns, order)) return firstErr(n, ns, order); if (!ns.includes(n)) return ERR.NA; return (order ? ns.filter(x => x < n) : ns.filter(x => x > n)).length + 1; });
    def('PERCENTILE PERCENTILE.INC', args => { const ns = numbers([args[0]]), k = toNumber(args[1]); if (firstErr(ns, k)) return firstErr(ns, k); if (!ns.length || k < 0 || k > 1) return ERR.NUM; const s = sorted(ns), idx = k * (s.length - 1), lo = Math.floor(idx); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (idx - lo); });
    def('QUARTILE QUARTILE.INC', args => { const q = toNumber(args[1]); if (isErr(q)) return q; if (q < 0 || q > 4) return ERR.NUM; return F.PERCENTILE([args[0], Math.floor(q) / 4]); });
    def('CORREL', args => { const a = numbers([args[0]]), b = numbers([args[1]]); if (firstErr(a, b)) return firstErr(a, b); if (a.length !== b.length || a.length < 2) return ERR.DIV0; const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length; let num = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? num / Math.sqrt(da * db) : ERR.DIV0; });

    // Conditional aggregates
    function pairs(args, start) {
        const out = [];
        for (let i = start; i + 1 < args.length; i += 2) out.push({ range: toMatrix(args[i]), test: makeCriteria(args[i + 1]) });
        return out;
    }
    function conditional(valueRange, conditions) {
        const vm = valueRange ? toMatrix(valueRange) : conditions[0].range;
        const rows = vm.length, cols = vm[0].length;
        const picked = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (conditions.every(cond => cond.test(cond.range[r] ? cond.range[r][c] : null))) picked.push(vm[r][c]);
        }
        return picked;
    }
    const sumOf = vals => vals.reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0);
    def('COUNTIF', args => conditional(null, [{ range: toMatrix(args[0]), test: makeCriteria(args[1]) }]).length);
    def('COUNTIFS', args => conditional(null, pairs(args, 0)).length);
    def('SUMIF', args => sumOf(conditional(args.length > 2 && args[2] !== BLANK ? args[2] : args[0], [{ range: toMatrix(args[0]), test: makeCriteria(args[1]) }])));
    def('SUMIFS', args => sumOf(conditional(args[0], pairs(args, 1))));
    def('AVERAGEIF', args => { const v = conditional(args.length > 2 && args[2] !== BLANK ? args[2] : args[0], [{ range: toMatrix(args[0]), test: makeCriteria(args[1]) }]).filter(x => typeof x === 'number'); return v.length ? sumOf(v) / v.length : ERR.DIV0; });
    def('AVERAGEIFS', args => { const v = conditional(args[0], pairs(args, 1)).filter(x => typeof x === 'number'); return v.length ? sumOf(v) / v.length : ERR.DIV0; });
    def('MAXIFS', args => { const v = conditional(args[0], pairs(args, 1)).filter(x => typeof x === 'number'); return v.length ? Math.max(...v) : 0; });
    def('MINIFS', args => { const v = conditional(args[0], pairs(args, 1)).filter(x => typeof x === 'number'); return v.length ? Math.min(...v) : 0; });

    // Logic (IF-family arguments are evaluated lazily by the evaluator)
    def('AND', args => { let any = false; for (const { v, fromRange } of flatten(args)) { if (fromRange && typeof v === 'string') continue; const b = toBool(v); if (isErr(b)) return b; any = true; if (!b) return false; } return any ? true : ERR.VALUE; });
    def('OR', args => { let any = false; for (const { v, fromRange } of flatten(args)) { if (fromRange && typeof v === 'string') continue; const b = toBool(v); if (isErr(b)) return b; any = true; if (b) return true; } return any ? false : ERR.VALUE; });
    def('XOR', args => { let count = 0; for (const { v, fromRange } of flatten(args)) { if (fromRange && typeof v === 'string') continue; const b = toBool(v); if (isErr(b)) return b; if (b) count++; } return count % 2 === 1; });
    def('NOT', args => { const b = toBool(args[0]); return isErr(b) ? b : !b; });
    def('TRUE', () => true); def('FALSE', () => false);
    def('NA', () => ERR.NA);

    // Information
    def('ISBLANK', args => { const v = scalar(args[0]); return v === null || v === undefined; });
    def('ISNUMBER', args => typeof scalar(args[0]) === 'number');
    def('ISTEXT', args => typeof scalar(args[0]) === 'string');
    def('ISNONTEXT', args => typeof scalar(args[0]) !== 'string');
    def('ISLOGICAL', args => typeof scalar(args[0]) === 'boolean');
    def('ISERROR', args => isErr(scalar(args[0])));
    def('ISERR', args => isErr(scalar(args[0])) && scalar(args[0]) !== ERR.NA);
    def('ISNA', args => scalar(args[0]) === ERR.NA);
    def('ISEVEN', args => { const n = toNumber(args[0]); return isErr(n) ? n : Math.trunc(n) % 2 === 0; });
    def('ISODD', args => { const n = toNumber(args[0]); return isErr(n) ? n : Math.abs(Math.trunc(n)) % 2 === 1; });
    def('N', args => { const v = scalar(args[0]); return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : isErr(v) ? v : 0; });
    def('TYPE', args => { const v = args[0]; if (isMatrix(v)) return 64; const s = scalar(v); return typeof s === 'number' || s === null ? 1 : typeof s === 'string' ? 2 : typeof s === 'boolean' ? 4 : 16; });

    // Text
    const txt1 = fn => args => { const s = toText(args[0]); return isErr(s) ? s : fn(s, args); };
    def('CONCAT CONCATENATE', args => { let out = ''; for (const { v } of flatten(args)) { const s = toText(v); if (isErr(s)) return s; out += s; } return out; });
    def('TEXTJOIN', args => {
        const delim = toText(args[0]), ignore = toBool(args[1]);
        if (firstErr(delim, ignore)) return firstErr(delim, ignore);
        const parts = [];
        for (const { v } of flatten(args.slice(2), { skipEmpty: false })) { const s = toText(v); if (isErr(s)) return s; if (ignore && s === '') continue; parts.push(s); }
        return parts.join(delim);
    });
    def('LEN', txt1(s => [...s].length));
    def('LEFT', txt1((s, a) => { const n = argN(a, 1, 1); return isErr(n) ? n : n < 0 ? ERR.VALUE : [...s].slice(0, Math.floor(n)).join(''); }));
    def('RIGHT', txt1((s, a) => { const n = argN(a, 1, 1); if (isErr(n)) return n; if (n < 0) return ERR.VALUE; const chars = [...s]; return Math.floor(n) === 0 ? '' : chars.slice(-Math.floor(n)).join(''); }));
    def('MID', txt1((s, a) => { const st = toNumber(a[1]), n = toNumber(a[2]); if (firstErr(st, n)) return firstErr(st, n); if (st < 1 || n < 0) return ERR.VALUE; return [...s].slice(Math.floor(st) - 1, Math.floor(st) - 1 + Math.floor(n)).join(''); }));
    def('UPPER', txt1(s => s.toUpperCase()));
    def('LOWER', txt1(s => s.toLowerCase()));
    def('PROPER', txt1(s => s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())));
    def('TRIM', txt1(s => s.replace(/ +/g, ' ').trim()));
    def('CLEAN', txt1(s => s.replace(/[\x00-\x1f]/g, '')));
    def('REPT', txt1((s, a) => { const n = toNumber(a[1]); return isErr(n) ? n : n < 0 ? ERR.VALUE : s.repeat(Math.floor(n)); }));
    def('EXACT', args => { const a = toText(args[0]), b = toText(args[1]); return firstErr(a, b) || a === b; });
    def('SUBSTITUTE', args => {
        const s = toText(args[0]), find = toText(args[1]), rep = toText(args[2]);
        if (firstErr(s, find, rep)) return firstErr(s, find, rep);
        if (find === '') return s;
        if (args.length > 3) {
            const which = toNumber(args[3]); if (isErr(which)) return which;
            let idx = -1;
            for (let i = 0; i < which; i++) { idx = s.indexOf(find, idx + 1); if (idx < 0) return s; }
            return s.slice(0, idx) + rep + s.slice(idx + find.length);
        }
        return s.split(find).join(rep);
    });
    def('REPLACE', args => { const s = toText(args[0]), st = toNumber(args[1]), n = toNumber(args[2]), rep = toText(args[3]); if (firstErr(s, st, n, rep)) return firstErr(s, st, n, rep); return s.slice(0, st - 1) + rep + s.slice(st - 1 + n); });
    def('FIND', args => { const f = toText(args[0]), s = toText(args[1]), st = argN(args, 2, 1); if (firstErr(f, s, st)) return firstErr(f, s, st); const i = s.indexOf(f, st - 1); return i < 0 ? ERR.VALUE : i + 1; });
    def('SEARCH', args => {
        const f = toText(args[0]), s = toText(args[1]), st = argN(args, 2, 1);
        if (firstErr(f, s, st)) return firstErr(f, s, st);
        const re = new RegExp(f.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
        const m = re.exec(s.slice(st - 1));
        return m ? m.index + st : ERR.VALUE;
    });
    def('CHAR', num1(n => String.fromCodePoint(Math.floor(n))));
    def('UNICHAR', num1(n => String.fromCodePoint(Math.floor(n))));
    def('CODE UNICODE', txt1(s => (s.length ? s.codePointAt(0) : ERR.VALUE)));
    def('VALUE', args => { const v = scalar(args[0]); if (typeof v === 'number') return v; const n = toNumber(v); return n; });
    def('T', args => { const v = scalar(args[0]); return typeof v === 'string' ? v : ''; });
    def('TEXT', args => {
        const v = toNumber(args[0]), pattern = toText(args[1]);
        if (firstErr(v, pattern)) return firstErr(v, pattern);
        return formatPattern(v, pattern);
    });
    def('FIXED', args => { const n = toNumber(args[0]), d = argN(args, 1, 2), noCommas = args.length > 2 ? toBool(args[2]) : false; if (firstErr(n, d, noCommas)) return firstErr(n, d, noCommas); return new Intl.NumberFormat('en-US', { minimumFractionDigits: Math.max(0, d), maximumFractionDigits: Math.max(0, d), useGrouping: !noCommas }).format(roundTo(n, d)); });
    def('SPLIT', args => { const s = toText(args[0]), d = toText(args[1]); if (firstErr(s, d)) return firstErr(s, d); return matrix([d === '' ? [s] : s.split(d)]); });

    // Dates
    function parts(serial) { const d = serialToDate(serial); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), date: d }; }
    def('TODAY', () => todaySerial(), { volatile: true, fmt: { t: 'date' } });
    def('NOW', () => nowSerial(), { volatile: true, fmt: { t: 'datetime' } });
    def('DATE', args => { const y = toNumber(args[0]), m = toNumber(args[1]), d = toNumber(args[2]); if (firstErr(y, m, d)) return firstErr(y, m, d); const yy = y < 1900 ? y + 1900 : y; return (Date.UTC(yy, m - 1, d) - EPOCH) / DAY; }, { fmt: { t: 'date' } });
    def('TIME', args => { const h = toNumber(args[0]), m = toNumber(args[1]), s = toNumber(args[2]); if (firstErr(h, m, s)) return firstErr(h, m, s); const v = ((h * 3600 + m * 60 + s) / 86400) % 1; return v < 0 ? v + 1 : v; }, { fmt: { t: 'time' } });
    def('DATEVALUE', args => { const p = parseLiteral(toText(args[0])); return typeof p.value === 'number' && p.fmt && /date/.test(p.fmt.t) ? Math.floor(p.value) : ERR.VALUE; }, { fmt: { t: 'date' } });
    def('TIMEVALUE', args => { const p = parseLiteral(toText(args[0])); return typeof p.value === 'number' && p.fmt && /time/.test(p.fmt.t) ? p.value % 1 : ERR.VALUE; }, { fmt: { t: 'time' } });
    def('YEAR', num1(n => parts(n).y)); def('MONTH', num1(n => parts(n).m)); def('DAY', num1(n => parts(n).d));
    def('HOUR', num1(n => Math.floor(((n % 1) + 1e-9) * 24) % 24));
    def('MINUTE', num1(n => Math.floor(((n % 1) * 1440) + 1e-6) % 60));
    def('SECOND', num1(n => Math.round((n % 1) * 86400) % 60));
    def('WEEKDAY', args => { const n = toNumber(args[0]), type = argN(args, 1, 1); if (firstErr(n, type)) return firstErr(n, type); const wd = parts(n).wd; if (type === 2) return wd === 0 ? 7 : wd; if (type === 3) return wd === 0 ? 6 : wd - 1; return wd + 1; });
    def('WEEKNUM', num1(n => { const p = parts(n); const jan1 = dateToSerial(p.y, 1, 1); const offset = parts(jan1).wd; return Math.floor((Math.floor(n) - jan1 + offset) / 7) + 1; }));
    def('EDATE', args => { const n = toNumber(args[0]), m = toNumber(args[1]); if (firstErr(n, m)) return firstErr(n, m); const p = parts(n); const target = new Date(Date.UTC(p.y, p.m - 1 + Math.trunc(m), 1)); const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate(); return dateToSerial(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(p.d, last)); }, { fmt: { t: 'date' } });
    def('EOMONTH', args => { const n = toNumber(args[0]), m = toNumber(args[1]); if (firstErr(n, m)) return firstErr(n, m); const p = parts(n); return (Date.UTC(p.y, p.m + Math.trunc(m), 0) - EPOCH) / DAY; }, { fmt: { t: 'date' } });
    def('DAYS', args => { const a = toNumber(args[0]), b = toNumber(args[1]); return firstErr(a, b) || Math.floor(a) - Math.floor(b); });
    def('DATEDIF', args => {
        const a = toNumber(args[0]), b = toNumber(args[1]), unit = toText(args[2]);
        if (firstErr(a, b, unit)) return firstErr(a, b, unit);
        if (b < a) return ERR.NUM;
        const pa = parts(a), pb = parts(b);
        let months = (pb.y - pa.y) * 12 + (pb.m - pa.m); if (pb.d < pa.d) months--;
        switch (unit.toUpperCase()) {
            case 'D': return Math.floor(b) - Math.floor(a);
            case 'M': return months;
            case 'Y': return Math.floor(months / 12);
            case 'YM': return months % 12;
            case 'MD': { let d = pb.d - pa.d; if (d < 0) d += new Date(Date.UTC(pb.y, pb.m - 1, 0)).getUTCDate(); return d; }
            case 'YD': { let start = dateToSerial(pb.y, pa.m, pa.d); if (start > b) start = dateToSerial(pb.y - 1, pa.m, pa.d); return Math.floor(b) - start; }
            default: return ERR.NUM;
        }
    });
    def('NETWORKDAYS', args => {
        const a = toNumber(args[0]), b = toNumber(args[1]);
        if (firstErr(a, b)) return firstErr(a, b);
        const holidays = new Set(args[2] ? numbers([args[2]]).map(Math.floor) : []);
        const lo = Math.floor(Math.min(a, b)), hi = Math.floor(Math.max(a, b));
        let count = 0;
        for (let d = lo; d <= hi; d++) { const wd = parts(d).wd; if (wd !== 0 && wd !== 6 && !holidays.has(d)) count++; }
        return a <= b ? count : -count;
    });
    def('WORKDAY', args => {
        const a = toNumber(args[0]), n = toNumber(args[1]);
        if (firstErr(a, n)) return firstErr(a, n);
        const holidays = new Set(args[2] ? numbers([args[2]]).map(Math.floor) : []);
        let d = Math.floor(a), left = Math.abs(Math.trunc(n)); const step = n < 0 ? -1 : 1;
        while (left > 0) { d += step; const wd = parts(d).wd; if (wd !== 0 && wd !== 6 && !holidays.has(d)) left--; }
        return d;
    }, { fmt: { t: 'date' } });

    // Lookup
    function lookupIndex(needle, list, mode) {
        // mode 0 exact, 1 approximate ascending (largest <= needle)
        if (mode === 0) {
            const test = typeof needle === 'string' && /[*?]/.test(needle) ? makeCriteria(needle) : null;
            for (let i = 0; i < list.length; i++) {
                if (test ? test(list[i]) : compareValues(list[i], needle) === 0 && typeof list[i] === typeof needle) return i;
                if (!test && typeof needle === 'number' && typeof list[i] === 'number' && list[i] === needle) return i;
            }
            return -1;
        }
        let found = -1;
        for (let i = 0; i < list.length; i++) {
            if (list[i] === null || list[i] === undefined) continue;
            if (typeof list[i] !== typeof needle) continue;
            if (compareValues(list[i], needle) <= 0) found = i; else break;
        }
        return found;
    }
    def('VLOOKUP', args => {
        const needle = scalar(args[0]), table = toMatrix(args[1]), col = toNumber(args[2]);
        const approx = args.length > 3 && args[3] !== BLANK ? toBool(args[3]) : true;
        if (firstErr(needle, col, approx)) return firstErr(needle, col, approx);
        if (col < 1 || col > table[0].length) return ERR.REF;
        const idx = lookupIndex(needle, table.map(r => r[0]), approx ? 1 : 0);
        return idx < 0 ? ERR.NA : table[idx][Math.floor(col) - 1];
    });
    def('HLOOKUP', args => {
        const needle = scalar(args[0]), table = toMatrix(args[1]), row = toNumber(args[2]);
        const approx = args.length > 3 && args[3] !== BLANK ? toBool(args[3]) : true;
        if (firstErr(needle, row, approx)) return firstErr(needle, row, approx);
        if (row < 1 || row > table.length) return ERR.REF;
        const idx = lookupIndex(needle, table[0], approx ? 1 : 0);
        return idx < 0 ? ERR.NA : table[Math.floor(row) - 1][idx];
    });
    const vector = m => (m.length === 1 ? m[0] : m.map(r => r[0]));
    def('MATCH', args => {
        const needle = scalar(args[0]), list = vector(toMatrix(args[1])), type = argN(args, 2, 1);
        if (firstErr(needle, type)) return firstErr(needle, type);
        if (type === 0) { const i = lookupIndex(needle, list, 0); return i < 0 ? ERR.NA : i + 1; }
        if (type > 0) { const i = lookupIndex(needle, list, 1); return i < 0 ? ERR.NA : i + 1; }
        let found = -1;
        for (let i = 0; i < list.length; i++) { if (compareValues(list[i], needle) >= 0) found = i; else break; }
        return found < 0 ? ERR.NA : found + 1;
    });
    def('INDEX', args => {
        const m = toMatrix(args[0]);
        let r = argN(args, 1, 0), c = argN(args, 2, 0);
        if (firstErr(r, c)) return firstErr(r, c);
        if (m.length === 1 && args.length === 2) { c = r; r = 1; }
        if (r < 0 || c < 0 || r > m.length || c > m[0].length) return ERR.REF;
        if (r === 0 && c === 0) return matrix(m);
        if (r === 0) return matrix(m.map(row => [row[c - 1]]));
        if (c === 0) return m[0].length === 1 ? m[r - 1][0] : matrix([m[r - 1]]);
        return m[r - 1][c - 1];
    });
    def('XLOOKUP', args => {
        const needle = scalar(args[0]), look = toMatrix(args[1]), ret = toMatrix(args[2]);
        const notFound = args.length > 3 && args[3] !== BLANK ? args[3] : ERR.NA;
        const mode = argN(args, 4, 0);
        if (firstErr(needle, mode)) return firstErr(needle, mode);
        const vertical = look[0].length === 1;
        const list = vertical ? look.map(r => r[0]) : look[0];
        let idx = -1;
        if (mode === 0 || mode === 2) idx = lookupIndex(needle, list, 0);
        else {
            let best = -1;
            for (let i = 0; i < list.length; i++) {
                if (typeof list[i] !== typeof needle) continue;
                const cmp = compareValues(list[i], needle);
                if (cmp === 0) { best = i; break; }
                if (mode === -1 && cmp < 0 && (best < 0 || compareValues(list[i], list[best]) > 0)) best = i;
                if (mode === 1 && cmp > 0 && (best < 0 || compareValues(list[i], list[best]) < 0)) best = i;
            }
            idx = best;
        }
        if (idx < 0) return notFound;
        if (vertical) return ret[0].length === 1 ? ret[idx][0] : matrix([ret[idx]]);
        return ret.length === 1 ? ret[0][idx] : matrix(ret.map(r => [r[idx]]));
    });
    def('CHOOSE', args => { const i = toNumber(args[0]); if (isErr(i)) return i; return i >= 1 && i < args.length ? args[Math.floor(i)] : ERR.VALUE; });
    def('ROWS', args => (isMatrix(args[0]) ? args[0].rows.length : 1));
    def('COLUMNS', args => (isMatrix(args[0]) ? args[0].rows[0].length : 1));
    def('TRANSPOSE', args => { const m = toMatrix(args[0]); return matrix(m[0].map((_, c) => m.map(r => r[c]))); });

    // Finance
    def('PMT', args => {
        const rate = toNumber(args[0]), n = toNumber(args[1]), pv = toNumber(args[2]), fv = argN(args, 3, 0), type = argN(args, 4, 0);
        if (firstErr(rate, n, pv, fv, type)) return firstErr(rate, n, pv, fv, type);
        if (n === 0) return ERR.NUM;
        if (rate === 0) return -(pv + fv) / n;
        const p = Math.pow(1 + rate, n);
        return -(rate * (pv * p + fv)) / ((1 + rate * type) * (p - 1));
    }, { fmt: { t: 'currency', d: 2 } });
    def('FV', args => {
        const rate = toNumber(args[0]), n = toNumber(args[1]), pmt = toNumber(args[2]), pv = argN(args, 3, 0), type = argN(args, 4, 0);
        if (firstErr(rate, n, pmt, pv, type)) return firstErr(rate, n, pmt, pv, type);
        if (rate === 0) return -(pv + pmt * n);
        const p = Math.pow(1 + rate, n);
        return -(pv * p + pmt * (1 + rate * type) * (p - 1) / rate);
    }, { fmt: { t: 'currency', d: 2 } });
    def('PV', args => {
        const rate = toNumber(args[0]), n = toNumber(args[1]), pmt = toNumber(args[2]), fv = argN(args, 3, 0), type = argN(args, 4, 0);
        if (firstErr(rate, n, pmt, fv, type)) return firstErr(rate, n, pmt, fv, type);
        if (rate === 0) return -(fv + pmt * n);
        const p = Math.pow(1 + rate, n);
        return -(fv + pmt * (1 + rate * type) * (p - 1) / rate) / p;
    }, { fmt: { t: 'currency', d: 2 } });
    def('NPV', args => { const rate = toNumber(args[0]); if (isErr(rate)) return rate; const ns = numbers(args.slice(1)); if (isErr(ns)) return ns; return ns.reduce((sum, v, i) => sum + v / Math.pow(1 + rate, i + 1), 0); }, { fmt: { t: 'currency', d: 2 } });
    def('IRR', args => {
        const ns = numbers([args[0]]); if (isErr(ns)) return ns;
        let rate = args.length > 1 ? toNumber(args[1]) : 0.1; if (isErr(rate)) return rate;
        for (let i = 0; i < 100; i++) {
            let f = 0, df = 0;
            ns.forEach((v, t) => { f += v / Math.pow(1 + rate, t); df -= t * v / Math.pow(1 + rate, t + 1); });
            if (Math.abs(df) < 1e-12) return ERR.NUM;
            const next = rate - f / df;
            if (Math.abs(next - rate) < 1e-10) return next;
            rate = next;
        }
        return ERR.NUM;
    }, { fmt: { t: 'percent', d: 2 } });

    // Functions whose arguments must not all be evaluated up front.
    const LAZY = new Set(['IF', 'IFS', 'IFERROR', 'IFNA', 'SWITCH', 'ROW', 'COLUMN', 'ISREF', 'ISFORMULA', 'OFFSET', 'INDIRECT']);
    const FUNCTION_NAMES = [...new Set([...Object.keys(F), ...LAZY])].sort();

    /* ------------------------------------------------------------ evaluator */
    // workbook: { sheets: [{ id, name, rows, cols, cells: { 'r:c': { v } } }] }
    function createEvaluator(getWorkbook) {
        let cache = new Map();
        let fmtCache = new Map();
        const evaluating = new Set();
        const astCache = new Map();
        function sheetBy(ctxSheet, name) {
            const book = getWorkbook();
            if (name === null || name === undefined) return ctxSheet;
            const lower = String(name).toLowerCase();
            return book.sheets.find(s => s.name.toLowerCase() === lower) || null;
        }
        function parsed(src) {
            let entry = astCache.get(src);
            if (!entry) {
                try { entry = { ast: parseFormula(src) }; } catch (error) { entry = { error: ERR.ERROR }; }
                if (astCache.size > 20000) astCache.clear();
                astCache.set(src, entry);
            }
            return entry;
        }
        function cellValue(sheet, r, c) {
            if (!sheet) return ERR.REF;
            const key = sheet.id + '|' + r + ':' + c;
            if (cache.has(key)) return cache.get(key);
            const cell = sheet.cells[r + ':' + c];
            const raw = cell ? cell.v : null;
            let value;
            if (raw === null || raw === undefined || raw === '') value = null;
            else if (typeof raw === 'string' && raw[0] === '=' && raw.length > 1) {
                if (evaluating.has(key)) return ERR.CYCLE;
                evaluating.add(key);
                try {
                    const entry = parsed(raw.slice(1));
                    if (entry.error) value = entry.error;
                    else {
                        const ctx = { sheet, r, c, fmt: null };
                        value = scalar(evalNode(entry.ast, ctx));
                        if (ctx.fmt) fmtCache.set(key, ctx.fmt);
                    }
                } catch (error) {
                    value = ERR.ERROR;
                } finally {
                    evaluating.delete(key);
                }
                if (value === undefined) value = null;
                if (typeof value === 'number' && !Number.isFinite(value)) value = ERR.NUM;
            } else {
                value = parseLiteral(raw).value;
            }
            cache.set(key, value);
            return value;
        }
        function rangeValue(sheet, node) {
            if (!sheet) return ERR.REF;
            const r2 = node.r2 === Infinity ? Math.max(0, usedRows(sheet) - 1) : node.r2;
            const c2 = node.c2 === Infinity ? Math.max(0, usedCols(sheet) - 1) : node.c2;
            const r1 = Math.min(node.r1, r2), rr2 = Math.max(node.r1, r2);
            const c1 = Math.min(node.c1, c2), cc2 = Math.max(node.c1, c2);
            const rows = [];
            for (let r = r1; r <= rr2; r++) {
                const row = [];
                for (let c = c1; c <= cc2; c++) row.push(cellValue(sheet, r, c));
                rows.push(row);
            }
            return matrix(rows);
        }
        function evalArgs(args, ctx) { return args.map(a => (a.k === 'blank' ? BLANK : evalNode(a, ctx))); }
        function binary(op, a, b) {
            if (isMatrix(a) || isMatrix(b)) {
                const ma = toMatrix(a), mb = toMatrix(b);
                const rows = Math.max(ma.length, mb.length), cols = Math.max(ma[0].length, mb[0].length);
                const pick = (m, r, c) => m[m.length === 1 ? 0 : r]?.[m[0].length === 1 ? 0 : c];
                const out = [];
                for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) { const x = pick(ma, r, c), y = pick(mb, r, c); row.push(x === undefined || y === undefined ? ERR.NA : binary(op, x, y)); } out.push(row); }
                return matrix(out);
            }
            if (isErr(a)) return a;
            if (isErr(b)) return b;
            switch (op) {
                case '&': { const x = toText(a), y = toText(b); return firstErr(x, y) || x + y; }
                case '=': return compareValues(a, b) === 0;
                case '<>': return compareValues(a, b) !== 0;
                case '<': return compareValues(a, b) < 0;
                case '>': return compareValues(a, b) > 0;
                case '<=': return compareValues(a, b) <= 0;
                case '>=': return compareValues(a, b) >= 0;
            }
            const x = toNumber(a), y = toNumber(b);
            if (firstErr(x, y)) return firstErr(x, y);
            switch (op) {
                case '+': return x + y;
                case '-': return x - y;
                case '*': return x * y;
                case '/': return y === 0 ? ERR.DIV0 : x / y;
                case '^': { const p = Math.pow(x, y); return Number.isFinite(p) ? p : ERR.NUM; }
            }
            return ERR.VALUE;
        }
        function mapMatrix(v, fn) { return isMatrix(v) ? matrix(v.rows.map(row => row.map(fn))) : fn(v); }
        function evalNode(node, ctx) {
            switch (node.k) {
                case 'num': return node.v;
                case 'str': return node.v;
                case 'bool': return node.v;
                case 'err': return node.v;
                case 'blank': return null;
                case 'array': return matrix(node.rows.map(row => row.map(n => scalar(evalNode(n, ctx)))));
                case 'ref': {
                    const sheet = sheetBy(ctx.sheet, node.sheet);
                    if (!sheet) return ERR.REF;
                    const v = cellValue(sheet, node.r, node.c);
                    if (!ctx.fmt) ctx.fmt = refFormat(sheet, node.r, node.c);
                    return v;
                }
                case 'range': {
                    const sheet = sheetBy(ctx.sheet, node.sheet);
                    if (!ctx.fmt && sheet) ctx.fmt = refFormat(sheet, node.r1, node.c1);
                    return rangeValue(sheet, node);
                }
                case 'neg': return mapMatrix(evalNode(node.a, ctx), v => { const n = toNumber(v); return isErr(n) ? n : -n; });
                case 'pct': ctx.fmt = { t: 'percent', d: 0 }; return mapMatrix(evalNode(node.a, ctx), v => { const n = toNumber(v); return isErr(n) ? n : n / 100; });
                case 'bin': {
                    const keep = ctx.fmt;
                    const a = evalNode(node.a, ctx);
                    const b = evalNode(node.b, ctx);
                    if (['=', '<>', '<', '>', '<=', '>=', '&'].includes(node.op)) ctx.fmt = keep;
                    else if (node.op === '/' || node.op === '*' || node.op === '^') ctx.fmt = ctx.fmt && ctx.fmt.t === 'percent' ? keep : ctx.fmt;
                    return binary(node.op, a, b);
                }
                case 'fn': return callFunction(node, ctx);
            }
            return ERR.VALUE;
        }
        function callFunction(node, ctx) {
            const name = node.name.replace(/^_XLFN\./, '');
            const lazy = node.args;
            const val = i => (i < lazy.length ? (lazy[i].k === 'blank' ? null : scalar(evalNode(lazy[i], ctx))) : undefined);
            switch (name) {
                case 'IF': {
                    if (lazy.length < 2) return ERR.NA;
                    const cond = toBool(val(0));
                    if (isErr(cond)) return cond;
                    if (cond) return lazy[1].k === 'blank' ? 0 : evalNode(lazy[1], ctx);
                    return lazy.length > 2 ? (lazy[2].k === 'blank' ? 0 : evalNode(lazy[2], ctx)) : false;
                }
                case 'IFS': {
                    for (let i = 0; i + 1 < lazy.length; i += 2) {
                        const cond = toBool(val(i));
                        if (isErr(cond)) return cond;
                        if (cond) return evalNode(lazy[i + 1], ctx);
                    }
                    return ERR.NA;
                }
                case 'IFERROR': { const v = val(0); return isErr(v) ? (lazy.length > 1 ? val(1) ?? 0 : 0) : v; }
                case 'IFNA': { const v = val(0); return v === ERR.NA ? (lazy.length > 1 ? val(1) ?? 0 : 0) : v; }
                case 'SWITCH': {
                    const target = val(0);
                    if (isErr(target)) return target;
                    let i = 1;
                    for (; i + 1 < lazy.length; i += 2) if (compareValues(val(i), target) === 0) return val(i + 1);
                    return i < lazy.length ? val(i) : ERR.NA;
                }
                case 'ROW': {
                    if (!lazy.length) return ctx.r + 1;
                    const n = lazy[0];
                    if (n.k === 'ref') return n.r + 1;
                    if (n.k === 'range') return n.r1 + 1;
                    return ERR.VALUE;
                }
                case 'COLUMN': {
                    if (!lazy.length) return ctx.c + 1;
                    const n = lazy[0];
                    if (n.k === 'ref') return n.c + 1;
                    if (n.k === 'range') return n.c1 + 1;
                    return ERR.VALUE;
                }
                case 'ISREF': return lazy[0] && (lazy[0].k === 'ref' || lazy[0].k === 'range');
                case 'ISFORMULA': {
                    const n = lazy[0];
                    if (!n || n.k !== 'ref') return ERR.VALUE;
                    const sheet = sheetBy(ctx.sheet, n.sheet);
                    const cell = sheet && sheet.cells[n.r + ':' + n.c];
                    return !!(cell && typeof cell.v === 'string' && cell.v[0] === '=');
                }
                case 'INDIRECT': {
                    const text = toText(val(0));
                    if (isErr(text)) return text;
                    let sheetName = null, ref = text;
                    const bang = text.lastIndexOf('!');
                    if (bang > 0) { sheetName = text.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'"); ref = text.slice(bang + 1); }
                    const sheet = sheetBy(ctx.sheet, sheetName);
                    const range = parseRangeA1(ref.replace(/\$/g, ''));
                    if (!sheet || !range) return ERR.REF;
                    if (range.r1 === range.r2 && range.c1 === range.c2) return cellValue(sheet, range.r1, range.c1);
                    return rangeValue(sheet, range);
                }
                case 'OFFSET': {
                    const base = lazy[0];
                    if (!base || (base.k !== 'ref' && base.k !== 'range')) return ERR.VALUE;
                    const dr = toNumber(val(1)), dc = toNumber(val(2));
                    if (firstErr(dr, dc)) return firstErr(dr, dc);
                    const r1 = (base.k === 'ref' ? base.r : base.r1) + dr, c1 = (base.k === 'ref' ? base.c : base.c1) + dc;
                    const h = lazy.length > 3 && lazy[3].k !== 'blank' ? toNumber(val(3)) : base.k === 'range' ? base.r2 - base.r1 + 1 : 1;
                    const w = lazy.length > 4 && lazy[4].k !== 'blank' ? toNumber(val(4)) : base.k === 'range' ? base.c2 - base.c1 + 1 : 1;
                    if (firstErr(h, w)) return firstErr(h, w);
                    if (r1 < 0 || c1 < 0 || h < 1 || w < 1) return ERR.REF;
                    const sheet = sheetBy(ctx.sheet, base.sheet);
                    if (h === 1 && w === 1) return cellValue(sheet, r1, c1);
                    return rangeValue(sheet, { r1, c1, r2: r1 + h - 1, c2: c1 + w - 1 });
                }
            }
            const fn = F[name];
            if (!fn) return ERR.NAME;
            const before = ctx.fmt;
            const args = evalArgs(node.args, ctx);
            if (fn.fmt) ctx.fmt = fn.fmt;
            else if (/^(COUNT|COUNTA|COUNTBLANK|COUNTIF|COUNTIFS|LEN|ROWS|COLUMNS|MATCH|RANK|RANK\.EQ|YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|WEEKDAY|WEEKNUM|DAYS|DATEDIF|NETWORKDAYS|FIND|SEARCH|CODE|UNICODE)$/.test(name)) ctx.fmt = null;
            else if (!/^(SUM|AVERAGE|MIN|MAX|MEDIAN|ROUND|ROUNDUP|ROUNDDOWN|ABS|SUMIF|SUMIFS|AVERAGEIF|AVERAGEIFS|MAXIFS|MINIFS|VLOOKUP|HLOOKUP|XLOOKUP|INDEX|LARGE|SMALL|CEILING|FLOOR|MROUND|TRUNC|INT|PRODUCT|MODE|CHOOSE)$/.test(name)) ctx.fmt = before;
            try {
                const out = fn(args.map(a => (a === BLANK ? BLANK : a)));
                return out === undefined ? null : out;
            } catch (error) {
                return ERR.VALUE;
            }
        }
        function refFormat(sheet, r, c) {
            const cell = sheet.cells[r + ':' + c];
            if (!cell) return null;
            if (cell.s && cell.s.fmt && cell.s.fmt.t && cell.s.fmt.t !== 'auto') return cell.s.fmt;
            if (typeof cell.v === 'string' && cell.v[0] === '=') { cellValue(sheet, r, c); return fmtCache.get(sheet.id + '|' + r + ':' + c) || null; }
            return parseLiteral(cell.v).fmt;
        }
        return {
            value(sheet, r, c) { return cellValue(sheet, r, c); },
            // Inferred display format of a formula result (e.g. a SUM of currency cells).
            inferredFormat(sheet, r, c) { cellValue(sheet, r, c); return fmtCache.get(sheet.id + '|' + r + ':' + c) || null; },
            range(sheet, range) { return rangeValue(sheet, range).rows; },
            // Evaluate a formula as if it were typed in (r, c) without storing it (conditional formatting).
            evalFormula(sheet, r, c, formula) {
                const src = String(formula || '').replace(/^=/, '');
                const entry = parsed(src);
                if (entry.error) return entry.error;
                try { return scalar(evalNode(entry.ast, { sheet, r, c, fmt: null })); } catch { return ERR.ERROR; }
            },
            invalidate() { cache = new Map(); fmtCache = new Map(); }
        };
    }
    function usedRows(sheet) {
        let max = 0;
        for (const key in sheet.cells) { const r = +key.slice(0, key.indexOf(':')); if (r + 1 > max) max = r + 1; }
        return Math.min(max, sheet.rows || max);
    }
    function usedCols(sheet) {
        let max = 0;
        for (const key in sheet.cells) { const c = +key.slice(key.indexOf(':') + 1); if (c + 1 > max) max = c + 1; }
        return Math.min(max, sheet.cols || max);
    }

    /* ------------------------------------------------------------ formatting */
    const CURRENCY_CODES = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW' };
    // Times always use NM / AN instead of AM / PM.
    const meridiem = text => text.replace(/\bAM\b/g, 'NM').replace(/\bPM\b/g, 'AN').replace(/\ba\.?\s?m\.?(?=\s|$)/gi, 'NM').replace(/\bp\.?\s?m\.?(?=\s|$)/gi, 'AN');
    const nfCache = new Map();
    function nf(locale, options) {
        const key = locale + JSON.stringify(options);
        let f = nfCache.get(key);
        if (!f) { try { f = new Intl.NumberFormat(locale, options); } catch { f = new Intl.NumberFormat('en-US', options); } nfCache.set(key, f); }
        return f;
    }
    function dtf(locale, options) {
        const key = 'd' + locale + JSON.stringify(options);
        let f = nfCache.get(key);
        if (!f) { try { f = new Intl.DateTimeFormat(locale, Object.assign({ timeZone: 'UTC' }, options)); } catch { f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'UTC' }, options)); } nfCache.set(key, f); }
        return f;
    }
    function formatValue(value, fmt, locale = 'en-US') {
        if (value === null || value === undefined) return '';
        if (isErr(value)) return value.code;
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        if (typeof value === 'string') return value;
        if (typeof value !== 'number') return String(value);
        const t = fmt && fmt.t ? fmt.t : 'auto';
        const d = fmt && Number.isFinite(fmt.d) ? Math.max(0, Math.min(10, fmt.d)) : null;
        switch (t) {
            case 'text': return formatGeneral(value);
            case 'number': return nf(locale, { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 }).format(value);
            case 'percent': return nf(locale, { style: 'percent', minimumFractionDigits: d ?? 0, maximumFractionDigits: d ?? 0 }).format(value);
            case 'currency': {
                const code = (fmt && fmt.code) || CURRENCY_CODES[fmt && fmt.cur] || 'USD';
                return nf(locale, { style: 'currency', currency: code, minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 }).format(value);
            }
            case 'accounting': {
                const code = (fmt && fmt.code) || CURRENCY_CODES[fmt && fmt.cur] || 'USD';
                return nf(locale, { style: 'currency', currency: code, currencySign: 'accounting', minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 }).format(value);
            }
            case 'scientific': return value.toExponential(d ?? 2).replace('e+', 'E+').replace('e-', 'E-');
            case 'date': return dtf(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(serialToDate(value));
            case 'longdate': return dtf(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(serialToDate(value));
            case 'time': return meridiem(dtf(locale, { hour: 'numeric', minute: '2-digit' }).format(serialToDate(value % 1 < 0 ? value % 1 + 1 : value)));
            case 'datetime': return meridiem(dtf(locale, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(serialToDate(value)));
            case 'duration': {
                const total = Math.round(Math.abs(value) * 86400);
                const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
                return (value < 0 ? '-' : '') + h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
            }
            default: {
                if (d !== null) return nf(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(value);
                const abs = Math.abs(value);
                if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return value.toExponential(5).replace(/\.?0+e/, 'e').replace('e+', 'E+').replace('e-', 'E-');
                return nf(locale, { maximumFractionDigits: 10, useGrouping: false }).format(Number(value.toPrecision(12)));
            }
        }
    }
    // Small subset of TEXT() patterns: 0, 0.00, #,##0, 0%, yyyy-mm-dd, mm/dd/yyyy, hh:mm.
    function formatPattern(value, pattern) {
        const p = String(pattern);
        if (/[ymdhs]/i.test(p) && !/[0#]/.test(p)) {
            const date = serialToDate(value);
            const Y = date.getUTCFullYear(), M = date.getUTCMonth() + 1, D = date.getUTCDate(), H = date.getUTCHours(), Mi = date.getUTCMinutes(), S = date.getUTCSeconds();
            const ampm = /AM\/PM|NM\/AN/i.test(p);
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return p.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|NM\/AN/gi, tok => {
                const low = tok.toLowerCase();
                switch (low) {
                    case 'yyyy': return String(Y);
                    case 'yy': return String(Y).slice(-2);
                    case 'mmmm': return months[M - 1];
                    case 'mmm': return months[M - 1].slice(0, 3);
                    case 'mm': return /h/i.test(p) && !/[yd]/i.test(p) ? String(Mi).padStart(2, '0') : String(M).padStart(2, '0');
                    case 'm': return String(M);
                    case 'dddd': return days[date.getUTCDay()];
                    case 'ddd': return days[date.getUTCDay()].slice(0, 3);
                    case 'dd': return String(D).padStart(2, '0');
                    case 'd': return String(D);
                    case 'hh': return String(ampm ? (H % 12 || 12) : H).padStart(2, '0');
                    case 'h': return String(ampm ? (H % 12 || 12) : H);
                    case 'ss': return String(S).padStart(2, '0');
                    case 's': return String(S);
                    default: return H < 12 ? 'NM' : 'AN';
                }
            });
        }
        const percent = p.includes('%');
        let v = percent ? value * 100 : value;
        const decMatch = /\.([0#]+)/.exec(p);
        const decimals = decMatch ? decMatch[1].length : 0;
        const grouping = p.includes(',');
        const prefix = (/^[^0#.,%]*/.exec(p) || [''])[0];
        const suffix = (/[^0#.,%]*$/.exec(p.replace('%', '')) || [''])[0];
        const body = new Intl.NumberFormat('en-US', { minimumFractionDigits: decMatch ? decMatch[1].replace(/#/g, '').length : 0, maximumFractionDigits: decimals, useGrouping: grouping }).format(Math.abs(v));
        return (v < 0 ? '-' : '') + prefix + body + (percent ? '%' : '') + suffix;
    }

    /* ------------------------------------------------------------ reference rewriting */
    // Rebuild a formula from its tokens, transforming each reference.
    function rewrite(formula, transform) {
        if (typeof formula !== 'string' || formula[0] !== '=') return formula;
        let tokens;
        try { tokens = tokenize(formula.slice(1)); } catch { return formula; }
        let out = '', last = 0;
        const src = formula.slice(1);
        for (const t of tokens) {
            if (t.type !== 'cell' && t.type !== 'colrange' && t.type !== 'rowrange') continue;
            const replacement = transform(t);
            if (replacement === null || replacement === undefined) continue;
            out += src.slice(last, t.start) + replacement;
            last = t.end;
        }
        return '=' + out + src.slice(last);
    }
    const sheetPrefix = t => (t.sheet !== null && t.sheet !== undefined ? quoteSheet(t.sheet) + '!' : '');
    function emitCell(t, r, c) {
        if (r < 0 || c < 0) return sheetPrefix(t) + '#REF!';
        return sheetPrefix(t) + (t.absC ? '$' : '') + colName(c) + (t.absR ? '$' : '') + (r + 1);
    }
    // Copy/fill: relative references move by (dr, dc).
    function shiftFormula(formula, dr, dc) {
        return rewrite(formula, t => {
            if (t.type === 'cell') return emitCell(t, t.absR ? t.r : t.r + dr, t.absC ? t.c : t.c + dc);
            if (t.type === 'colrange') {
                const a = t.abs1 ? t.c1 : t.c1 + dc, b = t.abs2 ? t.c2 : t.c2 + dc;
                if (a < 0 || b < 0) return sheetPrefix(t) + '#REF!';
                return sheetPrefix(t) + (t.abs1 ? '$' : '') + colName(a) + ':' + (t.abs2 ? '$' : '') + colName(b);
            }
            const a = t.abs1 ? t.r1 : t.r1 + dr, b = t.abs2 ? t.r2 : t.r2 + dr;
            if (a < 0 || b < 0) return sheetPrefix(t) + '#REF!';
            return sheetPrefix(t) + (t.abs1 ? '$' : '') + (a + 1) + ':' + (t.abs2 ? '$' : '') + (b + 1);
        });
    }
    // Rows/columns inserted (count > 0) or deleted (count < 0) at index on sheet `targetName`.
    // Formulas on `ownName` without a sheet prefix refer to their own sheet.
    function adjustFormula(formula, ownName, targetName, axis, index, count) {
        const sameSheet = t => (t.sheet === null || t.sheet === undefined ? ownName : t.sheet).toLowerCase() === targetName.toLowerCase();
        const move = pos => {
            if (count > 0) return pos >= index ? pos + count : pos;
            const removedEnd = index - count; // exclusive
            if (pos >= index && pos < removedEnd) return null;
            return pos >= removedEnd ? pos + count : pos;
        };
        // Range end-points clamp inward when part of the range is deleted.
        const moveRange = (a, b) => {
            if (count > 0) return [a >= index ? a + count : a, b >= index ? b + count : b];
            const removedEnd = index - count;
            let na = a, nb = b;
            if (a >= index && a < removedEnd) na = index; else if (a >= removedEnd) na = a + count;
            if (b >= index && b < removedEnd) nb = index - 1; else if (b >= removedEnd) nb = b + count;
            if (nb < na) return null;
            return [na, nb];
        };
        let tokens;
        try { tokens = tokenize(String(formula).slice(1)); } catch { return formula; }
        // Pair cell tokens joined by ':' into ranges so their ends clamp together.
        const src = String(formula).slice(1);
        const pairs = new Map();
        for (let i = 0; i + 2 < tokens.length; i++) {
            if (tokens[i].type === 'cell' && tokens[i + 1].type === 'op' && tokens[i + 1].value === ':' && tokens[i + 2].type === 'cell') { pairs.set(tokens[i], tokens[i + 2]); i += 2; }
        }
        let out = '', last = 0;
        const skip = new Set();
        for (const t of tokens) {
            if (skip.has(t)) continue;
            let replacement = null, end = t.end;
            if (t.type === 'cell' && sameSheet(t)) {
                const partner = pairs.get(t);
                if (partner) {
                    skip.add(partner);
                    end = partner.end;
                    const key = axis === 'row' ? ['r', 'r'] : ['c', 'c'];
                    const res = moveRange(Math.min(t[key[0]], partner[key[1]]), Math.max(t[key[0]], partner[key[1]]));
                    if (!res) replacement = sheetPrefix(t) + '#REF!';
                    else {
                        const first = axis === 'row' ? emitCell(t, res[0], t.c) : emitCell(t, t.r, res[0]);
                        const second = axis === 'row' ? emitCell({ ...partner, sheet: null }, res[1], partner.c) : emitCell({ ...partner, sheet: null }, partner.r, res[1]);
                        replacement = first + ':' + second;
                    }
                } else {
                    const pos = move(axis === 'row' ? t.r : t.c);
                    replacement = pos === null ? sheetPrefix(t) + '#REF!' : axis === 'row' ? emitCell(t, pos, t.c) : emitCell(t, t.r, pos);
                }
            } else if (t.type === 'colrange' && axis === 'col' && sameSheet(t)) {
                const res = moveRange(Math.min(t.c1, t.c2), Math.max(t.c1, t.c2));
                replacement = res ? sheetPrefix(t) + (t.abs1 ? '$' : '') + colName(res[0]) + ':' + (t.abs2 ? '$' : '') + colName(res[1]) : sheetPrefix(t) + '#REF!';
            } else if (t.type === 'rowrange' && axis === 'row' && sameSheet(t)) {
                const res = moveRange(Math.min(t.r1, t.r2), Math.max(t.r1, t.r2));
                replacement = res ? sheetPrefix(t) + (t.abs1 ? '$' : '') + (res[0] + 1) + ':' + (t.abs2 ? '$' : '') + (res[1] + 1) : sheetPrefix(t) + '#REF!';
            } else continue;
            out += src.slice(last, t.start) + replacement;
            last = end;
        }
        return '=' + out + src.slice(last);
    }
    // Renaming a sheet rewrites every reference to it.
    function renameSheetInFormula(formula, oldName, newName) {
        return rewrite(formula, t => {
            if (t.sheet === null || t.sheet === undefined || t.sheet.toLowerCase() !== oldName.toLowerCase()) return null;
            const copy = { ...t, sheet: newName };
            if (t.type === 'cell') return emitCell(copy, t.r, t.c);
            if (t.type === 'colrange') return sheetPrefix(copy) + (t.abs1 ? '$' : '') + colName(t.c1) + ':' + (t.abs2 ? '$' : '') + colName(t.c2);
            return sheetPrefix(copy) + (t.abs1 ? '$' : '') + (t.r1 + 1) + ':' + (t.abs2 ? '$' : '') + (t.r2 + 1);
        });
    }
    // References inside a formula being edited (for colored highlights).
    function formulaReferences(formula) {
        if (typeof formula !== 'string' || formula[0] !== '=') return [];
        let tokens;
        try { tokens = tokenize(formula.slice(1)); } catch { return []; }
        const refs = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.type !== 'cell') continue;
            const n2 = tokens[i + 1], n3 = tokens[i + 2];
            if (n2 && n2.type === 'op' && n2.value === ':' && n3 && n3.type === 'cell') {
                refs.push({ sheet: t.sheet, r1: Math.min(t.r, n3.r), c1: Math.min(t.c, n3.c), r2: Math.max(t.r, n3.r), c2: Math.max(t.c, n3.c), start: t.start + 1, end: n3.end + 1 });
                i += 2;
            } else refs.push({ sheet: t.sheet, r1: t.r, c1: t.c, r2: t.r, c2: t.c, start: t.start + 1, end: t.end + 1 });
        }
        return refs;
    }

    const api = {
        ERR, SheetError, isErr, colName, colIndex, cellKey, refName, parseA1, parseRangeA1, rangeName, quoteSheet,
        dateToSerial, serialToDate, todaySerial, nowSerial, parseLiteral, tokenize, parseFormula,
        createEvaluator, formatValue, formatGeneral, shiftFormula, adjustFormula, renameSheetInFormula, formulaReferences,
        compareValues, FUNCTION_NAMES, meridiem
    };
    root.SheetsEngine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
