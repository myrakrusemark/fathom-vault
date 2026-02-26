#!/usr/bin/env bash
# Fathom PreCompact hook — snapshots vault state before context compaction.
#
# Reads the transcript, extracts any vault file paths mentioned,
# and records which files were active in this session for continuity.

set -euo pipefail

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
HOOK_ENABLED=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('hooks',{}).get('precompact-snapshot',{}).get('enabled','true'))" 2>/dev/null || echo "true")

if [ "$HOOK_ENABLED" != "True" ] && [ "$HOOK_ENABLED" != "true" ]; then
  exit 0
fi

# Read PreCompact input (contains transcript_path)
INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('transcript_path',''))" 2>/dev/null || echo "")

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# Extract vault file paths from transcript
VAULT_FILES=$(grep -oP 'vault/[a-zA-Z0-9_/.-]+\.md' "$TRANSCRIPT_PATH" 2>/dev/null | sort -u || echo "")

if [ -z "$VAULT_FILES" ]; then
  exit 0
fi

# Notify server about accessed files (best-effort)
AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
  AUTH_HEADER="Authorization: Bearer $API_KEY"
fi

for FILE in $VAULT_FILES; do
  curl -sf -X POST -H "Content-Type: application/json" -H "$AUTH_HEADER" \
    -d "{\"path\": \"$FILE\"}" \
    "${SERVER}/api/vault/access?workspace=${WORKSPACE}" >/dev/null 2>&1 || true
done

# Output summary
FILE_COUNT=$(echo "$VAULT_FILES" | wc -l)
python3 -c "
import json, sys
result = {
    'systemMessage': 'Fathom: Recorded ${FILE_COUNT} vault file(s) from this session.'
}
json.dump(result, sys.stdout)
"
