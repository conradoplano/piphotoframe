"""Daily album synchronisation."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta

from .config import Config, ConfigStore
from .library import PhotoLibrary, album_key
from .render import validate_image
from .state import RuntimeState
from .synology import SynologyShare, SynoPhoto, SynoVideo

log = logging.getLogger(__name__)

MAX_PHOTOS = 5000        # newest photos win if the albums hold more than this
DOWNLOAD_PARALLEL = 4
COMMIT_EVERY = 20        # publish partial progress so a first sync shows photos quickly


CLIP_SOURCE_MAX_SECONDS = 60  # longer videos are never downloaded, even to be trimmed


def wanted_clip(duration: float, cfg: Config) -> bool:
    """Whether a video becomes a clip. Longer ones are trimmed when played, or skipped."""
    if not cfg.clips_enabled or not 0 < duration <= CLIP_SOURCE_MAX_SECONDS:
        return False
    return cfg.clip_long == "trim" or duration <= cfg.clip_max_seconds + 0.5


def next_daily(hhmm: str, now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    h, m = map(int, hhmm.split(":"))
    run = now.replace(hour=h, minute=m, second=0, microsecond=0)
    return run if run > now else run + timedelta(days=1)


class Syncer:
    def __init__(self, library: PhotoLibrary, store: ConfigStore, state: RuntimeState):
        self.library = library
        self.store = store
        self.state = state
        self.status = {"running": False, "progress": "", "last_error": None, "next_run": None}
        self._lock = asyncio.Lock()
        self._wakeup = asyncio.Event()
        self._forced = False
        self._render_task: asyncio.Task | None = None

    # ---- triggers -------------------------------------------------------
    def request_sync(self) -> None:
        self._forced = True
        self._wakeup.set()

    def reschedule(self) -> None:
        self._wakeup.set()

    def prerender_soon(self) -> None:
        if self._render_task and not self._render_task.done():
            return
        mode = self.store.config.fit_mode
        self._render_task = asyncio.create_task(asyncio.to_thread(
            self.library.prerender, mode, lambda: self.store.config.fit_mode == mode))

    # ---- scheduler ------------------------------------------------------
    async def run_forever(self) -> None:
        lib = self.library
        stale = lib.last_sync is None or time.time() - lib.last_sync > 24 * 3600
        if stale and self.store.config.albums:
            self._forced = True
        else:
            self.prerender_soon()
        while True:
            run_at = next_daily(self.store.config.sync_time)
            self.status["next_run"] = run_at.timestamp()
            scheduled = False
            if not self._forced:
                try:
                    await asyncio.wait_for(self._wakeup.wait(),
                                           timeout=(run_at - datetime.now()).total_seconds())
                except asyncio.TimeoutError:
                    scheduled = True
            self._wakeup.clear()
            if not (scheduled or self._forced):
                continue  # sync time changed: recompute
            self._forced = False
            await self._sync_when_online(daily=scheduled)

    async def _sync_when_online(self, daily: bool) -> None:
        # The daily sync waits up to 30 minutes for Wi-Fi; if it is still missing the frame shows
        # the Wi-Fi screen. Manual / startup syncs only wait a little.
        deadline = time.monotonic() + (1800 if daily else 120)
        while not self.state.online and time.monotonic() < deadline:
            self.status["progress"] = "Waiting for network"
            await asyncio.sleep(10)
        if not self.state.online:
            self.status["progress"] = ""
            self.status["last_error"] = "No network connection"
            if daily:
                self.state.offline_at_sync = True
                self.state.wifi_dismissed = False
            return
        await self.sync_once()

    # ---- the actual sync ------------------------------------------------
    async def sync_once(self) -> None:
        if self._lock.locked():
            return
        async with self._lock:
            self.status.update(running=True, last_error=None)
            try:
                await self._sync(self.store.config)
            except Exception as e:
                log.exception("Sync failed")
                self.status["last_error"] = str(e)
            finally:
                self.status.update(running=False, progress="")
        self.prerender_soon()

    async def _sync(self, cfg: Config) -> None:
        lib = self.library
        albums = [a for a in cfg.albums if a.enabled]
        wanted: dict[str, dict] = {}
        fetch: dict[str, list[tuple[str, SynoPhoto]]] = {}
        wanted_clips: dict[str, dict] = {}
        clip_fetch: dict[str, list[tuple[str, SynoVideo]]] = {}

        for album in albums:
            self.status["progress"] = f"Reading album {album.name or album.url}"
            akey = album_key(album.url)
            try:
                async with SynologyShare(album.url, album.password, cfg.verify_tls) as share:
                    photos, videos = await share.list_media()
            except Exception as e:
                log.warning("Album %s failed: %s", album.url, e)
                prev = lib.albums.get(album.url, {})
                lib.albums[album.url] = {"ok": False, "count": prev.get("count", 0),
                                         "error": str(e), "checked": time.time()}
                # Keep what we already have from this album rather than wiping it.
                wanted.update({k: v for k, v in lib.photos.items() if v.get("album") == album.url})
                wanted_clips.update({k: v for k, v in lib.clips.items() if v.get("album") == album.url})
                continue
            for v in videos:
                if wanted_clip(v.duration, cfg):
                    key = f"{akey}_{v.unit_id}"
                    wanted_clips[key] = {"album": album.url, "unit_id": v.unit_id,
                                         "cache_key": v.cache_key, "duration": v.duration,
                                         "taken": v.taken, "filename": v.filename}
                    clip_fetch.setdefault(album.url, []).append((key, v))
            lib.albums[album.url] = {"ok": True, "count": len(photos), "error": None,
                                     "checked": time.time()}
            for p in photos:
                key = f"{akey}_{p.unit_id}"
                wanted[key] = {"album": album.url, "unit_id": p.unit_id, "cache_key": p.cache_key,
                               "size": p.size, "taken": p.taken, "filename": p.filename}
                fetch.setdefault(album.url, []).append((key, p))

        if len(wanted) > MAX_PHOTOS:
            keep = sorted(wanted, key=lambda k: wanted[k].get("taken", 0), reverse=True)[:MAX_PHOTOS]
            wanted = {k: wanted[k] for k in keep}

        configured = {a.url for a in cfg.albums}
        lib.albums = {u: s for u, s in lib.albums.items() if u in configured}
        for key in [k for k in lib.photos if k not in wanted]:
            lib.remove(key)

        todo: list[tuple[str, str, SynoPhoto]] = []
        for url, items in fetch.items():
            for key, p in items:
                if key not in wanted:
                    continue
                have = lib.photos.get(key)
                if have and have.get("cache_key") == p.cache_key and lib.src_path(key).exists():
                    lib.photos[key] = wanted[key]
                else:
                    todo.append((url, key, p))
        lib.commit()

        album_cfg = {a.url: a for a in albums}
        done = 0
        sem = asyncio.Semaphore(DOWNLOAD_PARALLEL)

        async def download_album(url: str, items: list[tuple[str, SynoPhoto]]) -> None:
            nonlocal done
            a = album_cfg[url]
            async with SynologyShare(url, a.password, cfg.verify_tls) as share:
                async def one(key: str, p: SynoPhoto) -> None:
                    nonlocal done
                    async with sem:
                        try:
                            data = await share.download(p)
                            await asyncio.to_thread(validate_image, data)
                            await asyncio.to_thread(lib.store, key, wanted[key], data)
                        except Exception as e:
                            log.warning("Download of %s failed: %s", p.filename or key, e)
                        done += 1
                        self.status["progress"] = f"Downloading photos {done}/{len(todo)}"
                        if done % COMMIT_EVERY == 0:
                            lib.commit()
                await asyncio.gather(*(one(k, p) for k, p in items))

        by_album: dict[str, list[tuple[str, SynoPhoto]]] = {}
        for url, key, p in todo:
            by_album.setdefault(url, []).append((key, p))
        for url, items in by_album.items():
            try:
                await download_album(url, items)
            except Exception as e:
                log.warning("Downloading from %s failed: %s", url, e)
                lib.albums[url]["error"] = str(e)

        await self._sync_clips(cfg, album_cfg, wanted_clips, clip_fetch)

        lib.last_sync = time.time()
        lib.commit()
        log.info("Sync finished: %d photos (%d downloaded), %d clips",
                 len(lib.photos), len(todo), len(lib.clips))

    async def _sync_clips(self, cfg: Config, album_cfg: dict, wanted: dict[str, dict],
                          fetch: dict[str, list[tuple[str, SynoVideo]]]) -> None:
        lib = self.library
        for key in [k for k in lib.clips if k not in wanted]:
            lib.remove_clip(key)
        todo = [(url, key, v) for url, items in fetch.items() for key, v in items
                if not (key in lib.clips and lib.clips[key].get("cache_key") == v.cache_key
                        and lib.clip_path(key).exists())]
        for key in wanted:
            if key in lib.clips:
                lib.clips[key] = wanted[key]
        for n, (url, key, v) in enumerate(todo, 1):
            self.status["progress"] = f"Downloading videos {n}/{len(todo)}"
            a = album_cfg[url]
            tmp = lib.clip_path(key).with_suffix(".part")
            try:
                async with SynologyShare(url, a.password, cfg.verify_tls) as share:
                    with open(tmp, "wb") as f:
                        await share.download_video(v, f)
                os.replace(tmp, lib.clip_path(key))
                lib.clips[key] = wanted[key]
            except Exception as e:
                log.warning("Video download of %s failed: %s", v.filename or key, e)
                tmp.unlink(missing_ok=True)
        lib.commit()
