#!/usr/bin/env bash
# Upgrade-from-baseline harness driver.
#
# Proves that every migration this branch adds upgrades a database that
# already holds data written under the reviewed baseline, rather than only
# ever being tested against a fresh, fully-migrated DB.
#
# Steps:
#   1. Move every migration this branch adds out of supabase/migrations/.
#   2. `supabase db reset --local` -> DB is at the reviewed baseline.
#   3. Run tests/upgrade/01-seed-baseline.test.ts (seeds baseline data and
#      writes test-results/upgrade-state.json).
#   4. Move the first remediation migration back and `supabase migration up`.
#   5. Run tests/upgrade/03-five-findings-preservation.test.ts phase=seed
#      (snapshots rows at that intermediate schema).
#   6. Move the remaining migrations back and `supabase migration up`.
#   7. Run tests/upgrade/02-verify-upgrade.test.ts.
#   8. Run 03-five-findings-preservation.test.ts phase=verify.
#
# Migration files are ALWAYS restored to supabase/migrations/ on exit
# (success, failure, or interruption), via trap. Run from inventory-app/.

set -uo pipefail

# This repository is developed from Windows PowerShell. When this script is
# launched through Git Bash/WSL, plain `npx` can select the Linux Node runtime
# and fail against the Windows node_modules tree (notably Rolldown native
# bindings). Invoke the Windows shim through cmd.exe when it is available.
# When the Node on PATH is already the Windows build (Git Bash with the
# Windows toolchain, or plain Linux/macOS), call npx directly: routing through
# cmd.exe from a non-console stdin can stall on the first child process.
NODE_PLATFORM="$(node -p process.platform 2>/dev/null || echo unknown)"
use_cmd_shim() {
  [ "${NODE_PLATFORM}" != "win32" ] && command -v cmd.exe >/dev/null 2>&1
}

run_npx() {
  if use_cmd_shim; then
    cmd.exe /d /c npx.cmd "$@"
  else
    npx "$@"
  fi
}

run_upgrade_vitest() {
  local output status
  if use_cmd_shim; then
    output=$(cmd.exe /d /c "set UPGRADE_HARNESS=1&& npx.cmd $*" 2>&1)
    status=$?
  else
    output=$(UPGRADE_HARNESS=1 npx "$@" 2>&1)
    status=$?
  fi
  printf '%s\n' "${output}"
  if [ "${status}" -ne 0 ]; then
    return "${status}"
  fi
  # Vitest exits 0 when a file is entirely skipped. That is not verification.
  if printf '%s\n' "${output}" | grep -Eq 'Test Files[[:space:]].*skipped|Tests[[:space:]].*skipped'; then
    echo "[verify-migration-upgrade] ERROR: upgrade test invocation was skipped"
    return 1
  fi
}

# Every migration this branch adds on top of the reviewed baseline, in order.
# The first one is the pagination/scope remediation that 01/02 straddle; the
# rest are the five-findings + follow-up migrations that 03 straddles.
BRANCH_MIGRATIONS=(
  20260912120000_review_remediation_pagination_scope.sql
  20260912130000_invoice_credit_revision_lock.sql
  20260912131000_transfer_replay_hardening.sql
  20260912132000_stock_movement_notes.sql
  20260912133000_invoice_email_retry_safety.sql
  20260912140000_stock_movement_notes_guc_reset.sql
  20260912150000_inventory_reconciliation.sql
  20260912151000_transfer_summary_limit.sql
  20260912160000_quotes_jobs_customers_pagination.sql
  20260912161000_purchase_order_summary_pagination.sql
  20260913100000_listing_keyset_cursor_tiebreak.sql
  20260913101000_stock_movement_notes_column_grant.sql
)
MIGRATIONS_DIR="supabase/migrations"
TMP_DIR="$(mktemp -d)"
STATUS=0

restore_migrations() {
  local name
  for name in "${BRANCH_MIGRATIONS[@]}"; do
    if [ -f "${TMP_DIR}/${name}" ] && [ ! -f "${MIGRATIONS_DIR}/${name}" ]; then
      mv "${TMP_DIR}/${name}" "${MIGRATIONS_DIR}/${name}"
      echo "[verify-migration-upgrade] restored ${MIGRATIONS_DIR}/${name}"
    fi
  done
  rm -rf "${TMP_DIR}"
}
trap restore_migrations EXIT INT TERM

