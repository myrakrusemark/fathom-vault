#!/bin/bash
# Shared JSONL→text parser for conversation transcripts
# Usage: parse-transcript.sh <transcript_path>
# Outputs formatted conversation to stdout
#
# PERFORMANCE: Single jq invocation processes entire JSONL stream.
# Previous version used a bash while-loop calling jq 3-5x per line — O(n*5) subprocesses.
# This version: O(1) subprocess regardless of transcript length.

TRANSCRIPT_PATH="$1"

if [ ! -f "$TRANSCRIPT_PATH" ]; then
    exit 1
fi

# Single jq pass over entire JSONL file
# Uses -R (raw input) + fromjson? to gracefully skip malformed lines
jq -R -r '
fromjson? |

# Format ISO timestamp to HH:MM dd/mm (UTC — no timezone conversion needed for snapshots)
def fmt_ts:
  if . == null or . == "" then "??:??"
  else
    (split("T") |
      if length > 1 then
        (.[1] | split(".")[0] | split(":")[0:2] | join(":")) + " " +
        (.[0] | split("-") | [.[2], .[1]] | join("/"))
      else "??:??" end)
  end;

(.timestamp // null | fmt_ts) as $ts |

if .type == "user" then
  (.message.content |
    if type == "string" then .
    elif type == "array" then [.[] | select(.type == "text") | .text] | join("\n")
    else null end
  ) as $content |
  if $content != null and $content != "" then
    "[Myra - \($ts)]: \($content)\n"
  else empty end

elif .type == "assistant" then
  ([.message.content[]? | select(.type == "text") | .text] | join("\n")) as $content |
  ([.message.content[]? | select(.type == "tool_use") | .name] | join(", ")) as $tools |
  (
    (if $content != "" and $content != "null" then "[Fathom - \($ts)]: \($content)\n" else "" end) +
    (if $tools != "" then "[Tool - \($ts)]: \($tools)\n" else "" end)
  ) | if . != "" then . else empty end

else empty end
' "$TRANSCRIPT_PATH"
