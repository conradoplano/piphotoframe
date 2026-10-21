"""Maps room brightness to screen brightness, and handles the night schedule."""

from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import datetime
from datetime import time as dtime
from typing import Callable

from .config import Brightness, Config, ConfigStore, Night
from .hardware import Backlight, LightSensor
from .state import RuntimeState

log = logging.getLogger(__name__)

INTERVAL = 0.5
WAKE_SECONDS = 60


def compute_target(b: Brightness, lux: float | None) -> float:
    """Screen brightness in percent. Follows lux on a log scale, which matches how eyes perceive it."""
    if not b.auto or lux is None:
        return float(b.manual_pct)
    lo, hi = sorted((b.min_pct, b.max_pct))
    dark = b.dark_lux
    bright = max(b.bright_lux, dark * 1.01)
    if lux <= dark:
        f = 0.0
    elif lux >= bright:
        f = 1.0
    else:
        f = math.log(lux / dark) / math.log(bright / dark)
    return lo + (hi - lo) * f


def _hhmm(s: str) -> dtime:
    h, m = map(int, s.split(":"))
    return dtime(h, m)


def night_active(n: Night, now: dtime) -> bool:
    if not n.enabled:
        return False
    start, end = _hhmm(n.start), _hhmm(n.end)
    if start == end:
        return False
    if start < end:
        return start <= now < end
    return now >= start or now < end  # window crosses midnight


class BrightnessController:
    def __init__(self, store: ConfigStore, state: RuntimeState, backlight: Backlight,
                 find_sensor: Callable[[], LightSensor | None]):
        self.store = store
        self.state = state
        self.backlight = backlight
        self.find_sensor = find_sensor
        self._dark_off = False

    def _should_be_off(self, cfg: Config, lux: float | None) -> bool:
        if time.time() < self.state.wake_until:
            return False
        if night_active(cfg.night, datetime.now().time()):
            return True
        threshold = cfg.brightness.off_below_lux
        if cfg.brightness.auto and threshold > 0 and lux is not None:
            # hysteresis so the screen does not flicker around the threshold
            self._dark_off = lux < (threshold * 1.5 if self._dark_off else threshold)
            return self._dark_off
        self._dark_off = False
        return False

    async def run_forever(self) -> None:
        sensor: LightSensor | None = None
        next_detect = 0.0
        smooth_log: float | None = None
        current: float | None = None
        while True:
            now = time.monotonic()
            if sensor is None and now >= next_detect:
                sensor = await asyncio.to_thread(self.find_sensor)
                next_detect = now + 60
                self.state.sensor = sensor.name if sensor else None
            if sensor is not None:
                try:
                    lux = await asyncio.to_thread(sensor.read_lux)
                    level = math.log10(max(lux, 0.0) + 0.1)
                    smooth_log = level if smooth_log is None else smooth_log + 0.2 * (level - smooth_log)
                except Exception as e:
                    log.warning("Light sensor read failed: %s", e)
                    sensor, smooth_log = None, None
                    self.state.sensor = None
            self.state.lux = None if smooth_log is None else round(max(0.0, 10 ** smooth_log - 0.1), 1)

            cfg = self.store.config
            target = compute_target(cfg.brightness, self.state.lux)
            # glide towards the target instead of jumping
            current = target if current is None else current + max(-3.0, min(3.0, target - current))
            off = self._should_be_off(cfg, self.state.lux)
            try:
                if off:
                    self.backlight.set_power(False)
                else:
                    self.backlight.set_percent(current)
                    self.backlight.set_power(True)
            except Exception as e:
                log.warning("Backlight write failed: %s", e)
            self.state.brightness_pct = round(current, 1)
            self.state.screen_on = not off
            await asyncio.sleep(INTERVAL)

    def wake(self) -> None:
        self.state.wake_until = time.time() + WAKE_SECONDS
