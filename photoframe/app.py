"""HTTP server: the kiosk frame page, the configuration page and their JSON API."""

from __future__ import annotations

import asyncio
import io
import logging
import socket
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

import segno
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .brightness import BrightnessController
from .config import Config, ConfigStore
from .hardware import MockBacklight, MockSensor, SysfsBacklight, detect_sensor
from .library import PhotoLibrary
from .network import MockWifi, NetworkMonitor, NmcliWifi, local_ip
from .settings import Settings
from .state import RuntimeState
from .sync import Syncer, wanted_clip
from .synology import SynologyShare
from .updater import Updater
from .weather import WeatherService, geocode

log = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"


class AlbumTest(BaseModel):
    url: str
    password: str = ""


class WifiConnect(BaseModel):
    ssid: str
    password: str = ""


class DevLux(BaseModel):
    lux: float


class DevWifi(BaseModel):
    online: bool
    forget: bool = False  # also drop saved networks, like a brand-new frame


def other_orientation(orientation: str) -> str:
    """Swipe down on the frame: switch between portrait and landscape."""
    return "landscape" if orientation == "portrait" else "portrait"


async def _supervise(name: str, fn) -> None:
    while True:
        try:
            await fn()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("%s crashed, restarting in 10 s", name)
            await asyncio.sleep(10)


