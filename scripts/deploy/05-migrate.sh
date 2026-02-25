#!/usr/bin/env bash
# Step 05: Run pending database migrations against production MongoDB Atlas
# Runs AFTER backend deploy since new code may depend on new schema

source "$(dirname "$0")/_common.sh"
load_secrets
start_timer

echo "=== Step 05: Running Database Migrations ==="
echo ""

cd "$PROJECT_ROOT"

# Export both URIs — migration CLI prefers MONGODB_ADMIN_URI for admin privileges
export MONGODB_URI
export MONGODB_ADMIN_URI

# Check migration status first (read-only)
echo "--- Checking pending migrations ---"
status_output=$(cd backend && npx tsx src/migrations/cli.ts status 2>&1) || {
  duration=$(elapsed_seconds)
  echo "$status_output"
  tail_text=$(json_escape "$(echo "$status_output" | tail -10)")
  emit_result "05-migrate" "failure" "$duration" \
    "Failed to check migration status" \
    "{\"reason\": \"status_check_failed\", \"output_tail\": \"$tail_text\"}"
  exit 1
}
echo "$status_output"

# Count pending migrations (marked with ○ in status output)
pending_count=$(echo "$status_output" | grep -c '○' || echo "0")

if [[ "$pending_count" -eq 0 ]]; then
  duration=$(elapsed_seconds)
  echo ""
  echo "No pending migrations."
  emit_result "05-migrate" "success" "$duration" \
    "No pending migrations to run" \
    "{\"pending\": 0, \"applied\": 0}"
  exit 0
fi

echo ""
echo "Found $pending_count pending migration(s). Running..."
echo ""

# Run migrations
echo "--- Running migrations ---"
migrate_output=$(cd backend && npx tsx src/migrations/cli.ts run 2>&1)
migrate_exit=$?
echo "$migrate_output"

if [[ $migrate_exit -ne 0 ]]; then
  duration=$(elapsed_seconds)
  tail_text=$(json_escape "$(echo "$migrate_output" | tail -10)")
  emit_result "05-migrate" "failure" "$duration" \
    "Migration failed" \
    "{\"pending\": $pending_count, \"output_tail\": \"$tail_text\"}"
  exit 1
fi

# Extract applied count from output
applied_count=$(echo "$migrate_output" | grep -oE 'Applied [0-9]+ migration' | grep -oE '[0-9]+' || echo "$pending_count")

# Extract schema version
schema_version=$(echo "$migrate_output" | grep -oE 'Schema version: [0-9]+' | grep -oE '[0-9]+' || echo "unknown")

duration=$(elapsed_seconds)
emit_result "05-migrate" "success" "$duration" \
  "Applied $applied_count migration(s), schema version: $schema_version" \
  "{\"applied\": $applied_count, \"schema_version\": \"$schema_version\", \"pending_before\": $pending_count}"
