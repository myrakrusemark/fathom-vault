"""Background vault re-indexer — runs qmd update + qmd embed for all workspaces."""

import subprocess
import threading
from datetime import datetime

from config import get_vault_path, get_workspaces


class BackgroundIndexer:
    def __init__(self):
        self._timer = None
        self._enabled = False
        self._interval = 15  # minutes
        self._excluded_dirs: list[str] = []
        self._last_indexed = None
        self._lock = threading.Lock()

    def configure(
        self, enabled: bool, interval_minutes: int, excluded_dirs: list[str] | None = None
    ) -> None:
        with self._lock:
            self._enabled = enabled
            self._interval = interval_minutes
            self._excluded_dirs = excluded_dirs or []
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
        # Index all workspaces sequentially
        workspaces = get_workspaces()
        for ws_name in workspaces:
            vault_path, _err = get_vault_path(ws_name)
            if not vault_path:
                continue
            subprocess.run(
                ["nice", "-n", "19", "qmd", "update"],
                cwd=vault_path,
                capture_output=True,
            )
            subprocess.run(
                ["nice", "-n", "19", "qmd", "embed"],
                cwd=vault_path,
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
            "excluded_dirs": self._excluded_dirs,
            "last_indexed": self._last_indexed,
        }


indexer = BackgroundIndexer()
