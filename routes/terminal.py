"""Terminal WebSocket — pty bridge for workspace-scoped fathom sessions."""

import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import termios
import threading
from urllib.parse import parse_qs

from flask_sock import Sock

from services.persistent_session import (
    _AGENT_COMMANDS,
    _get_agent,
    _is_human_workspace,
    _session_name,
    _work_dir,
    ensure_running,
)
from services.settings import load_workspace_settings

sock = Sock()


@sock.route("/ws/terminal")
def terminal(ws):
    # Extract workspace from query string
    qs = parse_qs(ws.environ.get("QUERY_STRING", ""))
    workspace = qs.get("workspace", [None])[0]

    # Read initial dimensions from query params so the PTY is correctly
    # sized *before* tmux attaches — prevents garbled first render.
    try:
        init_cols = max(1, min(500, int(qs.get("cols", [80])[0])))
    except (ValueError, IndexError):
        init_cols = 80
    try:
        init_rows = max(1, min(200, int(qs.get("rows", [24])[0])))
    except (ValueError, IndexError):
        init_rows = 24

    tmux_session = _session_name(workspace)
    ensure_running(workspace)

    working_dir = _work_dir(workspace)
    if not os.path.isdir(working_dir):
        working_dir = os.path.expanduser("~")

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"

    try:
        master_fd, slave_fd = pty.openpty()
        # Set PTY size before launching subprocess so tmux sees the
        # correct dimensions from the start (no garbled initial render).
        fcntl.ioctl(
            master_fd,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", init_rows, init_cols, 0, 0),
        )

        if _is_human_workspace(workspace):
            # Human workspaces — attach to bash session (ensure_running
            # handles inbox setup + tail -f)
            ensure_running(workspace)
            cmd = ["tmux", "new-session", "-A", "-s", tmux_session]
        else:
            ws_settings = load_workspace_settings(workspace)
            bypass = ws_settings.get("session", {}).get("bypass_permissions", False)

            agent_id = _get_agent(workspace)
            agent = _AGENT_COMMANDS.get(agent_id, _AGENT_COMMANDS["claude-code"])

            cmd = [
                "tmux",
                "new-session",
                "-A",
                "-s",
                tmux_session,
                *agent["command"],
            ]
            if bypass and agent_id == "claude-code":
                cmd += ["--permission-mode", "bypassPermissions"]

        subprocess.Popen(
            cmd,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=working_dir,
            close_fds=True,
            env=env,
        )
        os.close(slave_fd)
    except Exception as e:
        ws.send(f"\r\n[error: {e}]\r\n")
        return

    stop_event = threading.Event()

    def pty_reader():
        while not stop_event.is_set():
            try:
                r, _, _ = select.select([master_fd], [], [], 0.1)
                if r:
                    data = os.read(master_fd, 4096)
                    if not data:
                        break
                    ws.send(data)
            except OSError:
                break

    reader = threading.Thread(target=pty_reader, daemon=True)
    reader.start()

    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
            if isinstance(msg, str):
                try:
                    parsed = json.loads(msg)
                    if isinstance(parsed, dict) and parsed.get("type") == "resize":
                        cols = max(1, min(500, int(parsed.get("cols", 80))))
                        rows = max(1, min(200, int(parsed.get("rows", 24))))
                        fcntl.ioctl(
                            master_fd,
                            termios.TIOCSWINSZ,
                            struct.pack("HHHH", rows, cols, 0, 0),
                        )
                        continue
                except (json.JSONDecodeError, KeyError, ValueError):
                    pass
                os.write(master_fd, msg.encode())
            else:
                os.write(master_fd, msg)
    finally:
        stop_event.set()
        try:
            os.close(master_fd)
        except OSError:
            pass
