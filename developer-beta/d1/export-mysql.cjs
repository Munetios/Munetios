'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');

const root = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

function sqlValue(value, column) {
    if (value === null) return 'NULL';
    if (column.type === 'INTEGER') {
        const number = Number(value);
        if (!/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(number)) {
            throw new Error('Integer outside the supported range: ' + column.name);
        }
        return String(number);
    }
    if (typeof value !== 'string') throw new Error('Unexpected source value for ' + column.name);
    if (value.includes('\0')) return "CAST(X'" + Buffer.from(value).toString('hex') + "' AS TEXT)";
    return "'" + value.replaceAll("'", "''") + "'";
}

function insertRow(table, columns, row, write) {
    const names = columns.map(column => column.name);
    const values = columns.map(column => sqlValue(row[column.name], column));
    const textBytes = columns.reduce((sum, column) => sum + Buffer.byteLength(String(row[column.name] ?? '')), 0);
    if (textBytes > 1_950_000) throw new Error('D1 row size exceeded in ' + table);
    const append = columns.filter((column, index) => Buffer.byteLength(values[index]) > 48_000);
    const insert = values.map((value, index) => append.includes(columns[index]) ? "''" : value);
    write('INSERT INTO ' + table + ' (' + names.join(', ') + ') VALUES (' + insert.join(', ') + ');');
    if (!append.length) return;
    const primaryKey = columns.filter(column => column.pk);
    const where = primaryKey.map(column => column.name + ' = ' + sqlValue(row[column.name], column)).join(' AND ');
    if (!where) throw new Error('Large row requires a primary key in ' + table);
    for (const column of append) {
        const pieces = row[column.name].includes('\0') ? /.{1,11000}/gsu : /.{1,20000}/gsu;
        for (const piece of row[column.name].match(pieces)) {
            write('UPDATE ' + table + ' SET ' + column.name + ' = ' + column.name + ' || (' +
                sqlValue(piece, column) + ') WHERE ' + where + ';');
        }
    }
}

async function main() {
    if (!process.argv[2]) throw new Error('Specify a new export file outside the project.');
    const requested = path.resolve(process.argv[2]);
    const target = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
    const relative = path.relative(fs.realpathSync(root), target);
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('The export must be outside the project.');
    if (fs.existsSync(target)) throw new Error('The export file already exists.');

    const schema = new DatabaseSync(':memory:');
    const source = process.env;
    const mysqlConnection = await mysql.createConnection({
        host: source.MYSQL_HOST, port: Number(source.MYSQL_PORT || 3306),
        user: source.MYSQL_USER, password: source.MYSQL_PASSWORD, database: source.MYSQL_DATABASE,
        charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
        ...(source.MYSQL_SSL === 'true' ? {
            ssl: { rejectUnauthorized: true, ...(source.MYSQL_SSL_CA_FILE ? { ca: fs.readFileSync(source.MYSQL_SSL_CA_FILE, 'utf8') } : {}) },
        } : {}),
    });
    const partial = target + '.' + randomUUID() + '.partial';
    let output;
    try {
        schema.exec(fs.readFileSync(path.join(__dirname, '0001_accounts.sql'), 'utf8'));
        const tables = schema.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'munetios_%' ORDER BY rowid").all();
        output = fs.openSync(partial, 'wx', 0o600);
        const write = sql => {
            if (Buffer.byteLength(sql) > 96_000) throw new Error('D1 statement size exceeded');
            fs.writeFileSync(output, sql + '\n');
        };
        await mysqlConnection.query("SET SESSION time_zone = '+00:00'");
        await mysqlConnection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await mysqlConnection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        for (const { name } of tables) {
            const columns = schema.prepare('PRAGMA table_info(' + name + ')').all();
            let count = 0;
            const query = mysqlConnection.connection.query('SELECT ' + columns.map(column => column.name).join(', ') + ' FROM ' + name);
            for await (const row of query.stream()) {
                insertRow(name, columns, row, write);
                count++;
            }
            process.stdout.write(name + ': ' + count + '\n');
        }
        await mysqlConnection.commit();
        fs.closeSync(output);
        output = undefined;
        fs.linkSync(partial, target);
    } finally {
        schema.close();
        if (output !== undefined) fs.closeSync(output);
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
        await mysqlConnection.end();
    }
}

if (require.main === module) main().catch(error => {
    console.error(error.code || error.message);
    process.exitCode = 1;
});

module.exports = { insertRow };
