"""User configuration, edited from the web page and persisted as JSON."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .synology import parse_share_url
from .util import write_atomic

log = logging.getLogger(__name__)

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class Album(BaseModel):
    url: str
    name: str = ""
    password: str = ""
    enabled: bool = True

    @field_validator("url")
    @classmethod
    def _valid_share_link(cls, v: str) -> str:
        v = v.strip()
        parse_share_url(v)  # raises ValueError with a readable message
        return v


class City(BaseModel):
    name: str
    country: str = ""
    latitude: float
    longitude: float
    timezone: str = "UTC"


class Brightness(BaseModel):
    auto: bool = True
    min_pct: int = Field(5, ge=0, le=100)
    max_pct: int = Field(100, ge=1, le=100)
    manual_pct: int = Field(80, ge=1, le=100)
    dark_lux: float = Field(1.0, gt=0)      # at or below this the screen uses min_pct
    bright_lux: float = Field(400.0, gt=0)  # at or above this the screen uses max_pct
    off_below_lux: float = Field(0.0, ge=0)  # 0 = never switch off because of darkness


class Night(BaseModel):
    enabled: bool = False
    start: str = Field("23:00", pattern=HHMM)
    end: str = Field("07:00", pattern=HHMM)


class Config(BaseModel):
    albums: list[Album] = Field(default_factory=list)
    slide_seconds: int = Field(30, ge=5, le=86400)
    order: Literal["shuffle", "newest", "oldest"] = "shuffle"
    fit_mode: Literal["blur", "cover", "contain"] = "blur"
    transition: Literal["fade", "none"] = "fade"
    sync_time: str = Field("03:00", pattern=HHMM)
    weather_mode: Literal["forecast", "multi"] = "forecast"
    cities: list[City] = Field(default_factory=list, max_length=3)
    units: Literal["C", "F"] = "C"
    clock_24h: bool = True
    show_date: bool = True
    language: str = "en"
    brightness: Brightness = Field(default_factory=Brightness)
    night: Night = Field(default_factory=Night)
    verify_tls: bool = True

    @model_validator(mode="after")
    def _unique_albums(self) -> "Config":
        seen = set()
        for a in self.albums:
            if a.url in seen:
                raise ValueError(f"Album added twice: {a.url}")
            seen.add(a.url)
        return self


Listener = Callable[[Config, Config], None]


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        self.version = 1
        self._listeners: list[Listener] = []
        self.config = self._load()

    def _load(self) -> Config:
        if self.path.exists():
            try:
                return Config.model_validate_json(self.path.read_text("utf-8"))
            except Exception:
                log.exception("Invalid config file, starting with defaults (old file kept as .bad)")
                self.path.replace(self.path.with_suffix(".bad"))
        return Config()

    def subscribe(self, listener: Listener) -> None:
        self._listeners.append(listener)

    def update(self, new: Config) -> None:
        old, self.config = self.config, new
        write_atomic(self.path, new.model_dump_json(indent=2))
        self.version += 1
        for listener in self._listeners:
            try:
                listener(old, new)
            except Exception:
                log.exception("Config listener failed")
