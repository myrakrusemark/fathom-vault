#!/bin/bash
# PreCompact hook (Fathom) — Save conversation snapshot to vault before context compression.
# Parses JSONL transcript into readable text, writes to vault/conversations/,
# then updates qmd index/embeddings and triggers dashboard title/summary generation.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOAST="$SCRIPT_DIR/hook-toast.sh"

# Toast: progress via queue (one-shot)
"$TOAST" fathom "⏳ Saving snapshot..." &>/dev/null

INPUT=$(cat)

TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path' | sed "s|~|$HOME|")
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

VAULT_DIR="/data/Dropbox/Work/vault/conversations"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_FILE="$VAULT_DIR/${TIMESTAMP}_compaction.txt"

mkdir -p "$VAULT_DIR"

# Only save if transcript exists and has content
if [ ! -f "$TRANSCRIPT_PATH" ]; then
    "$TOAST" fathom "✗ No transcript found" &>/dev/null
    exit 0
fi

LINE_COUNT=$(wc -l < "$TRANSCRIPT_PATH")
if [ "$LINE_COUNT" -lt 2 ]; then
    "$TOAST" fathom "✓ Skipped (tiny conversation)" &>/dev/null
    exit 0  # Skip tiny/empty conversations
fi

# Write frontmatter
{
    echo "---"
    echo "session_id: $SESSION_ID"
    echo "type: compaction_snapshot"
    echo "---"
    echo ""
} > "$OUTPUT_FILE"

# Parse transcript using shared parser
"$SCRIPT_DIR/parse-transcript.sh" "$TRANSCRIPT_PATH" >> "$OUTPUT_FILE"

# Check if file has content beyond frontmatter
if [ ! -s "$OUTPUT_FILE" ]; then
    rm -f "$OUTPUT_FILE"
    "$TOAST" fathom "✗ Snapshot empty" &>/dev/null
    exit 0
fi

# Report success
FILENAME=$(basename "$OUTPUT_FILE")
FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

# Toast: done
"$TOAST" fathom "✓ Snapshot saved (${FILE_SIZE})" &>/dev/null

python3 -c "
import json, sys
msg = sys.argv[1]
print(json.dumps({'systemMessage': msg}))
" "Fathom Snapshot: saved ${FILENAME} (${FILE_SIZE})"

# Update qmd index and trigger title/summary in background
(
    sleep 2
    qmd update 2>/dev/null
    qmd embed 2>/dev/null
    if curl -s --max-time 2 "http://localhost:4242/api/status" >/dev/null 2>&1; then
        curl -s -X POST "http://localhost:4242/api/conversations/${FILENAME}/generate-title" --max-time 30 2>/dev/null
        curl -s -X POST "http://localhost:4242/api/conversations/${FILENAME}/generate-summary" --max-time 30 2>/dev/null
    fi
) &

exit 0
