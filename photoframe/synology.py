"""Client for public Synology Photos share links (e.g. https://nas:5001/mo/sharing/AbCdEf).

Synology does not document this API; it is what the Photos web app itself calls. See
https://github.com/zeichensatz/SynologyPhotosAPI for the reverse-engineered reference.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

log = logging.getLogger(__name__)

PAGE_SIZE = 500


class SynologyError(Exception):
    pass


@dataclass(frozen=True)
class ShareRef:
    url: str
    origin: str      # https://host:port
    prefix: str      # "" or e.g. "/photo" when Photos is served under an alias
    passphrase: str  # the share id at the end of the link

    @property
    def endpoints(self) -> list[str]:
        base = f"{self.origin}{self.prefix}"
        return [f"{base}/mo/sharing/webapi/entry.cgi", f"{base}/webapi/entry.cgi"]


def parse_share_url(url: str) -> ShareRef:
    url = url.strip()
    u = urlsplit(url)
    if u.scheme not in ("http", "https") or not u.netloc:
        raise ValueError("Album link must start with http:// or https://")
    parts = [p for p in u.path.split("/") if p]
    if "sharing" not in parts:
        raise ValueError("Not a Synology Photos share link (expected …/sharing/<id>)")
    i = len(parts) - 1 - parts[::-1].index("sharing")
    if i + 1 >= len(parts):
        raise ValueError("Share link is missing the share id after /sharing/")
    prefix = parts[:i]
    if prefix and prefix[-1] == "mo":
        prefix = prefix[:-1]
    return ShareRef(url, f"{u.scheme}://{u.netloc}", "".join("/" + p for p in prefix), parts[i + 1])


@dataclass
class SynoPhoto:
    unit_id: int
    cache_key: str
    size: str  # best available thumbnail size ("xl" = 1280px on the short side)
    filename: str
    taken: int
    width: int
    height: int


@dataclass
class SynoVideo:
    unit_id: int
    cache_key: str
    filename: str
    taken: int
    duration: float  # seconds


def _to_video(item: dict) -> SynoVideo | None:
    """Videos that Synology has already converted to 720p H.264 (playable on the Pi)."""
    if item.get("type") != "video":
        return None
    extra = item.get("additional") or {}
    thumb = extra.get("thumbnail") or {}
    converted = any(c.get("quality") == "high" for c in extra.get("video_convert") or [])
    if not converted or extra.get("video_convert_status", "ready") != "ready":
        return None
    meta = extra.get("video_meta") or {}
    return SynoVideo(
        unit_id=int(thumb.get("unit_id") or item["id"]),
        cache_key=str(thumb.get("cache_key") or item["id"]),
        filename=item.get("filename", ""),
        taken=int(item.get("time") or 0),
        duration=float(meta.get("duration") or 0) / 1000,
    )


def _q(value: str) -> str:
    """The Photos web API expects string parameters JSON-encoded (with quotes)."""
    return json.dumps(value)


def _to_photo(item: dict) -> SynoPhoto | None:
    if item.get("type") == "video":
        return None
    extra = item.get("additional") or {}
    thumb = extra.get("thumbnail") or {}
    cache_key = thumb.get("cache_key")
    if not cache_key:
        return None
    if thumb.get("xl") == "ready":
        size = "xl"
    elif thumb.get("m") == "ready":
        size = "m"
    else:
        return None  # Synology has not generated thumbnails for this item yet
    res = extra.get("resolution") or {}
    return SynoPhoto(
        unit_id=int(thumb.get("unit_id") or item["id"]),
        cache_key=str(cache_key),
        size=size,
        filename=item.get("filename", ""),
        taken=int(item.get("time") or 0),
        width=int(res.get("width") or 0),
        height=int(res.get("height") or 0),
    )


class SynologyShare:
    def __init__(self, url: str, password: str = "", verify: bool = True, timeout: float = 30):
        self.ref = parse_share_url(url)
        self.password = password
        self._endpoint: str | None = None
        self._client = httpx.AsyncClient(
            verify=verify, timeout=timeout, follow_redirects=True,
            headers={"X-SYNO-SHARING": self.ref.passphrase, "User-Agent": "photoframe/1.0"},
        )

    async def __aenter__(self) -> "SynologyShare":
        return self

    async def __aexit__(self, *exc) -> None:
        await self._client.aclose()

    async def _post(self, endpoint: str, params: dict) -> dict:
        r = await self._client.post(endpoint, data=params)
        r.raise_for_status()
        try:
            body = r.json()
        except ValueError:
            raise SynologyError(f"Unexpected (non-JSON) response from {endpoint}") from None
        if not body.get("success"):
            code = (body.get("error") or {}).get("code")
            raise SynologyError(f"Synology API error {code}")
        return body.get("data") or {}

    def _list_params(self, offset: int, limit: int) -> dict:
        return {
            "api": "SYNO.Foto.Browse.Item", "method": "list", "version": "1",
            "offset": str(offset), "limit": str(limit),
            "sort_by": _q("takentime"), "sort_direction": _q("desc"),
            "passphrase": _q(self.ref.passphrase),
            "additional": json.dumps(["thumbnail", "resolution", "orientation",
                                      "video_meta", "video_convert"]),
        }

    async def _connect(self) -> str:
        if self._endpoint:
            return self._endpoint
        try:
            # Opening the share page hands out the sharing cookie on some DSM versions.
            # Without a browser user agent the /mo/ (mobile) path can 404, so try the plain one too.
            for page in dict.fromkeys([self.ref.url,
                                       f"{self.ref.origin}{self.ref.prefix}/sharing/{self.ref.passphrase}"]):
                await self._client.get(page)
        except httpx.HTTPError as e:
            raise SynologyError(f"Cannot reach {self.ref.origin}: {e}") from e
        errors = []
        for endpoint in self.ref.endpoints:
            login = {"api": "SYNO.Core.Sharing.Login", "method": "login", "version": "1",
                     "sharing_id": self.ref.passphrase}
            if self.password:
                login["password"] = self.password
            try:
                await self._post(endpoint, login)
            except (SynologyError, httpx.HTTPError) as e:
                log.debug("Sharing login via %s failed: %s", endpoint, e)
            try:
                await self._post(endpoint, self._list_params(0, 1))
            except (SynologyError, httpx.HTTPError) as e:
                errors.append(str(e))
                continue
            self._endpoint = endpoint
            return endpoint
        hint = " (wrong password?)" if self.password else " (is the album shared publicly, or password protected?)"
        raise SynologyError(f"Could not open album: {errors[-1] if errors else 'unknown error'}{hint}")

    async def list_media(self) -> tuple[list[SynoPhoto], list[SynoVideo]]:
        endpoint = await self._connect()
        photos: list[SynoPhoto] = []
        videos: list[SynoVideo] = []
        offset = 0
        while True:
            data = await self._post(endpoint, self._list_params(offset, PAGE_SIZE))
            items = data.get("list") or []
            photos.extend(p for p in map(_to_photo, items) if p)
            videos.extend(v for v in map(_to_video, items) if v)
            if len(items) < PAGE_SIZE:
                return photos, videos
            offset += PAGE_SIZE

    async def list_photos(self) -> list[SynoPhoto]:
        return (await self.list_media())[0]

    async def download_video(self, video: SynoVideo, dst) -> None:
        """Stream Synology's 720p conversion of the video into the file `dst` (opened for writing)."""
        endpoint = await self._connect()
        params = {
            "api": "SYNO.Foto.Streaming", "method": "streaming", "version": "1",
            "id": str(video.unit_id), "quality": _q("high"),
            "passphrase": _q(self.ref.passphrase), "_sharing_id": _q(self.ref.passphrase),
        }
        async with self._client.stream("GET", endpoint, params=params, timeout=120) as r:
            if r.status_code not in (200, 206) or not r.headers.get("content-type", "").startswith("video/"):
                raise SynologyError(f"Video download failed for {video.filename or video.unit_id}: "
                                    f"HTTP {r.status_code} {r.headers.get('content-type', '')}")
            async for chunk in r.aiter_bytes(1 << 16):
                dst.write(chunk)

    async def download(self, photo: SynoPhoto) -> bytes:
        endpoint = await self._connect()
        sizes = [photo.size] + (["m"] if photo.size != "m" else [])
        last = "no thumbnail"
        for size in sizes:
            params = {
                "api": "SYNO.Foto.Thumbnail", "method": "get", "version": "1", "mode": "download",
                "id": str(photo.unit_id), "type": _q("unit"), "size": _q(size),
                "cache_key": _q(photo.cache_key),
                "passphrase": _q(self.ref.passphrase), "_sharing_id": _q(self.ref.passphrase),
            }
            r = await self._client.get(endpoint, params=params)
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
                return r.content
            last = f"HTTP {r.status_code} {r.headers.get('content-type', '')}"
        raise SynologyError(f"Thumbnail download failed for {photo.filename or photo.unit_id}: {last}")
