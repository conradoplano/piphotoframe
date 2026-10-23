"""Local photo cache: downloaded originals (screen-sized thumbnails) plus per-fit-mode renders."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import threading
from pathlib import Path

from .render import render
from .util import write_atomic

log = logging.getLogger(__name__)

FIT_MODES = ("blur", "cover", "contain")


def album_key(url: str) -> str:
    return hashlib.sha1(url.strip().encode()).hexdigest()[:10]


class PhotoLibrary:
    def __init__(self, root: Path, screen_size: tuple[int, int]):
        self.root = root
        self.src_dir = root / "src"
        self.render_root = root / "render"
        self.index_path = root / "index.json"
        self.screen_size = screen_size
        self.clip_dir = root / "clips"
        self.src_dir.mkdir(parents=True, exist_ok=True)
        self.clip_dir.mkdir(parents=True, exist_ok=True)
        self.photos: dict[str, dict] = {}
        self.clips: dict[str, dict] = {}  # short videos, shown when swiping to the next photo
        self.albums: dict[str, dict] = {}  # album url -> {ok, count, error, checked}
        self.last_sync: float | None = None
        self.version = 1
        self._lock = threading.Lock()
        self._load()

    def _load(self) -> None:
        if not self.index_path.exists():
            return
        try:
            data = json.loads(self.index_path.read_text("utf-8"))
        except Exception:
            log.exception("Photo index unreadable, starting empty")
            return
        self.photos = {k: v for k, v in data.get("photos", {}).items() if self.src_path(k).exists()}
        self.clips = {k: v for k, v in data.get("clips", {}).items() if self.clip_path(k).exists()}
        self.albums = data.get("albums", {})
        self.last_sync = data.get("last_sync")

    def commit(self) -> None:
        """Persist the index and tell the frame that the photo list changed."""
        with self._lock:
            payload = json.dumps({"photos": self.photos, "clips": self.clips, "albums": self.albums,
                                  "last_sync": self.last_sync})
        write_atomic(self.index_path, payload)
        self.version += 1

    def src_path(self, key: str) -> Path:
        return self.src_dir / f"{key}.jpg"

    def clip_path(self, key: str) -> Path:
        return self.clip_dir / f"{key}.mp4"

    def remove_clip(self, key: str) -> None:
        with self._lock:
            self.clips.pop(key, None)
        self.clip_path(key).unlink(missing_ok=True)

    def render_path(self, key: str, mode: str) -> Path:
        return self.render_root / mode / f"{key}.jpg"

    def ordered(self, order: str) -> list[tuple[str, dict]]:
        items = list(self.photos.items())
        items.sort(key=lambda kv: kv[1].get("taken", 0), reverse=(order != "oldest"))
        return items

    def store(self, key: str, meta: dict, data: bytes) -> None:
        write_atomic(self.src_path(key), data)
        self._drop_renders(key)
        with self._lock:
            self.photos[key] = meta

    def remove(self, key: str) -> None:
        with self._lock:
            self.photos.pop(key, None)
        self.src_path(key).unlink(missing_ok=True)
        self._drop_renders(key)

    def _drop_renders(self, key: str) -> None:
        for variant_dir in self.render_root.glob("*"):
            (variant_dir / f"{key}.jpg").unlink(missing_ok=True)

    @staticmethod
    def variant(mode: str, landscape: bool) -> str:
        """Render folder name: the fit mode, plus the orientation the photo is laid out for."""
        return f"{mode}-landscape" if landscape else mode

    def rendered(self, key: str, mode: str, landscape: bool = False) -> Path | None:
        """Return the screen-ready image, rendering it on first use. Blocking: call from a thread."""
        if key not in self.photos or mode not in FIT_MODES:
            return None
        dst = self.render_path(key, self.variant(mode, landscape))
        if not dst.exists():
            src = self.src_path(key)
            if not src.exists():
                return None
            w, h = self.screen_size
            render(src, dst, mode, (h, w) if landscape else (w, h))
        return dst

    def prerender(self, mode: str, landscape: bool = False, still_wanted=lambda: True) -> None:
        """Render every photo for the current fit mode and orientation so the slideshow never waits."""
        keep = self.variant(mode, landscape)
        for variant_dir in self.render_root.glob("*"):
            if variant_dir.name != keep and variant_dir.is_dir():
                shutil.rmtree(variant_dir, ignore_errors=True)  # free SD space from old settings
        for key in list(self.photos):
            if not still_wanted():
                return
            try:
                self.rendered(key, mode, landscape)
            except Exception as e:
                log.warning("Could not render %s: %s", key, e)
