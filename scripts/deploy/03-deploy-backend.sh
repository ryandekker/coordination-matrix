#!/usr/bin/env bash
# Step 03: Deploy backend to Render
# Merges main -> prod branch and pushes, then polls Render API for deploy status

source "$(dirname "$0")/_common.sh"
load_secrets
start_timer

echo "=== Step 03: Deploying Backend (Render) ==="
echo ""

cd "$PROJECT_ROOT"

require_cmd git
require_cmd curl
require_cmd jq

# Save current branch to return to later
current_branch=$(git branch --show-current)
echo "Current branch: $current_branch"

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  duration=$(elapsed_seconds)
  emit_result "03-deploy-backend" "failure" "$duration" \
    "Uncommitted changes detected. Commit or stash before deploying." \
    "{\"reason\": \"dirty_working_tree\"}"
  exit 1
fi

# Record the commit we're deploying
deploy_commit=$(git rev-parse --short HEAD)
deploy_commit_full=$(git rev-parse HEAD)
deploy_message=$(git log -1 --format='%s' HEAD)
echo "Deploying commit: $deploy_commit ($deploy_message)"

# Merge main into prod
echo ""
echo "--- Merging into prod ---"
git fetch origin prod 2>/dev/null || true

git checkout prod || {
  duration=$(elapsed_seconds)
  emit_result "03-deploy-backend" "failure" "$duration" \
    "Failed to checkout prod branch" \
    "{\"reason\": \"checkout_failed\"}"
  exit 1
}

git merge "$current_branch" --no-edit || {
  duration=$(elapsed_seconds)
  git merge --abort 2>/dev/null || true
  git checkout "$current_branch" 2>/dev/null
  emit_result "03-deploy-backend" "failure" "$duration" \
    "Merge conflict: $current_branch -> prod" \
    "{\"reason\": \"merge_conflict\"}"
  exit 1
}

# Push prod
echo ""
echo "--- Pushing prod branch ---"
git push origin prod || {
  duration=$(elapsed_seconds)
  git checkout "$current_branch" 2>/dev/null
  emit_result "03-deploy-backend" "failure" "$duration" \
    "Failed to push prod branch" \
    "{\"reason\": \"push_failed\"}"
  exit 1
}

# Return to original branch
git checkout "$current_branch" 2>/dev/null || git checkout main

echo ""
echo "Pushed to prod. Waiting for Render to start deploy..."

# Poll Render API for deploy status
RENDER_API="https://api.render.com/v1"
MAX_WAIT=300  # 5 minutes max
POLL_INTERVAL=15
waited=0
deploy_status=""
deploy_id=""

sleep 10  # Give Render a moment to detect the push

while [[ $waited -lt $MAX_WAIT ]]; do
  deploy_info=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
    "$RENDER_API/services/$RENDER_SERVICE_ID/deploys?limit=1" 2>/dev/null)

  if [[ -z "$deploy_info" ]]; then
    echo "  Warning: Could not reach Render API, retrying..."
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
    continue
  fi

  # Render API returns array of {deploy:{...}} objects
  deploy_status=$(echo "$deploy_info" | jq -r '.[0].deploy.status // .[0].status // empty' 2>/dev/null)
  deploy_id=$(echo "$deploy_info" | jq -r '.[0].deploy.id // .[0].id // empty' 2>/dev/null)

  echo "  Render deploy status: ${deploy_status:-unknown} (waited ${waited}s)"

  case "$deploy_status" in
    "live")
      duration=$(elapsed_seconds)
      emit_result "03-deploy-backend" "success" "$duration" \
        "Backend deployed to Render (commit $deploy_commit)" \
        "{\"deploy_id\": \"$deploy_id\", \"commit\": \"$deploy_commit\", \"render_status\": \"live\"}"
      exit 0
      ;;
    "deactivated"|"build_failed"|"update_failed"|"canceled")
      duration=$(elapsed_seconds)
      emit_result "03-deploy-backend" "failure" "$duration" \
        "Render deploy failed with status: $deploy_status" \
        "{\"deploy_id\": \"$deploy_id\", \"render_status\": \"$deploy_status\", \"commit\": \"$deploy_commit\"}"
      exit 1
      ;;
    "created"|"build_in_progress"|"update_in_progress")
      # Still in progress, keep waiting
      ;;
    *)
      echo "  Unknown status: ${deploy_status:-empty}"
      ;;
  esac

  sleep "$POLL_INTERVAL"
  waited=$((waited + POLL_INTERVAL))
done

# Timeout
duration=$(elapsed_seconds)
emit_result "03-deploy-backend" "failure" "$duration" \
  "Render deploy timed out after ${MAX_WAIT}s (last status: ${deploy_status:-unknown})" \
  "{\"reason\": \"timeout\", \"last_status\": \"${deploy_status:-unknown}\", \"deploy_id\": \"${deploy_id:-unknown}\"}"
exit 1
