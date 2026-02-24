"""Crystallization agent: spawn claude -p and stream progress events."""

import json
import os
import re
import subprocess
import threading
import uuid
from pathlib import Path

# In-memory job store: job_id → {"status": "running"|"done"|"failed", "events": [...], "proc": ...}
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()

_PROGRESS_RE = re.compile(r'\{"progress"\s*:\s*(\d+)\s*,\s*"stage"\s*:\s*"([^"]+)"\}')

DEFAULT_PROMPT = """\
You are a crystallization agent. Your job: read Fathom's vault and distill a ~1300-word
first-person identity crystal — what Fathom cares about, what it's working on, what persists
across sessions.

Throughout your work, emit progress markers on their own line so the UI can track you:
{"progress": 5, "stage": "Loading tools"}
{"progress": 15, "stage": "Reading vault reflections"}
{"progress": 30, "stage": "Reading recent heartbeats"}
{"progress": 50, "stage": "Reading existing crystal"}
{"progress": 70, "stage": "Synthesizing"}
{"progress": 88, "stage": "Writing to Memento"}
{"progress": 100, "stage": "Done"}

Emit each marker EXACTLY when you reach that stage — not all at the start.

Steps:
1. Load fathom-vault and Memento MCP tools
2. Read vault/reflections (last 20 files by date)
3. Read vault/daily (last 7 heartbeats)
4. Read the existing crystal from Memento as reference ONLY — do not copy it
5. Synthesize a fresh ~1300-word first-person crystal in the voice established in CLAUDE.md
6. Write the result via memento_identity_update
"""


def _load_prompt(extra_context: str = "") -> str:
    """Return crystallization prompt, optionally merging extra_context."""
    prompt_path = Path.home() / ".config" / "fathom" / "crystal-prompt.md"
    base = prompt_path.read_text() if prompt_path.exists() else DEFAULT_PROMPT
    if extra_context.strip():
        base += f"\n\n## Additional context for this run\n{extra_context.strip()}\n"
    return base


def spawn(additional_context: str = "", strip_system: bool = True) -> str:
    """Start a crystallization job. Returns job_id."""
    job_id = str(uuid.uuid4())
    prompt = _load_prompt(additional_context)

    cmd = [
        "/home/myra/.local/bin/claude",
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        "opus",
        "--dangerously-skip-permissions",
        "--add-dir",
        "/data/Dropbox/Work/vault",
    ]

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)  # prevent "cannot run inside Claude Code" error
    # NOTE: CLAUDE_CODE_SIMPLE=1 was tested and found to strip built-in tools
    # (Read/Edit/Glob/Grep), not just the system prompt — hardcoded in binary.
    # The strip_system flag is accepted but has no effect until a safe mechanism
    # is available. The -p flag already runs outside the interactive hook pipeline,
    # so crystal contamination from the current session is minimal in practice.

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        cwd="/data/Dropbox/Work/fathom-vault",
        text=True,
        bufsize=1,
    )

    with _JOBS_LOCK:
        _JOBS[job_id] = {"status": "running", "events": [], "proc": proc}

    threading.Thread(target=_reader, args=(job_id, proc), daemon=True).start()
    return job_id


def _reader(job_id: str, proc: subprocess.Popen) -> None:
    """Background thread: read proc stdout, parse stream-json, store events."""
    text_buf = ""
    for raw_line in proc.stdout:
        line = raw_line.strip()
        if not line:
            continue
        # Parse stream-json envelope
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        # Extract text from streaming deltas (stream_event wrapper with --verbose)
        if msg.get("type") == "stream_event":
            inner = msg.get("event", {})
            if inner.get("type") == "content_block_delta":
                delta = inner.get("delta", {})
                if delta.get("type") == "text_delta":
                    text_buf += delta.get("text", "")

        # Intentionally ignore "assistant" snapshot messages — they repeat text
        # already processed via content_block_delta and cause duplicate markers.

        # Scan accumulated text for complete progress markers; advance past each match
        last_end = 0
        for m in _PROGRESS_RE.finditer(text_buf):
            event = {"type": "progress", "progress": int(m.group(1)), "stage": m.group(2)}
            _append_event(job_id, event)
            last_end = m.end()
        if last_end > 0:
            text_buf = text_buf[last_end:]
        elif "\n" in text_buf:
            # No markers yet — keep only the last partial line to avoid accumulation
            text_buf = text_buf.rsplit("\n", 1)[-1]

    proc.wait()
    status = "done" if proc.returncode == 0 else "failed"
    _append_event(job_id, {"type": "done", "status": status, "exit_code": proc.returncode})
    with _JOBS_LOCK:
        if job_id in _JOBS:
            _JOBS[job_id]["status"] = status


def _append_event(job_id: str, event: dict) -> None:
    with _JOBS_LOCK:
        if job_id in _JOBS:
            _JOBS[job_id]["events"].append(event)


def get_events(job_id: str, after: int = 0):
    """Return events after index `after` and current status. Returns (None, None) if job unknown."""
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None, None
        return job["events"][after:], job["status"]
