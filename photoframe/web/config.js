'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = body.detail || res.statusText;
    if (Array.isArray(msg)) msg = msg.map((d) => `${(d.loc || []).slice(1).join('.')}: ${d.msg}`).join('; ');
    throw new Error(msg);
  }
  return body;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

let saved = null;  // config as stored on the frame
let cfg = null;    // working copy being edited
let state = null;

const getPath = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

function changed() {
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  $('#savebar').classList.toggle('hidden', !dirty);
  $('#save-msg').textContent = 'Unsaved changes';
  $('#save-msg').className = '';
}

/* ---------- simple fields bound with data-path ---------- */

function renderFields() {
  $$('[data-path]').forEach((el) => {
    const v = getPath(cfg, el.dataset.path);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
  $$('output[data-for]').forEach((o) => (o.textContent = getPath(cfg, o.dataset.for) + '%'));
  $$('input[name=wmode]').forEach((r) => (r.checked = r.value === cfg.weather_mode));
  const s = cfg.slide_seconds;
  const unit = s % 3600 === 0 ? 3600 : s % 60 === 0 ? 60 : 1;
  $('#dur-unit').value = String(unit);
  $('#dur-value').value = s / unit;
  $$('[data-auto]').forEach((el) => {
    el.classList.toggle('hidden', (el.dataset.auto === '1') !== cfg.brightness.auto);
  });
}

function bindFields() {
  $$('[data-path]').forEach((el) => {
    el.addEventListener(el.type === 'range' || el.type === 'text' ? 'input' : 'change', () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number' || el.type === 'range') v = Number(el.value);
      else v = el.value;
      setPath(cfg, el.dataset.path, v);
      renderFields();
      if (el.dataset.path === 'weather_mode') renderCities();
      changed();
    });
  });
  $$('input[name=wmode]').forEach((r) => r.addEventListener('change', () => {
    cfg.weather_mode = r.value;
    renderCities();
    changed();
  }));
  const dur = () => {
    const n = Math.max(1, Math.round(Number($('#dur-value').value) || 1));
    cfg.slide_seconds = Math.max(5, n * Number($('#dur-unit').value));
    changed();
  };
  $('#dur-value').addEventListener('input', dur);
  $('#dur-unit').addEventListener('change', () => { dur(); renderFields(); });
}

/* ---------- albums ---------- */

function albumStatus(url) {
  const st = state && state.albums && state.albums[url];
  if (!st) return ['Not synced yet', ''];
  if (st.ok) return [`${st.count} photos`, 'ok'];
  return [st.error || 'Error', 'bad'];
}

function renderAlbums() {
  const box = $('#albums');
  box.innerHTML = '';
  if (!cfg.albums.length) {
    box.innerHTML = '<p class="note">No albums yet.</p>';
    return;
  }
  cfg.albums.forEach((album, i) => {
    const node = $('#album-tpl').content.firstElementChild.cloneNode(true);
    node.classList.toggle('off', !album.enabled);
    const bind = (sel, key, prop = 'value') => {
      const el = $(sel, node);
      el[prop] = album[key];
      el.addEventListener(prop === 'checked' ? 'change' : 'input', () => {
        album[key] = el[prop];
        node.classList.toggle('off', !album.enabled);
        changed();
      });
    };
    bind('.a-name', 'name');
    bind('.a-url', 'url');
    bind('.a-pass', 'password');
    bind('.a-enabled', 'enabled', 'checked');
    if (album.password) $('.a-more', node).open = true;
    const status = $('.a-status', node);
    const [text, cls] = albumStatus(album.url);
    status.textContent = text;
    status.className = `a-status note ${cls}`;
    $('.a-del', node).addEventListener('click', () => {
      cfg.albums.splice(i, 1);
      renderAlbums();
      changed();
    });
    $('.a-test', node).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      status.textContent = 'Testing…';
      status.className = 'a-status note';
      try {
        const r = await post('/api/albums/test', { url: album.url, password: album.password });
        status.textContent = r.ok ? `OK — ${r.count} photos found` : r.error;
        status.className = `a-status note ${r.ok ? 'ok' : 'bad'}`;
      } catch (err) {
        status.textContent = err.message;
        status.className = 'a-status note bad';
      } finally {
        btn.disabled = false;
      }
    });
    box.appendChild(node);
  });
}

$('#album-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#album-url').value.trim();
  if (!/\/sharing\/[^/]+/.test(url)) { toast('That does not look like a Synology share link'); return; }
  if (cfg.albums.some((a) => a.url === url)) { toast('Album already added'); return; }
  cfg.albums.push({ url, name: '', password: '', enabled: true });
  $('#album-url').value = '';
  renderAlbums();
  changed();
});

/* ---------- cities ---------- */

