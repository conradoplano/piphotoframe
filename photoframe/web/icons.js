'use strict';
// Line icons for WMO weather codes (Open-Meteo), drawn on a 24x24 grid in currentColor.

const Icons = (() => {
  const CLOUD = 'M6.5 18h10.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.2 4.4 4.4 0 0 0 6.5 18z';
  const svg = (body) =>
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  function rays(cx, cy, r1, r2) {
    let d = '';
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const c = Math.cos(a), s = Math.sin(a);
      d += `M${(cx + c * r1).toFixed(2)} ${(cy + s * r1).toFixed(2)}L${(cx + c * r2).toFixed(2)} ${(cy + s * r2).toFixed(2)}`;
    }
    return `<path d="${d}"/>`;
  }
  const sun = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>` + rays(cx, cy, r + 1.8, r + 3.6);
  const moon = (cx, cy, r) =>
    `<path d="M${cx + r * 0.35} ${cy - r}A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.45}A${r * 0.78} ${r * 0.78} 0 0 1 ${cx + r * 0.35} ${cy - r}z"/>`;
  const cloud = (dx, dy, s = 1) => `<path transform="translate(${dx} ${dy}) scale(${s})" d="${CLOUD}"/>`;

  const ICONS = {
    clearDay: () => svg(sun(12, 12, 4.2)),
    clearNight: () => svg(moon(12, 12, 6.5)),
    partlyDay: () => svg(
      `<mask id="pc-m"><rect width="24" height="24" fill="#fff"/>` +
      `<path transform="translate(2 3.5) scale(.85)" d="${CLOUD}" fill="#000" stroke="#000" stroke-width="3"/></mask>` +
      `<g mask="url(#pc-m)">${sun(8, 8, 2.8)}</g>` + cloud(2, 3.5, 0.85)),
    partlyNight: () => svg(
      `<mask id="pn-m"><rect width="24" height="24" fill="#fff"/>` +
      `<path transform="translate(2 3.5) scale(.85)" d="${CLOUD}" fill="#000" stroke="#000" stroke-width="3"/></mask>` +
      `<g mask="url(#pn-m)">${moon(8, 7.5, 4)}</g>` + cloud(2, 3.5, 0.85)),
    cloudy: () => svg(cloud(0, 1)),
    fog: () => svg(cloud(0, -3) + '<path d="M5 18.5h14M7 21.5h10"/>'),
    drizzle: () => svg(cloud(0, -2.5) + '<path d="M8 19v.5M12 20v.5M16 19v.5"/>'),
    rain: () => svg(cloud(0, -2.5) + '<path d="M8.5 18.5l-1 2.8M12.5 18.5l-1 2.8M16.5 18.5l-1 2.8"/>'),
    snow: () => svg(cloud(0, -2.5) +
      '<circle cx="8" cy="19.5" r=".8"/><circle cx="12" cy="21" r=".8"/><circle cx="16" cy="19.5" r=".8"/>'),
    thunder: () => svg(cloud(0, -2.5) + '<path d="M12.8 16.2l-2.3 3.6h3l-2.3 3.6"/>'),
    unknown: () => svg('<circle cx="12" cy="12" r="1"/>'),
    wifiOff: () => svg('<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/>' +
      '<circle cx="12" cy="19" r=".6"/><path d="M3 3l18 18"/>'),
    lock: () => svg('<rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>'),
  };

  function weather(code, isDay = true) {
    if (code === null || code === undefined) return ICONS.unknown();
    if (code <= 1) return isDay ? ICONS.clearDay() : ICONS.clearNight();
    if (code === 2) return isDay ? ICONS.partlyDay() : ICONS.partlyNight();
    if (code === 3) return ICONS.cloudy();
    if (code === 45 || code === 48) return ICONS.fog();
    if (code >= 51 && code <= 57) return ICONS.drizzle();
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ICONS.rain();
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ICONS.snow();
    if (code >= 95) return ICONS.thunder();
    return ICONS.cloudy();
  }

  function signal(strength) {
    const bars = strength > 75 ? 4 : strength > 50 ? 3 : strength > 25 ? 2 : 1;
    let body = '';
    for (let i = 0; i < 4; i++) {
      const h = 4 + i * 4;
      body += `<rect x="${3 + i * 5}" y="${21 - h}" width="3" height="${h}" rx=".8" ` +
        `fill="${i < bars ? 'currentColor' : 'none'}" opacity="${i < bars ? 1 : 0.35}"/>`;
    }
    return svg(body);
  }

  return { weather, signal, wifiOff: ICONS.wifiOff, lock: ICONS.lock };
})();
