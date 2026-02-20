#!/bin/bash
# post-edit-check.sh
#
# PostToolUse hook for Edit|Write tool calls.
# Runs fast, cheap checks on the edited file immediately after modification.
# Full validation (tsc, eslint, tests) is handled by: npm run check
#
# Checks:
#   1. Merge conflict markers in the edited file
#   2. Sensitive file detection (.env, credentials, etc.)

INPUT=$(cat)

# Extract file path - try jq first, fall back to node
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
else
  FILE_PATH=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input?.file_path||'')}catch{console.log('')}})
  ")
fi

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Determine relative path for reporting
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

ISSUES=""

# --- Check 1: Merge conflict markers ---
if grep -qE '^(<{7}|={7}|>{7})' "$FILE_PATH" 2>/dev/null; then
  ISSUES="${ISSUES}Unresolved merge conflict markers found in ${REL_PATH}. "
fi

# --- Check 2: Sensitive file detection ---
BASENAME=$(basename "$FILE_PATH")
case "$BASENAME" in
  .env|.env.*|*.pem|*.key|*.cert|*.p12|*.pfx|credentials.json|secrets.json|*.secret)
    ISSUES="${ISSUES}Sensitive file modified: ${REL_PATH}. Ensure this is not committed to version control. "
    ;;
esac

# --- Check 3: Accidental binary/large file ---
FILE_SIZE=$(wc -c < "$FILE_PATH" 2>/dev/null | tr -d ' ')
if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt 524288 ]; then
  SIZE_KB=$((FILE_SIZE / 1024))
  ISSUES="${ISSUES}Large file (${SIZE_KB}KB): ${REL_PATH}. Consider if this should be committed. "
fi

# --- Report results ---
if [ -n "$ISSUES" ]; then
  # Return structured JSON to feed back to Claude
  # PostToolUse uses "decision": "block" with "reason" for feedback
  REASON=$(echo "$ISSUES" | sed 's/"/\\"/g')
  echo "{\"decision\": \"block\", \"reason\": \"Post-edit check: ${REASON}Please review and fix before continuing.\"}"
  exit 0
fi

exit 0
