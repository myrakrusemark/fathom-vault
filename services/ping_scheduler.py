"""Ping rhythm scheduler — manages multiple independent ping routines.

Each routine has its own timer, interval, context sources, workspace, and enabled state.
Injects prompts into the workspace-specific persistent session on fire.

Internally, routines are keyed by composite `workspace:id` to allow identical IDs
across different workspaces.
"""

import subprocess
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from services.settings import load_workspace_settings, save_workspace_settings


@dataclass
class RoutineState:
    id: str
    name: str = "Untitled"
    enabled: bool = False
    interval_minutes: int = 60
    workspace: str = "fathom"
    next_ping_at: datetime | None = None
    last_ping_at: datetime | None = None
    context_sources: dict = field(
        default_factory=lambda: {"time": True, "scripts": [], "texts": []}
    )
    timer: threading.Timer | None = field(default=None, repr=False)

    @property
    def _key(self) -> str:
        return f"{self.workspace}:{self.id}"


class PingScheduler:
    def __init__(self):
        self._routines: dict[str, RoutineState] = {}  # keyed by workspace:id
        self._lock = threading.Lock()

    @staticmethod
    def _composite_key(workspace: str, routine_id: str) -> str:
        return f"{workspace}:{routine_id}"

    # ── Bulk load on startup ──────────────────────────────────────────────

    def configure_all(self, routines_list: list[dict]) -> None:
        """Load all routines from settings. Replaces any existing state."""
        with self._lock:
            for rs in self._routines.values():
                if rs.timer:
                    rs.timer.cancel()
            self._routines.clear()

            for r in routines_list:
                rid = r["id"]
                ws = r.get("workspace", "fathom")
                rs = RoutineState(
                    id=rid,
                    name=r.get("name", "Untitled"),
                    enabled=r.get("enabled", False),
                    interval_minutes=max(1, r.get("interval_minutes", 60)),
                    workspace=ws,
                    context_sources=r.get(
                        "context_sources", {"time": True, "scripts": [], "texts": []}
                    ),
                )
                if r.get("last_ping_at"):
                    rs.last_ping_at = datetime.fromisoformat(r["last_ping_at"])
                if rs.enabled:
                    if r.get("next_ping_at"):
                        target = datetime.fromisoformat(r["next_ping_at"])
                        if target.tzinfo is None:
                            target = target.replace(tzinfo=UTC)
                        remaining = (target - datetime.now(UTC)).total_seconds()
                        if remaining > 0:
                            rs.next_ping_at = target
                            self._schedule(rs, remaining)
                        else:
                            self._reschedule(rs)
                    else:
                        self._reschedule(rs)
                self._routines[rs._key] = rs

    # ── Single-routine operations ─────────────────────────────────────────

    def _find(self, routine_id: str, workspace: str | None = None) -> RoutineState | None:
        """Find a routine by ID, optionally scoped to a workspace. Must hold lock."""
        if workspace:
            return self._routines.get(self._composite_key(workspace, routine_id))
        # Fallback: search all routines by ID (backward compat)
        for rs in self._routines.values():
            if rs.id == routine_id:
                return rs
        return None

    def configure_routine(
        self, routine_id: str, workspace: str | None = None, **kwargs
    ) -> dict | None:
        """Update fields on one routine and restart its timer if needed."""
        with self._lock:
            rs = self._find(routine_id, workspace)
            if not rs:
                return None

            if "name" in kwargs:
                rs.name = kwargs["name"]
            if "interval_minutes" in kwargs:
                rs.interval_minutes = max(1, kwargs["interval_minutes"])
            if "context_sources" in kwargs:
                rs.context_sources = kwargs["context_sources"]

            enabled_changed = "enabled" in kwargs and kwargs["enabled"] != rs.enabled
            if "enabled" in kwargs:
                rs.enabled = kwargs["enabled"]

            if rs.timer:
                rs.timer.cancel()
                rs.timer = None

            if rs.enabled:
                if enabled_changed or "interval_minutes" in kwargs:
                    self._reschedule(rs)
                elif rs.next_ping_at:
                    remaining = (rs.next_ping_at - datetime.now(UTC)).total_seconds()
                    if remaining > 0:
                        self._schedule(rs, remaining)
                    else:
                        self._reschedule(rs)
                else:
                    self._reschedule(rs)
            else:
                rs.next_ping_at = None

            return self._routine_dict(rs)

    def add_routine(self, routine_dict: dict) -> dict:
        """Add a new routine and optionally start its timer."""
        with self._lock:
            rid = routine_dict["id"]
            ws = routine_dict.get("workspace", "fathom")
            rs = RoutineState(
                id=rid,
                name=routine_dict.get("name", "Untitled"),
                enabled=routine_dict.get("enabled", False),
                interval_minutes=max(1, routine_dict.get("interval_minutes", 60)),
                workspace=ws,
                context_sources=routine_dict.get(
                    "context_sources", {"time": True, "scripts": [], "texts": []}
                ),
            )
            if rs.enabled:
                self._reschedule(rs)
            self._routines[rs._key] = rs
            return self._routine_dict(rs)

    def remove_routine(self, routine_id: str, workspace: str | None = None) -> bool:
        """Cancel timer and remove a routine. Returns True if found."""
        with self._lock:
            rs = self._find(routine_id, workspace)
            if rs is None:
                return False
            del self._routines[rs._key]
            if rs.timer:
                rs.timer.cancel()
            return True

    def get_routine(self, routine_id: str, workspace: str | None = None) -> dict | None:
        """Get one routine's status dict."""
        with self._lock:
            rs = self._find(routine_id, workspace)
            return self._routine_dict(rs) if rs else None

    def fire_now(self, routine_id: str | None = None, workspace: str | None = None) -> None:
        """Fire a specific routine immediately (non-blocking).

        If routine_id is None, fires the first routine (backward compat).
        """
        with self._lock:
            if routine_id is None:
                rs = next(iter(self._routines.values()), None)
            else:
                rs = self._find(routine_id, workspace)
        if rs:
            threading.Thread(target=self._run, args=(rs.id, rs.workspace), daemon=True).start()

    # ── Status ────────────────────────────────────────────────────────────

    @property
    def status(self) -> dict:
        """Return status for all routines."""
        with self._lock:
            return {
                "routines": [self._routine_dict(rs) for rs in self._routines.values()],
            }

    def status_for_workspace(self, workspace: str | None = None) -> dict:
        """Return status filtered to a single workspace."""
        with self._lock:
            routines = [
                self._routine_dict(rs)
                for rs in self._routines.values()
                if workspace is None or rs.workspace == workspace
            ]
            return {"routines": routines}

    @property
    def first_routine_status(self) -> dict:
        """Backward-compat: return status dict shaped like old single-routine format."""
        with self._lock:
            rs = next(iter(self._routines.values()), None)
            if not rs:
                return {
                    "enabled": False,
                    "interval_minutes": 60,
                    "next_ping_at": None,
                    "last_ping_at": None,
                    "context_sources": {"time": True, "scripts": [], "texts": []},
                }
            return self._routine_dict(rs)

    # ── Internal ──────────────────────────────────────────────────────────

    def _routine_dict(self, rs: RoutineState) -> dict:
        return {
            "id": rs.id,
            "name": rs.name,
            "enabled": rs.enabled,
            "interval_minutes": rs.interval_minutes,
            "workspace": rs.workspace,
            "next_ping_at": rs.next_ping_at.isoformat() if rs.next_ping_at else None,
            "last_ping_at": rs.last_ping_at.isoformat() if rs.last_ping_at else None,
            "context_sources": rs.context_sources,
        }

    def _reschedule(self, rs: RoutineState) -> None:
        """Set next ping and schedule timer. Must hold lock."""
        rs.next_ping_at = datetime.now(UTC) + timedelta(minutes=rs.interval_minutes)
        self._schedule(rs, rs.interval_minutes * 60)

    def _schedule(self, rs: RoutineState, seconds: float) -> None:
        """Create and start a timer for one routine. Must hold lock."""
        if rs.timer:
            rs.timer.cancel()
        rs.timer = threading.Timer(seconds, self._run, args=(rs.id, rs.workspace))
        rs.timer.daemon = True
        rs.timer.start()

    def _build_prompt(self, rs: RoutineState) -> str:
        src = rs.context_sources
        parts = []

        # Header line
        header_parts = []
        if src.get("time"):
            header_parts.append(f"Time: {datetime.now().strftime('%A %B %-d, %-I:%M %p')}")
        if header_parts:
            parts.append(f"[Ping — {' · '.join(header_parts)}]")

        # Script sections
        for script in src.get("scripts", []):
            if not script.get("enabled"):
                continue
            label = script.get("label", "Script")
            output = ""
            try:
                result = subprocess.run(
                    script["command"],
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                output = result.stdout.strip()
            except Exception:
                pass
            section = f"[{label}]"
            if output:
                section += f"\n{output}"
            parts.append(section)

        # Text blocks (or custom prompt file)
        custom = Path.home() / ".config" / "fathom" / "ping-prompt.md"
        if custom.exists():
            parts.append(custom.read_text().strip())
        else:
            for t in src.get("texts", []):
                if t.get("enabled") and t.get("content", "").strip():
                    parts.append(t["content"].strip())

        return "\n\n".join(p for p in parts if p)

    def _run(self, routine_id: str, workspace: str) -> None:
        from services.persistent_session import inject

        key = self._composite_key(workspace, routine_id)
        with self._lock:
            rs = self._routines.get(key)
            if not rs:
                return
            prompt = self._build_prompt(rs)
            ws = rs.workspace

        inject(prompt, workspace=ws)

        with self._lock:
            rs = self._routines.get(key)
            if not rs:
                return
            rs.last_ping_at = datetime.now(UTC)

            # Persist to per-workspace settings
            try:
                ws_settings = load_workspace_settings(ws)
                for saved_r in ws_settings["ping"]["routines"]:
                    if saved_r["id"] == routine_id:
                        saved_r["last_ping_at"] = rs.last_ping_at.isoformat()
                        if rs.enabled:
                            self._reschedule(rs)
                            saved_r["next_ping_at"] = rs.next_ping_at.isoformat()
                        break
                save_workspace_settings(ws, ws_settings)
            except (ValueError, OSError):
                pass  # Don't crash the timer on settings save failure


ping_scheduler = PingScheduler()
