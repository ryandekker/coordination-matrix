#!/usr/bin/env bash
# Common deployment utilities - sourced by all deploy scripts

set -euo pipefail

# Resolve paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SECRETS_FILE="$PROJECT_ROOT/.deploy-secrets"

# Load secrets from .deploy-secrets
load_secrets() {
  if [[ ! -f "$SECRETS_FILE" ]]; then
    echo "ERROR: $SECRETS_FILE not found." >&2
    echo "Copy .deploy-secrets.example to .deploy-secrets and fill in values." >&2
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
  set +a
}

# Emit structured result for agent parsing
# Usage: emit_result "01-test" "success" 42 "All tests passed" '{"tests":47}'
emit_result() {
  local step="$1"
  local status="$2"
  local duration="$3"
  local summary="$4"
  local details="${5:-{}}"
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  cat <<RESULT_EOF

===DEPLOY_STEP_RESULT===
{
  "step": "$step",
  "status": "$status",
  "duration_seconds": $duration,
  "summary": "$summary",
  "details": $details,
  "timestamp": "$timestamp"
}
===END_DEPLOY_STEP_RESULT===
RESULT_EOF
}

# Timer helpers
start_timer() {
  DEPLOY_START_TIME=$(date +%s)
}

elapsed_seconds() {
  local now
  now=$(date +%s)
  echo $(( now - DEPLOY_START_TIME ))
}

# Check if a command exists
require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: Required command '$1' not found." >&2
    exit 1
  fi
}

# Escape a string for safe JSON embedding
json_escape() {
  local str="$1"
  str="${str//\\/\\\\}"
  str="${str//\"/\\\"}"
  str="$(echo "$str" | tr '\n' ' ' | tr '\r' ' ')"
  echo "$str"
}
