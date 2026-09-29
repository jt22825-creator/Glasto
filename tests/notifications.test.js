'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../notifications/ntfy');
const { createServer } = require('../server/server');
const { startFakeNtfy } = require('./helpers/fake-ntfy');

const AT = Date.UTC(2026, 9, 4, 8, 3, 12); // 09:03:12 BST

test('booking notification matches the "SAM — BOOKING PAGE DETECTED" format', () => {
  const n = N.bookingNotification({
    member: 'Sam',
    device: 'Laptop',
    connection: 'Home broadband',
    vpn: 'none',
    sessionId: 'S-AB12',
    at: AT,
    timezone: 'Europe/London',
    dashboardUrl: 'http://192.168.1.20:8787/',
  });
  assert.equal(n.title, 'SAM — BOOKING PAGE DETECTED');
  assert.match(n.message, /Sam reached the booking page at 09:03:12 \(Europe\/London\)/);
  assert.match(n.message, /Laptop · Home broadband · none/);
  assert.match(n.message, /S-AB12/);
  assert.match(n.message, /Dashboard: http:\/\/192\.168\.1\.20:8787\//);
  assert.equal(n.click, 'http://192.168.1.20:8787/');
  assert.equal(n.priority, 5);
});

test('booking notification without optional fields', () => {
  const n = N.bookingNotification({ at: AT });
  assert.equal(n.title, 'SOMEONE — BOOKING PAGE DETECTED');
  assert.equal(n.click, undefined);
  assert.doesNotMatch(n.message, /Dashboard/);
});

test('buildRequest publishes JSON to the server root with optional token', () => {
  const r = N.buildRequest({ server: 'https://ntfy.example.org/', topic: 'our-group_1', token: 'tk_abc' }, { title: 'T', message: 'M', tags: ['x'] });
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://ntfy.example.org');
  assert.equal(r.headers.Authorization, 'Bearer tk_abc');
  assert.deepEqual(JSON.parse(r.body), { topic: 'our-group_1', title: 'T', message: 'M', tags: ['x'] });
  assert.equal(N.buildRequest({ topic: 'abc' }, { title: 't' }).url, 'https://ntfy.sh');
});

test('topic validation', () => {
  assert.equal(N.isValidTopic('glasto-2027_xk29'), true);
  for (const bad of ['', 'has space', 'a/b', 'x'.repeat(65), null]) assert.equal(N.isValidTopic(bad), false, String(bad));
  assert.throws(() => N.buildRequest({ topic: 'bad topic' }, {}), /topic/);
});

test('send uses the given transport and rejects non-2xx', async () => {
  const calls = [];
  await N.send({ topic: 't1' }, { title: 'x' }, async (req) => {
    calls.push(req);
    return { status: 200 };
  });
  assert.equal(calls.length, 1);
  await assert.rejects(N.send({ topic: 't1' }, { title: 'x' }, async () => ({ status: 403 })), /HTTP 403/);
});

test('send with default fetch transport reaches an ntfy-compatible server', async () => {
  const fake = await startFakeNtfy();
  try {
    await N.send({ server: fake.url, topic: 'grp' }, N.bookingNotification({ member: 'Alex', at: AT }));
    assert.equal(fake.received.length, 1);
    assert.equal(fake.received[0].json.topic, 'grp');
    assert.equal(fake.received[0].json.title, 'ALEX — BOOKING PAGE DETECTED');
  } finally {
    await fake.close();
  }
});

test('sale alert notification text', () => {
  const n = N.saleAlertNotification(
    { kind: '1min', message: 'Coach sale starts in 1 minute', sale: { label: 'Coach sale', at: Date.UTC(2026, 9, 1, 17, 0) } },
    { timezone: 'Europe/London' }
  );
  assert.equal(n.title, 'Coach sale starts in 1 minute');
  assert.match(n.message, /Coach sale at 18:00:00 \(Europe\/London\)/);
});

// ---------------------------------------------------------------- server-side group notification

function serverWithFakeSend(extra) {
  const sent = [];
  let now = AT;
  const app = createServer(
    Object.assign(
      {
        dataFile: null,
        quiet: true,
        now: () => now,
        sendNtfy: async (cfg, n) => {
          sent.push({ cfg, n });
          return { status: 200 };
        },
      },
      extra
    )
  );
  return { app, sent, setNow: (t) => (now = t) };
}

test('dashboard notifies the group once when a session reaches booking', async () => {
  const { app, sent } = serverWithFakeSend();
  try {
    app.store.setConfig({ ntfy: { enabled: true, topic: 'grp' }, dashboardUrl: 'http://dash/' });
    app.store.heartbeat('S-SAM1', { member: 'Sam', device: 'Laptop', connection: 'Home broadband', status: 'in_queue' });
    assert.equal(sent.length, 0);
    app.store.heartbeat('S-SAM1', { status: 'booking', bookingDetectedAt: AT });
    app.store.heartbeat('S-SAM1', { status: 'booking' });
    await new Promise((r) => setImmediate(r));
    assert.equal(sent.length, 1, 'exactly one notification');
    assert.equal(sent[0].n.title, 'SAM — BOOKING PAGE DETECTED');
    assert.match(sent[0].n.message, /09:03:12/);
    assert.match(sent[0].n.message, /Dashboard: http:\/\/dash\//);
    assert.equal(sent[0].cfg.topic, 'grp');
  } finally {
    await app.shutdown();
  }
});

test('no group notification when ntfy is disabled, but the event is logged', async () => {
  const { app, sent } = serverWithFakeSend();
  try {
    app.store.heartbeat('S-ALX1', { member: 'Alex', status: 'booking' });
    await new Promise((r) => setImmediate(r));
    assert.equal(sent.length, 0);
    assert.ok(app.store.state.events.some((e) => e.type === 'booking'));
  } finally {
    await app.shutdown();
  }
});

test('dashboard sends 5-minute, 1-minute and start alerts once each', async () => {
  const { app, sent, setNow } = serverWithFakeSend();
  try {
    const start = Date.UTC(2026, 9, 1, 17, 0);
    setNow(start - 10 * 60 * 1000);
    app.store.setConfig({ ntfy: { enabled: true, topic: 'grp' }, salesText: 'Coach sale: 2026-10-01 18:00', timezone: 'Europe/London' });
    for (let t = start - 10 * 60 * 1000; t <= start + 60 * 1000; t += 1000) {
      setNow(t);
      app.checkSaleAlerts();
    }
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(sent.map((s) => s.n.title), ['Coach sale starts in 5 minutes', 'Coach sale starts in 1 minute', 'Coach sale has started']);
  } finally {
    await app.shutdown();
  }
});

test('failed ntfy delivery is recorded, not thrown', async () => {
  const { app } = serverWithFakeSend({
    sendNtfy: async () => {
      throw new Error('ntfy returned HTTP 429');
    },
  });
  try {
    app.store.setConfig({ ntfy: { enabled: true, topic: 'grp' } });
    app.store.heartbeat('S-JAM1', { member: 'Jamie', status: 'booking' });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(app.store.state.events.some((e) => e.type === 'notify_failed' && /429/.test(e.text)));
  } finally {
    await app.shutdown();
  }
});

test('config rejects an invalid topic when enabling ntfy', async () => {
  const { app } = serverWithFakeSend();
  try {
    assert.throws(() => app.store.setConfig({ ntfy: { enabled: true, topic: 'no spaces allowed' } }), /topic/);
    const c = app.store.setConfig({ ntfy: { enabled: true, topic: 'ok-topic', token: 'secret' } });
    assert.equal(c.ntfy.token, '********', 'token is never sent back to browsers');
    app.store.setConfig({ ntfy: { token: '********' } });
    assert.equal(app.store.state.config.ntfy.token, 'secret', 'masked token round-trips unchanged');
  } finally {
    await app.shutdown();
  }
});
