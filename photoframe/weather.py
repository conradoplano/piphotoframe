"""Weather and city search via Open-Meteo (free, no API key)."""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

from .config import City, ConfigStore

log = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
REFRESH_SECONDS = 20 * 60


def city_id(c: City) -> str:
    return f"{c.latitude:.3f},{c.longitude:.3f}"


async def geocode(query: str, language: str = "en") -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(GEOCODE_URL, params={"name": query, "count": 8,
                                                 "language": language, "format": "json"})
        r.raise_for_status()
    return [{
        "name": x["name"],
        "country": x.get("country", ""),
        "region": x.get("admin1", ""),
        "latitude": x["latitude"],
        "longitude": x["longitude"],
        "timezone": x.get("timezone", "UTC"),
    } for x in r.json().get("results", [])]


def parse_forecast(j: dict) -> dict:
    cur = j.get("current") or {}
    d = j.get("daily") or {}
    days = [{"date": date, "code": code, "max": tmax, "min": tmin}
            for date, code, tmax, tmin in zip(d.get("time", []), d.get("weather_code", []),
                                              d.get("temperature_2m_max", []),
                                              d.get("temperature_2m_min", []))]
    return {
        "current": {"temp": cur.get("temperature_2m"), "code": cur.get("weather_code"),
                    "is_day": bool(cur.get("is_day", 1))} if cur else None,
        "daily": days,
        "updated": time.time(),
    }


class WeatherService:
    def __init__(self, store: ConfigStore):
        self.store = store
        self._data: dict[str, dict] = {}
        self._units = store.config.units
        self.error: str | None = None
        self._wakeup = asyncio.Event()

    def poke(self) -> None:
        self._wakeup.set()

    async def refresh(self) -> None:
        cfg = self.store.config
        if cfg.units != self._units:
            self._data.clear()
            self._units = cfg.units
        errors = []
        async with httpx.AsyncClient(timeout=20) as client:
            for c in cfg.cities:
                params = {
                    "latitude": c.latitude, "longitude": c.longitude,
                    "current": "temperature_2m,weather_code,is_day",
                    "daily": "weather_code,temperature_2m_max,temperature_2m_min",
                    "timezone": "auto", "forecast_days": 4,
                    "temperature_unit": "fahrenheit" if cfg.units == "F" else "celsius",
                }
                try:
                    r = await client.get(FORECAST_URL, params=params)
                    r.raise_for_status()
                    self._data[city_id(c)] = parse_forecast(r.json())
                except Exception as e:
                    errors.append(f"{c.name}: {e}")
        self.error = "; ".join(errors) or None
        if errors:
            log.warning("Weather refresh: %s", self.error)

    def snapshot(self) -> dict:
        cfg = self.store.config
        cities = []
        for c in cfg.cities:
            w = self._data.get(city_id(c)) or {}
            cities.append({"name": c.name, "country": c.country, "timezone": c.timezone,
                           "current": w.get("current"), "daily": w.get("daily", []),
                           "updated": w.get("updated")})
        return {"units": self._units, "cities": cities, "error": self.error}

    async def run_forever(self) -> None:
        while True:
            try:
                await self.refresh()
            except Exception:
                log.exception("Weather refresh failed")
            try:
                await asyncio.wait_for(self._wakeup.wait(), timeout=REFRESH_SECONDS)
            except asyncio.TimeoutError:
                pass
            self._wakeup.clear()
