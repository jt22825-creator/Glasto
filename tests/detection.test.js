'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../shared/detection');
const { snapshotFromHtml, mockSnapshot } = require('./helpers/html-snapshot');

const snap = (text, extra) => Object.assign({ text, url: 'https://tickets.example/', has: () => false }, extra);

test('mock pages are classified as expected', () => {
  const expected = {
    'presale.html': 'waiting',
    'queue.html': 'in_queue',
    'long-queue.html': 'in_queue',
    'queue-progress.html': 'in_queue',
    'booking.html': 'booking',
    'unknown.html': 'unknown',
  };
  for (const [file, state] of Object.entries(expected)) {
    const r = D.detectState(mockSnapshot(file));
    assert.equal(r.state, state, `${file}: got ${r.state} via ${r.matched.join(', ')}`);
  }
});

test('queue page that mentions registration number and postcode is NOT booking', () => {
  const r = D.detectState(snap('You are now in the queue. Please have your registration number and postcode ready.'));
  assert.equal(r.state, 'in_queue');
});

test('booking needs a real form field, not just text', () => {
  assert.equal(D.detectState(snap('Registration number Postcode')).state, 'unknown');
  const html = '<label>Registration number</label><input name="regNumber" id="registrationNumber1"><input name="postcode1">';
  assert.equal(D.detectState(snapshotFromHtml(html)).state, 'booking');
});

test('booking with a single field plus matching text', () => {
  const html = '<p>Enter your registration number</p><input aria-label="Registration number">';
  assert.equal(D.detectState(snapshotFromHtml(html)).state, 'booking');
});

test('queue-it URL counts as in queue even without text', () => {
  const r = D.detectState(snap('', { url: 'https://festival.queue-it.net/?c=x&e=y' }));
  assert.equal(r.state, 'in_queue');
  assert.ok(r.matched.some((m) => m.startsWith('url:')));
});

test('waiting room text before the queue opens', () => {
  assert.equal(D.detectState(snap('Welcome to the waiting room. Sale starts at 9am.')).state, 'waiting');
  assert.equal(D.detectState(snap('The sale has not started yet.')).state, 'waiting');
});

test('queue takes priority over waiting when both match', () => {
  assert.equal(D.detectState(snap('Waiting room — you are now in line. Number in line: 44')).state, 'in_queue');
});

test('unknown page', () => {
  const r = D.detectState(snap('Line-up announcements coming soon'));
  assert.equal(r.state, 'unknown');
  assert.equal(r.label, 'UNKNOWN');
});

test('labels match the four on-page states', () => {
  assert.deepEqual(Object.values(D.STATE_LABELS), ['WAITING', 'IN QUEUE', 'BOOKING AVAILABLE', 'UNKNOWN']);
});

test('user config overrides indicators and keeps other defaults', () => {
  const cfg = D.mergeConfig({ queue: { text: ['fila de espera'] } });
  assert.equal(D.detectState(snap('Está en la fila de espera'), cfg).state, 'in_queue');
  assert.equal(D.detectState(snap('you are now in line'), cfg).state, 'unknown', 'default queue text replaced');
  assert.deepEqual(cfg.booking, D.mergeConfig(null).booking);
});

test('custom selector indicator', () => {
  const cfg = D.mergeConfig({ booking: { selectors: ['#basket'], text: [], minMatches: 1 } });
  const s = snap('', { has: (sel) => sel === '#basket' });
  assert.equal(D.detectState(s, cfg).state, 'booking');
});

test('invalid regex and selectors are ignored, not thrown', () => {
  const cfg = D.mergeConfig({ queue: { text: ['([bad', 'in line'], selectors: ['::::'] } });
  const s = snap('you are in line', {
    has: (sel) => {
      if (sel === '::::') throw new Error('SyntaxError');
      return false;
    },
  });
  assert.equal(D.detectState(s, cfg).state, 'in_queue');
});

test('mergeConfig does not mutate defaults', () => {
  const before = JSON.stringify(D.DEFAULT_CONFIG);
  const cfg = D.mergeConfig({ queue: { minMatches: 3 } });
  cfg.booking.selectors.push('x');
  assert.equal(JSON.stringify(D.DEFAULT_CONFIG), before);
});
