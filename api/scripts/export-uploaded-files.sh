#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_ops-common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/export-uploaded-files.sh --output OUTPUT_PATH

Creates a gzipped tar archive of storage/app/private at OUTPUT_PATH.
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
require_command tar

ensure_directory "$APP_PRIVATE_PATH"
ensure_directory "$(dirname "$output_path")"

echo "Archiving uploaded files: $output_path"
tar -C "$APP_PRIVATE_PATH" -czf "$output_path" .

echo "Uploaded files export created: $output_path"
