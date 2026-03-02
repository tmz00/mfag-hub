#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OPS_SCRIPTS_DIR="$PROJECT_DIR/scripts"
ORIGINAL_PATH="$PATH"

RUN_OUTPUT=""
RUN_STATUS=0
TESTS_RUN=0
TESTS_FAILED=0

fail() {
  echo "FAIL: $*" >&2
  return 1
}

assert_status() {
  local expected="$1"
  if [[ "$RUN_STATUS" -ne "$expected" ]]; then
    fail "Expected exit status $expected but got $RUN_STATUS. Output: $RUN_OUTPUT"
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "Expected output to contain [$needle] but it did not. Output: $haystack"
  fi
}

assert_file_exists() {
  local path="$1"
  [[ -f "$path" ]] || fail "Expected file to exist: $path"
}

assert_dir_exists() {
  local path="$1"
  [[ -d "$path" ]] || fail "Expected directory to exist: $path"
}

assert_not_exists() {
  local path="$1"
  [[ ! -e "$path" ]] || fail "Expected path to be absent: $path"
}

assert_file_contains() {
  local path="$1"
  local needle="$2"
  assert_file_exists "$path"

  local contents
  contents="$(<"$path")"
  assert_contains "$contents" "$needle"
}

run_command() {
  local stdin_data=""
  local use_stdin="false"

  if [[ "${1:-}" == "--stdin" ]]; then
    use_stdin="true"
    stdin_data="$2"
    shift 2
  fi

  set +e
  if [[ "$use_stdin" == "true" ]]; then
    RUN_OUTPUT="$(printf '%s' "$stdin_data" | "$@" 2>&1)"
    RUN_STATUS=$?
  else
    RUN_OUTPUT="$("$@" 2>&1)"
    RUN_STATUS=$?
  fi
  set -e
}

create_stub() {
  local path="$1"
  local body="$2"

  printf '%s\n' "$body" > "$path"
  chmod +x "$path"
}

create_fixture() {
  TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/snapshot-script-tests.XXXXXX")"
  TEST_BIN_DIR="$TEST_ROOT/bin"
  TEST_LOG_DIR="$TEST_ROOT/logs"

  mkdir -p "$TEST_BIN_DIR" "$TEST_LOG_DIR"

  export TEST_ROOT TEST_BIN_DIR TEST_LOG_DIR
  export PATH="$TEST_BIN_DIR:$ORIGINAL_PATH"
  export MFAG_OPS_SKIP_DOTENV="true"
  export DB_CONNECTION="mysql"
  export DB_HOST="127.0.0.1"
  export DB_PORT="3306"
  export DB_DATABASE="mfag_snapshot_test"
  export DB_USERNAME="snapshot_user"
  export DB_PASSWORD="snapshot_password"
  export BACKUP_ROOT="$TEST_ROOT/backups"
  export APP_PRIVATE_PATH="$TEST_ROOT/private"
  export BACKUP_RETENTION_COUNT="0"

  mkdir -p "$BACKUP_ROOT" "$APP_PRIVATE_PATH"
  : > "$APP_PRIVATE_PATH/.gitignore"

  create_stub "$TEST_BIN_DIR/mysqldump" '#!/usr/bin/env bash
printf "%s\n" "$*" >> "${TEST_LOG_DIR:?}/mysqldump.args"
printf "CREATE TABLE snapshot_test (id int);\n"
'

  create_stub "$TEST_BIN_DIR/mysql" '#!/usr/bin/env bash
printf "%s\n" "$*" >> "${TEST_LOG_DIR:?}/mysql.args"
cat > "${TEST_LOG_DIR:?}/mysql.stdin.sql"
'

  create_stub "$TEST_BIN_DIR/php" '#!/usr/bin/env bash
printf "%s\n" "$*" >> "${TEST_LOG_DIR:?}/php.args"
'
}

destroy_fixture() {
  rm -rf "$TEST_ROOT"
  PATH="$ORIGINAL_PATH"
}

with_fixture() {
  create_fixture
  set +e
  "$@"
  local status=$?
  set -e
  destroy_fixture
  return "$status"
}

run_test() {
  local name="$1"
  shift

  TESTS_RUN=$((TESTS_RUN + 1))
  if with_fixture "$@"; then
    echo "PASS: $name"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "FAIL: $name" >&2
  fi
}

