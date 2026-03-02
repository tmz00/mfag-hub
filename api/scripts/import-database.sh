#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_ops-common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/import-database.sh DUMP_PATH [--yes]

This will:
  - run php artisan migrate:fresh --force
  - import the provided SQL dump into the configured MySQL database
EOF
}

dump_path=""
assume_yes="false"

while (($# > 0)); do
  case "$1" in
    --yes)
      assume_yes="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$dump_path" ]]; then
        echo "Only one dump path can be provided." >&2
        exit 1
      fi
      dump_path="$1"
      shift
      ;;
  esac
done

if [[ -z "$dump_path" ]]; then
  echo "A dump path is required." >&2
  usage
  exit 1
fi

load_app_env
ensure_mysql_supported
resolve_php_command
resolve_mysql_command

if [[ ! -f "$dump_path" ]]; then
  echo "Database dump not found: $dump_path" >&2
  exit 1
fi

if [[ "$assume_yes" != "true" ]]; then
  printf 'Restore database dump %s into database %s? [y/N] ' "$dump_path" "$DB_DATABASE"
  read -r confirmation
  case "$confirmation" in
    y|Y|yes|YES)
      ;;
    *)
      echo "Restore cancelled."
      exit 1
      ;;
  esac
fi

build_mysql_args

echo "Resetting schema with artisan migrate:fresh --force"
(
  cd "$PROJECT_DIR"
  "${PHP_COMMAND:?}" artisan migrate:fresh --force
)

echo "Importing database dump: $dump_path"
if [[ "$dump_path" == *.gz ]]; then
  require_command gunzip
  gunzip -c "$dump_path" | run_mysql "$DB_DATABASE"
else
  run_mysql "$DB_DATABASE" < "$dump_path"
fi

echo "Database restore complete from: $dump_path"
