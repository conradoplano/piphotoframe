'use strict';
// Translations for the settings page. The page is written in English; when the browser's preferred
// language is Spanish, the texts below replace it. To add a language: add its column to TEXT and an
// object like ES_HTML, and extend LANG.

const LANGS = ['en', 'es'];
const LANG_KEY = 'photoframe.lang'; // this browser's choice in the header menu: '', 'en' or 'es'

function storedLang() {
  try { return localStorage.getItem(LANG_KEY) || ''; } catch { return ''; }
}

function browserLang() {
  const first = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return /^es\b/i.test(first) ? 'es' : 'en';
}

const LANG = LANGS.includes(storedLang()) ? storedLang() : browserLang();

// Page texts, by the element's data-i18n key (the English is in config.html itself). May contain <b>.
const ES_HTML = {
  'title': 'Cuadro digital de fotos · Ajustes',
  'app': 'Cuadro digital de fotos',
  'lang.auto': 'Automático',
  'aria.lang': 'Idioma de esta página',
  // album status
  'now.photos': 'En la presentación',
  'now.last': 'Fotos descargadas por última vez',
  'now.next': 'Próxima descarga',
  'now.sync': 'Descargar fotos nuevas ahora',
  'albums.list': 'Álbumes',
  // albums
  'albums.h': 'Álbumes de fotos',
  'albums.lead': 'El cuadro muestra las fotos (y los vídeos cortos) de estos álbumes de Synology Photos. ' +
    'Busca fotos nuevas una vez al día.',
  'albums.how': 'Para añadir un álbum: en Synology Photos abre el álbum, elige <b>Compartir</b>, activa el ' +
    'enlace público, cópialo y pégalo aquí.',
  'albums.add': 'Añadir',
  'albums.synctime': 'Buscar fotos nuevas en los álbumes cada día a las',
  'albums.nas': 'Conexión con el NAS',
  'albums.tls': 'Comprobar el certificado de seguridad del NAS',
  'albums.tlsnote': 'Déjalo activado. Desactívalo solo si tus enlaces usan la dirección local del NAS ' +
    '(como https://192.168.1.10:5001/…) y al añadir un álbum aparece un error de certificado.',
  // album card
  'album.show': 'Mostrar',
  'album.password': 'Contraseña',
  'album.test': 'Probar',
  'album.remove': 'Quitar',
  // slideshow
  'show.h': 'Presentación',
  'show.duration': 'Mostrar cada foto durante',
  'unit.seconds': 'segundos',
  'unit.minutes': 'minutos',
  'unit.hours': 'horas',
  'show.order': 'Orden',
  'show.random': 'Aleatorio',
  'show.newest': 'Las más nuevas primero',
  'show.oldest': 'Las más antiguas primero',
  'show.fit': 'Fotos con una forma distinta a la pantalla',
  'show.blur': 'Foto entera, bordes difuminados',
  'show.cover': 'Llenar la pantalla, recortar bordes',
  'show.contain': 'Foto entera, bordes negros',
  'show.trans': 'Cambiar de una foto a la siguiente',
  'show.fade': 'Con un fundido suave',
  'show.instant': 'Al instante',
  // videos
  'vid.h': 'Vídeos cortos',
  'vid.lead': 'Los vídeos de tus álbumes no forman parte de la presentación. Cuando alguien desliza a la ' +
    'foto siguiente, el cuadro reproduce primero un vídeo corto (sin sonido) y luego muestra la foto ' +
    'siguiente. Deslizar otra vez salta el vídeo.',
  'vid.on': 'Reproducir un vídeo cuando alguien desliza a la foto siguiente',
  'vid.slideshow': 'Reproducir también vídeos entre fotos en la presentación',
  'vid.pause': 'Esperar al menos este tiempo entre dos vídeos',
  'vid.max': 'Reproducir cada vídeo como máximo',
  'vid.long': 'Vídeos más largos',
  'vid.trim': 'Reproducir solo el principio',
  'vid.skip': 'No usarlos',
  'vid.note': 'Los vídeos de más de un minuto no se usan nunca.',
  // clock & weather
  'clock.h': 'Reloj y tiempo',
  'clock.lead': 'Añade una ciudad, o hasta tres para ver la hora y el tiempo en varios lugares. La primera ' +
    'ciudad es la principal: se muestra en grande, con la fecha y la previsión. Usa ↑ para elegir qué ' +
    'ciudad va primero.',
  'clock.show': 'Mostrar',
  'clock.date': 'La fecha',
  'clock.maincity': 'El nombre de la ciudad principal',
  'clock.forecast': 'La previsión de los próximos 3 días',
  'clock.24h': 'La hora en formato de 24 horas (si no, AM/PM)',
  'clock.units': 'Temperaturas en',
  'clock.lang': 'Idioma de la fecha y los días de la semana',
  // screen
  'screen.h': 'Pantalla',
  'screen.orient': 'Cómo cuelga el cuadro',
  'screen.portrait': 'Vertical',
  'screen.landscape': 'De lado (horizontal)',
  'screen.orienthint': 'También puedes cambiarlo deslizando el dedo hacia abajo en el cuadro.',
  'bri.h': 'Brillo',
  'bri.lead': 'Un sensor de luz mide cuánta luz hay en la habitación y la pantalla se adapta: tenue en una ' +
    'habitación oscura, brillante en una luminosa.',
  'bri.auto': 'Adaptar el brillo a la habitación',
  'bri.step1': '<b>1. Enseña al cuadro cómo es tu habitación.</b> El sensor ve más o menos luz según dónde ' +
    'esté montado. Pulsa <b>Ahora está oscuro</b> por la noche, con las luces que sueles tener encendidas, ' +
    'y <b>Ahora hay mucha luz</b> en un día luminoso. Pulsa Guardar después de cada uno.',
  'bri.step2': '<b>2. Elige cuánto brilla la pantalla.</b> Si aún brilla demasiado por la noche o muy poco ' +
    'de día, mueve estos controles.',
  'bri.dark': 'En una habitación oscura',
  'bri.bright': 'En una habitación luminosa',
  'bri.fixed': 'Brillo',
  'bri.more': 'Más opciones de brillo',
  'bri.luxnote': 'La luz se mide en lux. Como referencia: un dormitorio a oscuras tiene menos de 1 lux, un ' +
    'salón por la noche unos 50–150 y una habitación luminosa de día 300–1000. Los dos botones de arriba ' +
    'rellenan los dos primeros valores por ti.',
  'bri.darklux': 'La habitación cuenta como oscura a partir de (lux)',
  'bri.brightlux': 'La habitación cuenta como luminosa a partir de (lux)',
  'bri.offlux': 'Apagar la pantalla cuando haya menos de (lux)',
  'bri.offhint': '0 = nunca. Al tocarla se vuelve a encender durante un minuto.',
  'night.h': 'Noche',
  'night.on': 'Apagar la pantalla por la noche',
  'night.from': 'Desde',
  'night.until': 'Hasta',
  'night.note': 'Al tocar la pantalla se vuelve a encender durante un minuto.',
  // system
  'sys.h': 'Sistema',
  'sys.url': 'Para abrir estos ajustes en otro móvil u ordenador, ve a',
  'sys.software': 'Software',
  'sys.updmsg': 'Comprueba si hay una versión más nueva del software del cuadro.',
  'sys.check': 'Buscar actualizaciones',
  'sys.install': 'Instalar actualización',
  'sys.power': 'Encendido',
  'sys.powernote': 'Para apagar el cuadro, usa <b>Apagar</b> y espera a que la pantalla se quede negra antes ' +
    'de desenchufarlo. Para volver a encenderlo, enchúfalo de nuevo.',
  'sys.restart': 'Reiniciar',
  'sys.shutdown': 'Apagar',
  'sys.tech': 'Detalles técnicos',
  // save bar
  'save.undo': 'Deshacer',
  'save.save': 'Guardar',
  // attributes (placeholder / title / aria-label)
  'ph.albumurl': 'Pega el enlace para compartir del álbum',
  'ph.city': 'Añadir una ciudad…',
  'ph.albumname': 'Nombre (opcional, solo para ti)',
  'ph.albumpass': 'Contraseña, si el álbum compartido tiene una',
  'tt.albumshow': 'Incluir este álbum en la presentación',
  'aria.sharelink': 'Enlace para compartir',
  'aria.removealbum': 'Quitar el álbum',
};