make_sql_dump() {
  local path="$1"
  local sql_payload="$2"

  printf '%s\n' "$sql_payload" | gzip -c > "$path"
}

make_uploaded_files_archive() {
  local path="$1"
  local file_name="$2"
  local file_contents="$3"
  local archive_source="$TEST_ROOT/archive-source-$(basename "$path")"

  mkdir -p "$archive_source"
  printf '%s\n' "$file_contents" > "$archive_source/$file_name"
  tar -C "$archive_source" -czf "$path" .
}

test_export_database_creates_dump_file() {
  local output_path="$TEST_ROOT/export.sql.gz"
  local sql_contents

  run_command bash "$OPS_SCRIPTS_DIR/export-database.sh" --output "$output_path"
  assert_status 0 || return 1
  assert_contains "$RUN_OUTPUT" "Database export created: $output_path" || return 1
  assert_file_exists "$output_path" || return 1

  sql_contents="$(gunzip -c "$output_path")"
  assert_contains "$sql_contents" "CREATE TABLE snapshot_test" || return 1
}

test_backup_database_creates_snapshot_artifacts() {
  run_command bash "$OPS_SCRIPTS_DIR/backup-database.sh" --name snapshot-test --root "$BACKUP_ROOT"
  assert_status 0 || return 1
  assert_contains "$RUN_OUTPUT" "Database snapshot created: $BACKUP_ROOT/snapshot-test" || return 1

  local snapshot_dir="$BACKUP_ROOT/snapshot-test"
  local sql_contents

  assert_file_exists "$snapshot_dir/db.sql.gz" || return 1
  assert_not_exists "$snapshot_dir/storage-app-private.tar.gz" || return 1
  assert_file_exists "$snapshot_dir/manifest.env" || return 1
  assert_file_contains "$snapshot_dir/manifest.env" "DB_DATABASE=$DB_DATABASE" || return 1

  sql_contents="$(gunzip -c "$snapshot_dir/db.sql.gz")"
  assert_contains "$sql_contents" "CREATE TABLE snapshot_test" || return 1
}

test_backup_database_rejects_existing_snapshot_directory() {
  mkdir -p "$BACKUP_ROOT/snapshot-test"

  run_command bash "$OPS_SCRIPTS_DIR/backup-database.sh" --name snapshot-test --root "$BACKUP_ROOT"
  assert_status 1 || return 1
  assert_contains "$RUN_OUTPUT" "Snapshot directory already exists: $BACKUP_ROOT/snapshot-test" || return 1
}

test_backup_database_prunes_old_snapshots_when_retention_is_enabled() {
  export BACKUP_RETENTION_COUNT="2"
  mkdir -p \
    "$BACKUP_ROOT/snapshot-20260101T000000Z" \
    "$BACKUP_ROOT/snapshot-20260102T000000Z"

  run_command bash "$OPS_SCRIPTS_DIR/backup-database.sh" --name snapshot-20260103T000000Z --root "$BACKUP_ROOT"
  assert_status 0 || return 1
  assert_contains "$RUN_OUTPUT" "Pruning complete. Kept the newest 2 snapshot(s)." || return 1

  assert_not_exists "$BACKUP_ROOT/snapshot-20260101T000000Z" || return 1
  assert_dir_exists "$BACKUP_ROOT/snapshot-20260102T000000Z" || return 1
  assert_dir_exists "$BACKUP_ROOT/snapshot-20260103T000000Z" || return 1
}

test_export_database_uses_mariadb_dump_when_mysqldump_is_missing() {
  rm -f "$TEST_BIN_DIR/mysqldump"

  create_stub "$TEST_BIN_DIR/mariadb-dump" '#!/usr/bin/env bash
printf "%s\n" "$*" >> "${TEST_LOG_DIR:?}/mariadb-dump.args"
printf "CREATE TABLE snapshot_test (id int);\n"
'

  run_command bash "$OPS_SCRIPTS_DIR/export-database.sh" --output "$TEST_ROOT/export.sql.gz"
  assert_status 0 || return 1
  assert_file_contains "$TEST_LOG_DIR/mariadb-dump.args" "$DB_DATABASE" || return 1
}

