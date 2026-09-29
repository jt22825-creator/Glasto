'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');

let servers;
let browser;
before(async () => {
  servers = await h.startServers();
  browser = await h.launch();
});
after(async () => {
  await browser.close();
  await servers.close();
});

const url = (p) => `${servers.base}/mock/${p}`;

test('queue and booking detection on every mock page', async () => {
  const ctx = await h.newHelperContext(browser, { useDashboardSales: false });
  const page = await ctx.newPage();
  const expected = [
    ['presale.html', 'waiting', 'WAITING'],
    ['queue.html', 'in_queue', 'IN QUEUE'],
    ['long-queue.html', 'in_queue', 'IN QUEUE'],
    ['queue-progress.html?stay=1', 'in_queue', 'IN QUEUE'],
    ['booking.html', 'booking', 'BOOKING AVAILABLE'],
    ['unknown.html', 'unknown', 'UNKNOWN'],
  ];
  for (const [p, s, label] of expected) {
    await page.goto(url(p));
    await h.waitForState(page, s);
    assert.equal(await page.locator('ticket-helper-ui [data-el="state"]').textContent(), label, p);
  }
  await ctx.close();
});

test('pre-sale page moves into the queue on its own and the helper follows', async () => {
  const ctx = await h.newHelperContext(browser, {});
  const page = await ctx.newPage();
  await page.goto(url('presale.html?queueIn=1&stay=1'));
  await h.waitForState(page, 'in_queue', 8000);
  await ctx.close();
});

test('queue → booking: alarm, flashing, desktop notification, recorded times, event log', async () => {
  const ctx = await h.newHelperContext(browser, { member: 'Sam', device: 'Laptop' });
  const page = await ctx.newPage();
  await page.goto(url('queue-progress.html?start=3'));
  await h.waitForState(page, 'in_queue');
  const beepsBefore = Number((await h.read(page, 'rec:beeps')) || 0);
  await page.waitForURL(/booking\.html/, { timeout: 10000 });
  await h.waitForState(page, 'booking');

  // Alarm sounds and page flashes.
  await page.waitForSelector('ticket-helper-ui[data-alarm]', { state: 'attached' });
  await h.waitFor(async () => Number(await h.read(page, 'rec:beeps')) > beepsBefore + 2, 5000, 'alarm beeps');
  await h.waitFor(async () => (await page.title()).includes('🚨'), 3000, 'flashing title');

  // Desktop notification.
  const notes = await h.read(page, 'rec:notifications');
  assert.ok(notes.some((n) => n.title === 'BOOKING AVAILABLE' && /Sam/.test(n.text)), JSON.stringify(notes));

  // Times recorded in tab storage and the event log.
  const tab = await page.evaluate(() => JSON.parse(sessionStorage.getItem('gm-tab')));
  assert.ok(tab.queueEnteredAt > 0 && tab.bookingDetectedAt > tab.queueEnteredAt, JSON.stringify(tab));
  const log = (await h.read(page, 'gm:eventLog')).map((e) => e.type);
  assert.ok(log.indexOf('queue_entered') < log.indexOf('booking_detected'), log.join(','));
  assert.ok(log.includes('alarm_started'));

  // Stop alarm by clicking the badge; reload does not re-alarm.
  await page.locator('ticket-helper-ui .badge').click();
  await page.waitForSelector('ticket-helper-ui:not([data-alarm])', { state: 'attached' });
  await page.reload();
  await h.waitForState(page, 'booking');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('ticket-helper-ui[data-alarm]').count(), 0, 'no repeat alarm after reload');
  await ctx.close();
});

