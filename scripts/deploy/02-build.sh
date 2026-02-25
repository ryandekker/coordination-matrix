#!/usr/bin/env bash
# Step 02: Build backend (tsc) and frontend (next build)
# Validates that code compiles cleanly before deploying

source "$(dirname "$0")/_common.sh"
start_timer

echo "=== Step 02: Building ==="
echo ""

cd "$PROJECT_ROOT"

# Generate build-info.json with git metadata for version tracking.
# Both backend and frontend read this to expose deploy identifiers
# via /api/health (backend) and /build-info.json (frontend static).
echo "--- Generating build-info.json ---"
BUILD_COMMIT_SHA=$(git rev-parse --short HEAD)
BUILD_COMMIT_FULL=$(git rev-parse HEAD)
BUILD_COMMIT_MSG=$(git log -1 --format='%s' HEAD)
BUILD_BRANCH=$(git branch --show-current)
BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

BUILD_INFO=$(cat <<BUILDEOF
{
  "commitSha": "$BUILD_COMMIT_SHA",
  "commitFull": "$BUILD_COMMIT_FULL",
  "commitMessage": "$BUILD_COMMIT_MSG",
  "branch": "$BUILD_BRANCH",
  "buildTimestamp": "$BUILD_TIMESTAMP"
}
BUILDEOF
)

echo "$BUILD_INFO" > backend/build-info.json
echo "$BUILD_INFO" > frontend/public/build-info.json
echo "Build info: $BUILD_COMMIT_SHA ($BUILD_BRANCH) at $BUILD_TIMESTAMP"

# Export for Next.js NEXT_PUBLIC_* env vars (baked into client bundle)
export NEXT_PUBLIC_BUILD_COMMIT="$BUILD_COMMIT_SHA"
export NEXT_PUBLIC_BUILD_TIMESTAMP="$BUILD_TIMESTAMP"

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
