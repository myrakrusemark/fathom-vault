"""Periodic crystallization scheduler — runs spawn() on a threading.Timer loop.

Workspace-aware: each scheduler instance targets a specific workspace.
"""

import threading

from services import crystallization


class CrystalScheduler:
    def __init__(self):
        self._timer = None
        self._enabled = False
        self._interval_days = 7
        self._workspace = None
        self._lock = threading.Lock()

    def configure(self, enabled: bool, interval_days: int, workspace: str = None) -> None:
        with self._lock:
            self._enabled = enabled
            self._interval_days = max(1, interval_days)
            self._workspace = workspace
            if self._timer:
                self._timer.cancel()
                self._timer = None
            if self._enabled:
                self._schedule()

    def _schedule(self) -> None:
        self._timer = threading.Timer(self._interval_days * 86400, self._run)
        self._timer.daemon = True
        self._timer.start()

    def _run(self) -> None:
        crystallization.spawn(workspace=self._workspace)
        with self._lock:
            if self._enabled:
                self._schedule()

    @property
    def status(self) -> dict:
        with self._lock:
            return {
                "enabled": self._enabled,
                "interval_days": self._interval_days,
                "workspace": self._workspace,
            }


crystal_scheduler = CrystalScheduler()
