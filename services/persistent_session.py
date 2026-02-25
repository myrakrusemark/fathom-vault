"""Persistent workspace session manager.

Manages workspace-scoped tmux sessions running Claude Code.
Each workspace gets its own session: {workspace}_fathom-session.
The terminal panel attaches to it; the ping scheduler injects into it.
"""

import os
import subprocess
import threading
import time
from pathlib import Path

from config import get_workspace_path

_CLAUDE = "/home/myra/.local/bin/claude"
_FATHOM_CONFIG_DIR = Path.home() / ".config" / "fathom"

_lock = threading.Lock()


def _session_name(workspace: str = None) -> str:
    """Return the tmux session name for a workspace."""
    ws = workspace or "fathom"
    return f"{ws}_fathom-session"


def _pane_id_file(workspace: str = None) -> Path:
    """Return the pane-id file path for a workspace."""
    ws = workspace or "fathom"
    return _FATHOM_CONFIG_DIR / f"{ws}-pane-id"


def _work_dir(workspace: str = None) -> str:
    """Return the working directory for a workspace."""
    ws_path, _err = get_workspace_path(workspace)
    return ws_path or "/data/Dropbox/Work"


def _main_pane(workspace: str = None) -> str:
    """Return the tmux target for a workspace's main pane.

    Reads the workspace-specific pane-id file if it exists.
    Falls back to session-level target.
    """
    pane_file = _pane_id_file(workspace)
    try:
        pane_id = pane_file.read_text().strip()
        if pane_id:
            return pane_id
    except OSError:
        pass
    return _session_name(workspace)


def is_running(workspace: str = None) -> bool:
    """Return True if the workspace's tmux session exists."""
    session = _session_name(workspace)
    result = subprocess.run(
        ["tmux", "has-session", "-t", session],
        capture_output=True,
    )
    return result.returncode == 0


def ensure_running(workspace: str = None) -> bool:
    """Start workspace session if not running. Returns True if session is up."""
    with _lock:
        if is_running(workspace):
            return True
        session = _session_name(workspace)
        cwd = _work_dir(workspace)
        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        try:
            subprocess.Popen(
                [
                    "tmux",
                    "new-session",
                    "-d",
                    "-s",
                    session,
                    _CLAUDE,
                    "--model",
                    "opus",
                    "--permission-mode",
                    "bypassPermissions",
                ],
                env=env,
                cwd=cwd,
            )
            time.sleep(2)
            return is_running(workspace)
        except Exception:
            return False


def inject(text: str, workspace: str = None) -> bool:
    """Send text to a workspace's session as a new user message, then press Enter.

    Returns True if the send succeeded. Does not wait for or capture the response.
    """
    if not is_running(workspace):
        started = ensure_running(workspace)
        if not started:
            return False
        time.sleep(10)

    pane = _main_pane(workspace)
    env = os.environ.copy()
    try:
        subprocess.run(
            ["tmux", "send-keys", "-t", pane, "-l", text],
            capture_output=True,
            env=env,
        )
        time.sleep(1)
        subprocess.run(
            ["tmux", "send-keys", "-t", pane, "", "Enter"],
            capture_output=True,
            env=env,
        )
        return True
    except Exception:
        return False


def restart(workspace: str = None) -> bool:
    """Kill and restart a workspace session with --continue."""
    with _lock:
        session = _session_name(workspace)
        cwd = _work_dir(workspace)

        if is_running(workspace):
            subprocess.run(
                ["tmux", "kill-session", "-t", session],
                capture_output=True,
            )
            time.sleep(1)

        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        try:
            subprocess.Popen(
                [
                    "tmux",
                    "new-session",
                    "-d",
                    "-s",
                    session,
                    _CLAUDE,
                    "--continue",
                    "--model",
                    "opus",
                    "--permission-mode",
                    "bypassPermissions",
                ],
                env=env,
                cwd=cwd,
            )
            time.sleep(2)

            if is_running(workspace):
                result = subprocess.run(
                    ["tmux", "list-panes", "-t", session, "-F", "#{pane_id}"],
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0 and result.stdout.strip():
                    pane_id = result.stdout.strip().split("\n")[0]
                    pane_file = _pane_id_file(workspace)
                    pane_file.parent.mkdir(parents=True, exist_ok=True)
                    pane_file.write_text(pane_id)
                return True
            return False
        except Exception:
            return False


def status(workspace: str = None) -> dict:
    return {
        "session": _session_name(workspace),
        "pane": _main_pane(workspace),
        "running": is_running(workspace),
    }