def create_app(settings: Settings) -> FastAPI:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    store = ConfigStore(settings.data_dir / "config.json")
    state = RuntimeState()
    library = PhotoLibrary(settings.data_dir / "photos", settings.screen_size)
    syncer = Syncer(library, store, state)
    weather = WeatherService(store)

    if settings.mock:
        wifi = MockWifi()
        backlight = MockBacklight()
        mock_sensor = MockSensor()
        find_sensor = lambda: mock_sensor  # noqa: E731
    else:
        wifi = NmcliWifi()
        backlight = SysfsBacklight.find()
        if backlight is None:
            log.warning("No backlight found under /sys/class/backlight; brightness is simulated")
            backlight = MockBacklight()
        mock_sensor = None
        find_sensor = detect_sensor
    brightness = BrightnessController(store, state, backlight, find_sensor)
    netmon = NetworkMonitor(wifi, state, library)
    updater = Updater(can_restart=not settings.dev)

    def on_config_change(old: Config, new: Config) -> None:
        clip_settings = lambda c: (c.clips_enabled, c.clip_long, c.clip_max_seconds)  # noqa: E731
        if [a.model_dump() for a in old.albums] != [a.model_dump() for a in new.albums] \
                or old.verify_tls != new.verify_tls or clip_settings(old) != clip_settings(new):
            syncer.request_sync()
        elif old.sync_time != new.sync_time:
            syncer.reschedule()
        if old.cities != new.cities or old.units != new.units:
            weather.poke()
        if old.fit_mode != new.fit_mode or old.orientation != new.orientation:
            syncer.prerender_soon()

    store.subscribe(on_config_change)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = [asyncio.create_task(_supervise(n, f)) for n, f in (
            ("network", netmon.run_forever), ("sync", syncer.run_forever),
            ("weather", weather.run_forever), ("brightness", brightness.run_forever))]
        yield
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    app = FastAPI(title="Digital photo frame", version=__version__, lifespan=lifespan)

    @app.middleware("http")
    async def no_stale_pages(request: Request, call_next):
        response = await call_next(request)
        if not request.url.path.startswith(("/photos/", "/clips/")):
            response.headers.setdefault("Cache-Control", "no-cache")
        return response

    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    def current_layout() -> str:
        """Photos are rendered for one of two layouts; both landscape orientations share one."""
        return "portrait" if store.config.orientation == "portrait" else "landscape"

    def access_url() -> str:
        ip = local_ip() or socket.gethostname()
        return f"http://{ip}" + ("" if settings.port == 80 else f":{settings.port}") + "/"

    # ---- pages ------------------------------------------------------------
    @app.get("/", include_in_schema=False)
    async def config_page():
        return FileResponse(WEB_DIR / "config.html")

    @app.get("/frame", include_in_schema=False)
    async def frame_page():
        return FileResponse(WEB_DIR / "frame.html")

    @app.get("/preview", include_in_schema=False)
    async def preview_page():
        return FileResponse(WEB_DIR / "preview.html")

    # ---- config & status --------------------------------------------------
    @app.get("/api/config")
    async def get_config():
        return store.config.model_dump()

    @app.put("/api/config")
    async def put_config(cfg: Config):
        store.update(cfg)
        return store.config.model_dump()

    @app.get("/api/state")
    async def get_state():
        return {
            "version": __version__,
            "build": updater.build,
            "config_version": store.version,
            "photos_version": library.version,
            "photo_count": len(library.photos),
            "clip_count": len(library.clips),
            "online": state.online,
            "ssid": state.ssid,
            "needs_wifi": state.needs_wifi,
            "screen_on": state.screen_on,
            "brightness": state.brightness_pct,
            "lux": state.lux,
            "sensor": state.sensor,
            "backlight": backlight.name,
            "sync": {**syncer.status, "last_sync": library.last_sync},
            "albums": library.albums,
            "weather_error": weather.error,
            "url": access_url(),
            "hostname": socket.gethostname(),
            "mock": settings.mock,
        }

    # ---- photos -----------------------------------------------------------
    @app.get("/api/photos")
    async def list_photos():
        cfg = store.config
        layout = current_layout()
        return {
            "version": library.version,
            "order": cfg.order,
            "layout": layout,
            "items": [{"id": k, "url": f"/photos/{k}.jpg?fit={cfg.fit_mode}&layout={layout}"
                                        f"&v={m['cache_key']}"}
                      for k, m in library.ordered(cfg.order)],
            "clips": [{"id": k, "url": f"/clips/{k}.mp4?v={m['cache_key']}", "duration": m["duration"]}
                      for k, m in library.clips.items()] if cfg.clips_enabled else [],
        }

    @app.get("/clips/{key}.mp4", include_in_schema=False)
    async def clip(key: str):
        if key not in library.clips:
            raise HTTPException(404)
        return FileResponse(library.clip_path(key), media_type="video/mp4",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/photos/{key}.jpg", include_in_schema=False)
    async def photo(key: str, fit: str | None = None, layout: str | None = None):
        landscape = (layout or current_layout()) == "landscape"
        path = await run_in_threadpool(library.rendered, key, fit or store.config.fit_mode, landscape)
        if path is None:
            raise HTTPException(404)
        return FileResponse(path, media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @app.post("/api/sync")
    async def sync_now():
        syncer.request_sync()
        return {"ok": True}

    @app.post("/api/albums/test")
    async def test_album(body: AlbumTest):
        try:
            async with SynologyShare(body.url, body.password, store.config.verify_tls) as share:
                photos, videos = await share.list_media()
        except Exception as e:
            return {"ok": False, "error": str(e)}
        cfg = store.config
        used = sum(wanted_clip(v.duration, cfg) for v in videos)
        return {"ok": True, "count": len(photos), "videos": used, "videos_unused": len(videos) - used}

    # ---- weather ----------------------------------------------------------
    @app.get("/api/weather")
    async def get_weather():
        return weather.snapshot()

    @app.get("/api/geocode")
    async def search_city(q: str):
        if len(q.strip()) < 2:
            return []
        try:
            return await geocode(q.strip(), store.config.language)
        except Exception as e:
            raise HTTPException(502, f"City search failed: {e}")

    # ---- wifi -------------------------------------------------------------
    @app.get("/api/wifi/networks")
    async def wifi_networks():
        try:
            return await wifi.scan()
        except Exception as e:
            raise HTTPException(500, str(e))

    @app.post("/api/wifi/connect")
    async def wifi_connect(body: WifiConnect):
        ok, message = await wifi.connect(body.ssid, body.password)
        if ok:
            await netmon.check()
            if not library.photos or state.offline_at_sync or library.last_sync is None:
                syncer.request_sync()
        return {"ok": ok, "message": message}

    @app.post("/api/wifi/dismiss")
    async def wifi_dismiss():
        state.wifi_dismissed = True
        state.needs_wifi = False
        return {"ok": True}

    # ---- screen & system --------------------------------------------------
    @app.post("/api/orientation/next")
    async def next_orientation():
        """Swipe down on the frame: switch between portrait and landscape."""
        cfg = store.config
        store.update(cfg.model_copy(update={"orientation": other_orientation(cfg.orientation)}))
        return {"orientation": store.config.orientation}

    @app.post("/api/wake")
    async def wake():
        brightness.wake()
        return {"ok": True}

    @app.get("/api/qr.svg", include_in_schema=False)
    async def qr():
        buf = io.BytesIO()
        segno.make(access_url(), error="m").save(buf, kind="svg", scale=10, border=2,
                                                  dark="#000", light="#fff")
        return Response(buf.getvalue(), media_type="image/svg+xml")

    @app.post("/api/system/reboot")
    async def reboot():
        if settings.mock:
            return {"ok": True, "message": "Simulated reboot"}
        subprocess.Popen(["systemctl", "reboot"])
        return {"ok": True, "message": "Rebooting"}

    @app.post("/api/system/shutdown")
    async def shutdown():
        if settings.mock:
            return {"ok": True, "message": "Simulated shutdown"}
        subprocess.Popen(["systemctl", "poweroff"])
        return {"ok": True, "message": "Shutting down"}

    # ---- software update ------------------------------------------------------
    @app.get("/api/update")
    async def update_status():
        return updater.snapshot()

    @app.post("/api/update/check")
    async def update_check():
        return await updater.check()

    @app.post("/api/update/install")
    async def update_install():
        if not updater.can_install:
            raise HTTPException(400, "Updates can only be installed on the frame (not in --dev mode)")
        app.state.update_task = asyncio.create_task(updater.install())  # keep a reference
        return updater.snapshot()

    # ---- development helpers (simulated hardware only) ---------------------
    @app.post("/api/dev/lux")
    async def dev_lux(body: DevLux):
        if mock_sensor is None:
            raise HTTPException(404)
        mock_sensor.lux = max(0.0, body.lux)
        return {"ok": True}

    @app.post("/api/dev/wifi")
    async def dev_wifi(body: DevWifi):
        if not isinstance(wifi, MockWifi):
            raise HTTPException(404)
        wifi.online = body.online
        if body.forget:
            wifi.saved = []
        await netmon.check()
        return {"ok": True}

    @app.get("/api/dev/backlight")
    async def dev_backlight():
        if not isinstance(backlight, MockBacklight):
            raise HTTPException(404)
        return {"percent": backlight.percent, "on": backlight.on}

    return app
