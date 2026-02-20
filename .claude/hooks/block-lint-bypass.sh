#!/bin/bash
# block-lint-bypass.sh
#
# PreToolUse hook for Bash commands.
# Blocks attempts to bypass linting, verification, or type checking.
#
# Blocked patterns:
#   - git commit --no-verify / -n
#   - eslint --no-eslintrc or disabling rules
#   - Environment vars that disable ESLint
#   - tsc skip flags

INPUT=$(cat)

# Extract command - try jq first, fall back to node
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
else
  COMMAND=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input?.command||'')}catch{console.log('')}})
  ")
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Block --no-verify on git commit
if echo "$COMMAND" | grep -qE 'git\s+commit.*--no-verify|git\s+commit.*\s-n\b'; then
  echo "--no-verify is not allowed. Commit without bypassing hooks. If pre-commit checks fail, fix the issues first." >&2
  exit 2
fi

# Block eslint --no-eslintrc or disabling rules entirely
if echo "$COMMAND" | grep -qE 'eslint\s.*--no-eslintrc|eslint\s.*--rule\s.*off|eslint\s.*--rule\s.*\b0\b'; then
  echo "Disabling ESLint rules is not allowed. Fix the lint issues instead of bypassing them." >&2
  exit 2
fi

# Block environment variables that disable ESLint
if echo "$COMMAND" | grep -qE 'ESLINT_NO_DEV_ERRORS=true|NEXT_DISABLE_ESLINT=true|DISABLE_ESLINT_PLUGIN=true'; then
  echo "Disabling ESLint via environment variables is not allowed. Fix the lint issues instead." >&2
  exit 2
fi

# Block tsc skip flags that circumvent type checking
if echo "$COMMAND" | grep -qE 'tsc\s.*--noCheck'; then
  echo "Skipping TypeScript type checking is not allowed." >&2
  exit 2
fi

# Block eslint-disable comments being added via sed/echo (agent workaround attempts)
if echo "$COMMAND" | grep -qE "eslint-disable-next-line|eslint-disable\s|@ts-ignore|@ts-nocheck"; then
  echo "Adding eslint-disable or @ts-ignore comments via shell commands is not allowed. Fix the underlying issue." >&2
  exit 2
fi

exit 0
