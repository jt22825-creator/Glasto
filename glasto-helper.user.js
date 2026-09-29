// ==UserScript==
// @name         Glasto Ticket Day Helper
// @namespace    https://github.com/jt22825-creator/glasto
// @version      1.0.0
// @description  Alerts you the instant you're through the queue, blocks accidental refreshes, and keeps your group's registration details one click away. Never automates the site itself.
// @match        *://*.seetickets.com/*
// @match        *://*.queue-it.net/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      ntfy.sh
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Sale times (UTC). Thu 1 Oct 18:00 BST, Sun 4 Oct 09:00 BST.
  const SALES = [
    { label: 'Coach sale', at: Date.UTC(2026, 9, 1, 17, 0, 0) },
    { label: 'General sale', at: Date.UTC(2026, 9, 4, 8, 0, 0) },
  ];
  const BE_ON_PAGE_MINUTES = 5;

  const RX = {
    queue: /you are (now )?in (the )?(line|queue)|waiting room|your (estimated )?(wait|position)|people (ahead|in line)|number in line|queue ?id/i,
    booking: /registration (number|no\.?|id)/i,
    postcode: /post ?code/i,
    blocked: /access denied|you don't have permission to access|request blocked|reference\s*#\s*[0-9a-f.]+/i,
  };

  const store = {
    get: (k, d) => { try { return GM_getValue(k, d); } catch (_) { return d; } },
    set: (k, v) => { try { GM_setValue(k, v); } catch (_) {} },
  };

  // ---------- page state detection ----------

  function detectState() {
    const text = (document.body && document.body.innerText) || '';
    if (RX.blocked.test(text)) return 'blocked';
    if (location.hostname.includes('queue-it') || RX.queue.test(text)) return 'queue';
    const inputs = [...document.querySelectorAll('input')];
    const attr = (el) => `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`;
    const hasRegInput = inputs.some((el) => /reg/i.test(attr(el)));
    const hasPostInput = inputs.some((el) => /post/i.test(attr(el)));
    if ((hasRegInput && hasPostInput) || (RX.booking.test(text) && RX.postcode.test(text))) return 'booking';
    return 'unknown';
  }

  // ---------- alarm ----------

  let audioCtx = null;
  let alarmTimer = null;

  function unlockAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function beep() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.25;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
  }

  let titleTimer = null;
  const originalTitle = document.title;

  function startAlarm(message) {
    stopAlarm();
    beep();
    alarmTimer = setInterval(beep, 600);
    let on = false;
    titleTimer = setInterval(() => {
      document.title = (on = !on) ? `🚨 ${message} 🚨` : originalTitle;
    }, 700);
    try {
      GM_notification({ title: 'Glasto Helper', text: message, highlight: true, timeout: 0 });
    } catch (_) {}
    pushToGroup(message);
  }

  function stopAlarm() {
    clearInterval(alarmTimer);
    clearInterval(titleTimer);
    alarmTimer = titleTimer = null;
    document.title = originalTitle;
  }

  // Optional: push to everyone subscribed to an ntfy.sh topic (free phone app).
  function pushToGroup(message) {
    const topic = store.get('ntfyTopic', '').trim();
    if (!topic) return;
    const who = store.get('myName', '').trim() || 'Someone';
    GM_xmlhttpRequest({
      method: 'POST',
      url: `https://ntfy.sh/${encodeURIComponent(topic)}`,
      headers: { Title: 'Glasto', Priority: 'urgent', Tags: 'tent' },
      data: `${who}: ${message}`,
    });
  }

  // ---------- refresh guard ----------
  // Refreshing in the queue sends you to the back. Intercept the refresh keys
  // rather than using beforeunload, which could stall the queue's own redirect.

  window.addEventListener('keydown', (e) => {
    const isRefresh = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r');
    if (!isRefresh || currentState !== 'queue') return;
    e.preventDefault();
    e.stopPropagation();
    flash('Refresh blocked — you are in the queue. Refreshing sends you to the back.');
  }, true);

  // ---------- panel ----------

  const panel = document.createElement('div');
  panel.id = 'glasto-helper';
  panel.innerHTML = `
    <style>
      #glasto-helper { position: fixed; bottom: 12px; right: 12px; z-index: 2147483647; width: 300px;
        font: 13px/1.4 system-ui, sans-serif; color: #111; background: #fff; border: 2px solid #222;
        border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
      #glasto-helper header { display: flex; justify-content: space-between; align-items: center;
        padding: 6px 10px; background: #222; color: #fff; border-radius: 7px 7px 0 0; cursor: pointer; }
      #glasto-helper .body { padding: 8px 10px; max-height: 60vh; overflow: auto; }
      #glasto-helper.collapsed .body { display: none; }
      #glasto-helper .state { font-weight: 700; padding: 4px 6px; border-radius: 4px; margin-bottom: 6px; }
      #glasto-helper .s-queue { background: #fff3c4; } #glasto-helper .s-booking { background: #b8f5c4; }
      #glasto-helper .s-blocked { background: #ffc4c4; } #glasto-helper .s-unknown { background: #eee; }
      #glasto-helper button { font: inherit; padding: 3px 8px; margin: 2px 2px 2px 0; cursor: pointer;
        border: 1px solid #444; border-radius: 4px; background: #f6f6f6; color: #111; }
      #glasto-helper textarea, #glasto-helper input { width: 100%; box-sizing: border-box; font: 12px monospace;
        margin: 2px 0 6px; }
      #glasto-helper .person { display: flex; gap: 4px; align-items: center; flex-wrap: wrap;
        border-top: 1px solid #ddd; padding: 4px 0; }
      #glasto-helper .person b { flex: 1 0 100%; }
      #glasto-helper .flash { background: #ffe08a; padding: 4px 6px; border-radius: 4px; margin: 4px 0; }
      #glasto-helper details { margin-top: 6px; }
    </style>
    <header><span>🎪 Glasto Helper</span><span data-el="countdown"></span></header>
    <div class="body">
      <div class="state" data-el="state"></div>
      <div data-el="flash"></div>
      <div data-el="people"></div>
      <div data-el="timer"></div>
      <button data-act="test">Test alarm (click once to enable sound)</button>
      <button data-act="stop">Stop alarm</button>
      <details>
        <summary>Setup</summary>
        <label>Group — one per line: <code>Name, RegNumber, Postcode</code> (lead booker first, max 6)</label>
        <textarea data-el="group" rows="6" placeholder="Me, 1234567890, BA4 4BY"></textarea>
        <label>Your name (for group alerts)</label>
        <input data-el="myName">
        <label>ntfy.sh topic (optional — alerts everyone's phones)</label>
        <input data-el="ntfy" placeholder="e.g. our-glasto-2027-xk29">
        <button data-act="save">Save</button>
        <button data-act="testpush">Send test push</button>
      </details>
    </div>`;
  document.documentElement.appendChild(panel);

  const $ = (name) => panel.querySelector(`[data-el="${name}"]`);
  if (store.get('collapsed', false)) panel.classList.add('collapsed');
  panel.querySelector('header').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    store.set('collapsed', panel.classList.contains('collapsed'));
  });

  $('group').value = store.get('group', '');
  $('myName').value = store.get('myName', '');
  $('ntfy').value = store.get('ntfyTopic', '');

  function flash(msg) {
    $('flash').innerHTML = '';
    const d = document.createElement('div');
    d.className = 'flash';
    d.textContent = msg;
    $('flash').appendChild(d);
    setTimeout(() => d.remove(), 6000);
  }

  function parseGroup() {
    return store.get('group', '').split('\n').map((l) => l.split(',').map((s) => s.trim()))
      .filter((p) => p.length >= 3 && p[1]).slice(0, 6)
      .map(([name, reg, postcode]) => ({ name, reg, postcode }));
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      flash(`Copied ${label}`);
    } catch (_) {
      prompt('Copy this:', text);
    }
  }

  function renderPeople() {
    const box = $('people');
    box.innerHTML = '';
    const people = parseGroup();
    if (!people.length) {
      box.textContent = 'Add your group under Setup so their details are ready to copy.';
      return;
    }
    people.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'person';
      const name = document.createElement('b');
      name.textContent = `${i + 1}. ${p.name}${i === 0 ? ' (lead)' : ''}`;
      row.appendChild(name);
      [['Reg', p.reg], ['Postcode', p.postcode]].forEach(([label, val]) => {
        const b = document.createElement('button');
        b.textContent = `${label}: ${val}`;
        b.addEventListener('click', () => copy(val, `${p.name}'s ${label.toLowerCase()}`));
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }
  renderPeople();

  panel.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    unlockAudio();
    if (act === 'test') { startAlarm('Test alarm'); setTimeout(stopAlarm, 2000); }
    if (act === 'stop') stopAlarm();
    if (act === 'save') {
      store.set('group', $('group').value);
      store.set('myName', $('myName').value);
      store.set('ntfyTopic', $('ntfy').value);
      renderPeople();
      flash('Saved');
    }
    if (act === 'testpush') {
      store.set('ntfyTopic', $('ntfy').value);
      store.set('myName', $('myName').value);
      pushToGroup('test push from Glasto Helper');
      flash('Test push sent');
    }
  });
  // Any interaction with the page also unlocks audio for the alarm.
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });

  // ---------- main loop ----------

  const STATE_TEXT = {
    queue: '⏳ In the queue — do NOT refresh',
    booking: '✅ BOOKING PAGE — enter details now!',
    blocked: '⛔ Looks blocked (access denied)',
    unknown: '… Watching this page',
  };

  let currentState = null;
  let bookingSince = null;
  let prealertFired = store.get('prealertFired', {});

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return (d ? `${d}d ` : '') + `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
  }

  function tick() {
    const state = detectState();
    if (state !== currentState) {
      const prev = currentState;
      currentState = state;
      const el = $('state');
      el.className = `state s-${state}`;
      el.textContent = STATE_TEXT[state];
      if (state === 'booking' && prev !== null) {
        bookingSince = Date.now();
        startAlarm("YOU'RE THROUGH! Booking page is open");
      } else if (state === 'booking') {
        bookingSince = Date.now();
      } else if (state === 'blocked') {
        startAlarm('Access denied — try another device/connection');
      } else {
        bookingSince = null;
      }
    }

    // 10-minute checkout timer
    $('timer').textContent = bookingSince
      ? `Checkout time left (approx): ${fmt(10 * 60 * 1000 - (Date.now() - bookingSince))}`
      : '';

    // Countdown to next sale + "be on the page" alert
    const now = Date.now();
    const next = SALES.find((s) => s.at + 60 * 60 * 1000 > now);
    if (next) {
      const diff = next.at - now;
      $('countdown').textContent = diff > 0 ? `${next.label} in ${fmt(diff)}` : `${next.label} LIVE`;
      if (diff > 0 && diff < BE_ON_PAGE_MINUTES * 60 * 1000 && !prealertFired[next.label]) {
        prealertFired[next.label] = true;
        store.set('prealertFired', prealertFired);
        flash(`${next.label} starts in under ${BE_ON_PAGE_MINUTES} min — stay on this page, don't refresh.`);
        beep();
      }
    } else {
      $('countdown').textContent = '';
    }
  }

  tick();
  setInterval(tick, 1000);
})();
