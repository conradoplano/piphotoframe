'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

const S = {
  config: null, configVersion: null, photosVersion: null, state: null, weather: null,
  photos: new Map(), queue: [], pos: -1, current: null,
  timer: null, front: $('#slideA'), back: $('#slideB'), showToken: 0,
  clips: [], clipQueue: [], lastClipAt: 0, clip: null, // clip = the one playing: { finish }
};

/* ================= slideshow ================= */

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueue(keepId) {
  const ids = [...S.photos.keys()];
  let q = S.config.order === 'shuffle' ? shuffle(ids) : ids;
  S.pos = -1;
  if (keepId && S.photos.has(keepId)) {
    if (S.config.order === 'shuffle') q = [keepId, ...q.filter((x) => x !== keepId)];
    S.pos = q.indexOf(keepId);
  }
  S.queue = q;
}

function schedule() {
  clearTimeout(S.timer);
  if (!S.config) return;
  S.timer = setTimeout(() => (S.clip ? schedule() : autoNext()), S.config.slide_seconds * 1000);
}

async function go(step, how) {
  schedule();
  if (!S.queue.length) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    let pos = S.pos + step;
    if (pos >= S.queue.length) {
      // a full round is done: new shuffle, avoiding an immediate repeat
      const last = S.queue[S.queue.length - 1];
      buildQueue();
      if (S.queue.length > 1 && S.queue[0] === last) [S.queue[0], S.queue[1]] = [S.queue[1], S.queue[0]];
      pos = 0;
    }
    if (pos < 0) pos = S.queue.length - 1;
    S.pos = pos;
    if (await show(S.queue[pos], how)) return;
  }
}

