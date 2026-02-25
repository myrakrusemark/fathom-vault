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

from services.persistent_session import _CLAUDE, _session_name, _work_dir, ensure_running

sock = Sock()


@sock.route("/ws/terminal")
def terminal(ws):
    # Extract workspace from query string
    qs = parse_qs(ws.environ.get("QUERY_STRING", ""))
    workspace = qs.get("workspace", [None])[0]

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
        subprocess.Popen(
            [
                "tmux",
                "new-session",
                "-A",
                "-s",
                tmux_session,
                _CLAUDE,
                "--model",
                "opus",
                "--permission-mode",
                "bypassPermissions",
            ],
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
