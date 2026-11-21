'use strict';

const sharedDomain = 'munetios.com';
const sharedOrigins = new Set(['https://write.munetios.com', 'https://accounts.munetios.com']);

function requestOrigin(req) {
    return new URL(`${req.protocol}://${req.get('host')}`).origin;
}

function usesSharedSession(req, env) {
    return env.AUTH_SHARE_MUNETIOS_SESSION === 'true' && sharedOrigins.has(requestOrigin(req));
}

function expectedBrowserOrigin(req, env) {
    return usesSharedSession(req, env) ? requestOrigin(req) : new URL(env.PUBLIC_ORIGIN || requestOrigin(req)).origin;
}

module.exports = { sharedDomain, sharedOrigins, requestOrigin, usesSharedSession, expectedBrowserOrigin };
