#!/bin/bash
# Fathom Vault recall — BM25 keyword + cached semantic search on every user message.
# JSON output: systemMessage (user sees count) + additionalContext (model sees details).
#
# Search strategy:
# - BM25 keyword search runs synchronously (<2s) for immediate results
# - Vector semantic search runs asynchronously in the background
# - Cached vsearch results from the previous query are shown alongside BM25
# - This gives us the best of both: fast keywords + deep semantics (one message behind)

set -o pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
VSEARCH_CACHE="/tmp/fathom-vsearch-cache.json"
VSEARCH_LOCK="/tmp/fathom-vsearch.lock"
STALE_LOCK_SECONDS=180   # 3 minutes — lock older than this is considered stale
CACHE_TTL_SECONDS=300    # 5 minutes — cached results older than this are ignored

# Walk up to find .fathom.json
find_config() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/.fathom.json" ]; then
      echo "$dir/.fathom.json"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

CONFIG_FILE=$(find_config 2>/dev/null) || exit 0

WORKSPACE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('workspace',''))" 2>/dev/null || echo "")
SERVER=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('server','http://localhost:4243'))" 2>/dev/null || echo "http://localhost:4243")
API_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiKey',''))" 2>/dev/null || echo "")

AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
  AUTH_HEADER="Authorization: Bearer $API_KEY"
fi

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

INPUT=$(cat)
USER_MESSAGE=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

if [ -z "$USER_MESSAGE" ] || [ ${#USER_MESSAGE} -lt 10 ]; then
    exit 0
fi

QUERY="${USER_MESSAGE:0:500}"

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

# --- Phase 2: Run search via API ---
ENCODED_Q=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$QUERY")

CURL_ARGS=(-sf)
[ -n "$AUTH_HEADER" ] && CURL_ARGS+=(-H "$AUTH_HEADER")

API_RESPONSE=$(timeout 5 curl "${CURL_ARGS[@]}" "${SERVER}/api/search?q=${ENCODED_Q}&n=5&mode=bm25&workspace=${WORKSPACE}" 2>/dev/null)
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

# --- Output ---
if [ -n "$BM25_RESULTS" ] || [ -n "$CACHED_VSEARCH" ]; then
    VAULT_COUNT=0
    [ -n "$BM25_RESULTS" ] && VAULT_COUNT=$(echo "$BM25_RESULTS" | grep -c '^\s' || true)
    [ -n "$CACHED_VSEARCH" ] && VAULT_COUNT=$((VAULT_COUNT + $(echo "$CACHED_VSEARCH" | grep -c '^\s' || true)))

    DETAIL_TEXT="Fathom Vault: ${VAULT_COUNT} results"
    DETAIL_TEXT="$DETAIL_TEXT"$'\n'
    if [ -n "$BM25_RESULTS" ] && [ -n "$CACHED_VSEARCH" ]; then
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"Vault (keyword):"
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$BM25_RESULTS"
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'$'\n'"Vault (semantic, previous query):"
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$CACHED_VSEARCH"
    elif [ -n "$BM25_RESULTS" ]; then
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$BM25_RESULTS"
    elif [ -n "$CACHED_VSEARCH" ]; then
        DETAIL_TEXT="$DETAIL_TEXT"$'\n'"$CACHED_VSEARCH"
    fi

    SUMMARY="Fathom Vault: ${VAULT_COUNT} memories"
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
    nohup "$HOOK_DIR/fathom-vsearch-background.sh" "$QUERY" "$WORKSPACE" >/dev/null 2>&1 &
    disown
fi
