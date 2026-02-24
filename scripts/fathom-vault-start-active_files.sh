#!/bin/bash
# fathom-vault-start-active_files.sh
# SessionStart hook — injects active vault files (by access score) into startup context.
# Nomenclature: [tool]-[hook]-[function] → fathom-vault / start / active_files
#
# Output: plain text → appears as system-reminder in Claude's context.
# Silent on failure (vault server may not be running).

ACTIVE=$(curl -sf -m 2 "http://localhost:4243/api/vault/activity?limit=5" 2>/dev/null)

if [ -z "$ACTIVE" ]; then
    exit 0
fi

python3 -c "
import json, sys, time

data = json.load(sys.stdin)
files = data.get('files', data) if isinstance(data, dict) else data
if not files:
    sys.exit(0)

now = time.time()

def rel_time(ts):
    if not ts: return '?'
    diff = now - float(ts)
    if diff < 3600: return f'{int(diff/60)}m ago'
    if diff < 86400: return f'{int(diff/3600)}h ago'
    return f'{int(diff/86400)}d ago'

def heat(score):
    if score > 1.5: return '🔥'
    if score >= 0.5: return '🌡'
    return '❄'

print('### Active Vault Files')
for f in files:
    icon = heat(f.get('score', 0))
    path = f.get('path', '')
    score = f.get('score', 0)
    last = rel_time(f.get('last_opened'))
    print(f'{icon} {path} ({score:.2f}, {last})')
" <<< "$ACTIVE" 2>/dev/null

exit 0
