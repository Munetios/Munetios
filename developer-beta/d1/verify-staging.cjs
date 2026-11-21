'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');

const root = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

function queryFor(tables, textType, bytesFunction) {
    return tables.map(({ table, columns }) => {
        let from = table;
        if (table === 'munetios_sync_item_chunks') {
            from = '(SELECT account_id, item_key, COUNT(*) as part_count, SUM(' + bytesFunction + '(ciphertext)) AS size_bytes' +
                ' FROM ' + table + ' GROUP BY account_id, item_key) parts';
        }
        const values = (table === 'munetios_sync_item_chunks' ? ['account_id', 'item_key', 'part_count', 'size_bytes'] : columns)
            .map(column => ['ciphertext', 'body'].includes(column) ? bytesFunction + '(' + column + ')' : column)
            .map(expression => 'CAST(' + expression + ' AS ' + textType + ')');
        return "SELECT '" + table + "' AS table_name, JSON_ARRAY(" + values.join(', ') + ') AS row_data FROM ' + from;
    }).join(' UNION ALL ');
}

function collect(rows) {
    const tables = new Map();
    for (const { table_name: name, row_data: data } of rows) {
        if (!tables.has(name)) tables.set(name, []);
        tables.get(name).push(JSON.stringify(JSON.parse(data)));
    }
    for (const list of tables.values()) list.sort();
    return tables;
}

async function main() {
    const schema = new DatabaseSync(':memory:');
    schema.exec(fs.readFileSync(path.join(__dirname, '0001_accounts.sql'), 'utf8'));
    const tables = schema.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'munetios_%'").all()
        .map(({ name }) => ({ table: name, columns: schema.prepare('PRAGMA table_info(' + name + ')').all().map(column => column.name) }));
    schema.close();

    const env = process.env;
    const database = await mysql.createConnection({
        host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306), user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE, charset: 'utf8mb4',
        ...(env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true, ...(env.MYSQL_SSL_CA_FILE ?
            { ca: fs.readFileSync(env.MYSQL_SSL_CA_FILE, 'utf8') } : {}) } } : {}),
    });
    try {
        await database.query("SET SESSION time_zone = '+00:00'");
        const [sourceRows] = await database.query(queryFor(tables, 'CHAR', 'OCTET_LENGTH'));
        const remoteRows = [];
        for (let from = 0; from < tables.length; from += 4) {
            const sql = queryFor(tables.slice(from, from + 4), 'TEXT', 'OCTET_LENGTH');
            const result = spawnSync('npx.cmd --yes wrangler d1 execute ACCOUNTS_DB --remote --json --config developer-beta/d1/wrangler.toml --command "' + sql + '"', {
                cwd: root, shell: true, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024,
                env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
            });
            if (result.status !== 0) {
                const detail = (result.error?.message || result.stderr || result.stdout || '').split(/\r?\n/).find(line =>
                    /too (many|large|long)|no such (table|column|function)|syntax error|authorization|authentication|timeout|d1_error|ENOENT|EINVAL|ENOBUFS/i.test(line));
                throw new Error('D1 verification query failed' + (detail ? ': ' + detail.trim() : '.'));
            }
            remoteRows.push(...JSON.parse(result.stdout.trim()).flatMap(query => query.results));
        }
        const source = collect(sourceRows);
        const target = collect(remoteRows);
        for (const { table } of tables) {
            const expected = source.get(table) || [];
            const actual = target.get(table) || [];
            if (JSON.stringify(expected) === JSON.stringify(actual)) console.log(table + ': verified');
            else {
                console.log(table + ': differs (' + expected.length + ' source, ' + actual.length + ' D1)');
                process.exitCode = 2;
            }
        }
    } finally {
        await database.end();
    }
}

main().catch(error => {
    console.error(error.code || error.message);
    process.exitCode = 1;
});
