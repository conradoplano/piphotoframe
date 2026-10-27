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
  $('#save-msg').textContent = t('unsaved');
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
      changed();
    });
  });
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
  if (!st) return [t('notChecked'), ''];
  if (st.ok) return [mediaSummary(st), 'ok'];
  return [st.error || t('error'), 'bad'];
}

// "10 photos · 3 videos (1 more not used: too long)"
function mediaSummary(r) {
  let text = t('photos', { n: r.count });
  if (r.videos) text += ` · ${t('videos', { n: r.videos })}`;
  if (r.videos_unused) {
    const what = r.videos ? t('moreVideos', { n: r.videos_unused }) : t('videos', { n: r.videos_unused });
    text += ` (${t('notUsed', { what, why: cfg.clips_enabled ? t('tooLong') : t('videosOff') })})`;
  }
  return text;
}

function renderAlbums() {
  const box = $('#albums');
  box.innerHTML = '';
  if (!cfg.albums.length) {
    box.innerHTML = `<p class="note">${esc(t('noAlbums'))}</p>`;
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
    const pass = $('.a-pass', node);
    pass.classList.toggle('hidden', !album.password); // shown only when the share needs one
    $('.a-pass-toggle', node).addEventListener('click', () => {
      pass.classList.toggle('hidden');
      if (!pass.classList.contains('hidden')) pass.focus();
    });
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
      status.dataset.manual = '1'; // keep the test result; the status refresh leaves it alone
      status.textContent = t('testing');
      status.className = 'a-status note';
      try {
        const r = await post('/api/albums/test', { url: album.url, password: album.password });
        status.textContent = r.ok ? t('testOk', { summary: mediaSummary(r) }) : r.error;
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
  if (!/\/sharing\/[^/]+/.test(url)) { toast(t('notShareLink')); return; }
  if (cfg.albums.some((a) => a.url === url)) { toast(t('albumTwice')); return; }
  cfg.albums.push({ url, name: '', password: '', enabled: true });
  $('#album-url').value = '';
  renderAlbums();
  changed();
});

/* ---------- cities ---------- */

function renderCities() {
  const list = $('#cities');
  list.innerHTML = cfg.cities.map((c, i) => `<li>
      <span class="name">${esc(c.name)}<small>${esc([c.country, c.timezone].filter(Boolean).join(' · '))}</small></span>
      <button type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('moveUp'))}">↑</button>
      <button type="button" data-del="${i}" aria-label="${esc(t('remove'))}">✕</button>
    </li>`).join('') || `<li class="note">${esc(t('noCity'))}</li>`;
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
  $('#city-q').placeholder = cfg.cities.length >= 3 ? t('maxCities') : t('addCity');
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
    ).join('') || `<li class="note">${esc(t('noCityFound'))}</li>`;
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
  if (!ts) return t('never');
  const s = Math.round(Date.now() / 1000 - ts);
  if (s < 90) return t('justNow');
  if (s < 5400) return t('minAgo', { n: Math.round(s / 60) });
  if (s < 129600) return t('hoursAgo', { n: Math.round(s / 3600) });
  return new Date(ts * 1000).toLocaleDateString();
}

