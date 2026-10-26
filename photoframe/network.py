"""Wi-Fi status and setup through NetworkManager (nmcli), plus a simulated version."""

from __future__ import annotations

import asyncio
import logging
import re
import socket
import time
from dataclasses import dataclass

from .library import PhotoLibrary
from .state import RuntimeState

log = logging.getLogger(__name__)

BOOT_GRACE_SECONDS = 90  # give a saved network time to connect before asking the user


@dataclass
class WifiStatus:
    available: bool
    online: bool
    ssid: str | None


def split_terse(line: str) -> list[str]:
    """Split one line of `nmcli -t` output; ':' inside values is escaped as '\\:'."""
    return [f.replace("\\:", ":").replace("\\\\", "\\") for f in re.split(r"(?<!\\):", line)]


async def _run(*args: str, timeout: float = 45) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "", "timed out"
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


class NmcliWifi:
    async def status(self) -> WifiStatus:
        rc, out, _ = await _run("nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device")
        if rc != 0:
            return WifiStatus(False, False, None)
        return parse_device_status(out)


def parse_device_status(out: str) -> WifiStatus:
    """Online through Wi-Fi or a network cable (the Pi's Ethernet port works as a fallback)."""
    rows = [r for r in (split_terse(l) for l in out.splitlines() if l) if len(r) >= 4]
    connected = lambda r: r[2].startswith("connected") and not r[2].startswith("connected (site")  # noqa: E731
    wifi = [r for r in rows if r[1] == "wifi"]
    for r in wifi:
        if connected(r):
            return WifiStatus(True, True, r[3] or None)
    wired = any(r[1] == "ethernet" and connected(r) for r in rows)
    return WifiStatus(bool(wifi), wired, "cable" if wired else None)

    async def saved_networks(self) -> list[str]:
        rc, out, _ = await _run("nmcli", "-t", "-f", "NAME,TYPE", "connection", "show")
        if rc != 0:
            return []
        rows = [split_terse(l) for l in out.splitlines() if l]
        return [r[0] for r in rows if len(r) >= 2 and r[1] == "802-11-wireless"]

    async def scan(self) -> list[dict]:
        rc, out, err = await _run("nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY",
                                  "device", "wifi", "list", "--rescan", "yes")
        if rc != 0:
            raise RuntimeError(err.strip() or "Wi-Fi scan failed")
        best: dict[str, dict] = {}
        for line in out.splitlines():
            f = split_terse(line)
            if len(f) < 4 or not f[1]:
                continue
            net = {"ssid": f[1], "signal": int(f[2] or 0), "secure": f[3] not in ("", "--"),
                   "in_use": f[0].strip() == "*"}
            if f[1] not in best or net["signal"] > best[f[1]]["signal"]:
                best[f[1]] = net
        return sorted(best.values(), key=lambda n: (-n["in_use"], -n["signal"]))

    async def connect(self, ssid: str, password: str) -> tuple[bool, str]:
        if ssid in await self.saved_networks():
            await _run("nmcli", "connection", "delete", "id", ssid)  # replace old credentials
        args = ["nmcli", "--wait", "40", "device", "wifi", "connect", ssid]
        if password:
            args += ["password", password]
        rc, out, err = await _run(*args, timeout=60)
        if rc == 0:
            return True, "Connected"
        await _run("nmcli", "connection", "delete", "id", ssid)  # don't keep a broken profile
        msg = (err or out).strip().removeprefix("Error: ")
        if "Secrets were required" in msg or "802-1x" in msg or "psk" in msg.lower():
            msg = "Wrong password"
        return False, msg or "Connection failed"


class MockWifi:
    NETWORKS = [
        {"ssid": "Home", "signal": 82, "secure": True, "in_use": False},
        {"ssid": "Neighbour 5G", "signal": 54, "secure": True, "in_use": False},
        {"ssid": "Café Guest", "signal": 31, "secure": False, "in_use": False},
    ]

    def __init__(self, online: bool = True):
        self.online = online
        self.ssid = "Home"
        self.saved = ["Home"]

    async def status(self) -> WifiStatus:
        return WifiStatus(True, self.online, self.ssid if self.online else None)

    async def saved_networks(self) -> list[str]:
        return list(self.saved)

    async def scan(self) -> list[dict]:
        await asyncio.sleep(1)
        return [dict(n, in_use=self.online and n["ssid"] == self.ssid) for n in self.NETWORKS]

    async def connect(self, ssid: str, password: str) -> tuple[bool, str]:
        await asyncio.sleep(2)
        net = next((n for n in self.NETWORKS if n["ssid"] == ssid), None)
        if net and net["secure"] and len(password) < 8:
            return False, "Wrong password (simulated: use 8+ characters)"
        self.online, self.ssid = True, ssid
        if ssid not in self.saved:
            self.saved.append(ssid)
        return True, "Connected"


class NetworkMonitor:
    def __init__(self, wifi, state: RuntimeState, library: PhotoLibrary):
        self.wifi = wifi
        self.state = state
        self.library = library

    def _needs_wifi(self) -> bool:
        s = self.state
        if s.online or not s.wifi_available or s.wifi_dismissed:
            return False
        if s.has_saved_wifi and time.monotonic() - s.started < BOOT_GRACE_SECONDS:
            return False
        # A dropped connection keeps the slideshow running until the next daily sync.
        return not s.has_saved_wifi or not self.library.photos or s.offline_at_sync

    async def check(self) -> None:
        st = await self.wifi.status()
        s = self.state
        s.wifi_available, s.online, s.ssid = st.available, st.online, st.ssid
        s.has_saved_wifi = bool(await self.wifi.saved_networks())
        if s.online:
            s.offline_at_sync = False
            s.wifi_dismissed = False
        s.needs_wifi = self._needs_wifi()

    async def run_forever(self) -> None:
        while True:
            try:
                await self.check()
            except Exception:
                log.exception("Network check failed")
            await asyncio.sleep(5)


def local_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; just picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()
