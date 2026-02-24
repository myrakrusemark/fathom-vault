"""Persistent fathom-session manager.

Manages a single long-lived tmux session running Claude Code.
The terminal panel attaches to it; the ping scheduler injects into it.
"""

import os
import subprocess
import threading
import time
from pathlib import Path

_SESSION = "fathom-session"
_CLAUDE = "/home/myra/.local/bin/claude"
_WORK_DIR = "/data/Dropbox/Work"
_PANE_ID_FILE = Path.home() / ".config" / "fathom" / "pane-id"

_lock = threading.Lock()


def _main_pane() -> str:
    """Return the tmux target for Fathom's main pane.

    Reads ~/.config/fathom/pane-id if it exists (written by the fathom-session
    launcher). Falls back to session-level target, which at least hits *some* pane.
    """
    try:
        pane_id = _PANE_ID_FILE.read_text().strip()
        if pane_id:
            return pane_id
    except OSError:
        pass
    return _SESSION


def is_running() -> bool:
    """Return True if the tmux session exists."""
    result = subprocess.run(
        ["tmux", "has-session", "-t", _SESSION],
        capture_output=True,
    )
    return result.returncode == 0


def ensure_running() -> bool:
    """Start fathom-session if it isn't already running. Returns True if session is up."""
    with _lock:
        if is_running():
            return True
        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        try:
            subprocess.Popen(
                [
                    "tmux",
                    "new-session",
                    "-d",
                    "-s",
                    _SESSION,
                    _CLAUDE,
                    "--model",
                    "opus",
                    "--permission-mode",
                    "bypassPermissions",
                ],
                env=env,
                cwd=_WORK_DIR,
            )
            # Give Claude a moment to initialize
            time.sleep(2)
            return is_running()
        except Exception:
            return False


def inject(text: str) -> bool:
    """Send text to fathom-session as a new user message, then press Enter.

    Returns True if the send succeeded. Does not wait for or capture the response.
    """
    if not is_running():
        started = ensure_running()
        if not started:
            return False
        # Give Claude time to be ready for input
        time.sleep(10)

    pane = _main_pane()
    env = os.environ.copy()
    try:
        # Send the text literally (no key-name interpretation)
        subprocess.run(
            ["tmux", "send-keys", "-t", pane, "-l", text],
            capture_output=True,
            env=env,
        )
        # Brief pause so text flushes before Enter
        time.sleep(1)
        subprocess.run(
            ["tmux", "send-keys", "-t", pane, "", "Enter"],
            capture_output=True,
            env=env,
        )
        return True
    except Exception:
        return False


def restart() -> bool:
    """Kill and restart fathom-session with --continue in the configured working directory."""
    with _lock:
        if is_running():
            subprocess.run(
                ["tmux", "kill-session", "-t", _SESSION],
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
                    _SESSION,
                    _CLAUDE,
                    "--continue",
                    "--model",
                    "opus",
                    "--permission-mode",
                    "bypassPermissions",
                ],
                env=env,
                cwd=_WORK_DIR,
            )
            time.sleep(2)

            # Update pane-id file so message routing targets the new pane
            if is_running():
                result = subprocess.run(
                    ["tmux", "list-panes", "-t", _SESSION, "-F", "#{pane_id}"],
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0 and result.stdout.strip():
                    pane_id = result.stdout.strip().split("\n")[0]
                    _PANE_ID_FILE.parent.mkdir(parents=True, exist_ok=True)
                    _PANE_ID_FILE.write_text(pane_id)
                return True
            return False
        except Exception:
            return False


def status() -> dict:
    return {
        "session": _SESSION,
        "pane": _main_pane(),
        "running": is_running(),
    }
