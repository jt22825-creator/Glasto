'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../shared/session');
const { createServer } = require('../server/server');

async function start(opts) {
  let now = Date.UTC(2026, 9, 4, 8, 0);
  const app = createServer(Object.assign({ dataFile: null, quiet: true, now: () => now, sendNtfy: async () => ({ status: 200 }) }, opts));
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, p, body, headers) => {
    const res = await fetch(base + p, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* not json */
    }
    return { status: res.status, json, text };
  };
  return { app, base, call, tick: (ms) => (now += ms), now: () => now };
}

test('health: live, stale, lost, never', () => {
  const t = 1_000_000;
  assert.equal(S.health(null, t), 'never');
  assert.equal(S.health(t - 5_000, t), 'live');
  assert.equal(S.health(t - 45_000, t), 'stale');
  assert.equal(S.health(t - 120_000, t), 'lost');
});

test('session ids are short and unambiguous', () => {
  for (let i = 0; i < 200; i++) assert.match(S.newSessionId(), /^S-[A-HJ-NP-Z2-9]{4}$/);
});

test('register a session with member/device/connection/VPN labels', async () => {
  const { app, call } = await start();
  try {
    const r = await call('POST', '/api/sessions', { member: 'Alex', device: 'iPhone', connection: 'Mobile', vpn: 'none', status: 'waiting' });
    assert.equal(r.status, 201);
    assert.match(r.json.id, /^S-/);
    assert.equal(r.json.member, 'Alex');
    assert.equal(r.json.vpn, 'none');
    assert.equal(r.json.available, true);
    assert.equal(r.json.source, 'manual');
    const bad = await call('POST', '/api/sessions', { device: 'x' });
    assert.equal(bad.status, 400);
  } finally {
    await app.shutdown();
  }
});

test('userscript heartbeat creates, updates and ages a session', async () => {
  const { app, call, tick } = await start();
  try {
    const hb = (body) => call('POST', '/api/sessions/S-SAM1/heartbeat', Object.assign({ source: 'userscript' }, body));
    let r = await hb({ member: 'Sam', device: 'Laptop', connection: 'Home broadband', status: 'waiting' });
    assert.equal(r.status, 200);
    assert.equal(r.json.config.timezone, 'Europe/London', 'heartbeat returns shared sale config');
    tick(5_000);
    await hb({ status: 'in_queue', queueEnteredAt: Date.UTC(2026, 9, 4, 8, 0, 3) });
    let state = (await call('GET', '/api/state')).json;
    let s = state.sessions[0];
    assert.equal(s.status, 'in_queue');
    assert.equal(s.health, 'live');
    assert.equal(s.queueEnteredAt, Date.UTC(2026, 9, 4, 8, 0, 3));

    tick(40_000);
    assert.equal((await call('GET', '/api/state')).json.sessions[0].health, 'stale');
    tick(60_000);
    assert.equal((await call('GET', '/api/state')).json.sessions[0].health, 'lost');
    app.store.sweep();
    assert.ok(app.store.state.events.some((e) => e.type === 'lost'));

    await hb({ status: 'booking', bookingDetectedAt: Date.UTC(2026, 9, 4, 8, 3) });
    state = (await call('GET', '/api/state')).json;
    s = state.sessions[0];
    assert.equal(s.health, 'live');
    assert.equal(s.status, 'booking');
    assert.equal(s.bookingDetectedAt, Date.UTC(2026, 9, 4, 8, 3));
  } finally {
    await app.shutdown();
  }
});

test('availability toggle, reset and remove', async () => {
  const { app, call } = await start();
  try {
    const { json: s } = await call('POST', '/api/sessions', { member: 'Jamie', device: 'Android', status: 'booking' });
    assert.ok(s.bookingDetectedAt);
    let r = await call('PATCH', `/api/sessions/${s.id}`, { available: false });
    assert.equal(r.json.available, false);
    r = await call('POST', `/api/sessions/${s.id}/reset`);
    assert.equal(r.json.status, 'unknown');
    assert.equal(r.json.bookingDetectedAt, null);
    r = await call('DELETE', `/api/sessions/${s.id}`);
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/api/state')).json.sessions.length, 0);
    assert.equal((await call('DELETE', `/api/sessions/${s.id}`)).status, 404);
  } finally {
    await app.shutdown();
  }
});

