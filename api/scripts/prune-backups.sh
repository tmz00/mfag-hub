#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_ops-common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/prune-backups.sh [--root BACKUP_ROOT] [--keep SNAPSHOT_COUNT]

Deletes old snapshot-* directories after keeping the newest N snapshots.
EOF
}

backup_root_override=""
keep_count=""

while (($# > 0)); do
  case "$1" in
    --root)
      if (($# < 2)); then
        echo "--root requires a value." >&2
        exit 1
      fi
      backup_root_override="$2"
      shift 2
      ;;
    --keep)
      if (($# < 2)); then
        echo "--keep requires a value." >&2
        exit 1
      fi
      keep_count="$2"
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

load_app_env

if [[ -n "$backup_root_override" ]]; then
  BACKUP_ROOT="$backup_root_override"
fi

if [[ -z "$keep_count" ]]; then
  keep_count="$BACKUP_RETENTION_COUNT"
fi

if [[ ! "$keep_count" =~ ^[0-9]+$ ]]; then
  echo "Retention count must be a positive integer. Received: $keep_count" >&2
  exit 1
fi

if (( keep_count < 1 )); then
  echo "Retention count must be at least 1." >&2
  exit 1
fi

ensure_directory "$BACKUP_ROOT"

snapshots=()
while IFS= read -r snapshot_path; do
  snapshots+=("$snapshot_path")
done < <(list_snapshots_desc "$BACKUP_ROOT")

if ((${#snapshots[@]} <= keep_count)); then
  echo "No pruning needed. Snapshots present: ${#snapshots[@]}; retention: $keep_count."
  exit 0
fi

for ((index = keep_count; index < ${#snapshots[@]}; index++)); do
  echo "Removing old snapshot: ${snapshots[$index]}"
  rm -rf "${snapshots[$index]}"
done

echo "Pruning complete. Kept the newest $keep_count snapshot(s)."
