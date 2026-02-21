"""Background vault re-indexer — runs qmd update + qmd embed at idle CPU priority."""

import subprocess
import threading
from datetime import datetime

from config import VAULT_DIR


class BackgroundIndexer:
    def __init__(self):
        self._timer = None
        self._enabled = False
        self._interval = 15  # minutes
        self._last_indexed = None
        self._lock = threading.Lock()

    def configure(self, enabled: bool, interval_minutes: int) -> None:
        with self._lock:
            self._enabled = enabled
            self._interval = interval_minutes
            self._cancel()
            if enabled:
                self._schedule()

    def _cancel(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def _schedule(self) -> None:
        self._timer = threading.Timer(self._interval * 60, self._run)
        self._timer.daemon = True
        self._timer.start()

    def _run(self) -> None:
        subprocess.run(
            ["nice", "-n", "19", "qmd", "update"],
            cwd=VAULT_DIR,
            capture_output=True,
        )
        subprocess.run(
            ["nice", "-n", "19", "qmd", "embed"],
            cwd=VAULT_DIR,
            capture_output=True,
        )
        self._last_indexed = datetime.now().isoformat()
        with self._lock:
            if self._enabled:
                self._schedule()

    def run_now(self) -> None:
        """Trigger an immediate index run in a background thread."""
        threading.Thread(target=self._run, daemon=True).start()

    @property
    def status(self) -> dict:
        return {
            "enabled": self._enabled,
            "interval_minutes": self._interval,
            "last_indexed": self._last_indexed,
        }


indexer = BackgroundIndexer()
