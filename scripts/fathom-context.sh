#!/bin/bash
# Fathom's context script — configurable sections and output format.
#
# Usage:
#   fathom-context.sh                              # all sections, plain text (SessionStart)
#   fathom-context.sh --sections time,weather       # just time + weather, plain text
#   fathom-context.sh --sections time,weather --format hook-json   # UserPromptSubmit hook format
#
# Sections: time, weather, dashboard, browser
#   dashboard = startup context (identity, memory systems, vault activity, moltbook, hifathom, memento stats)
#   time      = current date/time
#   weather   = weather from dashboard cache or NOAA fallback
#   browser   = Chrome + debugging status
#
# Formats: plain (default), hook-json (UserPromptSubmit JSON with systemMessage + additionalContext)
#
# Stripped from dashboard output: Last Heartbeat, Recent Sessions, Telegram,
# Last Conversation, Message in a Bottle — noisy/redundant.
# Also stripped: Moltbook Status, hifathom.com, Memento Protocol — these are
# ping-only stats, included via fathom-ping.sh instead.

SECTIONS="all"
FORMAT="plain"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --sections) SECTIONS="$2"; shift 2 ;;
        --format)   FORMAT="$2"; shift 2 ;;
        *) shift ;;
    esac
done

has_section() {
    [[ "$SECTIONS" == "all" ]] || [[ ",$SECTIONS," == *",$1,"* ]]
}

OUTPUT=""

# --- Time ---
if has_section time; then
    NOW=$(date "+%a %b %-d, %-I:%M %p %Z")
    OUTPUT="$NOW"
fi

# --- Weather ---
if has_section weather; then
    WEATHER=""
    # Dashboard cache first
    WX=$(curl -sf -m 1 "http://localhost:4242/api/startup-context" 2>/dev/null)
    if [ -n "$WX" ]; then
        WEATHER=$(echo "$WX" | grep -oP '(?<=☀️|⛅|🌧|🌦|🌩|❄️|🌤|☁️|🌫|🌨|🌪)\s+.*' | head -1 | sed 's/^ *//')
    fi
    # Grep for weather line with temperature pattern as fallback
    if [ -z "$WEATHER" ]; then
        WEATHER=$(echo "$WX" | grep -oP '[+-]?\d+°F.*' | head -1)
    fi
    # NOAA fallback
    if [ -z "$WEATHER" ]; then
        NOAA=$(curl -sf -m 2 "https://api.weather.gov/gridpoints/LSX/100,73/forecast/hourly" \
            -H "User-Agent: fathom-agent" 2>/dev/null)
        if [ -n "$NOAA" ]; then
            WEATHER=$(echo "$NOAA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
p=d['properties']['periods'][0]
print(f\"{p['temperature']}°F, {p['shortForecast'].lower()}\")
" 2>/dev/null)
        fi
    fi
    if [ -n "$WEATHER" ]; then
        if [ -n "$OUTPUT" ]; then
            OUTPUT="$OUTPUT | $WEATHER"
        else
            OUTPUT="$WEATHER"
        fi
    fi
fi

# --- Dashboard (startup context, filtered) ---
if has_section dashboard; then
    RESPONSE=$(curl -s --max-time 5 http://localhost:4242/api/startup-context 2>/dev/null)

    if [ -z "$RESPONSE" ]; then
        sleep 2
        RESPONSE=$(curl -s --max-time 5 http://localhost:4242/api/startup-context 2>/dev/null)
    fi

    if [ -z "$RESPONSE" ]; then
        fathom-dashboard up >/dev/null 2>&1
        for i in 1 2 3 4 5; do
            sleep 2
            RESPONSE=$(curl -s --max-time 5 http://localhost:4242/api/startup-context 2>/dev/null)
            [ -n "$RESPONSE" ] && break
        done
    fi

    if [ -n "$RESPONSE" ]; then
        # Strip noisy/redundant sections from dashboard output
        RESPONSE=$(echo "$RESPONSE" | python3 -c "
import sys, re
text = sys.stdin.read()
# Remove sections by ### header
sections_to_remove = [
    r'### Last Heartbeat.*?(?=###|\Z)',
    r'### Recent Sessions.*?(?=###|\Z)',
    r'### Telegram.*?(?=###|\Z)',
    r'### Last Conversation.*?(?=###|\Z)',
    r'### Message in a Bottle.*?(?=###|\Z)',
    r'### Moltbook Status.*?(?=###|\Z)',
    r'### hifathom\.com.*?(?=###|\Z)',
    r'### Memento Protocol.*?(?=###|\Z)',
]
for pattern in sections_to_remove:
    text = re.sub(pattern, '', text, flags=re.DOTALL)
# Clean up extra blank lines
text = re.sub(r'\n{3,}', '\n\n', text).strip()
print(text)
")
        if [ -n "$OUTPUT" ]; then
            OUTPUT="$OUTPUT"$'\n\n'"$RESPONSE"
        else
            OUTPUT="$RESPONSE"
        fi
    else
        FALLBACK="=== Fathom's Dynamic Context ($(date '+%Y-%m-%d %H:%M %Z')) ==="$'\n\n'
        FALLBACK+="### Dashboard failed to start"$'\n\n'
        FALLBACK+="Tried fathom-dashboard up but couldn't connect. Check /tmp/fathom-dashboard.log"$'\n\n'
        FALLBACK+="=== End Dynamic Context ==="
        if [ -n "$OUTPUT" ]; then
            OUTPUT="$OUTPUT"$'\n\n'"$FALLBACK"
        else
            OUTPUT="$FALLBACK"
        fi
    fi
fi

# --- Browser ---
if has_section browser; then
    BROWSER_STATUS=""
    if pgrep -a chrome 2>/dev/null | grep -q "remote-debugging" && curl -sf -m 1 http://localhost:9222/json/version > /dev/null 2>&1; then
        BROWSER_STATUS="### Browser Status
Chrome is running with remote debugging. Use mcp__chrome-devtools__* tools for browser automation."
    else
        BROWSER_STATUS="### Browser Status
Chrome debugging not available. Start with: google-chrome --remote-debugging-port=9222 &"
    fi
    if [ -n "$OUTPUT" ]; then
        OUTPUT="$OUTPUT"$'\n\n'"$BROWSER_STATUS"
    else
        OUTPUT="$BROWSER_STATUS"
    fi
fi

# --- Pre-warm vsearch models (only on full context / SessionStart) ---
if has_section dashboard; then
    (cat /home/myra/.cache/qmd/models/*.gguf > /dev/null 2>&1) &
fi

# --- Output ---
if [ "$FORMAT" = "hook-json" ]; then
    python3 -c "
import json, sys
text = sys.argv[1]
print(json.dumps({
    'systemMessage': text,
    'hookSpecificOutput': {
        'hookEventName': 'UserPromptSubmit',
        'additionalContext': text
    }
}))
" "$OUTPUT"
else
    echo "$OUTPUT"
fi