test_export_database_loads_dotenv_values_without_shell_eval() {
  local output_path="$TEST_ROOT/export-from-dotenv.sql.gz"
  local env_path="$TEST_ROOT/custom.env"
  local expected_password='1o1D,111^7o $prod!'

  cat > "$env_path" <<EOF
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=dotenv_db
DB_USERNAME=dotenv_user
DB_PASSWORD='$expected_password'
EOF

  export MFAG_OPS_SKIP_DOTENV="false"
  export MFAG_OPS_ENV_FILE="$env_path"

  create_stub "$TEST_BIN_DIR/mysqldump" '#!/usr/bin/env bash
printf "%s\n" "$MYSQL_PWD" > "${TEST_LOG_DIR:?}/mysqldump.password"
printf "%s\n" "$*" > "${TEST_LOG_DIR:?}/mysqldump.args"
printf "CREATE TABLE snapshot_test (id int);\n"
'

  run_command bash "$OPS_SCRIPTS_DIR/export-database.sh" --output "$output_path"
  assert_status 0 || return 1
  assert_file_contains "$TEST_LOG_DIR/mysqldump.args" "dotenv_db" || return 1
  assert_file_contains "$TEST_LOG_DIR/mysqldump.args" "-udotenv_user" || return 1
  assert_file_contains "$TEST_LOG_DIR/mysqldump.password" "$expected_password" || return 1
}

test_import_database_restores_dump() {
  local dump_path="$TEST_ROOT/import.sql.gz"

  make_sql_dump "$dump_path" 'SELECT "restored";'

  run_command bash "$OPS_SCRIPTS_DIR/import-database.sh" "$dump_path" --yes
  assert_status 0 || return 1
  assert_contains "$RUN_OUTPUT" "Database restore complete from: $dump_path" || return 1
  assert_file_contains "$TEST_LOG_DIR/php.args" "artisan migrate:fresh --force" || return 1
  assert_file_contains "$TEST_LOG_DIR/mysql.args" "$DB_DATABASE" || return 1
  assert_file_contains "$TEST_LOG_DIR/mysql.stdin.sql" 'SELECT "restored";' || return 1
}

test_import_database_uses_php_bin_when_php_is_missing() {
  local dump_path="$TEST_ROOT/import.sql.gz"
  local custom_php="$TEST_ROOT/custom-php"

  make_sql_dump "$dump_path" 'SELECT "restored";'
  rm -f "$TEST_BIN_DIR/php"

  create_stub "$custom_php" '#!/usr/bin/env bash
printf "%s\n" "$*" >> "${TEST_LOG_DIR:?}/php-custom.args"
'

  export PHP_BIN="$custom_php"

  run_command bash "$OPS_SCRIPTS_DIR/import-database.sh" "$dump_path" --yes
  assert_status 0 || return 1
  assert_contains "$RUN_OUTPUT" "Database restore complete from: $dump_path" || return 1
  assert_file_contains "$TEST_LOG_DIR/php-custom.args" "artisan migrate:fresh --force" || return 1
}

test_import_database_cancels_without_confirmation() {
  local dump_path="$TEST_ROOT/import.sql.gz"

  make_sql_dump "$dump_path" 'SELECT "restored";'

  run_command --stdin $'n\n' bash "$OPS_SCRIPTS_DIR/import-database.sh" "$dump_path"
  assert_status 1 || return 1
  assert_contains "$RUN_OUTPUT" "Restore cancelled." || return 1
  assert_not_exists "$TEST_LOG_DIR/php.args" || return 1
  assert_not_exists "$TEST_LOG_DIR/mysql.args" || return 1
}

test_import_database_fails_when_dump_is_missing() {
  local dump_path="$TEST_ROOT/missing.sql.gz"

  run_command bash "$OPS_SCRIPTS_DIR/import-database.sh" "$dump_path" --yes
  assert_status 1 || return 1
  assert_contains "$RUN_OUTPUT" "Database dump not found: $dump_path" || return 1
}

test_export_uploaded_files_creates_archive() {
  local archive_path="$TEST_ROOT/uploaded-files.tar.gz"
  local extracted_dir="$TEST_ROOT/extracted"

  printf 'private payload\n' > "$APP_PRIVATE_PATH/document.txt"

  run_command bash "$OPS_SCRIPTS_DIR/export-uploaded-files.sh" --output "$archive_path"
  assert_status 0 || return 1
  assert_contains "$RUN_OUTPUT" "Uploaded files export created: $archive_path" || return 1
  assert_file_exists "$archive_path" || return 1

  mkdir -p "$extracted_dir"
  tar -C "$extracted_dir" -xzf "$archive_path"
  assert_file_exists "$extracted_dir/document.txt" || return 1
}

