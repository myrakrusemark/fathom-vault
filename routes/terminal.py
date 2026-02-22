"""Terminal WebSocket — pty bridge for Claude Code sessions."""

import fcntl
import json
import os
import pty
import re
import select
import struct
import subprocess
import termios
import threading

from flask import request
from flask_sock import Sock

from services.settings import load_settings

sock = Sock()


@sock.route("/ws/terminal")
def terminal(ws):
    # Resolve browser-specific tmux session name
    raw = request.args.get("session", "")
    session_id = re.sub(r"[^a-zA-Z0-9-]", "", raw)[:36]
    tmux_session = f"fv-{session_id}" if session_id else "fv-default"

    settings = load_settings()
    working_dir = settings.get("terminal", {}).get("working_dir", "/data/Dropbox/Work")

    # Validate working directory exists
    if not os.path.isdir(working_dir):
        working_dir = os.path.expanduser("~")

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)  # prevent "cannot run inside Claude Code" error
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"

    try:
        master_fd, slave_fd = pty.openpty()
        subprocess.Popen(
            ["tmux", "new-session", "-A", "-s", tmux_session, "claude"],
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
                    if parsed.get("type") == "resize":
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
        # proc (tmux client) detaches naturally when the pty master closes — don't kill it
