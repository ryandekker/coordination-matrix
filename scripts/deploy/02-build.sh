#!/usr/bin/env bash
# Step 02: Build backend (tsc) and frontend (next build)
# Validates that code compiles cleanly before deploying

source "$(dirname "$0")/_common.sh"
start_timer

echo "=== Step 02: Building ==="
echo ""

cd "$PROJECT_ROOT"

# Build backend
echo "--- Building backend (tsc) ---"
backend_output=$(cd backend && npm run build 2>&1) || {
  duration=$(elapsed_seconds)
  echo "$backend_output"
  tail_text=$(json_escape "$(echo "$backend_output" | tail -10)")
  emit_result "02-build" "failure" "$duration" "Backend build failed (tsc)" \
    "{\"failed_component\": \"backend\", \"output_tail\": \"$tail_text\"}"
  exit 1
}
echo "$backend_output"
echo "Backend build complete."

# Build frontend
echo ""
echo "--- Building frontend (next build) ---"
frontend_output=$(cd frontend && npm run build 2>&1) || {
  duration=$(elapsed_seconds)
  echo "$frontend_output"
  tail_text=$(json_escape "$(echo "$frontend_output" | tail -10)")
  emit_result "02-build" "failure" "$duration" "Frontend build failed (next build)" \
    "{\"failed_component\": \"frontend\", \"output_tail\": \"$tail_text\"}"
  exit 1
}
echo "$frontend_output"
echo "Frontend build complete."

duration=$(elapsed_seconds)
emit_result "02-build" "success" "$duration" \
  "Both backend and frontend built successfully" \
  "{\"backend\": \"tsc compiled\", \"frontend\": \"next build complete\"}"
