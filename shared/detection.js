/*
 * Page-state detection for the ticket helper.
 *
 * Pure logic: takes a snapshot of the page (text, URL, and a function that
 * says whether a CSS selector matches) and decides which of four states the
 * tab is in. It never interacts with the page.
 *
 * Shared by the userscript (inlined at build time), the mock test runner
 * (loaded as a browser global) and the Node unit tests (require()).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketHelperDetection = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATES = Object.freeze({
    WAITING: 'waiting',
    IN_QUEUE: 'in_queue',
    BOOKING: 'booking',
    UNKNOWN: 'unknown',
  });

  const STATE_LABELS = Object.freeze({
    waiting: 'WAITING',
    in_queue: 'IN QUEUE',
    booking: 'BOOKING AVAILABLE',
    unknown: 'UNKNOWN',
  });

  // Each state has indicators. A state matches when at least `minMatches`
  // indicators match (each matching selector, text pattern or URL pattern
  // counts as one). `requireSelector` means at least one of those matches
  // must be a DOM selector, not just text.
  //
  // Booking is checked first, then queue, then waiting. Booking requires a
  // real form field because queue pages often *mention* "registration number"
  // and "postcode" ("have them ready") without being the booking page.
  const DEFAULT_CONFIG = Object.freeze({
    booking: {
      selectors: [
        'input[name*="registration" i]',
        'input[id*="registration" i]',
        'input[placeholder*="registration" i]',
        'input[aria-label*="registration" i]',
        'input[name*="postcode" i]',
        'input[id*="postcode" i]',
        'input[placeholder*="postcode" i]',
        'input[aria-label*="postcode" i]',
        '[data-ticket-helper="booking"]',
      ],
      text: ['registration (number|no\\.?|id)', 'post ?code', 'enter (your|the) registration'],
      urlPatterns: [],
      minMatches: 2,
      requireSelector: true,
    },
    queue: {
      selectors: ['#MainPart_divProgressbar', '#queue-it_log', '[data-ticket-helper="queue"]'],
      text: [
        'you are (now )?in (the )?(line|queue)',
        '(your )?number in (the )?(line|queue)',
        '(people|users) (ahead of you|in (the )?line ahead)',
        '(estimated|expected) (wait(ing)? time|time of arrival|arrival time)',
        'your (queue )?position',
        'queue ?id',
      ],
      urlPatterns: ['queue-it\\.net'],
      minMatches: 1,
      requireSelector: false,
    },
    waiting: {
      selectors: ['[data-ticket-helper="waiting"]'],
      text: [
        'waiting room',
        'sale (has not|hasn\'t) (yet )?(started|opened)',
        'sales? (starts?|opens?|will (start|open)) (in|at|on)',
        'will be (randomly )?(assigned|given) a (random )?(place|position)',
        'tickets (go|will go) on sale',
      ],
      urlPatterns: [],
      minMatches: 1,
      requireSelector: false,
    },
  });

  const ORDER = [STATES.BOOKING, STATES.IN_QUEUE, STATES.WAITING];
  const CONFIG_KEY = { booking: 'booking', in_queue: 'queue', waiting: 'waiting' };

  function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  /**
   * Merge a partial user config over the defaults. Arrays given by the user
   * replace the default arrays (so users can remove a default indicator).
   */
  function mergeConfig(userConfig) {
    const base = cloneDefault();
    if (!userConfig || typeof userConfig !== 'object') return base;
    for (const key of Object.keys(base)) {
      const u = userConfig[key];
      if (!u || typeof u !== 'object') continue;
      for (const field of Object.keys(base[key])) {
        if (u[field] !== undefined) base[key][field] = u[field];
      }
    }
    return base;
  }

  function safeRegex(src) {
    try {
      return new RegExp(src, 'i');
    } catch (_) {
      return null;
    }
  }

  function evaluate(indicators, snapshot) {
    const matched = [];
    let selectorMatched = false;
    for (const sel of indicators.selectors || []) {
      let hit = false;
      try {
        hit = !!snapshot.has(sel);
      } catch (_) {
        hit = false; // invalid selector: ignore
      }
      if (hit) {
        matched.push('selector:' + sel);
        selectorMatched = true;
      }
    }
    for (const src of indicators.text || []) {
      const rx = safeRegex(src);
      if (rx && rx.test(snapshot.text || '')) matched.push('text:' + src);
    }
    for (const src of indicators.urlPatterns || []) {
      const rx = safeRegex(src);
      if (rx && rx.test(snapshot.url || '')) matched.push('url:' + src);
    }
    const ok =
      matched.length >= (indicators.minMatches || 1) &&
      (!indicators.requireSelector || selectorMatched);
    return { ok, matched };
  }

  /**
   * @param {{text: string, url: string, has: (selector: string) => boolean}} snapshot
   * @param {object} [config] result of mergeConfig(); defaults if omitted
   * @returns {{state: string, label: string, matched: string[]}}
   */
  function detectState(snapshot, config) {
    const cfg = config || cloneDefault();
    const snap = {
      text: snapshot.text || '',
      url: snapshot.url || '',
      has: typeof snapshot.has === 'function' ? snapshot.has : () => false,
    };
    for (const state of ORDER) {
      const r = evaluate(cfg[CONFIG_KEY[state]], snap);
      if (r.ok) return { state, label: STATE_LABELS[state], matched: r.matched };
    }
    return { state: STATES.UNKNOWN, label: STATE_LABELS.unknown, matched: [] };
  }

  /** Build a snapshot from a live DOM document. Read-only. */
  function snapshotFromDocument(doc, excludeEl) {
    let text = (doc.body && doc.body.innerText) || '';
    if (excludeEl && excludeEl.innerText) text = text.replace(excludeEl.innerText, '');
    return {
      text,
      url: (doc.location && doc.location.href) || '',
      has: (sel) => {
        const el = doc.querySelector(sel);
        return !!el && !(excludeEl && excludeEl.contains(el));
      },
    };
  }

  return { STATES, STATE_LABELS, DEFAULT_CONFIG, mergeConfig, detectState, snapshotFromDocument };
});