function loadImage(img, url) {
  return new Promise((resolve) => {
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(true));
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function show(id, how) {
  const photo = S.photos.get(id);
  if (!photo) return false;
  const token = ++S.showToken;
  const inc = S.back, out = S.front;
  if (!(await loadImage(inc, photo.url))) return false;
  if (token !== S.showToken) return true;

  const swipe = how === 'next' || how === 'prev';
  const fade = how !== 'none' && S.config.transition === 'fade' && S.current !== null;
  const ms = swipe ? 450 : fade ? 1400 : 0;
  inc.style.transition = out.style.transition = 'none';
  inc.style.zIndex = 2; out.style.zIndex = 1;
  inc.style.transform = swipe ? `translateX(${how === 'next' ? 100 : -100}%)` : 'none';
  inc.style.opacity = swipe || !fade ? 1 : 0;
  void inc.offsetWidth; // apply the start state before animating
  if (ms) {
    const ease = `${ms}ms cubic-bezier(.2,.7,.2,1)`;
    inc.style.transition = `opacity ${ease}, transform ${ease}`;
    out.style.transition = `transform ${ease}`;
  }
  inc.style.opacity = 1;
  inc.style.transform = 'none';
  if (swipe) out.style.transform = `translateX(${how === 'next' ? -100 : 100}%)`;
  setTimeout(() => {
    if (token !== S.showToken) return;
    out.style.transition = 'none';
    out.style.opacity = 0;
    out.style.transform = 'none';
  }, ms + 50);

  S.front = inc; S.back = out; S.current = id;
  return true;
}

async function loadPhotos() {
  const data = await api('/api/photos');
  const before = S.current ? S.photos.get(S.current) : null;
  S.photos = new Map(data.items.map((p) => [p.id, p]));
  S.clips = data.clips || [];
  S.clipQueue = S.clipQueue.filter((c) => S.clips.some((x) => x.id === c.id));
  buildQueue(S.current);
  updateEmpty();
  const now = S.current ? S.photos.get(S.current) : null;
  if (!S.queue.length) {
    S.current = null;
    S.front.style.opacity = S.back.style.opacity = 0;
  } else if (!now || !before || now.url !== before.url) {
    // first photos arrived, the current one was removed, or the fit mode changed
    if (!now) S.pos = -1; else S.pos -= 1;
    go(1, 'auto');
  }
}

/* ================= short videos ================= */
// Swiping to the next photo first plays a short muted video from the albums (at most one every
// clip_pause_seconds), then fades to the next photo. With clips_in_slideshow they also play
// between photos in the automatic slideshow, sharing the same pause.

function nextClip() {
  if (!S.clipQueue.length) {
    const last = S.lastClipId;
    S.clipQueue = shuffle(S.clips.slice());
    if (S.clipQueue.length > 1 && S.clipQueue[0].id === last) S.clipQueue.push(S.clipQueue.shift());
  }
  const clip = S.clipQueue.shift();
  if (clip) S.lastClipId = clip.id;
  return clip;
}

function clipDue() {
  const c = S.config;
  return c && c.clips_enabled && S.clips.length && S.queue.length &&
    Date.now() - S.lastClipAt >= c.clip_pause_seconds * 1000;
}

// Plays one clip; resolves with 'next' (finished or skipped) or 'stay' (swiped back / failed).
function playClip(clip) {
  const v = $('#clip');
  const limit = Math.min(clip.duration || S.config.clip_max_seconds, S.config.clip_max_seconds);
  return new Promise((resolve) => {
    let safety;
    const finish = (action) => {
      if (!S.clip) return;
      S.clip = null;
      clearTimeout(safety);
      v.ontimeupdate = v.onended = v.onerror = null;
      resolve(action);
    };
    S.clip = { finish };
    // stop a little before the limit so the fade-out ends on time (trims longer videos)
    v.ontimeupdate = () => { if (v.currentTime >= limit - 0.6) finish('next'); };
    v.onended = () => finish('next');
    v.onerror = () => finish('stay');
    safety = setTimeout(() => finish('next'), (limit + 8) * 1000); // e.g. a stalled download
    v.muted = true;
    v.src = clip.url;
    v.play().then(() => document.body.classList.add('clip')).catch(() => finish('stay'));
  });
}

function hideClip() {
  const v = $('#clip');
  document.body.classList.remove('clip');
  setTimeout(() => {
    if (S.clip) return; // a new clip started meanwhile
    v.pause();
    v.removeAttribute('src');
    v.load();
  }, 700);
}

function swipeNext() {
  if (S.clip) { S.clip.finish('next'); return; } // swiping during a clip skips it
  if (clipDue()) clipThenNext();
  else go(1, 'next');
}

function autoNext() {
  // no videos for an empty room: skip them while the screen is off (dark room / night)
  const screenOn = !S.state || S.state.screen_on;
  if (S.config.clips_in_slideshow && screenOn && clipDue()) clipThenNext();
  else go(1, 'auto');
}

async function clipThenNext() {
  S.lastClipAt = Date.now();
  clearTimeout(S.timer);
  const action = await playClip(nextClip());
  if (action === 'next') await go(1, 'none'); // swap the photo while the video still covers it
  hideClip();
  schedule();
}

function swipePrev() {
  if (S.clip) { S.clip.finish('stay'); return; } // back out of the clip to the current photo
  go(-1, 'prev');
}

function updateEmpty() {
  const empty = !S.photos.size;
  $('#empty').classList.toggle('hidden', !empty);
  if (!empty || !S.config) return;
  const st = S.state || {};
  let title = 'No photos yet', text;
  if (!S.config.albums.length) text = 'Open the settings page on your phone or computer and add a Synology Photos album.';
  else if (st.sync && st.sync.running) { title = 'Getting your photos…'; text = st.sync.progress || 'Syncing albums'; }
  else if (st.online === false) text = 'Waiting for the network…';
  else text = (st.sync && st.sync.last_error) || 'No photos were found in the configured albums.';
  $('#empty-title').textContent = title;
  $('#empty-text').textContent = text;
}

/* ================= clock & weather ================= */

const fmtCache = new Map();
function formatter(tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!fmtCache.has(key)) {
    let f;
    try { f = new Intl.DateTimeFormat(S.config.language || 'en', { ...opts, timeZone: tz || undefined }); }
    catch { f = new Intl.DateTimeFormat('en', opts); }
    fmtCache.set(key, f);
  }
  return fmtCache.get(key);
}

function timeHtml(tz) {
  const h24 = S.config.clock_24h;
  const parts = formatter(tz, { hour: 'numeric', minute: '2-digit', hourCycle: h24 ? 'h23' : 'h12' })
    .formatToParts(new Date());
  // "9:05", not "09:05" (some languages pad the hour even when asked not to)
  const main = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim()
    .replace(/^0(\d)/, '$1');
  if (h24) return esc(main);
  // Always "AM"/"PM", whatever the language would write ("a. m.", "vorm.", …).
  const hour = Number(formatter(tz, { hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return `${esc(main)}<small>${hour < 12 ? 'AM' : 'PM'}</small>`;
}

// Long date, e.g. "Friday, October 23" / "Viernes, 23 de Octubre". Day and month names are
// capitalised even in languages that write them in lowercase (Spanish, French, …).
function dateText(tz) {
  const cap = (s) => s.charAt(0).toLocaleUpperCase(S.config.language || 'en') + s.slice(1);
  return formatter(tz, { weekday: 'long', day: 'numeric', month: 'long' })
    .formatToParts(new Date())
    .map((p) => (p.type === 'weekday' || p.type === 'month' ? cap(p.value) : p.value))
    .join('');
}

function dayName(isoDate) {
  return formatter('UTC', { weekday: 'short' }).format(new Date(isoDate + 'T12:00:00Z'));
}

const temp = (t) => (t === null || t === undefined ? '–' : `${Math.round(t)}°`);

// the next three days (index 0 of Open-Meteo's daily list is today)
function daysHtml(daily) {
  const days = (daily || []).slice(1, 4);
  if (!days.length || !S.config.show_forecast) return '';
  return '<div class="days">' + days.map((d) => `<div class="day">
      <span class="dow">${esc(dayName(d.date))}</span>${Icons.weather(d.code)}
      <span>${temp(d.max)}<span class="lo">${temp(d.min)}</span></span></div>`).join('') + '</div>';
}

function renderOverlay() {
  if (!S.config) return;
  const cities = (S.weather && S.weather.cities) || [];
  const cfgCities = S.config.cities;
  let html;
  if (cfgCities.length > 1) {
    // The first city is the main one: large, with the date. The others sit below it, smaller,
    // one on the left and one on the right. Each reads: name, time, weather.
    const now = (i) => {
      const cur = (cities[i] || {}).current;
      return cur ? Icons.weather(cur.code, cur.is_day) + `<span>${temp(cur.temp)}</span>` : '';
    };
    const [main, ...others] = cfgCities;
    html = `<div class="multi">
      <div class="main">
        <div class="clock">
          <div class="time" data-clock="${esc(main.timezone)}"></div>
          ${S.config.show_date ? `<div class="date" data-date="${esc(main.timezone)}"></div>` : ''}
          ${S.config.show_main_city ? `<div class="city">${esc(main.name)}</div>` : ''}
        </div>
        <div class="weather">
          <div class="now">${now(0)}</div>
          ${daysHtml((cities[0] || {}).daily)}
        </div>
      </div>
      ${others.length ? '<div class="others">' + others.map((c, j) => `<div class="other">
          <div class="line"><span class="time" data-clock="${esc(c.timezone)}" data-hide-if-same="${esc(main.timezone)}"></span>
            <span class="weather">${now(j + 1)}</span></div>
          <div class="city">${esc(c.name)}</div>
        </div>`).join('') + '</div>' : ''}
    </div>`;
  } else {
    const c = cfgCities[0];
    const w = cities[0] || {};
    const cur = w.current;
    const tz = c ? c.timezone : '';
    html = `<div class="forecast">
      <div class="clock">
        <div class="time" data-clock="${esc(tz)}"></div>
        ${S.config.show_date ? `<div class="date" data-date="${esc(tz)}"></div>` : ''}
        ${c && S.config.show_main_city ? `<div class="city">${esc(c.name)}</div>` : ''}
      </div>
      <div class="weather">
        ${cur ? `<div class="now">${Icons.weather(cur.code, cur.is_day)}<span>${temp(cur.temp)}</span></div>` : ''}
        ${daysHtml(w.daily)}
      </div>
    </div>`;
  }
  $('#overlay').innerHTML = html;
  $('#overlay').classList.toggle('no-forecast', !S.config.show_forecast);
  tick();
}

function tick() {
  if (!S.config) return;
  document.querySelectorAll('[data-clock]').forEach((el) => {
    const html = timeHtml(el.dataset.clock);
    if (el.innerHTML !== html) el.innerHTML = html;
    // a secondary city in the main city's time zone needs no second clock
    // (checked every tick, since daylight saving can make two zones match or differ)
    if (el.dataset.hideIfSame !== undefined) {
      el.hidden = html === timeHtml(el.dataset.hideIfSame);
    }
  });
  document.querySelectorAll('[data-date]').forEach((el) => {
    const text = dateText(el.dataset.date);
    if (el.textContent !== text) el.textContent = text;
  });
}

async function loadWeather() {
  try { S.weather = await api('/api/weather'); renderOverlay(); } catch { /* keep the last forecast */ }
}

/* ================= server state ================= */

async function poll() {
  try {
    const st = await api('/api/state');
    if (S.build && st.build && st.build !== S.build) {
      location.reload(); // the server was updated: load the new page code
      return;
    }
    S.build = st.build;
    S.state = st;
    if (st.config_version !== S.configVersion) {
      S.config = await api('/api/config');
      S.configVersion = st.config_version;
      fmtCache.clear();
      document.documentElement.dataset.orient = S.config.orientation || 'portrait';
      renderOverlay();
      loadWeather();
      await loadPhotos();
      S.photosVersion = st.photos_version;
      if (S.current) schedule();
    } else if (st.photos_version !== S.photosVersion) {
      await loadPhotos();
      S.photosVersion = st.photos_version;
    }
    applyState(st);
  } catch (e) {
    // the server restarts during updates; just try again
  }
  setTimeout(poll, 4000);
}

function applyState(st) {
  document.querySelectorAll('[data-url]').forEach((el) => (el.textContent = st.url));
  $('#offline').classList.toggle('hidden', st.online);
  $('#blank').classList.toggle('hidden', st.screen_on);
  updateEmpty();
  if (st.needs_wifi && !Wifi.isOpen()) Wifi.open(true);
  else if (!st.needs_wifi && Wifi.isOpen() && Wifi.auto && st.online) Wifi.close(false);
}

/* ================= QR overlay ================= */

let qrTimer = null;
function showQr() {
  $('#qr .qr-img').src = '/api/qr.svg?t=' + Date.now();
  $('#qr').classList.remove('hidden');
  clearTimeout(qrTimer);
  qrTimer = setTimeout(hideQr, 20000);
}
function hideQr() { $('#qr').classList.add('hidden'); }

/* ================= Wi-Fi setup ================= */

const Wifi = {
  auto: false, ssid: null, busy: false, kb: null,

  isOpen() { return !$('#wifi').classList.contains('hidden'); },

  open(auto) {
    this.auto = auto;
    hideQr();
    $('#wifi').classList.remove('hidden');
    $('#wifi-close').classList.toggle('hidden', auto && !S.photos.size);
    this.showList();
    this.scan();
  },

  close(dismiss) {
    $('#wifi').classList.add('hidden');
    if (dismiss) post('/api/wifi/dismiss').catch(() => {});
  },

  showList() {
    $('#wifi-list-view').classList.remove('hidden');
    $('#wifi-pass-view').classList.add('hidden');
    $('#wifi-sub').textContent = S.state && S.state.online
      ? `Connected to ${S.state.ssid || 'a network'}` : 'Choose your network';
  },

  async scan() {
    const list = $('#wifi-list');
    list.innerHTML = '<div class="wifi-note">Searching for networks…</div>';
    try {
      const nets = await api('/api/wifi/networks');
      if (!nets.length) { list.innerHTML = '<div class="wifi-note">No networks found. Tap “Scan again”.</div>'; return; }
      list.innerHTML = nets.map((n, i) => `<button type="button" class="net" data-i="${i}">
          ${Icons.signal(n.signal)}<span class="name">${esc(n.ssid)}</span>
          ${n.in_use ? '<span class="tag">Connected</span>' : ''}${n.secure ? Icons.lock() : ''}
        </button>`).join('');
      list.querySelectorAll('.net').forEach((b) => b.addEventListener('click', () => this.pick(nets[b.dataset.i])));
    } catch (e) {
      list.innerHTML = `<div class="wifi-note">Could not scan: ${esc(e.message)}</div>`;
    }
  },

  pick(net) {
    this.ssid = net.ssid;
    if (!net.secure) { this.connect(''); return; }
    $('#wifi-list-view').classList.add('hidden');
    $('#wifi-pass-view').classList.remove('hidden');
    $('#wifi-ssid').textContent = net.ssid;
    $('#wifi-sub').textContent = 'Enter the password';
    const input = $('#wifi-pass');
    input.value = '';
    input.type = 'password';
    $('#wifi-show').textContent = 'Show';
    this.message('');
    if (!this.kb) this.kb = new OnScreenKeyboard($('#keyboard'), input, () => this.connect(input.value));
  },

  message(text, cls = '') {
    const el = $('#wifi-msg');
    el.textContent = text;
    el.className = cls;
  },

  async connect(password) {
    if (this.busy) return;
    this.busy = true;
    if ($('#wifi-pass-view').classList.contains('hidden')) {
      $('#wifi-list').innerHTML = `<div class="wifi-note">Connecting to ${esc(this.ssid)}…</div>`;
    }
    this.message(`Connecting to ${this.ssid}…`);
    try {
      const r = await post('/api/wifi/connect', { ssid: this.ssid, password });
      if (r.ok) {
        this.message('Connected!', 'ok');
        setTimeout(() => this.close(false), 1500);
      } else {
        this.message(r.message || 'Could not connect', 'error');
        if ($('#wifi-pass-view').classList.contains('hidden')) this.scan();
      }
    } catch (e) {
      this.message('Could not connect: ' + e.message, 'error');
    } finally {
      this.busy = false;
    }
  },
};

$('#wifi-close').addEventListener('click', () => Wifi.close(true));
$('#wifi-rescan').addEventListener('click', () => Wifi.scan());
$('#wifi-cancel').addEventListener('click', () => Wifi.showList());
$('#wifi-connect').addEventListener('click', () => Wifi.connect($('#wifi-pass').value));
$('#wifi-show').addEventListener('click', () => {
  const input = $('#wifi-pass');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#wifi-show').textContent = input.type === 'password' ? 'Show' : 'Hide';
});
$('#qr-wifi').addEventListener('click', () => Wifi.open(false));

/* ================= touch: swipe, long press, wake ================= */

let touch = null, pressTimer = null;

// Touch positions are in panel coordinates; turn a movement into the rotated picture's
// coordinates so "swipe left" always means left as the viewer sees it.
function toScreen(dx, dy) {
  const o = S.config && S.config.orientation;
  if (o === 'landscape') return [dy, -dx];         // picture turned a quarter clockwise
  if (o === 'landscape_flipped') return [-dy, dx]; // picture turned a quarter anticlockwise
  return [dx, dy];
}

document.addEventListener('pointerdown', (e) => {
  if (Wifi.isOpen()) return;
  // Every touch counts as a wake: our idea of screen_on can be up to one poll out of date,
  // and while the room is dark the server only switches the screen on after a wake.
  post('/api/wake').catch(() => {});
  if (S.state && !S.state.screen_on) {
    S.state.screen_on = true;
    $('#blank').classList.add('hidden');
    return;
  }
  if (!$('#qr').classList.contains('hidden')) {
    if (!e.target.closest('button')) hideQr();
    return;
  }
  touch = { x: e.clientX, y: e.clientY, moved: false };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { if (touch && !touch.moved && !S.clip) { touch = null; showQr(); } }, 900);
});

document.addEventListener('pointermove', (e) => {
  if (touch && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 15) {
    touch.moved = true;
    clearTimeout(pressTimer);
  }
});

document.addEventListener('pointerup', (e) => {
  clearTimeout(pressTimer);
  if (!touch) return;
  const [dx, dy] = toScreen(e.clientX - touch.x, e.clientY - touch.y);
  touch = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) (dx < 0 ? swipeNext() : swipePrev());
  // a long swipe down (a quarter of the picture's height) turns the picture to the next orientation
  else if (!S.clip && dy > $('#screen').clientHeight * 0.25 && dy > Math.abs(dx) * 1.5) rotate();
});

/* ================= swipe down: rotate the picture ================= */

const ORIENT_LABELS = {
  en: { portrait: 'Portrait', landscape: 'Landscape', landscape_flipped: 'Landscape (other way)' },
  es: { portrait: 'Vertical', landscape: 'Horizontal', landscape_flipped: 'Horizontal (al otro lado)' },
};

async function rotate() {
  try {
    const r = await post('/api/orientation/next');
    S.config.orientation = r.orientation;
    document.documentElement.dataset.orient = r.orientation; // turn now; photos follow on the next poll
    const labels = ORIENT_LABELS[(S.config.language || '').startsWith('es') ? 'es' : 'en'];
    flashMessage(labels[r.orientation] || r.orientation);
  } catch { /* server busy or restarting: nothing happens, swipe again */ }
}

let msgTimer = null;
function flashMessage(text) {
  const el = $('#frame-msg');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => el.classList.add('hidden'), 2000);
}

document.addEventListener('pointercancel', () => { touch = null; clearTimeout(pressTimer); });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
document.querySelectorAll('img').forEach((img) => (img.draggable = false));

// keyboard shortcuts for testing on a computer
document.addEventListener('keydown', (e) => {
  if (Wifi.isOpen()) { if (e.key === 'Escape') Wifi.close(true); return; }
  if (e.key === 'ArrowRight') swipeNext();
  else if (e.key === 'ArrowLeft') swipePrev();
  else if (e.key === 'q') showQr();
  else if (e.key === 'w') Wifi.open(false);
});

/* ================= start ================= */

if (window.self !== window.top) document.documentElement.classList.add('embedded');
$('#offline').innerHTML = Icons.wifiOff();
setInterval(tick, 1000);
setInterval(loadWeather, 5 * 60 * 1000);
poll();
