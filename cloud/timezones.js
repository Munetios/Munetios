'use strict';
/*
 * Time zones for Munetios Calendar, served from /api/cloud/calendar/timezones.
 * The server's time zone database decides the list and the current UTC offsets,
 * so every device shows the same zones even when its own browser data is older.
 */

const FALLBACK = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'];

function zoneIds() {
    try {
        const ids = Intl.supportedValuesOf('timeZone');
        return ids.includes('UTC') ? ids : ['UTC', ...ids];
    } catch {
        return FALLBACK;
    }
}

// Minutes east of UTC for a zone at a given instant.
function offsetMinutes(timeZone, at = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at);
    const get = type => Number(parts.find(part => part.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

const formatOffset = minutes => {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

let cache = null;
function listTimeZones(now = new Date()) {
    // Offsets change at daylight saving transitions, so the cache lasts 10 minutes.
    if (cache && now.getTime() - cache.at < 600000) return cache.value;
    const zones = zoneIds().map(id => {
        const offset = offsetMinutes(id, now);
        return { id, offset, label: formatOffset(offset) };
    }).sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
    cache = { at: now.getTime(), value: { generatedAt: now.toISOString(), zones } };
    return cache.value;
}

const isTimeZone = value => typeof value === 'string' && value.length <= 64 && (() => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
})();

module.exports = { listTimeZones, offsetMinutes, formatOffset, isTimeZone };
