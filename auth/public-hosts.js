'use strict';

const sharedDomain = 'munetios.com';

// Every HTTPS Munetios host (beta, accounts, mail, write, calendar, photos, notes, tasks, weather, maps, webfilter, …)
// shares one session cookie on .munetios.com, so signing in on any of them signs in on all of them.
function isSharedOrigin(origin) {
    try {
        const url = new URL(origin);
        return url.protocol === 'https:' && !url.port && (url.hostname === sharedDomain || url.hostname.endsWith('.' + sharedDomain));
    } catch {
        return false;
    }
}

function requestOrigin(req) {
    return new URL(`${req.protocol}://${req.get('host')}`).origin;
}

function usesSharedSession(req, env) {
    return env.AUTH_SHARE_MUNETIOS_SESSION === 'true' && isSharedOrigin(requestOrigin(req));
}

function expectedBrowserOrigin(req, env) {
    return usesSharedSession(req, env) ? requestOrigin(req) : new URL(env.PUBLIC_ORIGIN || requestOrigin(req)).origin;
}

module.exports = { sharedDomain, isSharedOrigin, requestOrigin, usesSharedSession, expectedBrowserOrigin };
