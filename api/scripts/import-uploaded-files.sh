#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_ops-common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/import-uploaded-files.sh ARCHIVE_PATH [--yes]

This will replace storage/app/private/* with the contents of the provided archive.
EOF
}

archive_path=""
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
      if [[ -n "$archive_path" ]]; then
        echo "Only one archive path can be provided." >&2
        exit 1
      fi
      archive_path="$1"
      shift
      ;;
  esac
done

if [[ -z "$archive_path" ]]; then
  echo "An archive path is required." >&2
  usage
  exit 1
fi

load_app_env
require_command tar

if [[ ! -f "$archive_path" ]]; then
  echo "Uploaded files archive not found: $archive_path" >&2
  exit 1
fi

if [[ "$assume_yes" != "true" ]]; then
  printf 'Replace uploaded files in %s using %s? [y/N] ' "$APP_PRIVATE_PATH" "$archive_path"
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

ensure_directory "$APP_PRIVATE_PATH"

if [[ "$archive_path" == *.tar.gz ]] || [[ "$archive_path" == *.tgz ]] || [[ "$archive_path" == *.gz ]]; then
  tar -tzf "$archive_path" >/dev/null
  echo "Replacing uploaded files in $APP_PRIVATE_PATH"
  clear_private_storage "$APP_PRIVATE_PATH"
  tar -C "$APP_PRIVATE_PATH" -xzf "$archive_path"
else
  tar -tf "$archive_path" >/dev/null
  echo "Replacing uploaded files in $APP_PRIVATE_PATH"
  clear_private_storage "$APP_PRIVATE_PATH"
  tar -C "$APP_PRIVATE_PATH" -xf "$archive_path"
fi

echo "Uploaded files restore complete from: $archive_path"
