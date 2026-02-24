"""Periodic crystallization scheduler — runs spawn() on a threading.Timer loop."""

import threading

from services import crystallization


class CrystalScheduler:
    def __init__(self):
        self._timer = None
        self._enabled = False
        self._interval_days = 7
        self._lock = threading.Lock()

    def configure(self, enabled: bool, interval_days: int) -> None:
        with self._lock:
            self._enabled = enabled
            self._interval_days = max(1, interval_days)
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
        crystallization.spawn()  # no additional_context for scheduled runs
        with self._lock:
            if self._enabled:
                self._schedule()

    @property
    def status(self) -> dict:
        with self._lock:
            return {
                "enabled": self._enabled,
                "interval_days": self._interval_days,
            }


crystal_scheduler = CrystalScheduler()
