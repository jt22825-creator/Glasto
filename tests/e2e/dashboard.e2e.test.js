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

async function dashboardPage() {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => {
    window.__notes = [];
    window.__beeps = 0;
    class FakeNotification {
      constructor(title, o) {
        window.__notes.push({ title, body: o && o.body });
      }
    }
    FakeNotification.permission = 'granted';
    FakeNotification.requestPermission = () => Promise.resolve('granted');
    window.Notification = FakeNotification;
    class FakeAudioContext {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      resume() {}
      createGain() { return { gain: {}, connect() {} }; }
      createOscillator() { return { frequency: {}, connect() {}, stop() {}, start() { window.__beeps++; } }; }
    }
    window.AudioContext = FakeAudioContext;
  });
  const page = await ctx.newPage();
  await page.goto(servers.base + '/');
  await page.waitForSelector('#conn.pill-on');
  return { ctx, page };
}

test('group table shows sessions with labels, status and heartbeat health', async () => {
  const store = servers.app.store;
  store.heartbeat('S-ALX1', { member: 'Alex', device: 'iPhone', connection: 'Mobile', status: 'in_queue', source: 'userscript' });
  store.heartbeat('S-JAM1', { member: 'Jamie', device: 'Android', connection: 'Mobile', vpn: 'VPN – Leeds', status: 'waiting', source: 'userscript' });
  const { ctx, page } = await dashboardPage();
  const row = page.locator('tr[data-session="S-JAM1"]');
  await row.waitFor();
  const text = await row.innerText();
  for (const s of ['Jamie', 'Android', 'Mobile', 'VPN – Leeds', 'Waiting', 'live']) assert.ok(text.includes(s), `${s} in: ${text}`);
  assert.match(await page.locator('#summary').innerText(), /1 in queue/);
  await ctx.close();
});

test('booking alert: banner, alarm and browser notification when a member reaches booking', async () => {
  const { ctx, page } = await dashboardPage();
  await page.click('#enable-alerts'); // members click this once so the browser allows sound
  servers.app.store.heartbeat('S-SAM1', { member: 'Sam', device: 'Laptop', connection: 'Home broadband', status: 'booking', source: 'userscript' });
  await page.waitForSelector('#booking-banner:not([hidden])');
  assert.equal(await page.locator('#booking-banner-text').innerText(), 'SAM — BOOKING PAGE DETECTED');
  await h.waitFor(() => page.evaluate(() => window.__beeps > 2), 3000, 'dashboard alarm');
  const notes = await page.evaluate(() => window.__notes);
  assert.ok(notes.some((n) => n.title === 'SAM — BOOKING PAGE DETECTED'));
  await page.click('#ack-alarm');
  await page.waitForSelector('#booking-banner.acked');
  const beeps = await page.evaluate(() => window.__beeps);
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.__beeps), beeps, 'alarm silenced');
  servers.app.store.reset('S-SAM1');
  await ctx.close();
});

test('manual session registration, status buttons and availability toggle', async () => {
  const { ctx, page } = await dashboardPage();
  await page.fill('#register-form [name=member]', 'Robin');
  await page.fill('#register-form [name=device]', 'iPad');
  await page.fill('#register-form [name=connection]', 'Mobile data (Three)');
  await page.click('#register-form button[type=submit]');
  const card = page.locator('.my-session', { hasText: 'Robin' });
  await card.waitFor();
  await card.locator('button', { hasText: 'In queue' }).click();
  const s = await h.waitFor(() => servers.app.store.snapshot().sessions.find((x) => x.member === 'Robin' && x.status === 'in_queue'), 5000, 'manual status');
  assert.equal(s.source, 'manual');
  assert.ok(s.queueEnteredAt);
  const toggle = page.locator(`tr[data-session="${s.id}"] input[type=checkbox]`);
  await toggle.uncheck();
  await h.waitFor(() => servers.app.store.state.sessions[s.id].available === false, 3000, 'availability');
  await ctx.close();
});

test('checkout copy buttons are local-only and copy to the clipboard', async () => {
  const { ctx, page } = await dashboardPage();
  await page.click('details summary');
  await page.fill('#checkout-text', '# Alex\nRegistration: 1234567890\nPostcode: BA4 4BY');
  await page.click('#save-checkout');
  await page.locator('#checkout-fields button[data-copy="Postcode"]').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'BA4 4BY');
  // Stored in localStorage only; the server never sees it.
  assert.doesNotMatch(JSON.stringify(servers.app.store.state), /1234567890|BA4 4BY/);
  assert.match(await page.evaluate(() => localStorage.getItem('dash:checkoutText')), /BA4 4BY/);
  await ctx.close();
});

test('sale countdowns come from group settings, in the chosen timezone', async () => {
  const { ctx, page } = await dashboardPage();
  await page.fill('#config-form [name=salesText]', 'Coach sale: 2030-10-03 18:00\nGeneral sale: 2030-10-06 09:00');
  await page.fill('#config-form [name=timezone]', 'Europe/London');
  await page.click('#config-form button[type=submit]');
  await page.waitForSelector('.countdown >> text=03 Oct');
  const cards = await page.locator('.countdown').allInnerTexts();
  assert.match(cards[0], /Coach sale[\s\S]*Thu,? 03 Oct, 18:00[\s\S]*\d+d \d\d:\d\d:\d\d/);
  const bad = page.locator('#config-errors');
  await page.fill('#config-form [name=timezone]', 'Not/AZone');
  await page.click('#config-form button[type=submit]');
  await h.waitFor(async () => /timezone/.test(await bad.innerText()), 3000, 'timezone error');
  await ctx.close();
});

test('mock test runner: automatic checks pass in the browser', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(servers.base + '/mock/test-runner.html');
  await h.waitFor(async () => (await page.locator('tr[data-check] td.pass').count()) >= 8, 10000, 'automatic checks');
  const fails = await page.locator('tr[data-check]:has(td.fail)').allInnerTexts();
  assert.deepEqual(fails, []);
  await ctx.close();
});
