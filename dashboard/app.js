/*
 * Group dashboard UI. Talks only to the dashboard server (same origin).
 * Checkout details are kept in this browser's localStorage and never sent.
 */
(function () {
  'use strict';
  const S = window.TicketHelperSession;
  const C = window.TicketHelperCountdown;
  const K = window.TicketHelperCheckout;

  const $ = (sel) => document.querySelector(sel);
  const ls = {
    get(k, d) {
      try {
        const v = localStorage.getItem('dash:' + k);
        return v == null ? d : JSON.parse(v);
      } catch (_) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('dash:' + k, JSON.stringify(v));
      } catch (_) {
        /* storage blocked: settings just won't persist */
      }
    },
    del(k) {
      try {
        localStorage.removeItem('dash:' + k);
      } catch (_) {
        /* ignore */
      }
    },
  };

  // A ?key= in the link someone shared is remembered, then removed from the address bar.
  const params = new URLSearchParams(location.search);
  if (params.get('key')) {
    ls.set('groupKey', params.get('key'));
    history.replaceState(null, '', location.pathname);
  }

  let state = null;
  let clockOffset = 0; // server time - local time
  const serverNow = () => Date.now() + clockOffset;

  // ------------------------------------------------------------ API

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const key = ls.get('groupKey', '');
    if (key) headers['X-Group-Key'] = key;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      $('#group-key').focus();
      toast('This dashboard needs the group key — enter it under "Set up a device".');
    }
    if (!res.ok) throw new Error(data.error || data.reason || 'HTTP ' + res.status);
    return data;
  }

  let es = null;
  function connect() {
    if (es) es.close();
    const key = ls.get('groupKey', '');
    es = new EventSource('/api/events' + (key ? '?key=' + encodeURIComponent(key) : ''));
    es.onopen = () => setConn(true);
    es.onerror = () => {
      setConn(false);
      // EventSource retries by itself; a 401 closes it, so poll to surface the error.
      if (es.readyState === EventSource.CLOSED) setTimeout(connect, 5000);
    };
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') applyState(msg.state);
      if (msg.type === 'ping') clockOffset = msg.serverTime - Date.now();
    };
  }

  function setConn(on) {
    const el = $('#conn');
    el.textContent = on ? 'live' : 'offline';
    el.className = 'pill ' + (on ? 'pill-on' : 'pill-off');
  }

  // ------------------------------------------------------------ alerts (sound + notifications)

  let audioCtx = null;
  let alarmTimer = null;

  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {
      /* no audio */
    }
  }

  function beep(freq, ms) {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.value = 0.2;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + ms / 1000);
    } catch (_) {
      /* ignore */
    }
  }

  function startAlarm() {
    if (alarmTimer) return;
    unlockAudio(); // works if this page already had a click; otherwise the banner and notification still show
    let hi = false;
    const ring = () => beep((hi = !hi) ? 988 : 740, 280);
    ring();
    alarmTimer = setInterval(ring, 400);
    setTimeout(stopAlarm, 3 * 60 * 1000);
  }

  function stopAlarm() {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }

  function notify(title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, requireInteraction: true });
      }
    } catch (_) {
      /* ignore */
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 6000);
  }

  $('#enable-alerts').addEventListener('click', async () => {
    unlockAudio();
    beep(880, 150);
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    $('#enable-alerts').textContent = 'Sound on' + ('Notification' in window && Notification.permission === 'granted' ? ' · notifications on' : '');
  });
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  // Booking alerts: every session that reached booking in the last 15 minutes
  // and hasn't been silenced on this device.
  const acked = new Set(ls.get('ackedBookings', []));
  const alerted = new Set();

  function checkBookings(sessions) {
    const recent = sessions.filter((s) => s.status === 'booking' && s.bookingDetectedAt && serverNow() - s.bookingDetectedAt < 15 * 60 * 1000);
    const fresh = recent.filter((s) => !acked.has(s.id + ':' + s.bookingDetectedAt));
    const banner = $('#booking-banner');
    if (!recent.length) {
      banner.hidden = true;
      stopAlarm();
      return;
    }
    banner.hidden = false;
    banner.classList.toggle('acked', !fresh.length);
    const first = recent[0];
    $('#booking-banner-text').textContent =
      recent.length === 1
        ? `${(first.member || 'Someone').toUpperCase()} — BOOKING PAGE DETECTED`
        : `${recent.map((s) => (s.member || '?').toUpperCase()).join(', ')} — BOOKING PAGES DETECTED`;
    const available = sessions.filter((s) => s.available).map((s) => s.member);
    $('#booking-banner-sub').textContent =
      recent.map((s) => `${s.member} on ${s.device || 'a device'} at ${C.formatInZone(s.bookingDetectedAt, tz(), true)}`).join(' · ') +
      (available.length ? ` — available to check out: ${[...new Set(available)].join(', ')}` : '');
    for (const s of fresh) {
      const k = s.id + ':' + s.bookingDetectedAt;
      if (alerted.has(k)) continue;
      alerted.add(k);
      notify(`${(s.member || 'Someone').toUpperCase()} — BOOKING PAGE DETECTED`, `${s.device || ''} ${s.connection || ''}`.trim());
      startAlarm();
    }
    if (!fresh.length) stopAlarm();
  }

  $('#ack-alarm').addEventListener('click', () => {
    stopAlarm();
    for (const s of (state && state.sessions) || []) if (s.status === 'booking') acked.add(s.id + ':' + s.bookingDetectedAt);
    ls.set('ackedBookings', [...acked].slice(-100));
    $('#booking-banner').classList.add('acked');
  });

  // ------------------------------------------------------------ rendering

  const tz = () => (state && state.config.timezone) || 'Europe/London';
  const fmt = (ms) => (ms ? C.formatInZone(ms, tz(), true) : '—');

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : String(c));
    return e;
  }

  function ago(ms) {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round((serverNow() - ms) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }

  function applyState(next) {
    state = next;
    clockOffset = next.serverTime - Date.now();
    document.title = `${next.config.groupName} — Queue dashboard`;
    $('#group-name').textContent = next.config.groupName;
    renderSessions();
    renderMySessions();
    renderEvents();
    renderConfigForm();
    checkBookings(next.sessions);
  }

  function renderSessions() {
    const tbody = $('#sessions tbody');
    tbody.textContent = '';
    const sessions = state.sessions;
    $('#no-sessions').hidden = sessions.length > 0;
    const now = serverNow();
    const counts = { live: 0, in_queue: 0, booking: 0, waiting: 0 };
    for (const s of sessions) {
      const health = S.health(s.lastHeartbeat, now);
      if (health === 'live') counts.live++;
      if (counts[s.status] !== undefined) counts[s.status]++;
      tbody.append(
        el(
          'tr',
          { class: 'st-' + s.status, 'data-session': s.id },
          el('td', { class: 'mono' }, s.id),
          el('td', {}, el('b', {}, s.member)),
          el('td', {}, s.device || '—'),
          el('td', {}, s.connection || '—'),
          el('td', {}, s.vpn || '—'),
          el('td', {}, fmt(s.startedAt)),
          el('td', {}, el('span', { class: 'status ' + s.status }, S.STATUS_LABELS[s.status])),
          el('td', {}, fmt(s.queueEnteredAt)),
          el('td', {}, fmt(s.bookingDetectedAt)),
          el('td', {}, el('span', { class: 'health ' + health, 'data-hb': s.lastHeartbeat || '' }, `${ago(s.lastHeartbeat)} (${health})`), s.source === 'manual' ? el('span', { class: 'muted small' }, ' · manual') : null),
          el('td', {}, el('label', { class: 'inline' }, el('input', { type: 'checkbox', checked: s.available, onchange: (e) => patch(s.id, { available: e.target.checked }) }), s.available ? 'yes' : 'no')),
          el(
            'td',
            {},
            el('button', { class: 'btn btn-small', title: 'Clear queue/booking times for the next sale', onclick: () => resetSession(s.id) }, 'Reset'),
            ' ',
            el('button', { class: 'btn btn-small btn-danger', onclick: () => removeSession(s) }, 'Remove')
          )
        )
      );
    }
    const summary = $('#summary');
    summary.textContent = '';
    summary.append(
      el('span', { class: 'pill' }, `${sessions.length} sessions`),
      el('span', { class: 'pill' }, `${counts.live} live`),
      el('span', { class: 'pill' }, `${counts.waiting} waiting`),
      el('span', { class: 'pill' }, `${counts.in_queue} in queue`),
      el('span', { class: 'pill' + (counts.booking ? ' pill-on' : '') }, `${counts.booking} booking`)
    );
  }

  // Heartbeat ages tick every second without a full re-render.
  function refreshAges() {
    if (!state) return;
    const now = serverNow();
    document.querySelectorAll('[data-hb]').forEach((e) => {
      const hb = Number(e.dataset.hb) || null;
      const h = S.health(hb, now);
      e.className = 'health ' + h;
      e.textContent = `${ago(hb)} (${h})`;
    });
  }

  async function patch(id, body) {
    try {
      await api('PATCH', `/api/sessions/${id}`, body);
    } catch (e) {
      toast(e.message);
    }
  }

  async function resetSession(id) {
    try {
      await api('POST', `/api/sessions/${id}/reset`);
    } catch (e) {
      toast(e.message);
    }
  }

  async function removeSession(s) {
    if (!confirm(`Remove ${s.member} / ${s.device || s.id} from the dashboard? (This doesn't affect their ticket-site tab.)`)) return;
    try {
      await api('DELETE', `/api/sessions/${s.id}`);
      setMySessions(mySessions().filter((x) => x !== s.id));
    } catch (e) {
      toast(e.message);
    }
  }

  function renderEvents() {
    const list = $('#events');
    list.textContent = '';
    for (const e of state.events.slice().reverse()) list.append(el('li', {}, `${C.formatInZone(e.t, tz(), true)} — ${e.text}`));
  }

  // ------------------------------------------------------------ countdowns

  const firedSaleAlerts = {};
  function renderCountdowns() {
    if (!state) return;
    const now = serverNow();
    const { sales, errors } = C.parseSalesConfig(state.config.salesText, { timezone: tz(), now });
    const box = $('#countdowns');
    box.textContent = '';
    if (!sales.length) box.append(el('p', { class: 'muted' }, 'No sales configured. Add them under Group settings.'));
    for (const sale of sales) {
      const st = C.saleStatus(sale, now);
      const soon = st.phase === 'upcoming' && st.remaining <= 5 * 60 * 1000;
      box.append(
        el(
          'div',
          { class: `countdown ${st.phase}${soon ? ' soon' : ''}` },
          el('div', { class: 'label' }, sale.label),
          el('div', { class: 'when' }, `${C.formatInZone(sale.at, tz())} (${tz()})`),
          el('div', { class: 'remaining' }, st.phase === 'live' ? 'LIVE NOW' : st.phase === 'ended' ? 'Ended' : st.text)
        )
      );
    }
    for (const e of errors) box.append(el('p', { class: 'error small' }, e));
    for (const a of C.dueAlerts(sales, now, firedSaleAlerts)) {
      firedSaleAlerts[a.id] = true;
      toast(a.message);
      notify('Sale countdown', a.message);
      const n = a.kind === 'start' ? 6 : a.kind === '1min' ? 3 : 2;
      for (let i = 0; i < n; i++) setTimeout(() => beep(1046, 180), i * 300);
    }
    $('#clock').textContent = `${C.formatInZone(now, tz(), true)} ${tz()}`;
  }

  // ------------------------------------------------------------ my sessions (manual status)

  const mySessions = () => ls.get('mySessions', []);
  const setMySessions = (ids) => ls.set('mySessions', ids);

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    body.status = 'waiting';
    body.source = 'manual';
    try {
      const s = await api('POST', '/api/sessions', body);
      setMySessions([...mySessions(), s.id]);
      e.target.reset();
      toast(`Registered ${s.member} / ${s.device || 'device'} as ${s.id}`);
    } catch (err) {
      toast(err.message);
    }
  });

  function renderMySessions() {
    const box = $('#my-sessions');
    box.textContent = '';
    const byId = Object.fromEntries(state.sessions.map((s) => [s.id, s]));
    const ids = mySessions().filter((id) => byId[id]);
    if (!ids.length) box.append(el('p', { class: 'muted small' }, 'None yet.'));
    for (const id of ids) {
      const s = byId[id];
      box.append(
        el(
          'div',
          { class: 'my-session' },
          el('div', {}, el('b', {}, `${s.member} — ${s.device || 'device'}`), el('span', { class: 'muted small mono' }, `  ${s.id}`)),
          el(
            'div',
            { class: 'buttons' },
            S.STATUSES.map((st) =>
              el('button', { class: 'btn btn-small' + (s.status === st ? ' on' : ''), onclick: () => heartbeatManual(id, st) }, S.STATUS_LABELS[st])
            )
          )
        )
      );
    }
  }

  async function heartbeatManual(id, status) {
    const s = state && state.sessions.find((x) => x.id === id);
    if (!s) return;
    try {
      await api('POST', `/api/sessions/${id}/heartbeat`, { status: status || s.status, source: 'manual' });
    } catch (e) {
      toast(e.message);
    }
  }

  setInterval(() => {
    for (const id of mySessions()) heartbeatManual(id);
  }, S.HEARTBEAT_INTERVAL_MS);

  // ------------------------------------------------------------ checkout details (local only)

  function renderCheckout() {
    const text = ls.get('checkoutText', '');
    const reveal = $('#reveal').checked;
    const { groups } = K.parseCheckoutFields(text);
    const box = $('#checkout-fields');
    box.textContent = '';
    if (!groups.length) box.append(el('p', { class: 'muted small' }, 'Nothing saved on this device yet. Open "Edit checkout details" below.'));
    for (const g of groups) {
      box.append(
        el(
          'div',
          { class: 'field-group' },
          g.title ? el('h4', {}, g.title) : null,
          g.fields.map((f) =>
            el(
              'div',
              { class: 'field-row' },
              el('span', { class: 'label' }, f.label),
              el('span', { class: 'value' }, reveal ? f.value : K.mask(f.value)),
              el('button', { class: 'btn btn-small', 'data-copy': f.label, onclick: () => copy(f.value, `${g.title ? g.title + ' — ' : ''}${f.label}`) }, 'Copy')
            )
          )
        )
      );
    }
  }

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`Copied ${label}`);
    } catch (_) {
      window.prompt('Copy this:', value);
    }
  }

  $('#checkout-text').value = ls.get('checkoutText', '') || '';
  $('#checkout-text').placeholder = K.EXAMPLE;
  $('#reveal').addEventListener('change', renderCheckout);
  $('#save-checkout').addEventListener('click', () => {
    const text = $('#checkout-text').value;
    $('#checkout-errors').textContent = K.parseCheckoutFields(text).errors.join(' ');
    ls.set('checkoutText', text);
    renderCheckout();
    toast('Saved on this device only');
  });
  $('#clear-checkout').addEventListener('click', () => {
    if (!confirm('Delete the checkout details stored in this browser?')) return;
    ls.del('checkoutText');
    $('#checkout-text').value = '';
    renderCheckout();
  });

  // ------------------------------------------------------------ settings

  let configFormDirty = false;
  $('#config-form').addEventListener('input', () => (configFormDirty = true));

  function renderConfigForm() {
    if (configFormDirty) return;
    const f = $('#config-form').elements;
    const c = state.config;
    f.groupName.value = c.groupName;
    f.salesText.value = c.salesText;
    f.timezone.value = c.timezone;
    f.dashboardUrl.value = c.dashboardUrl;
    f.ntfyEnabled.checked = c.ntfy.enabled;
    f.ntfyServer.value = c.ntfy.server;
    f.ntfyTopic.value = c.ntfy.topic;
    f.ntfyToken.value = c.ntfy.token;
    f.notifySaleAlerts.checked = c.notifySaleAlerts;
  }

  $('#config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    $('#config-errors').textContent = '';
    try {
      await api('PUT', '/api/config', {
        groupName: f.groupName.value,
        timezone: f.timezone.value.trim() || 'Europe/London',
        salesText: f.salesText.value,
        dashboardUrl: f.dashboardUrl.value,
        notifySaleAlerts: f.notifySaleAlerts.checked,
        ntfy: { enabled: f.ntfyEnabled.checked, server: f.ntfyServer.value, topic: f.ntfyTopic.value, token: f.ntfyToken.value },
      });
      configFormDirty = false;
      toast('Settings saved for the whole group');
    } catch (err) {
      $('#config-errors').textContent = err.message;
    }
  });

  $('#test-ntfy').addEventListener('click', async () => {
    try {
      await api('POST', '/api/notify/test', { member: 'the dashboard' });
      toast('Test notification sent — check the ntfy app');
    } catch (e) {
      toast('Notification failed: ' + e.message + ' (save settings with ntfy enabled first)');
    }
  });

  // ------------------------------------------------------------ device setup helpers

  $('#dash-url').textContent = location.origin;
  $('#copy-dash-url').addEventListener('click', () => copy(location.origin, 'dashboard URL'));
  $('#group-key').value = ls.get('groupKey', '');
  $('#key-step').hidden = !ls.get('groupKey', '');
  $('#save-key').addEventListener('click', () => {
    ls.set('groupKey', $('#group-key').value.trim());
    $('#key-step').hidden = !$('#group-key').value.trim();
    connect();
    toast('Key saved on this device');
  });

  // ------------------------------------------------------------ boot

  renderCheckout();
  connect();
  setInterval(() => {
    renderCountdowns();
    refreshAges();
  }, 1000);
  api('GET', '/api/state').then(applyState).then(renderCountdowns).catch(() => {});
})();
