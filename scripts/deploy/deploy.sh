#!/usr/bin/env bash
# Master deployment orchestrator
# Runs all deploy steps in sequence, stopping on first failure
#
# Usage:
#   ./scripts/deploy/deploy.sh           # Run all steps
#   ./scripts/deploy/deploy.sh --from 3  # Resume from step 03
#   ./scripts/deploy/deploy.sh --step 5  # Run only step 05
#   ./scripts/deploy/deploy.sh --dry-run # Show what would run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Parse arguments
START_FROM=1
DRY_RUN=false
SINGLE_STEP=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --from) START_FROM="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --step) SINGLE_STEP="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: deploy.sh [--from N] [--step N] [--dry-run]"
      echo ""
      echo "Options:"
      echo "  --from N    Start from step N (skip earlier steps)"
      echo "  --step N    Run only step N"
      echo "  --dry-run   Show steps without executing"
      echo ""
      echo "Steps:"
      echo "  1  Run test suites"
      echo "  2  Build backend and frontend"
      echo "  3  Deploy backend to Render"
      echo "  4  Deploy frontend to Cloudflare"
      echo "  5  Run database migrations"
      echo "  6  Post-deploy verification"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Define steps: number:script:description
STEPS=(
  "01:01-test.sh:Run test suites"
  "02:02-build.sh:Build backend and frontend"
  "03:03-deploy-backend.sh:Deploy backend to Render"
  "04:04-deploy-frontend.sh:Deploy frontend to Cloudflare"
  "05:05-migrate.sh:Run database migrations"
  "06:06-verify.sh:Post-deploy verification"
)

echo "============================================"
echo "  Coordination Matrix - Production Deploy"
echo "============================================"
echo ""
echo "Steps:"
for step_info in "${STEPS[@]}"; do
  IFS=: read -r num script desc <<< "$step_info"
  num_int="${num#0}"
  marker=" "
  if [[ -n "$SINGLE_STEP" ]]; then
    [[ "$num_int" -eq "$SINGLE_STEP" ]] && marker=">" || marker="-"
  elif [[ "$num_int" -ge "$START_FROM" ]]; then
    marker=">"
  else
    marker="-"
  fi
  echo "  $marker $num. $desc"
done
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "(Dry run - no steps will be executed)"
  exit 0
fi

# Track overall timing
overall_start=$(date +%s)
step_results=()

run_step() {
  local num="$1"
  local script="$2"
  local desc="$3"

  echo ""
  echo "========================================"
  echo "  STEP $num: $desc"
  echo "========================================"
  echo ""

  if bash "$SCRIPT_DIR/$script"; then
    step_results+=("$num:success:$desc")
    return 0
  else
    step_results+=("$num:failure:$desc")
    return 1
  fi
}

# Execute steps
failed=false
for step_info in "${STEPS[@]}"; do
  IFS=: read -r num script desc <<< "$step_info"
  num_int="${num#0}"

  # Skip logic
  if [[ -n "$SINGLE_STEP" ]]; then
    [[ "$num_int" -ne "$SINGLE_STEP" ]] && continue
  elif [[ "$num_int" -lt "$START_FROM" ]]; then
    echo "Skipping step $num (--from $START_FROM)"
    continue
  fi

  if ! run_step "$num" "$script" "$desc"; then
    failed=true
    echo ""
    echo "!!! DEPLOY HALTED at step $num: $desc !!!"
    echo ""
    echo "To resume after fixing the issue:"
    echo "  bash scripts/deploy/deploy.sh --from $((num_int + 1))"
    echo ""
    echo "To retry this step:"
    echo "  bash scripts/deploy/deploy.sh --step $num_int"
    break
  fi
done

# Final summary
overall_end=$(date +%s)
overall_duration=$((overall_end - overall_start))

echo ""
echo "============================================"
echo "  DEPLOY SUMMARY"
echo "============================================"
echo ""
for result in "${step_results[@]}"; do
  IFS=: read -r num status desc <<< "$result"
  if [[ "$status" == "success" ]]; then
    echo "  [OK]   Step $num: $desc"
  else
    echo "  [FAIL] Step $num: $desc"
  fi
done
echo ""
echo "Total time: ${overall_duration}s"

# Emit overall result
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "$failed" == "true" ]]; then
  cat <<SUMMARY_EOF

===DEPLOY_STEP_RESULT===
{
  "step": "deploy-orchestrator",
  "status": "failure",
  "duration_seconds": $overall_duration,
  "summary": "Deploy failed - check individual step results above",
  "details": {"steps_completed": ${#step_results[@]}},
  "timestamp": "$timestamp"
}
===END_DEPLOY_STEP_RESULT===
SUMMARY_EOF
  exit 1
else
  cat <<SUMMARY_EOF

===DEPLOY_STEP_RESULT===
{
  "step": "deploy-orchestrator",
  "status": "success",
  "duration_seconds": $overall_duration,
  "summary": "All ${#step_results[@]} deploy steps completed successfully",
  "details": {"steps_completed": ${#step_results[@]}},
  "timestamp": "$timestamp"
}
===END_DEPLOY_STEP_RESULT===
SUMMARY_EOF
fi