move_out() { mv "${MIGRATIONS_DIR}/$1" "${TMP_DIR}/$1"; }
move_back() { mv "${TMP_DIR}/$1" "${MIGRATIONS_DIR}/$1"; }

fail_if() {
  if [ "$1" -ne 0 ]; then
    echo "[verify-migration-upgrade] FAILED: $2"
    exit "$1"
  fi
}

run_phase_vitest() {
  # $1 = REMEDIATION_UPGRADE_PHASE, rest = vitest args
  local phase="$1"; shift
  local output status
  if use_cmd_shim; then
    output=$(cmd.exe /d /c "set UPGRADE_HARNESS=1&& set REMEDIATION_UPGRADE_PHASE=${phase}&& npx.cmd $*" 2>&1)
    status=$?
  else
    output=$(UPGRADE_HARNESS=1 REMEDIATION_UPGRADE_PHASE="${phase}" npx "$@" 2>&1)
    status=$?
  fi
  printf '%s\n' "${output}"
  [ "${status}" -ne 0 ] && return "${status}"
  if printf '%s\n' "${output}" | grep -Eq 'Test Files[[:space:]].*skipped|Tests[[:space:]].*skipped'; then
    echo "[verify-migration-upgrade] ERROR: upgrade test invocation was skipped"
    return 1
  fi
}

for name in "${BRANCH_MIGRATIONS[@]}"; do
  if [ ! -f "${MIGRATIONS_DIR}/${name}" ]; then
    echo "[verify-migration-upgrade] ERROR: ${MIGRATIONS_DIR}/${name} not found (already moved, or run from the wrong directory)"
    exit 1
  fi
done

echo "[verify-migration-upgrade] step 1/8: moving every branch migration out of ${MIGRATIONS_DIR}/"
for name in "${BRANCH_MIGRATIONS[@]}"; do move_out "${name}"; done

echo "[verify-migration-upgrade] step 2/8: supabase db reset --local (reviewed baseline)"
run_npx supabase db reset --local; fail_if $? "db reset to baseline"

echo "[verify-migration-upgrade] step 3/8: seeding baseline data (tests/upgrade/01-seed-baseline.test.ts)"
run_upgrade_vitest vitest run --config vitest.upgrade.config.ts tests/upgrade/01-seed-baseline.test.ts; fail_if $? "baseline seeding"

echo "[verify-migration-upgrade] step 4/8: applying ${BRANCH_MIGRATIONS[0]} only"
move_back "${BRANCH_MIGRATIONS[0]}"
run_npx supabase migration up --local; fail_if $? "migration up (first remediation)"

echo "[verify-migration-upgrade] step 5/8: snapshotting five-findings rows at that schema (03, phase=seed)"
run_phase_vitest seed vitest run --config vitest.upgrade.config.ts tests/upgrade/03-five-findings-preservation.test.ts; fail_if $? "five-findings seed"

echo "[verify-migration-upgrade] step 6/8: applying the remaining branch migrations"
for name in "${BRANCH_MIGRATIONS[@]:1}"; do move_back "${name}"; done
run_npx supabase migration up --local; fail_if $? "migration up (remaining)"

echo "[verify-migration-upgrade] step 7/8: verifying the pagination/scope upgrade (02)"
run_upgrade_vitest vitest run --config vitest.upgrade.config.ts tests/upgrade/02-verify-upgrade.test.ts; fail_if $? "upgrade verification"

echo "[verify-migration-upgrade] step 8/8: verifying five-findings preservation (03, phase=verify)"
run_phase_vitest verify vitest run --config vitest.upgrade.config.ts tests/upgrade/03-five-findings-preservation.test.ts; fail_if $? "five-findings verification"

echo "[verify-migration-upgrade] SUCCESS: baseline seeded, all branch migrations applied in two steps, both upgrades verified."
exit 0
