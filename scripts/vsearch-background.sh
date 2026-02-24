#!/bin/bash
# Background vector search worker for memory-recall hook.
# Launched via nohup/disown — runs asynchronously after the hook returns.
#
# Takes a search query as $1, runs qmd vsearch against the fathom-curated
# collection, and writes results as JSON to /tmp/fathom-vsearch-cache.json.
#
# Safety guards:
# - Lock file prevents multiple concurrent vsearch processes
# - 180-second hard timeout on qmd vsearch
# - Atomic write (temp file + mv) prevents partial cache reads
# - Lock auto-cleaned on exit via trap

set -o pipefail

LOCK_FILE="/tmp/fathom-vsearch.lock"
CACHE_FILE="/tmp/fathom-vsearch-cache.json"

cleanup() {
    rm -f "$LOCK_FILE"
}
trap cleanup EXIT

# Bail if no query provided
if [ -z "$1" ]; then
    exit 1
fi

# Create lock file with our PID
echo $$ > "$LOCK_FILE"

# Truncate query to 200 chars for vsearch (long queries degrade quality)
VSEARCH_QUERY="${1:0:200}"

# Run vsearch with 180-second hard timeout
RESULTS=$(timeout 180 qmd vsearch "$VSEARCH_QUERY" -n 5 -c fathom-curated --min-score 0.5 2>/dev/null)

# Write results as JSON to temp file, then atomically move to cache path
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

# Atomic rename — readers either see old cache or new cache, never partial
mv "$TMPFILE" "$CACHE_FILE"
