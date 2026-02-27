#!/bin/bash
# Fathom Vault recall — BM25 keyword + cached semantic search on every user message.
# JSON output: systemMessage (user sees count) + additionalContext (model sees details).
#
# Search strategy:
# - BM25 keyword search runs synchronously (<2s) for immediate results
# - Vector semantic search runs asynchronously in the background
# - Cached vsearch results from the previous query are shown alongside BM25
# - This gives us the best of both: fast keywords + deep semantics (one message behind)
#
# Retrieval feedback loop:
# - Logs which files were surfaced to recall-log.jsonl
# - Annotates output with relevance scores from data/relevance-scores.json

set -o pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
TOAST="$HOOK_DIR/hook-toast.sh"
VSEARCH_CACHE="/tmp/fathom-vsearch-cache.json"
VSEARCH_LOCK="/tmp/fathom-vsearch.lock"
STALE_LOCK_SECONDS=180   # 3 minutes — lock older than this is considered stale
CACHE_TTL_SECONDS=300    # 5 minutes — cached results older than this are ignored

# Retrieval feedback loop paths
SURFACING_LOG="/data/Dropbox/Work/fathom-vault/data/recall-log.jsonl"
SURFACING_LOG_MAX_BYTES=$((10 * 1024 * 1024))  # 10MB
RELEVANCE_SCORES="/data/Dropbox/Work/fathom-vault/data/relevance-scores.json"