async function refreshState() {
  try {
    state = await api('/api/state');
  } catch {
    $('#conn').textContent = t('unreachable');
    $('#conn').className = 'pill bad';
    return;
  }
  const conn = $('#conn');
  conn.textContent = !state.online ? t('noNetwork')
    : state.ssid === 'cable' ? t('onlineCable')
      : state.ssid ? t('onlineWifi', { ssid: state.ssid }) : t('online');
  conn.className = 'pill ' + (state.online ? 'ok' : 'bad');
  $('#st-photos').textContent = t('photos', { n: state.photo_count }) +
    (state.clip_count ? ` · ${t('videos', { n: state.clip_count })}` : '');
  $('#clip-count').textContent = state.clip_count
    ? t('clipsReady', { videos: t('videos', { n: state.clip_count }) }) : t('noClips');
  $('#st-last').textContent = ago(state.sync.last_sync);
  $('#st-next').textContent = state.sync.next_run
    ? new Date(state.sync.next_run * 1000).toLocaleString(LANG, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
  const now = state.sensor && state.lux !== null ? ` (${state.lux} lux)` : '';
  $('#cal-dark').textContent = t('darkNow') + now;
  $('#cal-bright').textContent = t('brightNow') + now;
  $('#bri-now').textContent = !state.sensor ? t('noSensor')
    : state.screen_on ? t('roomNowOn', { lux: state.lux ?? '–', pct: Math.round(state.brightness) })
      : t('roomNowOff', { lux: state.lux ?? '–' });
  $('#st-url').textContent = state.url;
  const sync = state.sync;
  const line = $('#st-sync');
  line.textContent = sync.running ? (tServer(sync.progress) || t('fetching'))
    : (sync.last_error ? t('syncProblem', { error: tServer(sync.last_error) }) : '');
  line.className = 'note' + (!sync.running && sync.last_error ? ' bad' : '');
  $('#sync-now').disabled = sync.running;
  $('#sys-info').textContent = t('sysInfo', {
    version: state.version + (state.build ? ` (${state.build})` : ''), host: state.hostname,
    sensor: state.sensor || t('none'), backlight: state.backlight,
  }) + (state.mock ? t('simulated') : '');
  if (!document.activeElement || !document.activeElement.closest('#albums')) {
    $$('.album').forEach((node, i) => {
      const a = cfg.albums[i];
      if (!a) return;
      const el = $('.a-status', node);
      if (el.dataset.manual) return; // showing a Test result
      const [text, cls] = albumStatus(a.url);
      el.textContent = text;
      el.className = `a-status note ${cls}`;
    });
  }
}

/* ---------- brightness calibration: use the current sensor reading as "dark" or "bright" ---------- */

function calibrate(which) {
  const lux = state && state.sensor ? state.lux : null;
  if (lux === null || lux === undefined) { toast(t('noReading')); return; }
  const b = cfg.brightness;
  const value = Math.max(0.1, Math.round(lux * 10) / 10);
  if (which === 'dark') {
    b.dark_lux = value;
    if (b.bright_lux < value * 3) b.bright_lux = Math.round(value * 30);
  } else {
    if (value < b.dark_lux * 3) {
      toast(t('notBrighter', { value, dark: b.dark_lux }));
      return;
    }
    b.bright_lux = Math.round(value);
  }
  renderFields();
  changed();
  toast(which === 'dark' ? t('darkSet', { value: b.dark_lux }) : t('brightSet', { value: b.bright_lux }));
}
$('#cal-dark').addEventListener('click', () => calibrate('dark'));
$('#cal-bright').addEventListener('click', () => calibrate('bright'));

$('#sync-now').addEventListener('click', async () => {
  try {
    if (JSON.stringify(cfg) !== JSON.stringify(saved)) await save();
    await post('/api/sync');
    toast(t('fetching'));
    setTimeout(refreshState, 800);
  } catch (e) { toast(e.message); }
});

$('#shutdown').addEventListener('click', async () => {
  if (!confirm(t('shutdownConfirm'))) return;
  try {
    toast(tServer((await post('/api/system/shutdown')).message));
    $('#conn').textContent = t('shuttingDown');
    $('#conn').className = 'pill bad';
  } catch (e) { toast(e.message); }
});

$('#reboot').addEventListener('click', async () => {
  if (!confirm(t('restartConfirm'))) return;
  try { toast(tServer((await post('/api/system/reboot')).message)); } catch (e) { toast(e.message); }
});

/* ---------- software update ---------- */

function renderUpdate(u) {
  const msg = $('#upd-msg');
  const list = $('#upd-commits');
  const install = $('#upd-install');
  list.classList.add('hidden');
  install.classList.add('hidden');
  msg.className = 'note';
  if (!u.available) {
    msg.textContent = tServer(u.error) || t('updNotAvailable');
  } else if (u.running) {
    msg.textContent = u.log.length ? tServer(u.log[u.log.length - 1]) : t('updating');
  } else if (u.error) {
    msg.textContent = tServer(u.error);
    msg.className = 'note bad';
  } else if (!u.checked) {
    msg.textContent = t('updInstalled', { build: u.build });
  } else if (!u.behind) {
    msg.textContent = t('updLatest', { build: u.build });
    msg.className = 'note ok';
  } else {
    msg.textContent = t('updAvailable', { n: u.behind });
    list.innerHTML = u.commits.map((c) => {
      const [hash, ...rest] = c.split(' ');
      return `<li><code>${esc(hash)}</code>${esc(rest.join(' '))}</li>`;
    }).join('');
    list.classList.remove('hidden');
    install.classList.toggle('hidden', !u.can_install);
    if (!u.can_install) msg.textContent += t('updDevMode');
  }
  $('#upd-check').disabled = u.running;
  install.disabled = u.running;
}

$('#upd-check').addEventListener('click', async () => {
  const btn = $('#upd-check');
  btn.disabled = true;
  $('#upd-msg').textContent = t('checking');
  $('#upd-msg').className = 'note';
  try { renderUpdate(await post('/api/update/check')); } catch (e) { toast(e.message); }
  btn.disabled = false;
});

$('#upd-install').addEventListener('click', async () => {
  if (!confirm(t('installConfirm'))) return;
  const before = state && state.build;
  try { renderUpdate(await post('/api/update/install')); } catch (e) { toast(e.message); return; }
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const st = await api('/api/state');
      if (st.build && st.build !== before) {
        clearInterval(timer);
        toast(t('updatedTo', { build: st.build }));
        setTimeout(() => location.reload(), 1200);
        return;
      }
      const u = await api('/api/update');
      renderUpdate(u);
      if (!u.running && u.error) clearInterval(timer);
    } catch {
      $('#upd-msg').textContent = t('restarting');
    }
    if (Date.now() - started > 5 * 60 * 1000) {
      clearInterval(timer);
      $('#upd-msg').textContent = t('updSlow');
    }
  }, 2000);
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
    toast(t('saved'));
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
  api('/api/update').then(renderUpdate).catch(() => {});
  setInterval(refreshState, 4000);
})();
