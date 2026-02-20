#!/usr/bin/env bash
# Step 01: Run all test suites
# Runs backend and frontend vitest tests in non-watch mode

source "$(dirname "$0")/_common.sh"
start_timer

echo "=== Step 01: Running Tests ==="
echo ""

cd "$PROJECT_ROOT"

# Run backend tests
echo "--- Running backend tests ---"
backend_output=$(cd backend && npx vitest run 2>&1) || {
  duration=$(elapsed_seconds)
  echo "$backend_output"
  tail_text=$(json_escape "$(echo "$backend_output" | tail -10)")
  emit_result "01-test" "failure" "$duration" "Backend tests failed" \
    "{\"failed_suite\": \"backend\", \"output_tail\": \"$tail_text\"}"
  exit 1
}
echo "$backend_output"

# Extract test counts from vitest output
backend_passed=$(echo "$backend_output" | grep -oE 'Tests\s+[0-9]+\s+passed' | grep -oE '[0-9]+' || echo "0")

# Run frontend tests
echo ""
echo "--- Running frontend tests ---"
frontend_output=$(cd frontend && npx vitest run 2>&1) || {
  duration=$(elapsed_seconds)
  echo "$frontend_output"
  tail_text=$(json_escape "$(echo "$frontend_output" | tail -10)")
  emit_result "01-test" "failure" "$duration" "Frontend tests failed" \
    "{\"failed_suite\": \"frontend\", \"backend_passed\": $backend_passed, \"output_tail\": \"$tail_text\"}"
  exit 1
}
echo "$frontend_output"

frontend_passed=$(echo "$frontend_output" | grep -oE 'Tests\s+[0-9]+\s+passed' | grep -oE '[0-9]+' || echo "0")

duration=$(elapsed_seconds)
total=$((backend_passed + frontend_passed))
emit_result "01-test" "success" "$duration" \
  "All tests passed ($total total: $backend_passed backend, $frontend_passed frontend)" \
  "{\"backend_passed\": $backend_passed, \"frontend_passed\": $frontend_passed, \"total\": $total}"
