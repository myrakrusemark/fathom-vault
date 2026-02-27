"""Persistent workspace session manager.

Manages workspace-scoped tmux sessions running AI agents (Claude Code, Codex, Gemini, etc.).
Each workspace gets its own session: {workspace}_fathom-session.
The terminal panel attaches to it; the ping scheduler injects into it.
"""

import os
import subprocess
import threading
import time
from pathlib import Path

from config import get_workspace_path
from services.settings import load_global_settings, load_workspace_settings

_CLAUDE = "/home/myra/.local/bin/claude"
_FATHOM_CONFIG_DIR = Path.home() / ".config" / "fathom"

# Agent CLI commands — map agent identifier to executable and flags
_AGENT_COMMANDS = {
    "claude-code": {
        "command": [_CLAUDE, "--model", "opus"],
        "restart_flag": "--continue",
    },
    "codex": {
        "command": ["codex"],
        "restart_flag": "resume --last",
    },
    "gemini": {
        "command": ["gemini"],
        "restart_flag": "--resume",
    },
    "opencode": {
        "command": ["opencode"],
        "restart_flag": "--continue",
    },
}


def _get_agent(workspace: str = None) -> str:
    """Read the primary agent for a workspace from global settings."""
    settings = load_global_settings()
    ws_entry = settings.get("workspaces", {}).get(workspace or "fathom", {})
    agents = ws_entry.get("agents", [])
    return agents[0] if agents else "claude-code"


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


def _save_pane_id(workspace: str = None) -> None:
    """Query tmux for the session's pane ID and write it to the pane-id file."""
    session = _session_name(workspace)
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
        ws_settings = load_workspace_settings(workspace)
        bypass = ws_settings.get("session", {}).get("bypass_permissions", False)

        agent_id = _get_agent(workspace)
        agent = _AGENT_COMMANDS.get(agent_id, _AGENT_COMMANDS["claude-code"])

        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        try:
            cmd = [
                "tmux",
                "new-session",
                "-d",
                "-s",
                session,
                *agent["command"],
            ]
            if bypass and agent_id == "claude-code":
                cmd += ["--permission-mode", "bypassPermissions"]
            subprocess.Popen(
                cmd,
                env=env,
                cwd=cwd,
            )
            time.sleep(2)
            if is_running(workspace):
                _save_pane_id(workspace)
                return True
            return False
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
    """Kill and restart a workspace session (with --continue for Claude Code)."""
    with _lock:
        session = _session_name(workspace)
        cwd = _work_dir(workspace)

        if is_running(workspace):
            subprocess.run(
                ["tmux", "kill-session", "-t", session],
                capture_output=True,
            )
            time.sleep(1)

        ws_settings = load_workspace_settings(workspace)
        bypass = ws_settings.get("session", {}).get("bypass_permissions", False)

        agent_id = _get_agent(workspace)
        agent = _AGENT_COMMANDS.get(agent_id, _AGENT_COMMANDS["claude-code"])

        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        try:
            # Build agent command with restart flag if supported
            agent_cmd = list(agent["command"])
            if agent.get("restart_flag"):
                for i, part in enumerate(agent["restart_flag"].split()):
                    agent_cmd.insert(1 + i, part)
            cmd = [
                "tmux",
                "new-session",
                "-d",
                "-s",
                session,
                *agent_cmd,
            ]
            if bypass and agent_id == "claude-code":
                cmd += ["--permission-mode", "bypassPermissions"]
            subprocess.Popen(
                cmd,
                env=env,
                cwd=cwd,
            )
            time.sleep(2)

            if is_running(workspace):
                _save_pane_id(workspace)
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
