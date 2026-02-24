#!/usr/bin/env bash
# Step 03: Deploy backend to Render
# Deploy is triggered by pushing to the prod branch on GitHub.
# Render auto-deploys from prod. The Render API key is only used to
# verify deploy status and fetch logs if something goes wrong.

source "$(dirname "$0")/_common.sh"
load_secrets
start_timer

echo "=== Step 03: Deploying Backend (Render) ==="
echo ""

cd "$PROJECT_ROOT"

require_cmd git

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

# Push prod — this triggers Render's auto-deploy
echo ""
echo "--- Pushing prod branch (triggers Render auto-deploy) ---"
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
echo "Pushed to prod. Render will auto-deploy from this push."

# If Render API credentials are available, poll for deploy status.
# This is optional — the deploy is already triggered by the git push.
# The API is only used here to verify success and surface errors.
if [[ -z "${RENDER_API_KEY:-}" || -z "${RENDER_SERVICE_ID:-}" ]]; then
  duration=$(elapsed_seconds)
  echo ""
  echo "Render API credentials not configured — skipping status polling."
  echo "Deploy was triggered by git push. Verify manually or via step 06."
  emit_result "03-deploy-backend" "success" "$duration" \
    "Pushed to prod (commit $deploy_commit). Render auto-deploy triggered. No API key to verify status." \
    "{\"commit\": \"$deploy_commit\", \"render_status\": \"push_triggered\", \"api_polling\": false}"
  exit 0
fi

require_cmd curl
require_cmd jq

echo "Polling Render API to verify deploy status..."

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
        "{\"deploy_id\": \"$deploy_id\", \"commit\": \"$deploy_commit\", \"render_status\": \"live\", \"api_polling\": true}"
      exit 0
      ;;
    "deactivated"|"build_failed"|"update_failed"|"canceled")
      # Fetch deploy logs for debugging
      deploy_logs=""
      if [[ -n "$deploy_id" ]]; then
        echo "  Fetching deploy logs..."
        deploy_logs=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
          "$RENDER_API/services/$RENDER_SERVICE_ID/deploys/$deploy_id/logs" 2>/dev/null \
          | jq -r '.[].message // empty' 2>/dev/null | tail -20) || true
        if [[ -n "$deploy_logs" ]]; then
          echo "  --- Render deploy logs (last 20 lines) ---"
          echo "$deploy_logs"
          echo "  --- End logs ---"
        fi
      fi
      duration=$(elapsed_seconds)
      log_tail=$(json_escape "$(echo "$deploy_logs" | tail -10)")
      emit_result "03-deploy-backend" "failure" "$duration" \
        "Render deploy failed with status: $deploy_status" \
        "{\"deploy_id\": \"$deploy_id\", \"render_status\": \"$deploy_status\", \"commit\": \"$deploy_commit\", \"log_tail\": \"$log_tail\"}"
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

# Timeout — deploy may still succeed, just took longer than expected
duration=$(elapsed_seconds)
emit_result "03-deploy-backend" "failure" "$duration" \
  "Render deploy timed out after ${MAX_WAIT}s (last status: ${deploy_status:-unknown}). Deploy may still be in progress." \
  "{\"reason\": \"timeout\", \"last_status\": \"${deploy_status:-unknown}\", \"deploy_id\": \"${deploy_id:-unknown}\"}"
exit 1
