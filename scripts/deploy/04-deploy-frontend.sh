#!/usr/bin/env bash
# Step 04: Deploy frontend to Cloudflare Pages via wrangler
# Builds with @cloudflare/next-on-pages, then deploys with wrangler

source "$(dirname "$0")/_common.sh"
load_secrets
start_timer

echo "=== Step 04: Deploying Frontend (Cloudflare Pages) ==="
echo ""

cd "$PROJECT_ROOT/frontend"

require_cmd npx

# Export Cloudflare credentials for wrangler
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID

# Back up .env.local if it exists (avoid leaking dev vars into CF build)
if [[ -f .env.local ]]; then
  mv .env.local .env.local.bak
  trap 'mv -f .env.local.bak .env.local 2>/dev/null || true' EXIT
fi

# Generate build-info.json for frontend version tracking.
# This becomes a static file at cm.hcizero.com/build-info.json.
# Also done in 02-build.sh, but repeated here because step 04 does its
# own full rebuild via @cloudflare/next-on-pages (separate from step 02).
echo "--- Generating frontend build-info.json ---"
BUILD_COMMIT_SHA=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)
BUILD_COMMIT_FULL=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
BUILD_COMMIT_MSG=$(git -C "$PROJECT_ROOT" log -1 --format='%s' HEAD)
BUILD_BRANCH=$(git -C "$PROJECT_ROOT" branch --show-current)
BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > public/build-info.json <<BUILDEOF
{
  "commitSha": "$BUILD_COMMIT_SHA",
  "commitFull": "$BUILD_COMMIT_FULL",
  "commitMessage": "$BUILD_COMMIT_MSG",
  "branch": "$BUILD_BRANCH",
  "buildTimestamp": "$BUILD_TIMESTAMP"
}
BUILDEOF

echo "Build info: $BUILD_COMMIT_SHA ($BUILD_BRANCH) at $BUILD_TIMESTAMP"

# Export NEXT_PUBLIC_* vars so they're baked into the client bundle
export NEXT_PUBLIC_BUILD_COMMIT="$BUILD_COMMIT_SHA"
export NEXT_PUBLIC_BUILD_TIMESTAMP="$BUILD_TIMESTAMP"

# Build for Cloudflare Pages
echo "--- Building with @cloudflare/next-on-pages ---"
build_output=$(npx @cloudflare/next-on-pages 2>&1) || {
  duration=$(elapsed_seconds)
  echo "$build_output"
  tail_text=$(json_escape "$(echo "$build_output" | tail -10)")
  emit_result "04-deploy-frontend" "failure" "$duration" \
    "Cloudflare Pages build failed (@cloudflare/next-on-pages)" \
    "{\"stage\": \"build\", \"output_tail\": \"$tail_text\"}"
  exit 1
}
echo "$build_output"

# Deploy to Cloudflare Pages
echo ""
echo "--- Deploying to Cloudflare Pages ---"
deploy_output=$(npx wrangler pages deploy .vercel/output/static \
  --project-name coordination-matrix --branch prod --commit-dirty=true 2>&1) || {
  duration=$(elapsed_seconds)
  echo "$deploy_output"
  tail_text=$(json_escape "$(echo "$deploy_output" | tail -10)")
  emit_result "04-deploy-frontend" "failure" "$duration" \
    "Cloudflare Pages deploy failed (wrangler)" \
    "{\"stage\": \"deploy\", \"output_tail\": \"$tail_text\"}"
  exit 1
}
echo "$deploy_output"

# Extract deployment URL from wrangler output
deploy_url=$(echo "$deploy_output" | grep -oE 'https://[a-z0-9-]+\.coordination-matrix\.pages\.dev' | head -1 || echo "")

# Restore .env.local
if [[ -f .env.local.bak ]]; then
  mv .env.local.bak .env.local
  trap - EXIT
fi

duration=$(elapsed_seconds)
emit_result "04-deploy-frontend" "success" "$duration" \
  "Frontend deployed to Cloudflare Pages" \
  "{\"deploy_url\": \"${deploy_url:-unknown}\"}"