// Texts built by config.js: [English, Spanish]. {name} is filled in; "a|b" is singular|plural by {n}.
const TEXT = {
  unsaved: ['You have unsaved changes', 'Tienes cambios sin guardar'],
  saved: ['Saved', 'Guardado'],
  notChecked: ['Not checked yet — tap Save, then “Get new photos now”',
    'Aún sin comprobar: pulsa Guardar y luego «Descargar fotos nuevas ahora»'],
  error: ['Error', 'Error'],
  photos: ['{n} photo|{n} photos', '{n} foto|{n} fotos'],
  videos: ['{n} video|{n} videos', '{n} vídeo|{n} vídeos'],
  moreVideos: ['{n} more', '{n} más'],
  notUsed: ['{what} not used: {why}', '{what} sin usar: {why}'],
  tooLong: ['too long', 'demasiado largos'],
  videosOff: ['videos are turned off', 'los vídeos están desactivados'],
  noAlbums: ['No albums yet.', 'Todavía no hay álbumes.'],
  testing: ['Testing…', 'Probando…'],
  testOk: ['OK — found {summary}', 'Correcto: se encontraron {summary}'],
  notShareLink: ['That is not a Synology Photos share link (it contains …/sharing/…)',
    'Eso no es un enlace para compartir de Synology Photos (contiene …/sharing/…)'],
  albumTwice: ['This album is already in the list', 'Este álbum ya está en la lista'],
  moveUp: ['Move up', 'Subir'],
  remove: ['Remove', 'Quitar'],
  noCity: ['No city yet — the frame shows its own local time.',
    'Todavía no hay ninguna ciudad: el cuadro muestra su propia hora local.'],
  maxCities: ['Maximum of 3 cities', 'Máximo 3 ciudades'],
  addCity: ['Add a city…', 'Añadir una ciudad…'],
  noCityFound: ['No city found with that name', 'No se encontró ninguna ciudad con ese nombre'],
  never: ['never', 'nunca'],
  justNow: ['just now', 'ahora mismo'],
  minAgo: ['{n} min ago', 'hace {n} min'],
  hoursAgo: ['{n} h ago', 'hace {n} h'],
  unreachable: ['Frame unreachable', 'No se puede conectar con el cuadro'],
  onlineCable: ['Online · network cable', 'Conectado · cable de red'],
  onlineWifi: ['Online · Wi‑Fi {ssid}', 'Conectado · wifi {ssid}'],
  online: ['Online', 'Conectado'],
  noNetwork: ['No network', 'Sin red'],
  clipsReady: ['Your albums have {videos} ready to play.', 'Tus álbumes tienen {videos} listos para reproducir.'],
  noClips: ['Your albums have no videos yet.', 'Tus álbumes todavía no tienen vídeos.'],
  darkNow: ["It's dark now", 'Ahora está oscuro'],
  brightNow: ["It's bright now", 'Ahora hay mucha luz'],
  noSensor: ['No light sensor found, so the screen keeps one fixed brightness.',
    'No se encontró ningún sensor de luz, así que la pantalla mantiene un brillo fijo.'],
  roomNowOn: ['Right now the room has {lux} lux of light, and the screen is at {pct}% brightness.',
    'Ahora mismo la habitación tiene {lux} lux de luz y la pantalla está al {pct} % de brillo.'],
  roomNowOff: ['Right now the room has {lux} lux of light, and the screen is off.',
    'Ahora mismo la habitación tiene {lux} lux de luz y la pantalla está apagada.'],
  fetching: ['Fetching new photos…', 'Descargando fotos nuevas…'],
  syncProblem: ['The last check for new photos had a problem: {error}',
    'La última búsqueda de fotos nuevas tuvo un problema: {error}'],
  sysInfo: ['Version {version} · {host} · light sensor: {sensor} · backlight: {backlight}',
    'Versión {version} · {host} · sensor de luz: {sensor} · retroiluminación: {backlight}'],
  none: ['none', 'ninguno'],
  simulated: [' · simulated hardware', ' · hardware simulado'],
  noReading: ['No light sensor reading yet', 'Todavía no hay lectura del sensor de luz'],
  notBrighter: ['Only {value} lux — that\'s not much brighter than your "dark" ({dark} lux). Try with more light.',
    'Solo {value} lux: no es mucho más que tu «oscuro» ({dark} lux). Prueba con más luz.'],
  darkSet: ['"Dark" set to {value} lux — tap Save', '«Oscuro» fijado en {value} lux: pulsa Guardar'],
  brightSet: ['"Bright" set to {value} lux — tap Save', '«Luminoso» fijado en {value} lux: pulsa Guardar'],
  shutdownConfirm: ['Shut down the photo frame?\n\nWait until the screen is dark and the green light on the Pi ' +
    'stops blinking before unplugging it. To turn it on again, unplug the power and plug it back in.',
  '¿Apagar el cuadro de fotos?\n\nEspera a que la pantalla se quede negra y la luz verde de la Raspberry Pi ' +
    'deje de parpadear antes de desenchufarlo. Para volver a encenderlo, desenchúfalo y vuelve a enchufarlo.'],
  shuttingDown: ['Shutting down', 'Apagándose'],
  restartConfirm: ['Restart the photo frame now? It is back in about a minute.',
    '¿Reiniciar el cuadro de fotos ahora? Vuelve en un minuto aproximadamente.'],
  updNotAvailable: ['Updates are not available (not installed from git).',
    'Las actualizaciones no están disponibles (no se instaló desde git).'],
  updating: ['Updating…', 'Actualizando…'],
  updInstalled: ['Installed version: {build}. Check whether a newer one is available.',
    'Versión instalada: {build}. Comprueba si hay una más nueva.'],
  updLatest: ['The frame has the latest version ({build}).', 'El cuadro tiene la última versión ({build}).'],
  updAvailable: ['A newer version is available, with {n} change:|A newer version is available, with {n} changes:',
    'Hay una versión más nueva, con {n} cambio:|Hay una versión más nueva, con {n} cambios:'],
  updDevMode: [' (install on the frame itself — not in dev mode)',
    ' (instálala en el propio cuadro, no en modo de desarrollo)'],
  checking: ['Checking…', 'Comprobando…'],
  installConfirm: ['Install the update now? The frame restarts and is back in about a minute.',
    '¿Instalar la actualización ahora? El cuadro se reinicia y vuelve en un minuto aproximadamente.'],
  updatedTo: ['Updated to {build}', 'Actualizado a {build}'],
  restarting: ['Restarting…', 'Reiniciando…'],
  updSlow: ['The update is taking long — reload this page in a moment.',
    'La actualización está tardando: vuelve a cargar esta página en un momento.'],
};

