#!/usr/bin/env bash
# Step 06: Post-deploy verification
# Checks backend health, frontend accessibility, API functionality,
# deploy version identifiers, and migration status.
#
# Production URL routing (important for understanding these checks):
#   cm.hcizero.com/*       → Cloudflare Pages (frontend)
#   cm.hcizero.com/api/*   → Render (backend, proxied through Cloudflare)
#
# Health endpoints:
#   /api/health            → Backend (public, no auth) — returns status + version
#   /build-info.json       → Frontend (static file) — returns commit + build time

source "$(dirname "$0")/_common.sh"
load_secrets
start_timer

echo "=== Step 06: Post-Deploy Verification ==="
echo ""

require_cmd curl
require_cmd jq

# The commit we just deployed (set by 03-deploy-backend.sh or read from git)
EXPECTED_COMMIT=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)
echo "Expected commit: $EXPECTED_COMMIT"
echo ""

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

# Check 1: Backend health via /api/health (public, no auth needed)
echo "--- Checking backend health (/api/health) ---"
health_response=$(curl -s -o /dev/stdout -w "\n%{http_code}" \
  --max-time 15 "$PROD_BACKEND_URL/api/health" 2>/dev/null) || true
http_code=$(echo "$health_response" | tail -1)
health_body=$(echo "$health_response" | sed '$d')

if [[ "$http_code" == "200" ]]; then
  health_status=$(echo "$health_body" | jq -r '.status' 2>/dev/null || echo "")
  if [[ "$health_status" == "healthy" ]]; then
    backend_commit=$(echo "$health_body" | jq -r '.version.commitSha // empty' 2>/dev/null)
    if [[ -n "$backend_commit" ]]; then
      run_check "Backend health" "status=healthy, commit=$backend_commit" "true"
    else
      run_check "Backend health" "status=healthy (no version info)" "true"
    fi
  else
    run_check "Backend health" "Unexpected status: $health_status" "false"
  fi
else
  run_check "Backend health" "HTTP $http_code at $PROD_BACKEND_URL/api/health" "false"
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

# Check 3: Frontend version via /build-info.json (static file)
echo "--- Checking frontend version (/build-info.json) ---"
fe_version_response=$(curl -s -o /dev/stdout -w "\n%{http_code}" \
  --max-time 10 "$PROD_BACKEND_URL/build-info.json" 2>/dev/null) || true
fe_version_code=$(echo "$fe_version_response" | tail -1)
fe_version_body=$(echo "$fe_version_response" | sed '$d')

if [[ "$fe_version_code" == "200" ]]; then
  frontend_commit=$(echo "$fe_version_body" | jq -r '.commitSha // empty' 2>/dev/null)
  if [[ -n "$frontend_commit" ]]; then
    run_check "Frontend version" "commit=$frontend_commit" "true"
  else
    run_check "Frontend version" "build-info.json exists but no commitSha" "false"
  fi
else
  run_check "Frontend version" "HTTP $fe_version_code (build-info.json not found)" "false"
fi

# Check 4: Backend API responds (with auth if API key available)
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

# Check 5: Version match — compare deployed commits against expected
echo "--- Checking deploy version match ---"
version_mismatches=""
if [[ -n "${backend_commit:-}" && "$backend_commit" != "$EXPECTED_COMMIT" ]]; then
  version_mismatches="backend(got=$backend_commit, expected=$EXPECTED_COMMIT)"
fi
if [[ -n "${frontend_commit:-}" && "$frontend_commit" != "$EXPECTED_COMMIT" ]]; then
  if [[ -n "$version_mismatches" ]]; then version_mismatches="$version_mismatches, "; fi
  version_mismatches="${version_mismatches}frontend(got=$frontend_commit, expected=$EXPECTED_COMMIT)"
fi

if [[ -z "$version_mismatches" && -n "${backend_commit:-}" && -n "${frontend_commit:-}" ]]; then
  run_check "Version match" "backend=$backend_commit, frontend=$frontend_commit" "true"
elif [[ -n "$version_mismatches" ]]; then
  run_check "Version match" "Mismatch: $version_mismatches" "false"
else
  echo "  SKIP: Version info not available from one or both services"
fi

# Check 6: Migration status (verify no pending migrations remain)
echo "--- Checking migration status ---"
if [[ -n "${MONGODB_URI:-}" ]]; then
  export MONGODB_URI
  export MONGODB_ADMIN_URI
  migrate_status=$(cd "$PROJECT_ROOT/backend" && npx tsx src/migrations/cli.ts status 2>&1) || true
  pending=$(echo "$migrate_status" | grep -c '○' 2>/dev/null || true)
  pending="${pending:-0}"
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