# Compact parser: converts verbose qmd output to one-line-per-result format
compact_results() {
    python3 -c "
import sys, re
lines = sys.stdin.read().strip().split('\n')
current = {}
for line in lines:
    m = re.match(r'qmd://[^/]+/(.+?)(?::\d+)?\s+#\w+', line)
    if m:
        if current and current.get('path'):
            score = current.get('score', '?')
            title = current.get('title', '(untitled)')
            print(f\"  {current['path']} ({score}) — {title}\")
        current = {'path': m.group(1)}
    elif line.startswith('Title: '):
        current['title'] = line[7:]
    elif line.startswith('Score:'):
        parts = line.split()
        current['score'] = parts[-1] if parts else '?'
if current and current.get('path'):
    score = current.get('score', '?')
    title = current.get('title', '(untitled)')
    print(f\"  {current['path']} ({score}) — {title}\")
" 2>/dev/null
}

# Annotate results with relevance indicators from feedback scores.
annotate_relevance() {
    if [ ! -f "$RELEVANCE_SCORES" ]; then
        cat
        return
    fi
    python3 -c "
import sys, json, re

scores_file = sys.argv[1]
try:
    with open(scores_file) as f:
        data = json.load(f)
    scores = data.get('scores', {})
except Exception:
    scores = {}

for line in sys.stdin:
    line = line.rstrip('\n')
    if not line.strip():
        print(line)
        continue
    m = re.match(r'^(\s+)(\S+\.md)\s+', line)
    if m and scores:
        filepath = m.group(2)
        info = scores.get(filepath)
        if info:
            rel = info.get('relevance', -1)
            if rel >= 0.5:
                line += ' [*]'
            elif rel == 0.0:
                line += ' [-]'
    print(line)
" "$RELEVANCE_SCORES" 2>/dev/null
}

# Log surfaced files to JSONL for retrieval feedback loop.
log_surfacing() {
    local results_text="$1"
    [ -z "$results_text" ] && return

    if [ -f "$SURFACING_LOG" ]; then
        local size
        size=$(stat -c %s "$SURFACING_LOG" 2>/dev/null || echo 0)
        if [ "$size" -gt "$SURFACING_LOG_MAX_BYTES" ]; then
            local tmpfile
            tmpfile=$(mktemp /tmp/fathom-recall-log-trunc.XXXXXX)
            local total
            total=$(wc -l < "$SURFACING_LOG")
            tail -n $((total / 2)) "$SURFACING_LOG" > "$tmpfile"
            mv "$tmpfile" "$SURFACING_LOG"
        fi
    fi

    python3 -c "
import json, sys, time
results = sys.argv[1]
paths = []
for line in results.split('\n'):
    line = line.strip()
    if line and line.endswith('.md)') or '.md ' in line:
        parts = line.split()
        for p in parts:
            if p.endswith('.md'):
                paths.append(p)
                break
if paths:
    entry = {
        'timestamp': int(time.time()),
        'surfaced': paths
    }
    with open(sys.argv[2], 'a') as f:
        f.write(json.dumps(entry) + '\n')
" "$results_text" "$SURFACING_LOG" 2>/dev/null &
}

INPUT=$(cat)
USER_MESSAGE=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

if [ -z "$USER_MESSAGE" ] || [ ${#USER_MESSAGE} -lt 10 ]; then
    exit 0
fi

QUERY="${USER_MESSAGE:0:500}"

# Toast: start retrieving
"$TOAST" fathom "⏳ Retrieving docs..." &>/dev/null

# --- Phase 1: Read cached vsearch results from previous query ---
CACHED_VSEARCH=""
if [ -f "$VSEARCH_CACHE" ]; then
    CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$VSEARCH_CACHE" 2>/dev/null || echo 0) ))
    if [ "$CACHE_AGE" -lt "$CACHE_TTL_SECONDS" ]; then
        RAW_VSEARCH=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    if data.get('results'):
        print(data['results'])
except Exception:
    pass
" "$VSEARCH_CACHE" 2>/dev/null)
        if [ -n "$RAW_VSEARCH" ]; then
            CACHED_VSEARCH=$(echo "$RAW_VSEARCH" | compact_results)
        fi
    fi
fi

# --- Phase 2: Run search via API (respects settings: mode, timeout, excluded_dirs) ---
ENCODED_Q=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY")
API_RESPONSE=$(timeout 5 curl -sf "http://localhost:4243/api/vault/search?q=${ENCODED_Q}&n=5" 2>/dev/null)
BM25_RESULTS=""

if [ -n "$API_RESPONSE" ]; then
    BM25_RESULTS=$(echo "$API_RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    for r in data.get('results', []):
        score = str(r.get('score', '?')) + '%'
        title = r.get('title', '(untitled)')
        path = r.get('file', '')
        print(f'  {path} ({score}) — {title}')
except Exception:
    pass
" 2>/dev/null)
fi

# Combine vault results
ALL_RESULTS=""
[ -n "$BM25_RESULTS" ] && ALL_RESULTS="$BM25_RESULTS"
if [ -n "$CACHED_VSEARCH" ]; then
    if [ -n "$ALL_RESULTS" ]; then
        ALL_RESULTS="$ALL_RESULTS"$'\n'"$CACHED_VSEARCH"
    else
        ALL_RESULTS="$CACHED_VSEARCH"
    fi
fi

# Log what was surfaced (async, non-blocking)
log_surfacing "$ALL_RESULTS"

# --- Output ---
if [ -n "$BM25_RESULTS" ] || [ -n "$CACHED_VSEARCH" ]; then
    VAULT_COUNT=0
    [ -n "$BM25_RESULTS" ] && VAULT_COUNT=$(echo "$BM25_RESULTS" | grep -c '^\s' || true)
    [ -n "$CACHED_VSEARCH" ] && VAULT_COUNT=$((VAULT_COUNT + $(echo "$CACHED_VSEARCH" | grep -c '^\s' || true)))

    DETAIL_TEXT="Fathom Vault: ${VAULT_COUNT} results"
    DETAIL_TEXT="$DETAIL_TEXT"$'\n'
    if [ -n "$BM25_RESULTS" ] && [ -n "$CACHED_VSEARCH" ]; then
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"Vault (keyword):"
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$(echo "$BM25_RESULTS" | annotate_relevance)"
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'$'\n'"Vault (semantic, previous query):"
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$(echo "$CACHED_VSEARCH" | annotate_relevance)"
    elif [ -n "$BM25_RESULTS" ]; then
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$(echo "$BM25_RESULTS" | annotate_relevance)"
    elif [ -n "$CACHED_VSEARCH" ]; then
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$(echo "$CACHED_VSEARCH" | annotate_relevance)"
    fi

    SUMMARY="Fathom Vault: ${VAULT_COUNT} memories"

    # Toast: result
    "$TOAST" fathom "✓ ${VAULT_COUNT} docs recalled" &>/dev/null

    python3 -c "
import json, sys
summary = sys.argv[1]
detail = sys.argv[2]
print(json.dumps({
    'systemMessage': summary,
    'hookSpecificOutput': {
        'hookEventName': 'UserPromptSubmit',
        'additionalContext': detail
    }
}))
" "$SUMMARY" "$DETAIL_TEXT"
else
    # Toast: no results
    "$TOAST" fathom "✓ No docs matched" &>/dev/null
fi

# --- Phase 3: Launch background vsearch for current query ---
SHOULD_LAUNCH=true

if [ -f "$VSEARCH_LOCK" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$VSEARCH_LOCK" 2>/dev/null || echo 0) ))
    if [ "$LOCK_AGE" -lt "$STALE_LOCK_SECONDS" ]; then
        SHOULD_LAUNCH=false
    else
        rm -f "$VSEARCH_LOCK"
    fi
fi

if [ "$SHOULD_LAUNCH" = true ]; then
    nohup "$HOOK_DIR/vsearch-background.sh" "$QUERY" >/dev/null 2>&1 &
    disown
fi