test_import_uploaded_files_replaces_private_storage() {
  local archive_path="$TEST_ROOT/uploaded-files.tar.gz"

  printf 'stale file\n' > "$APP_PRIVATE_PATH/stale.txt"
  make_uploaded_files_archive "$archive_path" 'restored.txt' 'restored payload'

  run_command bash "$OPS_SCRIPTS_DIR/import-uploaded-files.sh" "$archive_path" --yes
  assert_status 0 || return 1
  assert_contains "$RUN_OUTPUT" "Uploaded files restore complete from: $archive_path" || return 1
  assert_file_exists "$APP_PRIVATE_PATH/.gitignore" || return 1
  assert_not_exists "$APP_PRIVATE_PATH/stale.txt" || return 1
  assert_file_exists "$APP_PRIVATE_PATH/restored.txt" || return 1
}

test_import_uploaded_files_cancels_without_confirmation() {
  local archive_path="$TEST_ROOT/uploaded-files.tar.gz"

  printf 'stale file\n' > "$APP_PRIVATE_PATH/stale.txt"
  make_uploaded_files_archive "$archive_path" 'restored.txt' 'restored payload'

  run_command --stdin $'n\n' bash "$OPS_SCRIPTS_DIR/import-uploaded-files.sh" "$archive_path"
  assert_status 1 || return 1
  assert_contains "$RUN_OUTPUT" "Restore cancelled." || return 1
  assert_file_exists "$APP_PRIVATE_PATH/stale.txt" || return 1
  assert_not_exists "$APP_PRIVATE_PATH/restored.txt" || return 1
}

test_import_uploaded_files_fails_when_archive_is_missing() {
  local archive_path="$TEST_ROOT/missing.tar.gz"

  run_command bash "$OPS_SCRIPTS_DIR/import-uploaded-files.sh" "$archive_path" --yes
  assert_status 1 || return 1
  assert_contains "$RUN_OUTPUT" "Uploaded files archive not found: $archive_path" || return 1
}

test_scripts_reject_unsupported_database_connections() {
  export DB_CONNECTION="sqlite"

  run_command bash "$OPS_SCRIPTS_DIR/backup-database.sh" --name snapshot-test --root "$BACKUP_ROOT"
  assert_status 1 || return 1
  assert_contains "$RUN_OUTPUT" "These backup scripts only support DB_CONNECTION=mysql or mariadb. Current value: sqlite" || return 1
}

run_test "export database creates dump file" test_export_database_creates_dump_file
run_test "backup database creates snapshot artifacts" test_backup_database_creates_snapshot_artifacts
run_test "backup database rejects existing snapshot directory" test_backup_database_rejects_existing_snapshot_directory
run_test "backup database prunes old snapshots when retention is enabled" test_backup_database_prunes_old_snapshots_when_retention_is_enabled
run_test "export database uses mariadb-dump when mysqldump is missing" test_export_database_uses_mariadb_dump_when_mysqldump_is_missing
run_test "export database loads dotenv values without shell eval" test_export_database_loads_dotenv_values_without_shell_eval
run_test "import database restores dump" test_import_database_restores_dump
run_test "import database uses PHP_BIN when php is missing" test_import_database_uses_php_bin_when_php_is_missing
run_test "import database cancels without confirmation" test_import_database_cancels_without_confirmation
run_test "import database fails when dump is missing" test_import_database_fails_when_dump_is_missing
run_test "export uploaded files creates archive" test_export_uploaded_files_creates_archive
run_test "import uploaded files replaces private storage" test_import_uploaded_files_replaces_private_storage
run_test "import uploaded files cancels without confirmation" test_import_uploaded_files_cancels_without_confirmation
run_test "import uploaded files fails when archive is missing" test_import_uploaded_files_fails_when_archive_is_missing
run_test "scripts reject unsupported database connections" test_scripts_reject_unsupported_database_connections

if ((TESTS_FAILED > 0)); then
  echo "$TESTS_FAILED of $TESTS_RUN snapshot script tests failed." >&2
  exit 1
fi

echo "All $TESTS_RUN snapshot script tests passed."
