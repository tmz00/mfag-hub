#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_ops-common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/backup-database.sh [--name SNAPSHOT_NAME] [--root BACKUP_ROOT]

Creates a snapshot directory containing:
  - db.sql.gz
  - manifest.env
EOF
}

snapshot_name=""
backup_root_override=""

while (($# > 0)); do
  case "$1" in
    --name)
      if (($# < 2)); then
        echo "--name requires a value." >&2
        exit 1
      fi
      snapshot_name="$2"
      shift 2
      ;;
    --root)
      if (($# < 2)); then
        echo "--root requires a value." >&2
        exit 1
      fi
      backup_root_override="$2"
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
ensure_mysql_supported

if [[ -n "$backup_root_override" ]]; then
  BACKUP_ROOT="$backup_root_override"
fi

if [[ -z "$snapshot_name" ]]; then
  snapshot_name="snapshot-$(current_timestamp_utc)"
fi

ensure_directory "$BACKUP_ROOT"

snapshot_dir="$BACKUP_ROOT/$snapshot_name"
db_dump_path="$snapshot_dir/db.sql.gz"
manifest_path="$snapshot_dir/manifest.env"

if [[ -e "$snapshot_dir" ]]; then
  echo "Snapshot directory already exists: $snapshot_dir" >&2
  exit 1
fi

mkdir -p "$snapshot_dir"

bash "$SCRIPT_DIR/export-database.sh" --output "$db_dump_path"

cat > "$manifest_path" <<EOF
CREATED_AT_UTC=$(current_timestamp_utc)
DB_CONNECTION=$DB_CONNECTION
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_DATABASE=$DB_DATABASE
EOF

echo "Database snapshot created: $snapshot_dir"

if [[ "$BACKUP_RETENTION_COUNT" =~ ^[0-9]+$ ]] && (( BACKUP_RETENTION_COUNT > 0 )); then
  bash "$SCRIPT_DIR/prune-backups.sh" --root "$BACKUP_ROOT" --keep "$BACKUP_RETENTION_COUNT"
fi