test('refresh protection blocks F5, Ctrl+R and Cmd+R only while in the queue', async () => {
  const ctx = await h.newHelperContext(browser, {});
  const page = await ctx.newPage();
  const probe = (init) =>
    page.evaluate((i) => {
      const e = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, i));
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }, init);

  await page.goto(url('queue.html'));
  await h.waitForState(page, 'in_queue');
  assert.equal(await page.locator('ticket-helper-ui').getAttribute('data-protected'), '');
  assert.equal(await probe({ key: 'F5', code: 'F5' }), true, 'F5');
  assert.equal(await probe({ key: 'r', code: 'KeyR', ctrlKey: true }), true, 'Ctrl+R');
  assert.equal(await probe({ key: 'r', code: 'KeyR', metaKey: true }), true, 'Cmd+R');
  assert.equal(await probe({ key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true }), true, 'Ctrl+Shift+R');
  assert.equal(await probe({ key: 'r', code: 'KeyR' }), false, 'plain r is not blocked');

  // Real key presses: the page must survive (not reload) and the block is logged.
  await page.evaluate(() => (window.__marker = 42));
  await page.keyboard.press('F5');
  await page.keyboard.press('Control+r');
  assert.equal(await page.evaluate(() => window.__marker), 42);
  const log = (await h.read(page, 'gm:eventLog')).filter((e) => e.type === 'refresh_blocked');
  assert.ok(log.length >= 4, 'refresh_blocked logged');
  await page.waitForSelector('ticket-helper-ui >> .toast', { state: 'attached' });

  // Emergency control turns protection off for this tab.
  await page.locator('ticket-helper-ui .emergency').click();
  await page.waitForSelector('ticket-helper-ui:not([data-protected])', { state: 'attached' });
  assert.equal(await probe({ key: 'F5', code: 'F5' }), false, 'F5 allowed after disabling');

  // Not in the queue → never blocked.
  await page.evaluate(() => sessionStorage.removeItem('gm-tab'));
  await page.goto(url('booking.html'));
  await h.waitForState(page, 'booking');
  assert.equal(await probe({ key: 'F5', code: 'F5' }), false, 'F5 allowed on booking page');
  await ctx.close();
});

test('optional beforeunload warning while in the queue', async () => {
  const ctx = await h.newHelperContext(browser, { protectUnload: true });
  const page = await ctx.newPage();
  await page.goto(url('queue.html'));
  await h.waitForState(page, 'in_queue');
  await page.mouse.click(50, 300); // browsers only show the prompt after a user gesture
  const dialog = new Promise((resolve) => page.once('dialog', (d) => resolve(d)));
  await page.close({ runBeforeUnload: true });
  const d = await dialog;
  assert.equal(d.type(), 'beforeunload');
  await d.accept();
  await ctx.close();
});

test('heartbeat registers the session on the dashboard and the dashboard notifies the group', async () => {
  servers.app.store.setConfig({ ntfy: { enabled: true, server: servers.ntfy.url, topic: 'e2e-group' }, dashboardUrl: servers.base });
  const before = servers.ntfy.received.length;
  const ctx = await h.newHelperContext(browser, {
    member: 'Sam',
    device: 'Laptop',
    connection: 'Home broadband',
    vpn: 'none',
    dashboardUrl: servers.base,
    ntfyTopic: 'should-not-be-used',
    ntfyServer: servers.ntfy.url,
  });
  const page = await ctx.newPage();
  await page.goto(url('queue-progress.html?start=4'));
  await h.waitForState(page, 'in_queue');
  const sessionId = await h.waitFor(() => page.evaluate(() => (JSON.parse(sessionStorage.getItem('gm-tab') || '{}') || {}).sessionId));
  let s = await h.waitFor(async () => {
    const st = servers.app.store.snapshot();
    const x = st.sessions.find((y) => y.id === sessionId);
    return x && x.status === 'in_queue' ? x : null;
  }, 8000, 'in_queue heartbeat');
  assert.equal(s.member, 'Sam');
  assert.equal(s.connection, 'Home broadband');
  assert.equal(s.vpn, 'none');
  assert.equal(s.health, 'live');
  assert.equal(s.source, 'userscript');

  await h.waitForState(page, 'booking', 12000);
  s = await h.waitFor(() => servers.app.store.snapshot().sessions.find((y) => y.id === sessionId && y.status === 'booking'), 8000, 'booking heartbeat');
  assert.ok(s.bookingDetectedAt > s.queueEnteredAt);
  const msgs = await h.waitFor(() => {
    const m = servers.ntfy.received.slice(before);
    return m.length ? m : null;
  }, 5000, 'ntfy message');
  await new Promise((r) => setTimeout(r, 500));
  const all = servers.ntfy.received.slice(before);
  assert.equal(all.length, 1, 'group notified exactly once (no duplicate direct push)');
  assert.equal(msgs[0].json.topic, 'e2e-group');
  assert.equal(msgs[0].json.title, 'SAM — BOOKING PAGE DETECTED');
  assert.match(msgs[0].json.message, /Laptop · Home broadband · none/);
  servers.app.store.setConfig({ ntfy: { enabled: false } });
  await ctx.close();
});

