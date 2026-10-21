"""Self-update from the git repository the frame was installed from."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

log = logging.getLogger(__name__)

REPO_DIR = Path(__file__).resolve().parent.parent


def current_build() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_DIR,
                             capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


async def _run(*args: str, timeout: float = 300) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, cwd=REPO_DIR, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})  # never hang waiting for a password
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "timed out"
    return proc.returncode or 0, out.decode(errors="replace").strip()


class Updater:
    def __init__(self, can_restart: bool):
        # In dev mode nothing restarts the server, and pulling would touch your working copy.
        self.can_install = can_restart
        self.build = current_build()
        self.status: dict = {"checked": None, "behind": 0, "commits": [], "error": None,
                             "running": False, "log": [], "latest": None}

    def snapshot(self) -> dict:
        return {**self.status, "build": self.build, "available": self.build is not None,
                "can_install": self.can_install}

    async def check(self) -> dict:
        if self.build is None:
            self.status["error"] = "Not installed from git, so updates are not available"
            return self.snapshot()
        rc, out = await _run("git", "fetch", "--quiet", "origin", timeout=60)
        if rc != 0:
            self.status.update(error=f"Could not reach GitHub: {out or rc}", checked=time.time())
            return self.snapshot()
        rc, out = await _run("git", "log", "--format=%h %s", "HEAD..@{u}")
        if rc != 0:
            self.status.update(error=out, checked=time.time())
            return self.snapshot()
        commits = [line for line in out.splitlines() if line]
        _, latest = await _run("git", "rev-parse", "--short", "@{u}")
        self.status.update(checked=time.time(), behind=len(commits), commits=commits[:20],
                           latest=latest or None, error=None)
        return self.snapshot()

    async def install(self) -> None:
        if self.status["running"] or not self.can_install:
            return
        self.status.update(running=True, error=None, log=[])
        step = self.status["log"].append
        try:
            step("Downloading the new version…")
            rc, out = await _run("git", "pull", "--ff-only")
            if rc != 0:
                raise RuntimeError(f"git pull failed: {out}")
            step("Updating Python packages…")
            rc, out = await _run(sys.executable, "-m", "pip", "install", "--quiet",
                                 "-r", "requirements.txt", timeout=900)
            if rc != 0:
                raise RuntimeError(f"pip install failed: {out[-500:]}")
            step("Restarting…")
            # systemd (Restart=always) starts the new version within a few seconds;
            # the frame page notices the new build and reloads itself.
            asyncio.get_running_loop().call_later(1.0, os._exit, 0)
        except Exception as e:
            log.exception("Update failed")
            self.status.update(error=str(e), running=False)
