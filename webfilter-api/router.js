'use strict';
/*
 * Munetios WebFilter server API (mounted at /api/webfilter)
 *
 * Console (WebFilter workspace), authenticated with a Munetios session:
 *   GET    /orgs                                  discover workspaces for the active account
 *   POST   /orgs                                  create an org -> { orgId, adminKey, enrollToken }
 *   PUT    /orgs/:orgId/policy                    publish Global/Class/UserCSS policy
 *   POST   /orgs/:orgId/members                   add an existing account to the workspace
 *   GET    /orgs/:orgId/devices                   managed endpoints + command history
 *   POST   /orgs/:orgId/devices/:deviceId/commands  queue a remote action
 *   DELETE /orgs/:orgId/devices/:deviceId         forget a device
 *   PUT    /orgs/:orgId/extension                 publish a signed CRX for the update URL
 *
 * Munetios WebFilter extension, authenticated with the enrollment token:
 *   GET    /orgs/:orgId/policy                    latest policy
 *   POST   /orgs/:orgId/devices/heartbeat         status in, pending commands out
 *   POST   /orgs/:orgId/devices/:deviceId/ack     command results
 *
 *   PUT    /orgs/:orgId/devices/:deviceId        name a device or add it to a class
 *   GET    /orgs/:orgId/devices/:deviceId/screen latest screen image
 *   PUT    /orgs/:orgId/bypass                   set the bypass password (stored as a salted scrypt hash)
 *   GET    /orgs/:orgId/bypass                   whether a bypass password is set
 *   DELETE /orgs/:orgId/bypass                   remove it
 *   GET    /orgs/:orgId/requests                 access requests from students
 *   PUT    /orgs/:orgId/requests/:requestId      approve or deny
 *
 * Extension, also with the enrollment token:
 *   POST   /orgs/:orgId/bypass/verify            check a bypass password typed on the block page
 *   POST   /orgs/:orgId/requests                 send an access request from the block page
 *   GET    /orgs/:orgId/requests/:requestId      status of one request
 *
 * Public, for Chrome / Edge self-hosted installs:
 *   GET    /orgs/:orgId/update.xml                gupdate manifest
 *   GET    /orgs/:orgId/extension.crx             signed package
 *
 * Secrets are stored only as SHA-256 hashes. No request logging, no cookies.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const Engine = require('../webfilter/webfilter-engine');

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const APP_ID = /^[a-p]{32}$/;
const VERSION = /^\d{1,5}(\.\d{1,5}){0,3}$/;
const ONLINE_MS = 75 * 1000;
const LIVE_WAIT_MS = 20 * 1000;
const COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000;
const REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SCREEN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString('hex') };
}
const COMMAND_TYPES = new Set(['lock', 'unlock', 'notice', 'sync', 'open_tab', 'close_tab', 'temp_block', 'clear_temp_blocks']);

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isWebUrl(value) {
    try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
}

function validateCommand(body) {
    const type = text(body && body.type);
    if (!COMMAND_TYPES.has(type)) return { error: 'invalidCommand' };
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    if (type === 'lock' || type === 'notice') {
        const message = text(payload.message).trim();
        if (type === 'notice' && !message) return { error: 'messageRequired' };
        return { type, payload: { message } };
    }
    if (type === 'open_tab') {
        if (!isWebUrl(payload.url)) return { error: 'invalidUrl' };
        return { type, payload: { url: String(payload.url) } };
    }
    if (type === 'close_tab') {
        const tabId = Number(payload.tabId);
        if (!Number.isInteger(tabId) || tabId < 0) return { error: 'invalidTab' };
        return { type, payload: { tabId } };
    }
    if (type === 'temp_block') {
        const pattern = text(payload.pattern).trim();
        const minutes = Number(payload.minutes);
        if (!pattern || /\s/.test(pattern)) return { error: 'invalidPattern' };
        if (!Number.isFinite(minutes) || minutes <= 0) return { error: 'invalidDuration' };
        return { type, payload: { pattern, minutes } };
    }
    return { type, payload: {} };
}

function createStore(dataFile) {
    let data = { orgs: {} };
    const memoryCrx = new Map();
    if (dataFile) {
        try { data = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { data = { orgs: {} }; }
        if (!data || typeof data.orgs !== 'object') data = { orgs: {} };
    }
    let timer = null;
    function persist() {
        if (!dataFile || timer) return;
        timer = setTimeout(() => {
            timer = null;
            try {
                fs.mkdirSync(path.dirname(dataFile), { recursive: true });
                const temp = dataFile + '.tmp';
                fs.writeFileSync(temp, JSON.stringify(data));
                fs.renameSync(temp, dataFile);
            } catch (error) {
                console.error('WebFilter: could not save data.', error.message);
            }
        }, 200);
        if (timer.unref) timer.unref();
    }
    const crxPath = orgId => path.join(path.dirname(dataFile), orgId + '.crx');
    return {
        data, persist,
        savePackage(orgId, body) {
            if (dataFile) {
                const file = crxPath(orgId);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, body);
            } else memoryCrx.set(orgId, body);
            persist();
        },
        readPackage(orgId) {
            if (!dataFile) return memoryCrx.get(orgId);
            const file = crxPath(orgId);
            return fs.existsSync(file) ? fs.readFileSync(file) : null;
        },
    };
}

function createWebFilterRouter({ dataFile = null, store = createStore(dataFile), now = () => Date.now(), requireDashboardSession, lookupAccountByEmail, publicOrigin } = {}) {
    const router = express.Router();
    const origin = publicOrigin ? new URL(publicOrigin).origin : null;
    const liveWaiters = new Map();
    const deviceRevisions = new Map();

    function waitForLiveUpdate(res, key, ready, idle) {
        const listeners = liveWaiters.get(key) || new Set();
        liveWaiters.set(key, listeners);
        const cleanup = () => {
            clearTimeout(timer);
            listeners.delete(wake);
            if (!listeners.size) liveWaiters.delete(key);
            res.off('close', cleanup);
        };
        const wake = payload => {
            cleanup();
            res.json(payload);
        };
        const timer = setTimeout(() => wake(idle), LIVE_WAIT_MS);
        listeners.add(wake);
        res.once('close', cleanup);
        if (ready) wake(ready);
    }

    function notifyLive(key, payload) {
        const listeners = liveWaiters.get(key);
        if (listeners) for (const wake of listeners) wake(payload);
    }

    function notifyDevices(found) {
        const revision = crypto.randomUUID();
        deviceRevisions.set(found.id, revision);
        notifyLive(found.id, { revision });
    }

    router.use((req, res, next) => {
        res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
        const publicUpdate = ['GET', 'HEAD'].includes(req.method) && /^\/orgs\/[^/]+\/(update\.xml|extension\.crx)\/?$/i.test(req.path);
        if (requireDashboardSession && !publicUpdate && (!req.get('x-webfilter-enroll') || bearer(req))) {
            return requireDashboardSession(req, res, next);
        }
        next();
    });

    function org(req, res) {
        const orgId = req.params.orgId;
        const found = ID.test(orgId || '') && Object.hasOwn(store.data.orgs, orgId) ? store.data.orgs[orgId] : null;
        if (!found) res.status(404).json({ error: 'orgNotFound' });
        return found;
    }
    function bearer(req) {
        const header = req.get('authorization') || '';
        return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    }
    function requireAdmin(req, res) {
        const found = requireMember(req, res);
        if (!found) return null;
        if (req.workspaceMember.role !== 'admin') { res.status(403).json({ error: 'forbidden' }); return null; }
        return found;
    }
    function memberFor(found, account) {
        return account && found.members?.find(member => member.id === account.id);
    }
    function requireMember(req, res) {
        const found = org(req, res);
        if (!found) return null;
        const member = requireDashboardSession
            ? memberFor(found, req.account)
            : safeEqual(sha256(bearer(req)), found.adminKeyHash) && { id: '', role: 'admin', classIds: [] };
        if (!member) {
            res.status(requireDashboardSession ? 403 : 401).json({ error: 'unauthorized' });
            return null;
        }
        req.workspaceMember = member;
        return found;
    }
    const canManageClass = (member, classId) => member.role === 'admin' || member.classIds.includes(classId);
    function dashboardPolicy(found, member) {
        if (!found.policy || member.role === 'admin') return found.policy;
        return { ...found.policy, classes: found.policy.classes.filter(item => canManageClass(member, item.id)) };
    }
    function ownerMember(account) {
        return { id: account.id, name: account.displayName || '', email: account.email, role: 'admin', classIds: [], owner: true };
    }
    function requireDevice(req, res) {
        const found = org(req, res);
        if (!found) return null;
        const enroll = req.get('x-webfilter-enroll') || '';
        if (!safeEqual(sha256(enroll), found.enrollTokenHash)) { res.status(401).json({ error: 'unauthorized' }); return null; }
        return found;
    }
    function prune(found) {
        const cutoff = now() - COMMAND_RETENTION_MS;
        found.commands = found.commands.filter(command => command.status === 'queued' || command.status === 'delivered' || (command.updatedAt || command.createdAt) > cutoff);
    }
    function deviceClass(device) {
        return device.managedClassId || (device.assignedClassId ?? device.reportedClassId ?? device.classId ?? '');
    }
    function publicDevice(found, device) {
        const { screen, ...rest } = device;
        return Object.assign({}, rest, {
            classId: deviceClass(device),
            assignmentVersion: device.assignmentVersion || 0,
            name: device.assignedName || device.reportedName || device.assetId || device.hostname || '',
            hasScreen: !!screen,
            online: now() - device.lastSeen < ONLINE_MS,
            commands: found.commands.filter(command => command.deviceId === device.id).reverse(),
        });
    }

    router.get('/orgs', (req, res) => {
        const organizations = Object.values(store.data.orgs).flatMap(found => {
            const member = memberFor(found, req.account);
            return member ? [{ orgId: found.id, name: found.name, member }] : [];
        });
        res.json({ organizations });
    });

    router.post('/orgs', express.json({ limit: '16kb' }), (req, res) => {
        if (requireDashboardSession && !req.account) return res.status(401).json({ error: 'signedOut' });
        if (requireDashboardSession && !req.is('application/json')) return res.status(415).json({ error: 'invalidRequest' });
        const orgId = crypto.randomUUID();
        const adminKey = token();
        const enrollToken = token();
        store.data.orgs[orgId] = {
            id: orgId,
            name: text(req.body && req.body.name).trim() || 'Munetios WebFilter',
            adminKeyHash: sha256(adminKey),
            enrollTokenHash: sha256(enrollToken),
            ...(req.account ? { members: [ownerMember(req.account)] } : {}),
            createdAt: now(),
            policy: null,
            policyVersion: 0,
            devices: {},
            commands: [],
            extension: null,
        };
        store.persist();
        res.status(201).json({ orgId, adminKey, enrollToken });
    });

    router.post('/orgs/:orgId/claim', (req, res) => {
        const found = org(req, res);
        if (!found) return;
        if (!req.account || found.members || !safeEqual(sha256(bearer(req)), found.adminKeyHash)) {
            return res.status(403).json({ error: 'unauthorized' });
        }
        found.members = [ownerMember(req.account)];
        store.persist();
        res.json({ orgId: found.id, name: found.name, member: found.members[0] });
    });

    router.get('/orgs/:orgId/status', (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        const member = req.workspaceMember;
        res.json({
            orgId: found.id, name: found.name, policyVersion: found.policyVersion, policy: dashboardPolicy(found, member),
            member, members: member.role === 'admin' ? found.members : [member], extension: member.role === 'admin' ? found.extension : null,
            devices: Object.values(found.devices).filter(device => canManageClass(member, deviceClass(device))).length,
        });
    });

    router.patch('/orgs/:orgId', express.json({ limit: '16kb' }), (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        const name = text(req.body?.name).trim();
        if (!name) return res.status(400).json({ error: 'invalidRequest' });
        found.name = name;
        store.persist();
        res.json({ name });
    });

    function memberDetails(req, found) {
        const { name, role, classIds } = req.body || {};
        if (!['admin', 'teacher'].includes(role) || !Array.isArray(classIds) ||
            classIds.some(id => !found.policy?.classes.some(item => item.id === id))) return null;
        return { name: text(name).trim(), role, classIds: role === 'teacher' ? [...new Set(classIds)] : [] };
    }

    router.post('/orgs/:orgId/members', express.json({ limit: '16kb' }), async (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        const details = memberDetails(req, found);
        const email = text(req.body?.email).trim().toLowerCase();
        if (!details || !email) return res.status(400).json({ error: 'invalidRequest' });
        const account = await lookupAccountByEmail?.(email);
        if (!account) return res.status(404).json({ error: 'memberAccountNotFound' });
        if (memberFor(found, req.account)?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
        if (found.members.some(person => person.id === account.id)) return res.status(409).json({ error: 'duplicateMember' });
        if (!memberDetails(req, found)) return res.status(409).json({ error: 'policyChanged' });
        found.members.push({ ...account, ...details, owner: false });
        store.persist();
        res.status(201).json({ members: found.members });
    });

    router.put('/orgs/:orgId/members/:accountId', express.json({ limit: '16kb' }), (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        const person = found.members?.find(member => member.id === req.params.accountId);
        if (!person) return res.status(404).json({ error: 'memberAccountNotFound' });
        const details = memberDetails(req, found);
        if (!details) return res.status(400).json({ error: 'invalidRequest' });
        if (person.owner) person.name = details.name;
        else Object.assign(person, details);
        store.persist();
        res.json({ members: found.members });
    });

    router.delete('/orgs/:orgId/members/:accountId', (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        const person = found.members?.find(member => member.id === req.params.accountId);
        if (!person) return res.status(404).json({ error: 'memberAccountNotFound' });
        if (person.owner) return res.status(403).json({ error: 'forbidden' });
        found.members = found.members.filter(member => member !== person);
        store.persist();
        res.json({ members: found.members });
    });

    router.put('/orgs/:orgId/policy', express.json({ limit: '4mb' }), (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        const { policy, expectedVersion, classAssignments } = req.body || {};
        if (!policy?.global || typeof policy.global !== 'object' || !Array.isArray(policy.classes) ||
            policy.classes.some(item => !item || typeof item.id !== 'string') ||
            new Set(policy.classes.map(item => item.id)).size !== policy.classes.length) {
            return res.status(400).json({ error: 'invalidPolicy' });
        }
        if (requireDashboardSession && expectedVersion !== found.policyVersion) {
            return res.status(409).json({ error: 'policyChanged' });
        }
        const member = req.workspaceMember;
        let next = policy;
        if (member.role === 'teacher') {
            const current = found.policy;
            if (!current || classAssignments || policy.classes.some(item => !canManageClass(member, item.id) || !current.classes.some(existing => existing.id === item.id))) {
                return res.status(403).json({ error: 'forbidden' });
            }
            const changes = new Map(Engine.normalizePolicy(policy).classes.map(item => [item.id, item]));
            next = { ...current, classes: current.classes.map(item => {
                const change = changes.get(item.id);
                return change ? { ...item, ...change, name: item.name, styles: item.styles } : item;
            }) };
        } else if (found.members) {
            const ids = new Set(next.classes.map(item => item.id));
            const assignment = classAssignments;
            if (assignment && (!ids.has(assignment.classId) || !Array.isArray(assignment.teacherIds)
                || assignment.teacherIds.some(id => !found.members.some(person => person.id === id && person.role === 'teacher')))) {
                return res.status(400).json({ error: 'invalidPolicy' });
            }
            for (const person of found.members) {
                person.classIds = person.classIds.filter(id => ids.has(id) && id !== assignment?.classId);
                if (assignment?.teacherIds.includes(person.id)) person.classIds.push(assignment.classId);
            }
        }
        found.policyVersion += 1;
        found.policy = Object.assign({}, next, { version: found.policyVersion, updatedAt: now() });
        store.persist();
        res.json({ version: found.policyVersion, updatedAt: found.policy.updatedAt, ...(member.role === 'admin' && found.members ? { members: found.members } : {}) });
    });

    router.get('/orgs/:orgId/policy', (req, res) => {
        const found = org(req, res);
        if (!found) return;
        const device = safeEqual(sha256(req.get('x-webfilter-enroll') || ''), found.enrollTokenHash);
        if (device) return res.json({ policy: found.policy, version: found.policyVersion, workspaceName: found.name });
        if (!requireMember(req, res)) return;
        res.json({ policy: dashboardPolicy(found, req.workspaceMember), version: found.policyVersion });
    });

    router.post('/orgs/:orgId/devices/heartbeat', express.json({ limit: '4mb' }), (req, res) => {
        const found = requireDevice(req, res);
        if (!found) return;
        const body = req.body || {};
        const deviceId = text(body.deviceId);
        if (!ID.test(deviceId) || Object.hasOwn(Object.prototype, deviceId)) return res.status(400).json({ error: 'invalidDevice' });
        const tabs = Array.isArray(body.tabs) ? body.tabs.filter(tab => tab && Number.isInteger(tab.id)).map(tab => ({
            id: tab.id, url: text(tab.url), title: text(tab.title), active: !!tab.active,
        })) : [];
        const previous = found.devices[deviceId] || { id: deviceId, firstSeen: now() };
        const screen = text(body.screen);
        if (screen && SCREEN.test(screen)) {
            previous.screen = screen;
            previous.screenAt = now();
        } else if (body.screen === '') {
            delete previous.screen;
            delete previous.screenAt;
        }
        found.devices[deviceId] = Object.assign(previous, {
            // Keep the reported name separate from anything assigned in the dashboard.
            reportedName: text(typeof body.reportedName === 'string' ? body.reportedName : body.deviceName).trim(),
            hostname: text(body.hostname).trim(),
            assetId: text(body.assetId).trim(),
            location: text(body.location).trim(),
            user: text(body.user).trim(),
            reportedClassId: text(body.classId),
            managedClassId: text(body.managedClassId),
            version: text(body.version),
            platform: text(body.platform),
            activeUrl: text(body.activeUrl),
            activeTitle: text(body.activeTitle),
            locked: !!body.locked,
            policyVersion: Number(body.policyVersion) || 0,
            tempBlocks: Array.isArray(body.tempBlocks) ? body.tempBlocks.filter(item => item && typeof item.pattern === 'string').map(item => ({ pattern: item.pattern, until: Number(item.until) || 0 })) : [],
            tabs,
            lastSeen: now(),
        });
        const pending = found.commands.filter(command => command.deviceId === deviceId && command.status === 'queued');
        pending.forEach(command => { command.status = 'delivered'; command.updatedAt = now(); });
        prune(found);
        store.persist();
        notifyDevices(found);
        const device = found.devices[deviceId];
        res.json({
            commands: pending.map(({ id, type, payload }) => ({ id, type, payload })),
            policyVersion: found.policyVersion,
            assignment: { classId: device.assignedClassId || "", name: device.assignedName || "" },
            workspaceName: found.name,
            serverTime: now(),
        });
    });

    router.get('/orgs/:orgId/devices/:deviceId/command-ready', (req, res) => {
        const found = requireDevice(req, res);
        if (!found) return;
        const { deviceId } = req.params;
        if (!Object.hasOwn(found.devices, deviceId)) return res.status(404).json({ error: 'deviceNotFound' });
        const ready = found.commands.some(command => command.deviceId === deviceId && command.status === 'queued');
        waitForLiveUpdate(res, found.id + '/' + deviceId, ready ? { ready: true } : null, { ready: false });
    });

    router.post('/orgs/:orgId/devices/:deviceId/ack', express.json({ limit: '64kb' }), (req, res) => {
        const found = requireDevice(req, res);
        if (!found) return;
        const results = Array.isArray(req.body && req.body.results) ? req.body.results : [];
        const device = found.devices[req.params.deviceId];
        let changed = false;
        results.forEach(result => {
            const command = found.commands.find(item => item.id === result.id && item.deviceId === req.params.deviceId);
            if (!command || command.status !== 'delivered') return;
            changed = true;
            command.status = result.ok ? 'done' : 'failed';
            command.error = result.ok ? '' : text(result.error);
            command.updatedAt = now();
            if (device && result.ok && (command.type === 'lock' || command.type === 'unlock')) {
                device.locked = command.type === 'lock';
            }
        });
        store.persist();
        if (changed) notifyDevices(found);
        res.json({ ok: true });
    });

    router.get('/orgs/:orgId/devices', (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        prune(found);
        const devices = Object.values(found.devices).flatMap(device => {
            const classId = deviceClass(device);
            if (canManageClass(req.workspaceMember, classId)) return [publicDevice(found, device)];
            if (classId) return [];
            const { id, name, platform, lastSeen, online, assignmentVersion } = publicDevice(found, device);
            return [{ id, name, platform, lastSeen, online, assignmentVersion, classId: '' }];
        }).sort((a, b) => b.lastSeen - a.lastSeen);
        res.json({ devices, member: req.workspaceMember, revision: deviceRevisions.get(found.id) || '', policyVersion: found.policyVersion, serverTime: now() });
    });

    router.get('/orgs/:orgId/devices/changes', (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        const revision = deviceRevisions.get(found.id) || '';
        const after = text(req.query.after);
        waitForLiveUpdate(res, found.id, after !== revision ? { revision } : null, { revision });
    });

    router.post('/orgs/:orgId/devices/:deviceId/commands', express.json({ limit: '32kb' }), (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        const device = found.devices[req.params.deviceId];
        if (!device || !canManageClass(req.workspaceMember, deviceClass(device))) return res.status(404).json({ error: 'deviceNotFound' });
        const command = validateCommand(req.body);
        if (command.error) return res.status(400).json({ error: command.error });
        const record = Object.assign({ id: crypto.randomUUID(), deviceId: req.params.deviceId, status: 'queued', createdAt: now(), updatedAt: now() }, command);
        found.commands.push(record);
        store.persist();
        notifyLive(found.id + '/' + record.deviceId, { ready: true });
        notifyDevices(found);
        res.status(201).json({ command: record });
    });

    router.delete('/orgs/:orgId/devices/:deviceId', (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        delete found.devices[req.params.deviceId];
        found.commands = found.commands.filter(command => command.deviceId !== req.params.deviceId);
        store.persist();
        notifyLive(found.id + '/' + req.params.deviceId, { ready: false });
        notifyDevices(found);
        res.json({ ok: true });
    });

    router.put('/orgs/:orgId/devices/:deviceId', express.json({ limit: '16kb' }), (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        const device = found.devices[req.params.deviceId];
        if (!device) return res.status(404).json({ error: 'deviceNotFound' });
        const body = req.body || {};
        const assigning = typeof body.classId === 'string';
        const version = device.assignmentVersion || 0;
        if (body.assignmentVersion != null && body.assignmentVersion !== version) {
            return res.status(409).json({ error: 'deviceAssignmentChanged' });
        }
        if (assigning && device.managedClassId) return res.status(409).json({ error: 'deviceManagedClass' });
        if (assigning && body.classId && !found.policy?.classes.some(item => item?.id === body.classId)) {
            return res.status(400).json({ error: 'invalidDeviceClass' });
        }
        const teacher = requireDashboardSession
            ? (req.workspaceMember.role === 'teacher' ? req.workspaceMember : null)
            : body.teacher;
        if (teacher != null) {
            const classId = deviceClass(device);
            const classes = Array.isArray(teacher.classIds) ? teacher.classIds : [];
            if ((!requireDashboardSession && !ID.test(text(teacher.id))) || (classId && (!classes.includes(classId) || (device.assignedBy && device.assignedBy !== teacher.id))) ||
                (assigning && !classes.includes(body.classId))) {
                return res.status(403).json({ error: 'deviceAssignmentForbidden' });
            }
        }
        if (typeof body.name === 'string') device.assignedName = body.name.trim();
        if (assigning && body.classId !== device.assignedClassId) {
            device.assignedClassId = body.classId;
            device.assignedBy = body.classId ? (req.account?.id || teacher?.id || text(body.assignedBy)) : '';
            device.assignedAt = now();
            device.assignmentVersion = version + 1;
        }
        store.persist();
        notifyDevices(found);
        res.json({ device: publicDevice(found, device) });
    });

    router.get('/orgs/:orgId/devices/:deviceId/screen', (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        const device = found.devices[req.params.deviceId];
        if (!device?.screen || !canManageClass(req.workspaceMember, deviceClass(device))) return res.status(404).json({ error: 'noScreen' });
        res.type('image/jpeg').send(Buffer.from(device.screen.split(',')[1], 'base64'));
    });

    router.get('/orgs/:orgId/bypass', (req, res) => {
        const found = org(req, res);
        if (!found) return;
        const device = safeEqual(sha256(req.get('x-webfilter-enroll') || ''), found.enrollTokenHash);
        if (device) return res.json({ enabled: !!found.bypass });
        if (!requireAdmin(req, res)) return;
        res.json({ enabled: !!found.bypass, minutes: found.bypass ? found.bypass.minutes : 30, updatedAt: found.bypass ? found.bypass.updatedAt : 0 });
    });

    router.put('/orgs/:orgId/bypass', express.json({ limit: '16kb' }), (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        const password = text(req.body && req.body.password);
        const minutes = Number(req.body && req.body.minutes);
        if (password.length < 6) return res.status(400).json({ error: 'passwordTooShort' });
        if (!Number.isFinite(minutes) || minutes <= 0) return res.status(400).json({ error: 'invalidDuration' });
        found.bypass = Object.assign(hashPassword(password), { minutes, updatedAt: now() });
        store.persist();
        res.json({ enabled: true, minutes });
    });

    router.delete('/orgs/:orgId/bypass', (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        found.bypass = null;
        store.persist();
        res.json({ enabled: false });
    });

    router.post('/orgs/:orgId/bypass/verify', express.json({ limit: '16kb' }), async (req, res) => {
        const found = requireDevice(req, res);
        if (!found) return;
        const password = text(req.body && req.body.password);
        const ok = !!found.bypass && safeEqual(hashPassword(password, found.bypass.salt).hash, found.bypass.hash);
        found.bypassLog = (found.bypassLog || []).filter(item => item.at > now() - REQUEST_RETENTION_MS);
        found.bypassLog.push({ at: now(), ok, deviceId: text(req.body && req.body.deviceId), url: text(req.body && req.body.url) });
        store.persist();
        if (!ok) {
            // Slow down guessing: every wrong password waits before answering.
            await new Promise(resolve => setTimeout(resolve, 600));
            return res.status(403).json({ error: 'wrongPassword' });
        }
        res.json({ ok: true, minutes: found.bypass.minutes });
    });

    router.post('/orgs/:orgId/requests', express.json({ limit: '32kb' }), (req, res) => {
        const found = requireDevice(req, res);
        if (!found) return;
        const body = req.body || {};
        const deviceId = text(body.deviceId);
        if (!isWebUrl(body.url)) return res.status(400).json({ error: 'invalidUrl' });
        const device = found.devices[deviceId];
        if (!device) return res.status(404).json({ error: 'deviceNotFound' });
        const request = {
            id: crypto.randomUUID(),
            deviceId,
            url: String(body.url),
            reason: text(body.reason).trim(),
            user: text(body.user).trim() || device.user || '',
            classId: deviceClass(device),
            status: 'pending',
            createdAt: now(),
        };
        found.requests = (found.requests || []).filter(item => item.status === 'pending' || item.createdAt > now() - REQUEST_RETENTION_MS);
        found.requests.push(request);
        store.persist();
        res.status(201).json({ request: { id: request.id, status: request.status } });
    });

    router.get('/orgs/:orgId/requests/:requestId', (req, res) => {
        const found = requireDevice(req, res);
        if (!found) return;
        const request = (found.requests || []).find(item => item.id === req.params.requestId);
        if (!request || request.deviceId !== req.get('x-webfilter-device')) return res.status(404).json({ error: 'requestNotFound' });
        res.json({ request: { id: request.id, status: request.status } });
    });

    router.get('/orgs/:orgId/requests', (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        res.json({ requests: (found.requests || []).filter(item => canManageClass(req.workspaceMember, item.classId)).reverse() });
    });

    router.put('/orgs/:orgId/requests/:requestId', express.json({ limit: '16kb' }), (req, res) => {
        const found = requireMember(req, res);
        if (!found) return;
        const request = (found.requests || []).find(item => item.id === req.params.requestId);
        if (!request || !canManageClass(req.workspaceMember, request.classId)) return res.status(404).json({ error: 'requestNotFound' });
        const status = text(req.body && req.body.status);
        if (status !== 'approved' && status !== 'denied') return res.status(400).json({ error: 'invalidStatus' });
        if (request.status === status) return res.json({ request });
        if (request.status !== 'pending') return res.status(409).json({ error: 'requestAlreadyResolved' });
        Object.assign(request, { status, resolvedBy: req.account?.id || text(req.body.resolvedBy), resolvedAt: now() });
        store.persist();
        res.json({ request });
    });

    router.put('/orgs/:orgId/extension', express.raw({ type: 'application/x-chrome-extension', limit: '64mb' }), (req, res) => {
        const found = requireAdmin(req, res);
        if (!found) return;
        const appId = text(req.query.appId);
        const version = text(req.query.version);
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!APP_ID.test(appId) || !VERSION.test(version)) return res.status(400).json({ error: 'invalidPackage' });
        if (body.length < 16 || body.subarray(0, 4).toString('latin1') !== 'Cr24' || body.readUInt32LE(4) !== 3) return res.status(400).json({ error: 'invalidPackage' });
        const previous = found.extension;
        found.extension = { appId, version, size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), publishedAt: now() };
        try { store.savePackage(found.id, body); }
        catch (error) { found.extension = previous; throw error; }
        res.json({ extension: found.extension });
    });

    router.get('/orgs/:orgId/update.xml', (req, res) => {
        const found = org(req, res);
        if (!found) return;
        const base = (origin || (req.protocol + '://' + req.get('host'))) + req.baseUrl + '/orgs/' + found.id;
        const ext = found.extension;
        const app = ext
            ? `  <app appid="${ext.appId}">\n    <updatecheck codebase="${base}/extension.crx" version="${ext.version}" hash_sha256="${ext.sha256}"/>\n  </app>\n`
            : '';
        res.set('Cache-Control', 'no-cache').type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n${app}</gupdate>\n`);
    });

    router.get('/orgs/:orgId/extension.crx', (req, res) => {
        const found = org(req, res);
        if (!found) return;
        if (!found.extension) return res.status(404).json({ error: 'notPublished' });
        const body = store.readPackage(found.id);
        if (!body) return res.status(404).json({ error: 'notPublished' });
        res.set('Cache-Control', 'no-cache').type('application/x-chrome-extension').send(body);
    });

    router.use((error, req, res, next) => {
        if (error && (error.type === 'entity.too.large' || error.type === 'entity.parse.failed')) return res.status(400).json({ error: 'invalidBody' });
        next(error);
    });

    return router;
}

module.exports = { createWebFilterRouter, validateCommand };
