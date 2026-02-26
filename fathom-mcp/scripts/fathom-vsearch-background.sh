#!/bin/bash
# Background vector search worker for fathom-recall hook.
# Launched via nohup/disown — runs asynchronously after the hook returns.
#
# Takes a search query as $1 and workspace as $2, runs qmd vsearch,
# and writes results as JSON to /tmp/fathom-vsearch-cache.json.

set -o pipefail

LOCK_FILE="/tmp/fathom-vsearch.lock"
CACHE_FILE="/tmp/fathom-vsearch-cache.json"

cleanup() {
    rm -f "$LOCK_FILE"
}
trap cleanup EXIT

if [ -z "$1" ]; then
    exit 1
fi

WORKSPACE="${2:-fathom}"

echo $$ > "$LOCK_FILE"

VSEARCH_QUERY="${1:0:200}"

# Run vsearch with 180-second hard timeout
RESULTS=$(timeout 180 qmd vsearch "$VSEARCH_QUERY" -n 5 -c "$WORKSPACE" --min-score 0.5 2>/dev/null)

TMPFILE=$(mktemp /tmp/fathom-vsearch-cache.XXXXXX)

python3 -c "
import json, sys, time
query = sys.argv[1][:200]
results = sys.stdin.read().strip()
has_results = bool(results) and 'No results found' not in results
with open(sys.argv[2], 'w') as f:
    json.dump({
        'query': query,
        'timestamp': int(time.time()),
        'results': results if has_results else None
    }, f)
" "$VSEARCH_QUERY" "$TMPFILE" <<< "$RESULTS"

mv "$TMPFILE" "$CACHE_FILE"