// Messages the frame's server sends in English (progress, results of buttons).
const ES_SERVER = [
  [/^Reading album (.*)$/, 'Leyendo el álbum $1'],
  [/^Downloading photos (\d+)\/(\d+)$/, 'Descargando fotos $1/$2'],
  [/^Downloading videos (\d+)\/(\d+)$/, 'Descargando vídeos $1/$2'],
  [/^Waiting for network$/, 'Esperando a la red'],
  [/^No network connection$/, 'Sin conexión de red'],
  [/^Downloading the new version…$/, 'Descargando la versión nueva…'],
  [/^Updating Python packages…$/, 'Actualizando los paquetes de Python…'],
  [/^Restarting…$/, 'Reiniciando…'],
  [/^Rebooting$/, 'Reiniciando'],
  [/^Shutting down$/, 'Apagándose'],
  [/^Simulated reboot$/, 'Reinicio simulado'],
  [/^Simulated shutdown$/, 'Apagado simulado'],
  [/^Could not reach GitHub: /, 'No se pudo conectar con GitHub: '],
];

function t(key, params = {}) {
  const pair = TEXT[key];
  if (!pair) return key;
  let s = pair[LANG === 'es' ? 1 : 0];
  if (s.includes('|')) s = s.split('|')[params.n === 1 ? 0 : 1];
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
}