test('without a dashboard the userscript notifies the group directly via ntfy', async () => {
  const before = servers.ntfy.received.length;
  const ctx = await h.newHelperContext(browser, { member: 'Jamie', device: 'Android', ntfyTopic: 'direct-topic', ntfyServer: servers.ntfy.url });
  const page = await ctx.newPage();
  await page.goto(url('booking.html'));
  await h.waitForState(page, 'booking');
  const m = await h.waitFor(() => servers.ntfy.received.slice(before)[0], 5000, 'direct ntfy');
  assert.equal(m.json.topic, 'direct-topic');
  assert.equal(m.json.title, 'JAMIE — BOOKING PAGE DETECTED');
  await ctx.close();
});

test('local copy buttons copy the configured values and nothing is typed into the page', async () => {
  const ctx = await h.newHelperContext(browser, {
    checkoutText: '# Alex (lead)\nRegistration: 1234567890\nPostcode: BA4 4BY\n# Sam\nRegistration: 2345678901',
  });
  const page = await ctx.newPage();
  await page.goto(url('booking.html'));
  await h.waitForState(page, 'booking');
  await page.locator('ticket-helper-ui .badge').click(); // stops alarm
  await page.locator('ticket-helper-ui .badge').click(); // opens panel
  await page.locator('ticket-helper-ui [data-tab="copy"]').click();
  const text = await page.locator('ticket-helper-ui [data-el="copy"]').innerText();
  assert.match(text, /Alex \(lead\)/);
  assert.doesNotMatch(text, /1234567890/, 'values masked by default');
  await page.locator('ticket-helper-ui [data-el="copy"] button').nth(1).click();
  await page.locator('ticket-helper-ui [data-el="copy"] button').nth(2).click();
  assert.deepEqual(await h.read(page, 'rec:clipboard'), ['BA4 4BY', '2345678901']);
  assert.equal(await page.inputValue('#registrationNumber1'), '', 'page fields untouched');
  assert.equal(await page.inputValue('#postcode1'), '');
  await ctx.close();
});

test('countdown shows the next sale and gives the 5-minute warning', async () => {
  const at = new Date(Math.ceil(Date.now() / 60000) * 60000 + 2 * 60000); // 2-3 minutes ahead
  const spec = at.toISOString().slice(0, 16).replace('T', ' ');
  const ctx = await h.newHelperContext(browser, { salesText: `Test sale: ${spec}`, timezone: 'UTC', useDashboardSales: false });
  const page = await ctx.newPage();
  await page.goto(url('unknown.html'));
  await h.waitForState(page, 'unknown');
  await h.waitFor(async () => /Test sale: 00:0[23]:\d\d/.test(await page.locator('ticket-helper-ui [data-el="clock"]').textContent()), 3000, 'countdown text');
  const notes = await h.waitFor(async () => {
    const n = (await h.read(page, 'rec:notifications')) || [];
    return n.find((x) => /Test sale starts in 5 minutes/.test(x.text));
  }, 3000, '5-minute warning');
  assert.ok(notes);
  await ctx.close();
});

test('test buttons: alarm and desktop notification', async () => {
  const ctx = await h.newHelperContext(browser, {});
  const page = await ctx.newPage();
  await page.goto(url('unknown.html'));
  await h.waitForState(page, 'unknown');
  await page.locator('ticket-helper-ui .badge').click();
  await page.locator('ticket-helper-ui [data-act="test-alarm"]').click();
  await page.waitForSelector('ticket-helper-ui[data-alarm]', { state: 'attached' });
  await page.locator('ticket-helper-ui [data-act="stop"]').click();
  await page.waitForSelector('ticket-helper-ui:not([data-alarm])', { state: 'attached' });
  await page.locator('ticket-helper-ui [data-act="test-notify"]').click();
  const n = await h.read(page, 'rec:notifications');
  assert.ok(n.some((x) => x.title === 'Ticket helper test'));
  await ctx.close();
});

test('helper UI text does not confuse detection', async () => {
  // The badge says "IN QUEUE"/"BOOKING AVAILABLE"; it lives in a shadow root outside <body>.
  const ctx = await h.newHelperContext(browser, {});
  const page = await ctx.newPage();
  await page.goto(url('unknown.html'));
  await h.waitForState(page, 'unknown');
  const bodyText = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(bodyText, /IN QUEUE|BOOKING AVAILABLE/);
  await ctx.close();
});