test('invalid ids, statuses and oversized labels are handled', async () => {
  const { app, call } = await start();
  try {
    assert.notEqual((await call('POST', '/api/sessions/../../x/heartbeat', {})).status, 200);
    assert.equal((await call('POST', '/api/sessions/nope/heartbeat', {})).status, 400);
    const r = await call('POST', '/api/sessions/S-ZZZZ/heartbeat', { member: 'x'.repeat(500), status: 'hacked' });
    assert.equal(r.json.session.status, 'unknown');
    assert.equal(r.json.session.member.length, 60);
  } finally {
    await app.shutdown();
  }
});

test('group key is required when configured', async () => {
  const { app, call } = await start({ groupKey: 'letmein' });
  try {
    assert.equal((await call('GET', '/api/state')).status, 401);
    assert.equal((await call('GET', '/api/state', null, { 'X-Group-Key': 'wrong' })).status, 401);
    assert.equal((await call('GET', '/api/state', null, { 'X-Group-Key': 'letmein' })).status, 200);
    assert.equal((await call('GET', '/api/state?key=letmein')).status, 200);
    assert.equal((await call('GET', '/')).status, 200, 'static dashboard page needs no key');
  } finally {
    await app.shutdown();
  }
});

test('config: sales and timezone validation', async () => {
  const { app, call } = await start();
  try {
    let r = await call('PUT', '/api/config', { timezone: 'Nowhere/City' });
    assert.equal(r.status, 400);
    r = await call('PUT', '/api/config', { salesText: 'Coach: whenever' });
    assert.equal(r.status, 400);
    r = await call('PUT', '/api/config', { groupName: 'Glasto crew', timezone: 'Europe/London', salesText: 'Coach sale: Thursday 18:00\nGeneral sale: Sunday 09:00' });
    assert.equal(r.status, 200);
    assert.equal(r.json.groupName, 'Glasto crew');
  } finally {
    await app.shutdown();
  }
});

test('state persists to disk and reloads', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'th-')), 'state.json');
  let app = createServer({ dataFile: file, quiet: true });
  app.store.register({ member: 'Alex', device: 'iPhone' });
  app.store.setConfig({ groupName: 'Persisted' });
  await app.shutdown();
  app = createServer({ dataFile: file, quiet: true });
  try {
    assert.equal(app.store.snapshot().sessions[0].member, 'Alex');
    assert.equal(app.store.state.config.groupName, 'Persisted');
  } finally {
    await app.shutdown();
  }
});

test('static files: dashboard, mock pages, userscript; no path traversal', async () => {
  const { app, call } = await start();
  try {
    assert.match((await call('GET', '/')).text, /Group Queue Dashboard/);
    assert.match((await call('GET', '/mock/queue.html')).text, /You are now in the queue/);
    assert.match((await call('GET', '/userscript/ticket-helper.user.js')).text, /==UserScript==/);
    assert.match((await call('GET', '/shared/detection.js')).text, /detectState/);
    const trav = await call('GET', '/mock/..%2f..%2fpackage.json');
    assert.notEqual(trav.status, 200);
  } finally {
    await app.shutdown();
  }
});

test('live updates stream (SSE) pushes state changes', async () => {
  const { app, base, call } = await start();
  try {
    const ctrl = new AbortController();
    const res = await fetch(base + '/api/events', { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const next = async () => {
      while (!buf.includes('\n\n')) buf += dec.decode((await reader.read()).value);
      const i = buf.indexOf('\n\n');
      const msg = JSON.parse(buf.slice(6, i));
      buf = buf.slice(i + 2);
      return msg;
    };
    assert.equal((await next()).type, 'state');
    await call('POST', '/api/sessions', { member: 'Alex' });
    const m = await next();
    assert.equal(m.state.sessions[0].member, 'Alex');
    ctrl.abort();
  } finally {
    await app.shutdown();
  }
});
