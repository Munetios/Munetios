'use strict';
const { randomBytes, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function encode(bytes) {
    let value = 0, bits = 0, out = '';
    for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += alphabet[(value >>> bits) & 31]; } }
    if (bits) out += alphabet[(value << (5 - bits)) & 31];
    return out;
}
function decode(secret) {
    let value = 0, bits = 0; const out = [];
    for (const c of secret) { const n = alphabet.indexOf(c); if (n < 0) throw new Error('invalidSecret'); value = (value << 5) | n; bits += 5; if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); } }
    return Buffer.from(out);
}
function codeAt(secret, counter) {
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', decode(secret)).update(bytes).digest();
    const offset = digest[19] & 15;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function verifyCode(secret, code, last = -1, now = Date.now()) {
    if (!/^\d{6}$/.test(String(code))) return null;
    const counter = Math.floor(now / 30000);
    for (const step of [0, -1, 1]) { const n = counter + step; if (n > Number(last) && timingSafeEqual(Buffer.from(codeAt(secret, n)), Buffer.from(String(code)))) return n; }
    return null;
}
function securityVault(env) {
    let key;
    function getKey() {
        if (key) return key;
        if (env.AUTH_SECURITY_KEY) {
            if (!/^[a-f0-9]{64}$/i.test(env.AUTH_SECURITY_KEY)) throw new Error('AUTH_SECURITY_KEY_INVALID');
            return key = Buffer.from(env.AUTH_SECURITY_KEY, 'hex');
        }
        if (env.NODE_ENV === 'production') throw new Error('AUTH_SECURITY_KEY_REQUIRED');
        const file = path.join(__dirname, '.security-key');
        try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        key = readFileSync(file); if (key.length !== 32) throw new Error('AUTH_SECURITY_KEY_INVALID');
        return key;
    }
    return {
        create: () => encode(randomBytes(20)),
        recoveryHash(code, accountId) {
            return createHmac('sha256', getKey()).update(`recovery:${accountId}:${code}`).digest('hex');
        },
        seal(secret, accountId) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', getKey(), iv); cipher.setAAD(Buffer.from(String(accountId))); return Buffer.concat([iv, cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64'); },
        open(value, accountId) { const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', getKey(), data.subarray(0, 12)); cipher.setAAD(Buffer.from(String(accountId))); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString('utf8'); }
    };
}
module.exports = { codeAt, verifyCode, securityVault };
