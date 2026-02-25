"""Crystallization agent: spawn claude -p and stream progress events.

The spawned agent runs in simple mode (no MCP tools). It reads vault files
via --add-dir and outputs the crystal text. The Python code then captures
the text and writes it to Memento via the API.
"""

import json
import logging
import os
import re
import subprocess
import threading
import uuid
from pathlib import Path

from config import get_vault_path, get_workspace_path
from services.memento import write_crystal

log = logging.getLogger(__name__)

# In-memory job store: job_id → {"status": "running"|"done"|"failed", "events": [...], "proc": ...}
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()

_PROGRESS_RE = re.compile(r'\{"progress"\s*:\s*(\d+)\s*,\s*"stage"\s*:\s*"([^"]+)"\}')

# Markers that delimit the crystal text in the agent's output.
_CRYSTAL_START = "---CRYSTAL-START---"
_CRYSTAL_END = "---CRYSTAL-END---"

DEFAULT_PROMPT = """\
You are a crystallization agent. Your job: read the vault files provided and distill a
~1300-word first-person identity crystal — what this agent cares about, what it's working on,
what persists across sessions.

IMPORTANT: You are running in simple mode. You have Bash but NOT Read/Glob/Grep/Edit tools.
Use Bash commands (find, cat, ls, head) to read vault files.

Throughout your work, emit progress markers on their own line so the UI can track you:
{{"progress": 5, "stage": "Reading vault files"}}
{{"progress": 50, "stage": "Synthesizing"}}
{{"progress": 90, "stage": "Outputting crystal"}}
{{"progress": 100, "stage": "Done"}}

Emit each marker EXACTLY when you reach that stage — not all at the start.

Steps:
1. Use `find` or `ls` via Bash to discover vault files (reflections/, thinking/, daily/)
2. Use `cat` via Bash to read the most relevant files (up to 20 reflections, 7 heartbeats)
3. Synthesize a fresh ~1300-word first-person identity crystal
4. Output the crystal text between these exact delimiters:

---CRYSTAL-START---
(your crystal text here)
---CRYSTAL-END---

The infrastructure will capture the text between the delimiters and save it to Memento.
Do NOT try to call memento_identity_update or any MCP tools — they are not available.

Workspace: {workspace}
"""


def _load_prompt(extra_context: str = "", workspace: str = "") -> str:
    """Return crystallization prompt, optionally merging extra_context."""
    prompt_path = Path.home() / ".config" / "fathom" / "crystal-prompt.md"
    base = prompt_path.read_text() if prompt_path.exists() else DEFAULT_PROMPT
    base = base.format(workspace=workspace or "default")
    if extra_context.strip():
        base += f"\n\n## Additional context for this run\n{extra_context.strip()}\n"
    return base


def spawn(additional_context: str = "", workspace: str = None) -> str:
    """Start a crystallization job. Returns job_id.

    The workspace parameter controls which project directory the agent runs from
    and which Memento workspace receives the crystal.
    """
    job_id = str(uuid.uuid4())

    # Resolve workspace paths — fall back to fathom defaults
    project_path, _ = get_workspace_path(workspace)
    vault_path, _ = get_vault_path(workspace)
    if not project_path:
        project_path = "/data/Dropbox/Work"
    if not vault_path:
        vault_path = "/data/Dropbox/Work/vault"

    prompt = _load_prompt(additional_context, workspace=workspace or "fathom")

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
        vault_path,
    ]

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)  # prevent "cannot run inside Claude Code" error

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        cwd=project_path,
        text=True,
        bufsize=1,
    )

    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "status": "running",
            "events": [],
            "proc": proc,
            "workspace": workspace,
        }

    threading.Thread(target=_reader, args=(job_id, proc, workspace), daemon=True).start()
    return job_id


def _reader(job_id: str, proc: subprocess.Popen, workspace: str = None) -> None:
    """Background thread: read proc stdout, parse stream-json, store events.

    Accumulates full text output to extract the crystal after completion.
    """
    text_buf = ""
    full_text = []
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
                    chunk = delta.get("text", "")
                    text_buf += chunk
                    full_text.append(chunk)

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

    # Extract crystal from delimited output and write to Memento
    all_text = "".join(full_text)
    crystal = _extract_crystal(all_text)
    write_ok = False
    if crystal and proc.returncode == 0:
        result = write_crystal(crystal, workspace=workspace)
        write_ok = result.get("ok", False)
        if not write_ok:
            log.error("Failed to write crystal to Memento: %s", result.get("error"))

    status = "done" if proc.returncode == 0 and write_ok else "failed"
    error_detail = None
    if proc.returncode != 0:
        error_detail = f"Process exited with code {proc.returncode}"
    elif not crystal:
        error_detail = "No crystal text found between delimiters in agent output"
    elif not write_ok:
        error_detail = "Failed to write crystal to Memento"

    done_event = {"type": "done", "status": status, "exit_code": proc.returncode}
    if error_detail:
        done_event["error"] = error_detail
    _append_event(job_id, done_event)

    with _JOBS_LOCK:
        if job_id in _JOBS:
            _JOBS[job_id]["status"] = status


def _extract_crystal(text: str) -> str | None:
    """Extract crystal text from between start/end delimiters."""
    start_idx = text.find(_CRYSTAL_START)
    end_idx = text.find(_CRYSTAL_END)
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        return None
    crystal = text[start_idx + len(_CRYSTAL_START) : end_idx].strip()
    return crystal if crystal else None


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
