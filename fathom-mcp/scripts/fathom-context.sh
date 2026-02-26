#!/usr/bin/env bash
# Fathom SessionStart/UserPromptSubmit hook — injects vault context.
#
# Reads .fathom.json to find vault path and server URL.
# On SessionStart: injects recent heartbeat + active vault folders.
# On UserPromptSubmit: searches vault for relevant context.

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

# Extract config values
WORKSPACE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('workspace',''))" 2>/dev/null || echo "")
SERVER=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('server','http://localhost:4243'))" 2>/dev/null || echo "http://localhost:4243")
API_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiKey',''))" 2>/dev/null || echo "")
HOOK_ENABLED=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('hooks',{}).get('context-inject',{}).get('enabled','true'))" 2>/dev/null || echo "true")

if [ "$HOOK_ENABLED" != "True" ] && [ "$HOOK_ENABLED" != "true" ]; then
  exit 0
fi

# Read user prompt from stdin (if UserPromptSubmit)
INPUT=$(cat)

# Build auth header
AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
  AUTH_HEADER="Authorization: Bearer $API_KEY"
fi

# Try to get recent vault activity from server
CONTEXT=""
if [ -n "$SERVER" ]; then
  ACTIVITY=$(curl -sf -H "$AUTH_HEADER" \
    "${SERVER}/api/vault/activity?workspace=${WORKSPACE}&limit=5" 2>/dev/null || echo "")
  if [ -n "$ACTIVITY" ]; then
    CONTEXT="Recent vault activity:\n$ACTIVITY"
  fi
fi

if [ -n "$CONTEXT" ]; then
  # Output as hook response
  python3 -c "
import json, sys
result = {
    'hookSpecificOutput': {
        'additionalContext': '''$CONTEXT'''
    }
}
json.dump(result, sys.stdout)
"
fi
