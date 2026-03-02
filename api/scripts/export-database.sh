#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_ops-common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/export-database.sh --output OUTPUT_PATH

Creates a gzipped SQL dump at OUTPUT_PATH.
EOF
}

output_path=""

while (($# > 0)); do
  case "$1" in
    --output)
      if (($# < 2)); then
        echo "--output requires a value." >&2
        exit 1
      fi
      output_path="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$output_path" ]]; then
  echo "--output is required." >&2
  usage
  exit 1
fi

load_app_env
ensure_mysql_supported
resolve_mysqldump_command
require_command gzip

build_mysql_args
ensure_directory "$(dirname "$output_path")"

echo "Creating MySQL dump: $output_path"
run_mysqldump --single-transaction --quick --routines --triggers --no-tablespaces "$DB_DATABASE" | gzip -c > "$output_path"

echo "Database export created: $output_path"
