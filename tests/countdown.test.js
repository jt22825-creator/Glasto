'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/countdown');

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 12, 0); // Tue 29 Sep 2026, 13:00 BST

test('wall-clock time in a timezone converts to UTC (BST and GMT)', () => {
  assert.equal(C.zonedTimeToUtc(2026, 10, 1, 18, 0, 'Europe/London'), Date.UTC(2026, 9, 1, 17, 0)); // BST
  assert.equal(C.zonedTimeToUtc(2026, 12, 1, 18, 0, 'Europe/London'), Date.UTC(2026, 11, 1, 18, 0)); // GMT
  assert.equal(C.zonedTimeToUtc(2026, 10, 1, 18, 0, 'America/New_York'), Date.UTC(2026, 9, 1, 22, 0));
  assert.equal(C.zonedTimeToUtc(2026, 10, 1, 18, 0, 'UTC'), Date.UTC(2026, 9, 1, 18, 0));
});

test('conversion is correct on either side of the October DST change', () => {
  // UK clocks go back at 02:00 BST on Sun 25 Oct 2026.
  assert.equal(C.zonedTimeToUtc(2026, 10, 24, 9, 0, 'Europe/London'), Date.UTC(2026, 9, 24, 8, 0));
  assert.equal(C.zonedTimeToUtc(2026, 10, 25, 9, 0, 'Europe/London'), Date.UTC(2026, 9, 25, 9, 0));
});

test('parses the example config (weekday form) relative to now', () => {
  const { sales, errors } = C.parseSalesConfig('Coach sale: Thursday 18:00\nGeneral sale: Sunday 09:00', {
    timezone: 'Europe/London',
    now: NOW,
  });
  assert.deepEqual(errors, []);
  assert.equal(sales.length, 2);
  assert.equal(sales[0].label, 'Coach sale');
  assert.equal(sales[0].at, Date.UTC(2026, 9, 1, 17, 0));
  assert.equal(sales[1].label, 'General sale');
  assert.equal(sales[1].at, Date.UTC(2026, 9, 4, 8, 0));
});

test('parses explicit dates, am/pm, short weekdays, and ignores comments', () => {
  const text = '# sales\nA: 2026-10-01 18:00\n\nB: 2026-10-04T9:00am\nC: thu 6:00pm\nD: 2026-10-01 18.30';
  const { sales, errors } = C.parseSalesConfig(text, { timezone: 'Europe/London', now: NOW });
  assert.deepEqual(errors, []);
  const by = Object.fromEntries(sales.map((s) => [s.label, s.at]));
  assert.equal(by.A, Date.UTC(2026, 9, 1, 17, 0));
  assert.equal(by.B, Date.UTC(2026, 9, 4, 8, 0));
  assert.equal(by.C, Date.UTC(2026, 9, 1, 17, 0));
  assert.equal(by.D, Date.UTC(2026, 9, 1, 17, 30));
  assert.deepEqual(sales.map((s) => s.label), ['A', 'C', 'D', 'B'], 'sorted by time');
});

test('a weekday sale that just started stays this week (live window)', () => {
  const thuStart = Date.UTC(2026, 9, 1, 17, 0);
  let { sales } = C.parseSalesConfig('Coach: Thursday 18:00', { timezone: 'Europe/London', now: thuStart + 30 * MIN });
  assert.equal(sales[0].at, thuStart);
  ({ sales } = C.parseSalesConfig('Coach: Thursday 18:00', { timezone: 'Europe/London', now: thuStart + 3 * 60 * MIN }));
  assert.equal(sales[0].at, thuStart + 7 * 24 * 60 * MIN, 'long past → next week');
});

test('reports bad lines and bad timezones', () => {
  const r = C.parseSalesConfig('no colon here\nX: someday 18:00\nY: 2026-13-01 10:00\nZ: Friday 25:00', { timezone: 'Europe/London', now: NOW });
  assert.equal(r.sales.length, 0);
  assert.equal(r.errors.length, 4);
  assert.match(C.parseSalesConfig('A: Thursday 18:00', { timezone: 'Mars/Olympus' }).errors[0], /Unknown timezone/);
  assert.equal(C.isValidTimeZone('Europe/London'), true);
});

test('saleStatus phases and nextSale', () => {
  const sale = { key: 'a', label: 'A', at: NOW + 90 * 1000 };
  assert.equal(C.saleStatus(sale, NOW).phase, 'upcoming');
  assert.equal(C.saleStatus(sale, NOW).text, '00:01:30');
  assert.equal(C.saleStatus(sale, sale.at + MIN).phase, 'live');
  assert.equal(C.saleStatus(sale, sale.at + 3 * 60 * MIN).phase, 'ended');
  const later = { key: 'b', label: 'B', at: NOW + 3 * 24 * 60 * MIN };
  assert.equal(C.nextSale([sale, later], NOW).label, 'A');
  assert.equal(C.nextSale([sale, later], sale.at + 3 * 60 * MIN).label, 'B');
});

test('formatDuration', () => {
  assert.equal(C.formatDuration(0), '00:00:00');
  assert.equal(C.formatDuration(61 * 1000), '00:01:01');
  assert.equal(C.formatDuration((2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000), '2d 03:04:05');
});

test('warnings fire once each: 5 minutes, 1 minute, start', () => {
  const sale = { key: 'coach@1', label: 'Coach sale', at: NOW };
  const fired = {};
  const seen = [];
  for (let t = NOW - 10 * MIN; t <= NOW + 5 * MIN; t += 1000) {
    for (const a of C.dueAlerts([sale], t, fired)) {
      fired[a.id] = true;
      seen.push([a.kind, (NOW - t) / 1000, a.message]);
    }
  }
  assert.deepEqual(seen, [
    ['5min', 300, 'Coach sale starts in 5 minutes'],
    ['1min', 60, 'Coach sale starts in 1 minute'],
    ['start', 0, 'Coach sale has started'],
  ]);
});

test('page opened 3 minutes before: 5-minute warning still fires, then the rest', () => {
  const sale = { key: 'k', label: 'S', at: NOW };
  assert.deepEqual(C.dueAlerts([sale], NOW - 3 * MIN, {}).map((a) => a.kind), ['5min']);
  assert.deepEqual(C.dueAlerts([sale], NOW - 30 * 1000, {}).map((a) => a.kind), ['1min']);
  assert.deepEqual(C.dueAlerts([sale], NOW + 30 * 1000, {}).map((a) => a.kind), ['start']);
  assert.deepEqual(C.dueAlerts([sale], NOW + 10 * MIN, {}), [], 'nothing stale long after the start');
});

test('formatInZone shows local wall-clock time', () => {
  assert.equal(C.formatInZone(Date.UTC(2026, 9, 1, 17, 0), 'Europe/London'), 'Thu 01 Oct, 18:00');
});
