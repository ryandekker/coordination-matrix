#!/usr/bin/env bash
# Step 06: Post-deploy verification
# Checks backend health, frontend accessibility, API functionality, migration status

source "$(dirname "$0")/_common.sh"
load_secrets
start_timer

echo "=== Step 06: Post-Deploy Verification ==="
echo ""

require_cmd curl
require_cmd jq

checks_passed=0
checks_failed=0
check_details=""

run_check() {
  local name="$1"
  local result="$2"
  local pass="$3"  # "true" or "false"

  if [[ "$pass" == "true" ]]; then
    checks_passed=$((checks_passed + 1))
    echo "  PASS: $name"
  else
    checks_failed=$((checks_failed + 1))
    echo "  FAIL: $name -- $result"
  fi

  local escaped_result
  escaped_result=$(json_escape "$result")
  if [[ -n "$check_details" ]]; then
    check_details="$check_details,"
  fi
  check_details="$check_details{\"name\":\"$name\",\"pass\":$pass,\"detail\":\"$escaped_result\"}"
}

# Check 1: Backend health endpoint
# NOTE: In production, cm.hcizero.com serves the frontend (Cloudflare Pages)
# at the root and proxies /api/* to the backend (Render). The backend's /health
# endpoint is only reachable via the Render service URL directly, not through
# the Cloudflare proxy. Use /api/tasks with auth as the backend liveness check.
echo "--- Checking backend health ---"
if [[ -n "${RENDER_HEALTH_URL:-}" ]]; then
  # Direct Render health check (bypasses Cloudflare)
  health_response=$(curl -sL -o /dev/stdout -w "\n%{http_code}" \
    --max-time 10 "$RENDER_HEALTH_URL/health" 2>/dev/null) || true
  http_code=$(echo "$health_response" | tail -1)
  health_body=$(echo "$health_response" | sed '$d')

  if [[ "$http_code" == "200" ]]; then
    health_status=$(echo "$health_body" | jq -r '.status' 2>/dev/null || echo "")
    if [[ "$health_status" == "healthy" ]]; then
      run_check "Backend health" "status=healthy" "true"
    else
      run_check "Backend health" "Unexpected status: $health_status" "false"
    fi
  else
    run_check "Backend health" "HTTP $http_code (via Render URL)" "false"
  fi
else
  echo "  SKIP: No RENDER_HEALTH_URL configured, backend health checked via API below"
fi

# Check 2: Frontend accessibility
echo "--- Checking frontend ---"
fe_code=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 "$PROD_FRONTEND_URL" 2>/dev/null) || true
if [[ "$fe_code" == "200" ]]; then
  run_check "Frontend accessible" "HTTP 200" "true"
else
  run_check "Frontend accessible" "HTTP $fe_code" "false"
fi

# Check 3: Backend API responds (with auth if API key available)
echo "--- Checking API endpoint ---"
if [[ -n "${PROD_API_KEY:-}" ]]; then
  api_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 -H "X-API-Key: $PROD_API_KEY" \
    "$PROD_BACKEND_URL/api/tasks?limit=1" 2>/dev/null) || true
  if [[ "$api_code" == "200" ]]; then
    run_check "API authenticated request" "HTTP 200" "true"
  else
    run_check "API authenticated request" "HTTP $api_code" "false"
  fi
else
  echo "  SKIP: No PROD_API_KEY configured, skipping authenticated API check"
fi

# Check 4: Migration status (verify no pending migrations remain)
echo "--- Checking migration status ---"
if [[ -n "${MONGODB_URI:-}" ]]; then
  export MONGODB_URI
  migrate_status=$(cd "$PROJECT_ROOT/backend" && npx tsx src/migrations/cli.ts status 2>&1) || true
  pending=$(echo "$migrate_status" | grep -c '○' || echo "0")
  if [[ "$pending" -eq 0 ]]; then
    run_check "No pending migrations" "All migrations applied" "true"
  else
    run_check "No pending migrations" "$pending still pending" "false"
  fi
else
  echo "  SKIP: No MONGODB_URI configured, skipping migration check"
fi

# Summary
echo ""
total=$((checks_passed + checks_failed))
duration=$(elapsed_seconds)

if [[ $checks_failed -eq 0 ]]; then
  echo "All $checks_passed checks passed."
  emit_result "06-verify" "success" "$duration" \
    "All $checks_passed verification checks passed" \
    "{\"passed\": $checks_passed, \"failed\": $checks_failed, \"checks\": [$check_details]}"
else
  echo "$checks_failed of $total checks failed."
  emit_result "06-verify" "failure" "$duration" \
    "$checks_failed of $total verification checks failed" \
    "{\"passed\": $checks_passed, \"failed\": $checks_failed, \"checks\": [$check_details]}"
  exit 1
fi
