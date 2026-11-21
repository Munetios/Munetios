'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createWebFilterRouter } = require('./router');

async function serve(t, options = {}) {
    const app = express(); app.use('/api/webfilter', createWebFilterRouter(options));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/webfilter`;
    return (route, init = {}) => fetch(base + route, init);
}
const json = (method, body, headers = {}) => ({ method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });

test('policy publishing needs the admin key and devices read it with the enrollment token', async t => {
    const request = await serve(t);
    const created = await (await request('/orgs', json('POST', { name: 'School' }))).json();
    const admin = { Authorization: 'Bearer ' + created.adminKey };
    const device = { 'X-WebFilter-Enroll': created.enrollToken };
    const policy = { global: { rules: [{ type: 'domain', value: 'games.example', action: 'block' }] }, classes: [] };
    assert.equal((await request(`/orgs/${created.orgId}/policy`, json('PUT', { policy }))).status, 401);
    assert.equal((await request(`/orgs/${created.orgId}/policy`, json('PUT', { policy }, { Authorization: 'Bearer ' + created.enrollToken }))).status, 401);
    const put = await request(`/orgs/${created.orgId}/policy`, json('PUT', { policy }, admin));
    assert.equal((await put.json()).version, 1);
    assert.equal((await request(`/orgs/${created.orgId}/policy`)).status, 401);
    const read = await (await request(`/orgs/${created.orgId}/policy`, { headers: device })).json();
    assert.equal(read.policy.global.rules[0].value, 'games.example');
    assert.equal((await request('/orgs/not-an-org!/policy', { headers: device })).status, 404);
});

test('device assignments protect teacher ownership and stay consistent across check-ins', async t => {
    const request = await serve(t);
    const org = await (await request('/orgs', json('POST', {}))).json();
    const base = `/orgs/${org.orgId}`;
    const admin = { Authorization: 'Bearer ' + org.adminKey };
    const enroll = { 'X-WebFilter-Enroll': org.enrollToken };
    const deviceId = 'device-cart-1';
    const beat = body => request(base + '/devices/heartbeat', json('POST', { deviceId, platform: 'cros', ...body }, enroll));
    const update = body => request(base + '/devices/' + deviceId, json('PUT', body, admin));
    const first = { id: 'teacher-one', classIds: ['class-one', 'class-two'] };
    const other = { id: 'teacher-two', classIds: ['class-one', 'class-two'] };
    await request(base + '/policy', json('PUT', { policy: { global: {}, classes: [{ id: 'class-one' }, { id: 'class-two' }] } }, admin));
    await beat({ assetId: 'Cart 1' });
    assert.equal((await update({ teacher: { ...first, classIds: ['class-two'] }, classId: 'class-one' })).status, 403);
    const result = await update({ teacher: first, classId: 'class-one', assignmentVersion: 0 });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).device.assignedBy, first.id);
    assert.equal((await update({ teacher: other, classId: 'class-one', assignmentVersion: 0 })).status, 409);
    assert.equal((await update({ teacher: other, classId: 'class-two', assignmentVersion: 1 })).status, 403);
    assert.equal((await update({ teacher: other, name: 'Other cart', assignmentVersion: 1 })).status, 403);
    assert.equal((await update({ teacher: first, name: 'Library cart', assignmentVersion: 1 })).status, 200);
    assert.deepEqual((await (await beat({ deviceName: 'Library cart', reportedName: 'Cart 1', classId: 'class-one' })).json()).assignment,
        { classId: 'class-one', name: 'Library cart' });
    const cleared = await (await update({ classId: '', name: '', assignmentVersion: 1 })).json();
    assert.equal(cleared.device.classId, '');
    assert.equal(cleared.device.assignedBy, '');
    assert.equal(cleared.device.name, 'Cart 1');
    await beat({ classId: 'class-two', managedClassId: 'class-two' });
    assert.equal((await update({ classId: 'class-one' })).status, 409);
});

test('remote screen serves the newest frame and clears it when capture becomes unavailable', async t => {
    let now = 1000;
    const request = await serve(t, { now: () => now });
    const org = await (await request('/orgs', json('POST', {}))).json();
    const base = `/orgs/${org.orgId}/devices`;
    const admin = { Authorization: 'Bearer ' + org.adminKey };
    const deviceId = 'device-screen-1';
    const enroll = { 'X-WebFilter-Enroll': org.enrollToken };
    const heartbeat = body => request(base + '/heartbeat', json('POST', { deviceId, ...body }, enroll));
    const screen = headers => request(`${base}/${deviceId}/screen`, { headers });
    const state = async () => (await (await request(base, { headers: admin })).json()).devices[0];

    await heartbeat({ screen: 'data:image/jpeg;base64,/9gB/9k=' });
    assert.equal((await state()).screenAt, 1000);
    assert.equal((await screen(enroll)).status, 401);
    now = 2000;
    await heartbeat({ screen: 'data:image/jpeg;base64,/9gC/9k=' });
    assert.equal((await state()).screenAt, 2000);
    assert.equal(Buffer.from(await (await screen(admin)).arrayBuffer()).toString('base64'), '/9gC/9k=');
    await heartbeat({});
    assert.equal((await state()).hasScreen, true);
    await heartbeat({ screen: '' });
    assert.equal((await state()).hasScreen, false);
    assert.equal((await screen(admin)).status, 404);
});

test('access requests stay tied to their device and bypass passwords can be changed or removed', async t => {
    const request = await serve(t);
    const org = await (await request('/orgs', json('POST', {}))).json();
    const base = `/orgs/${org.orgId}`;
    const admin = { Authorization: 'Bearer ' + org.adminKey };
    const enroll = { 'X-WebFilter-Enroll': org.enrollToken };
    const deviceId = 'device-123456';
    await request(base + '/devices/heartbeat', json('POST', { deviceId }, enroll));
    const submitted = await request(base + '/requests', json('POST', { deviceId, url: 'https://example.org/lesson' }, enroll));
    assert.equal(submitted.status, 201);
    const { id } = (await submitted.json()).request;
    assert.equal((await request(base + '/requests/' + id, { headers: { ...enroll, 'X-WebFilter-Device': 'device-different' } })).status, 404);
    assert.equal((await request(base + '/requests/' + id, json('PUT', { status: 'approved' }, admin))).status, 200);
    assert.equal((await request(base + '/requests/' + id, json('PUT', { status: 'denied' }, admin))).status, 409);
    assert.equal((await (await request(base + '/requests/' + id, { headers: { ...enroll, 'X-WebFilter-Device': deviceId } })).json()).request.status, 'approved');
    const setPassword = (password, minutes) => request(base + '/bypass', json('PUT', { password, minutes }, admin));
    const verify = password => request(base + '/bypass/verify', json('POST', { password, deviceId, url: 'https://example.org/lesson' }, enroll));
    assert.equal((await setPassword('first-test', 15)).status, 200);
    assert.deepEqual(await (await request(base + '/bypass', { headers: enroll })).json(), { enabled: true });
    assert.deepEqual(await (await verify('first-test')).json(), { ok: true, minutes: 15 });
    assert.equal((await setPassword('second-test', 25)).status, 200);
    assert.equal((await verify('first-test')).status, 403);
    assert.deepEqual(await (await verify('second-test')).json(), { ok: true, minutes: 25 });
    assert.equal((await request(base + '/bypass', { method: 'DELETE', headers: admin })).status, 200);
    assert.equal((await (await request(base + '/bypass', { headers: admin })).json()).enabled, false);
});

test('remote commands are validated, delivered once, and acknowledged', async t => {
    let clock = 1000;
    const request = await serve(t, { now: () => clock });
    const created = await (await request('/orgs', json('POST', {}))).json();
    const admin = { Authorization: 'Bearer ' + created.adminKey };
    const device = { 'X-WebFilter-Enroll': created.enrollToken };
    const beat = body => request(`/orgs/${created.orgId}/devices/heartbeat`, json('POST', Object.assign({ deviceId: 'device-123456', deviceName: 'Cart 4', user: 'student@school.example', classId: 'c1', version: '1.0.0', activeUrl: 'https://wiki.example', tabs: [{ id: 7, url: 'https://wiki.example', title: 'Wiki', active: true }] }, body), device));
    assert.equal((await beat({ deviceId: 'bad id' })).status, 400);
    assert.deepEqual((await (await beat()).json()).commands, []);
    const queue = body => request(`/orgs/${created.orgId}/devices/device-123456/commands`, json('POST', body, admin));
    assert.equal((await queue({ type: 'format_disk' })).status, 400);
    assert.equal((await queue({ type: 'open_tab', payload: { url: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await queue({ type: 'temp_block', payload: { pattern: 'games.example', minutes: 0 } })).status, 400);
    assert.equal((await queue({ type: 'notice', payload: { message: '' } })).status, 400);
    assert.equal((await queue({ type: 'lock', payload: { message: 'Eyes up front' } })).status, 201);
    assert.equal((await queue({ type: 'close_tab', payload: { tabId: 7 } })).status, 201);
    const first = await (await beat()).json();
    assert.deepEqual(first.commands.map(c => c.type), ['lock', 'close_tab']);
    assert.deepEqual((await (await beat()).json()).commands, []);
    await request(`/orgs/${created.orgId}/devices/device-123456/ack`, json('POST', { results: [{ id: first.commands[0].id, ok: true }, { id: first.commands[1].id, ok: false, error: 'tabNotFound' }] }, device));
    const list = await (await request(`/orgs/${created.orgId}/devices`, { headers: admin })).json();
    assert.equal(list.devices[0].online, true);
    assert.equal(list.devices[0].name, 'Cart 4');
    assert.equal(list.devices[0].locked, true);
    assert.deepEqual(list.devices[0].commands.map(c => c.status).sort(), ['done', 'failed']);
    assert.equal((await queue({ type: 'unlock' })).status, 201);
    const { commands: [unlock] } = await (await beat({ locked: true })).json();
    assert.equal(unlock.type, 'unlock');
    await request(`/orgs/${created.orgId}/devices/device-123456/ack`, json('POST', { results: [{ id: unlock.id, ok: true }] }, device));
    const afterUnlock = await (await request(`/orgs/${created.orgId}/devices`, { headers: admin })).json();
    assert.equal(afterUnlock.devices[0].locked, false);
    clock += 120000;
    assert.equal((await (await request(`/orgs/${created.orgId}/devices`, { headers: admin })).json()).devices[0].online, false);
    assert.equal((await request(`/orgs/${created.orgId}/devices`, { headers: device })).status, 401);
});

test('connected devices and dashboards wake immediately when a remote command changes', async t => {
    const request = await serve(t);
    const org = await (await request('/orgs', json('POST', {}))).json();
    const base = `/orgs/${org.orgId}/devices`;
    const id = 'device-live-123';
    const admin = { Authorization: 'Bearer ' + org.adminKey };
    const enroll = { 'X-WebFilter-Enroll': org.enrollToken };
    const beat = () => request(base + '/heartbeat', json('POST', { deviceId: id }, enroll));
    const list = async () => (await (await request(base, { headers: admin })).json());
    const ready = headers => request(`${base}/${id}/command-ready`, { headers, signal: AbortSignal.timeout(4000) });
    const changes = revision => request(`${base}/changes?after=${revision}`, { headers: admin, signal: AbortSignal.timeout(4000) });

    await beat();
    assert.equal((await ready(admin)).status, 401);
    assert.equal((await request(base + '/changes', { headers: enroll })).status, 401);
    const initial = await list();
    const waitingOnCommand = ready(enroll);
    const waitingOnDashboard = changes(initial.revision);
    const queued = await request(`${base}/${id}/commands`, json('POST', { type: 'unlock' }, admin));
    assert.equal(queued.status, 201);
    assert.deepEqual(await (await waitingOnCommand).json(), { ready: true });
    assert.notEqual((await (await waitingOnDashboard).json()).revision, initial.revision);

    const { commands: [command] } = await (await beat()).json();
    assert.equal(command.type, 'unlock');
    const delivered = await list();
    const waitingOnAck = changes(delivered.revision);
    await request(`${base}/${id}/ack`, json('POST', { results: [{ id: command.id, ok: true }] }, enroll));
    assert.notEqual((await (await waitingOnAck).json()).revision, delivered.revision);
    assert.equal((await list()).devices[0].commands[0].status, 'done');
});

test('self-hosted update manifest and CRX are served after publishing', async t => {
    const request = await serve(t);
    const created = await (await request('/orgs', json('POST', {}))).json();
    const admin = { Authorization: 'Bearer ' + created.adminKey };
    const empty = await (await request(`/orgs/${created.orgId}/update.xml`)).text();
    assert.doesNotMatch(empty, /<app /);
    const crx = Buffer.alloc(32); crx.write('Cr24', 0, 'latin1'); crx.writeUInt32LE(3, 4);
    const appId = 'abcdefghijklmnopabcdefghijklmnop';
    assert.equal((await request(`/orgs/${created.orgId}/extension?appId=${appId}&version=1.0.0`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/x-chrome-extension' }, admin), body: Buffer.from('nope') })).status, 400);
    const put = await request(`/orgs/${created.orgId}/extension?appId=${appId}&version=1.0.1`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/x-chrome-extension' }, admin), body: crx });
    assert.equal(put.status, 200);
    const xml = await (await request(`/orgs/${created.orgId}/update.xml`)).text();
    assert.match(xml, new RegExp(`appid="${appId}"`));
    assert.match(xml, /version="1\.0\.1"/);
    const download = await request(`/orgs/${created.orgId}/extension.crx`);
    assert.equal(download.headers.get('content-type'), 'application/x-chrome-extension');
    assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 4).toString('latin1'), 'Cr24');
});

test('dashboard naming and class assignment win over what the device reports', async t => {
    const request = await serve(t);
    const created = await (await request('/orgs', json('POST', {}))).json();
    const admin = { Authorization: 'Bearer ' + created.adminKey };
    const device = { 'X-WebFilter-Enroll': created.enrollToken };
    const beat = () => request(`/orgs/${created.orgId}/devices/heartbeat`, json('POST', { deviceId: 'device-abcdef12', deviceName: '', hostname: 'CB-1234', classId: '', platform: 'cros' }, device));
    await beat();
    await request(`/orgs/${created.orgId}/policy`, json('PUT', { policy: { global: {}, classes: [{ id: 'bio', name: 'Biology' }] } }, admin));
    let list = await (await request(`/orgs/${created.orgId}/devices`, { headers: admin })).json();
    assert.equal(list.devices[0].name, 'CB-1234');
    assert.equal((await request(`/orgs/${created.orgId}/devices/device-abcdef12`, json('PUT', { classId: 'no-such-class' }, admin))).status, 400);
    assert.equal((await request(`/orgs/${created.orgId}/devices/device-abcdef12`, json('PUT', { name: 'Library 12', classId: 'bio' }, device))).status, 401);
    await request(`/orgs/${created.orgId}/devices/device-abcdef12`, json('PUT', { name: 'Library 12', classId: 'bio', assignedBy: 'teacher-1' }, admin));
    const answer = await (await beat()).json();
    assert.deepEqual(answer.assignment, { classId: 'bio', name: 'Library 12' });
    list = await (await request(`/orgs/${created.orgId}/devices`, { headers: admin })).json();
    assert.equal(list.devices[0].name, 'Library 12');
    assert.equal(list.devices[0].classId, 'bio');
    assert.equal(list.devices[0].assignedBy, 'teacher-1');
});

test('screens are stored per device and served only to the admin', async t => {
    const request = await serve(t);
    const created = await (await request('/orgs', json('POST', {}))).json();
    const admin = { Authorization: 'Bearer ' + created.adminKey };
    const device = { 'X-WebFilter-Enroll': created.enrollToken };
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
    await request(`/orgs/${created.orgId}/devices/heartbeat`, json('POST', { deviceId: 'device-abcdef12', screen: jpeg }, device));
    await request(`/orgs/${created.orgId}/devices/heartbeat`, json('POST', { deviceId: 'device-bbbbbb12', screen: '<script>bad</script>' }, device));
    const list = await (await request(`/orgs/${created.orgId}/devices`, { headers: admin })).json();
    assert.ok(list.devices.every(item => item.screen === undefined));
    assert.deepEqual(list.devices.map(item => item.hasScreen).sort(), [false, true]);
    const screen = await request(`/orgs/${created.orgId}/devices/device-abcdef12/screen`, { headers: admin });
    assert.equal(screen.headers.get('content-type'), 'image/jpeg');
    assert.equal((await request(`/orgs/${created.orgId}/devices/device-abcdef12/screen`, { headers: device })).status, 401);
});

test('bypass password is hashed, verified for devices, and wrong guesses are refused', async t => {
    const request = await serve(t);
    const created = await (await request('/orgs', json('POST', {}))).json();
    const admin = { Authorization: 'Bearer ' + created.adminKey };
    const device = { 'X-WebFilter-Enroll': created.enrollToken };
    const verify = password => request(`/orgs/${created.orgId}/bypass/verify`, json('POST', { password, url: 'https://games.example', deviceId: 'device-abcdef12' }, device));
    assert.equal((await verify('anything')).status, 403);
    assert.equal((await request(`/orgs/${created.orgId}/bypass`, json('PUT', { password: '123', minutes: 20 }, admin))).status, 400);
    assert.equal((await request(`/orgs/${created.orgId}/bypass`, json('PUT', { password: 'staff-only-42', minutes: 20 }, device))).status, 401);
    await request(`/orgs/${created.orgId}/bypass`, json('PUT', { password: 'staff-only-42', minutes: 20 }, admin));
    assert.deepEqual((await (await request(`/orgs/${created.orgId}/bypass`, { headers: admin })).json()).enabled, true);
    assert.equal((await verify('wrong-password')).status, 403);
    const ok = await verify('staff-only-42');
    assert.deepEqual(await ok.json(), { ok: true, minutes: 20 });
    await request(`/orgs/${created.orgId}/bypass`, { method: 'DELETE', headers: admin });
    assert.equal((await verify('staff-only-42')).status, 403);
});

test('access requests flow from the block page to the dashboard and back', async t => {
    const request = await serve(t);
    const created = await (await request('/orgs', json('POST', {}))).json();
    const admin = { Authorization: 'Bearer ' + created.adminKey };
    const device = { 'X-WebFilter-Enroll': created.enrollToken };
    await request(`/orgs/${created.orgId}/devices/heartbeat`, json('POST', { deviceId: 'device-abcdef12' }, device));
    assert.equal((await request(`/orgs/${created.orgId}/requests`, json('POST', { deviceId: 'device-abcdef12', url: 'javascript:alert(1)' }, device))).status, 400);
    const sent = await (await request(`/orgs/${created.orgId}/requests`, json('POST', { deviceId: 'device-abcdef12', url: 'https://science.example/lab', reason: 'Lab report', user: 'student@school.example' }, device))).json();
    assert.equal(sent.request.status, 'pending');
    const list = await (await request(`/orgs/${created.orgId}/requests`, { headers: admin })).json();
    assert.equal(list.requests[0].reason, 'Lab report');
    assert.equal((await request(`/orgs/${created.orgId}/requests`, { headers: device })).status, 401);
    assert.equal((await request(`/orgs/${created.orgId}/requests/${sent.request.id}`, json('PUT', { status: 'maybe' }, admin))).status, 400);
    await request(`/orgs/${created.orgId}/requests/${sent.request.id}`, json('PUT', { status: 'approved', resolvedBy: 'teacher-1' }, admin));
    assert.equal((await request(`/orgs/${created.orgId}/requests/${sent.request.id}`, { headers: device })).status, 404);
    const status = await (await request(`/orgs/${created.orgId}/requests/${sent.request.id}`, { headers: Object.assign({ 'X-WebFilter-Device': 'device-abcdef12' }, device) })).json();
    assert.equal(status.request.status, 'approved');
});