function tServer(text) {
  if (LANG !== 'es' || !text) return text;
  for (const [re, es] of ES_SERVER) if (re.test(text)) return text.replace(re, es);
  return text;
}

function translatePage() {
  document.documentElement.lang = LANG;
  if (LANG === 'en') return;
  const roots = [document, ...[...document.querySelectorAll('template')].map((tpl) => tpl.content)];
  for (const root of roots) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const es = ES_HTML[el.dataset.i18n];
      if (es !== undefined) el.innerHTML = es;
    });
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
        const es = ES_HTML[el.getAttribute(`data-i18n-${attr}`)];
        if (es !== undefined) el.setAttribute(attr, es);
      });
    }
  }
  document.title = ES_HTML.title;
}

// Header menu: Automatic (the browser's language) / English / Español, remembered in this browser.
function setupLanguageMenu() {
  const menu = document.getElementById('lang');
  if (!menu) return;
  menu.value = storedLang();
  menu.addEventListener('change', () => {
    try {
      if (menu.value) localStorage.setItem(LANG_KEY, menu.value);
      else localStorage.removeItem(LANG_KEY);
    } catch { /* storage blocked: the choice lasts until reload only */ }
    location.reload(); // unsaved changes trigger the browser's "leave page?" question first
  });
}

translatePage();
setupLanguageMenu();