function renderCities() {
  const multi = cfg.weather_mode === 'multi';
  $('#cities-note').textContent = multi
    ? 'Up to three cities, each with its own local time and current weather.'
    : 'The first city is used for the clock (its time zone) and the forecast.';
  const list = $('#cities');
  list.innerHTML = cfg.cities.map((c, i) => `<li class="${!multi && i > 0 ? 'unused' : ''}">
      <span class="name">${esc(c.name)}<small>${esc([c.country, c.timezone].filter(Boolean).join(' · '))}</small></span>
      <button type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button type="button" data-del="${i}" aria-label="Remove">✕</button>
    </li>`).join('') || '<li class="note">No city yet — the frame shows its own local time.</li>';
  $$('[data-up]', list).forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.up);
    [cfg.cities[i - 1], cfg.cities[i]] = [cfg.cities[i], cfg.cities[i - 1]];
    renderCities();
    changed();
  }));
  $$('[data-del]', list).forEach((b) => b.addEventListener('click', () => {
    cfg.cities.splice(Number(b.dataset.del), 1);
    renderCities();
    changed();
  }));
  $('#city-q').disabled = cfg.cities.length >= 3;
  $('#city-q').placeholder = cfg.cities.length >= 3 ? 'Maximum of 3 cities' : 'Add a city…';
}

let searchTimer = null, searchSeq = 0;
$('#city-q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#city-q').value.trim();
  if (q.length < 2) { $('#city-results').classList.add('hidden'); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    let results = [];
    try { results = await api('/api/geocode?q=' + encodeURIComponent(q)); } catch (e) { toast(e.message); }
    if (seq !== searchSeq) return;
    const ul = $('#city-results');
    ul.innerHTML = results.map((r, i) =>
      `<li data-i="${i}">${esc(r.name)} <small>${esc([r.region, r.country].filter(Boolean).join(', '))}</small></li>`
    ).join('') || '<li class="note">No match</li>';
    ul.classList.remove('hidden');
    $$('li[data-i]', ul).forEach((li) => li.addEventListener('click', () => {
      const r = results[li.dataset.i];
      cfg.cities.push({ name: r.name, country: r.country, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone });
      $('#city-q').value = '';
      ul.classList.add('hidden');
      renderCities();
      changed();
    }));
  }, 300);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) $('#city-results').classList.add('hidden');
});

/* ---------- status ---------- */

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round(Date.now() / 1000 - ts);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

async function refreshState() {
  try {
    state = await api('/api/state');
  } catch {
    $('#conn').textContent = 'Frame unreachable';
    $('#conn').className = 'pill bad';
    return;
  }
  const conn = $('#conn');
  conn.textContent = state.online ? `Online${state.ssid ? ' · ' + state.ssid : ''}` : 'Offline';
  conn.className = 'pill ' + (state.online ? 'ok' : 'bad');
  $('#st-photos').textContent = state.photo_count;
  $('#st-last').textContent = ago(state.sync.last_sync);
  $('#st-next').textContent = state.sync.next_run
    ? new Date(state.sync.next_run * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
  $('#st-lux').textContent = state.sensor ? `${state.lux ?? '–'} lux` : 'no sensor';
  $('#st-screen').textContent = state.screen_on ? `${Math.round(state.brightness)}%` : 'off';
  $('#st-url').textContent = state.url;
  const sync = state.sync;
  const line = $('#st-sync');
  line.textContent = sync.running ? (sync.progress || 'Syncing…') : (sync.last_error ? 'Last sync problem: ' + sync.last_error : '');
  line.className = 'note' + (!sync.running && sync.last_error ? ' bad' : '');
  $('#sync-now').disabled = sync.running;
  $('#sys-info').textContent = `Version ${state.version} · ${state.hostname} · light sensor: ${state.sensor || 'none'}` +
    ` · backlight: ${state.backlight}${state.mock ? ' · simulated hardware' : ''}`;
  if (!document.activeElement || !document.activeElement.closest('#albums')) {
    $$('.album').forEach((node, i) => {
      const a = cfg.albums[i];
      if (!a) return;
      const el = $('.a-status', node);
      if (el.textContent === 'Testing…' || el.textContent.startsWith('OK —')) return;
      const [text, cls] = albumStatus(a.url);
      el.textContent = text;
      el.className = `a-status note ${cls}`;
    });
  }
}

$('#sync-now').addEventListener('click', async () => {
  try {
    if (JSON.stringify(cfg) !== JSON.stringify(saved)) await save();
    await post('/api/sync');
    toast('Sync started');
    setTimeout(refreshState, 800);
  } catch (e) { toast(e.message); }
});

$('#reboot').addEventListener('click', async () => {
  if (!confirm('Restart the photo frame now?')) return;
  try { toast((await post('/api/system/reboot')).message); } catch (e) { toast(e.message); }
});

/* ---------- save ---------- */

async function save() {
  const btn = $('#save');
  btn.disabled = true;
  try {
    saved = await api('/api/config', { method: 'PUT', body: JSON.stringify(cfg) });
    cfg = structuredClone(saved);
    renderAll();
    changed();
    toast('Saved');
  } catch (e) {
    $('#save-msg').textContent = e.message;
    $('#save-msg').className = 'bad';
    throw e;
  } finally {
    btn.disabled = false;
  }
}
$('#save').addEventListener('click', () => save().catch(() => {}));
$('#revert').addEventListener('click', () => {
  cfg = structuredClone(saved);
  renderAll();
  changed();
});
window.addEventListener('beforeunload', (e) => {
  if (cfg && JSON.stringify(cfg) !== JSON.stringify(saved)) e.preventDefault();
});

function renderAll() {
  renderFields();
  renderAlbums();
  renderCities();
}

(async function init() {
  saved = await api('/api/config');
  cfg = structuredClone(saved);
  bindFields();
  renderAll();
  await refreshState();
  renderAlbums();
  setInterval(refreshState, 4000);
})();
