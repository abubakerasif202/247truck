#!/usr/bin/env bash
# Upgrade-from-baseline harness driver.
#
# Proves that 20260912120000_review_remediation_pagination_scope.sql upgrades
# a database that already holds data written under the PREVIOUS migration
# (the "reviewed baseline"), rather than only ever being tested against a
# fresh, fully-migrated DB.
#
# Steps:
#   1. Move the migration under test out of supabase/migrations/.
#   2. `supabase db reset --local` -> DB is at the baseline (every migration
#      except the one under test).
#   3. Run tests/upgrade/01-seed-baseline.test.ts, which seeds baseline data
#      and writes test-results/upgrade-state.json.
#   4. Move the migration back into supabase/migrations/.
#   5. `supabase migration up --local` -> applies just that one migration on
#      top of the seeded data.
#   6. Run tests/upgrade/02-verify-upgrade.test.ts, which asserts the
#      migration upgraded that data correctly.
#
# The migration file is ALWAYS restored to supabase/migrations/ on exit
# (success, failure, or interruption), via trap. Run from inventory-app/.

set -uo pipefail

# This repository is developed from Windows PowerShell. When this script is
# launched through Git Bash/WSL, plain `npx` can select the Linux Node runtime
# and fail against the Windows node_modules tree (notably Rolldown native
# bindings). Invoke the Windows shim through cmd.exe when it is available.
run_npx() {
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /d /c npx.cmd "$@"
  else
    npx "$@"
  fi
}

run_upgrade_vitest() {
  local output status
  if command -v cmd.exe >/dev/null 2>&1; then
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

MIGRATION_NAME="20260912120000_review_remediation_pagination_scope.sql"
MIGRATIONS_DIR="supabase/migrations"
MIGRATION_PATH="${MIGRATIONS_DIR}/${MIGRATION_NAME}"
TMP_DIR="$(mktemp -d)"
TMP_MIGRATION_PATH="${TMP_DIR}/${MIGRATION_NAME}"

STATUS=0
MOVED_OUT=0

restore_migration() {
  if [ "${MOVED_OUT}" = "1" ] && [ -f "${TMP_MIGRATION_PATH}" ] && [ ! -f "${MIGRATION_PATH}" ]; then
    mv "${TMP_MIGRATION_PATH}" "${MIGRATION_PATH}"
    echo "[verify-migration-upgrade] restored ${MIGRATION_PATH}"
  fi
  rm -rf "${TMP_DIR}"
}
trap restore_migration EXIT INT TERM

if [ ! -f "${MIGRATION_PATH}" ]; then
  echo "[verify-migration-upgrade] ERROR: ${MIGRATION_PATH} not found (already moved, or run from the wrong directory)"
  exit 1
fi

echo "[verify-migration-upgrade] step 1/6: moving ${MIGRATION_NAME} out of ${MIGRATIONS_DIR}/"
mv "${MIGRATION_PATH}" "${TMP_MIGRATION_PATH}"
MOVED_OUT=1

echo "[verify-migration-upgrade] step 2/6: supabase db reset --local (baseline, without the migration under test)"
run_npx supabase db reset --local
STATUS=$?
if [ "${STATUS}" -ne 0 ]; then
  echo "[verify-migration-upgrade] FAILED: db reset to baseline"
  exit "${STATUS}"
fi

echo "[verify-migration-upgrade] step 3/6: seeding baseline data (tests/upgrade/01-seed-baseline.test.ts)"
run_upgrade_vitest vitest run --config vitest.upgrade.config.ts tests/upgrade/01-seed-baseline.test.ts
STATUS=$?
if [ "${STATUS}" -ne 0 ]; then
  echo "[verify-migration-upgrade] FAILED: baseline seeding"
  exit "${STATUS}"
fi

echo "[verify-migration-upgrade] step 4/6: moving ${MIGRATION_NAME} back into ${MIGRATIONS_DIR}/"
mv "${TMP_MIGRATION_PATH}" "${MIGRATION_PATH}"
MOVED_OUT=0

echo "[verify-migration-upgrade] step 5/6: supabase migration up --local (applying the migration under test)"
run_npx supabase migration up --local
STATUS=$?
if [ "${STATUS}" -ne 0 ]; then
  echo "[verify-migration-upgrade] FAILED: migration up"
  exit "${STATUS}"
fi

echo "[verify-migration-upgrade] step 6/6: verifying the upgrade (tests/upgrade/02-verify-upgrade.test.ts)"
run_upgrade_vitest vitest run --config vitest.upgrade.config.ts tests/upgrade/02-verify-upgrade.test.ts
STATUS=$?
if [ "${STATUS}" -ne 0 ]; then
  echo "[verify-migration-upgrade] FAILED: upgrade verification"
  exit "${STATUS}"
fi

echo "[verify-migration-upgrade] SUCCESS: baseline seeded, migration applied, upgrade verified."
exit 0
