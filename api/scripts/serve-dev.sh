#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$APP_DIR/public"

memory_limit="${MFAG_PHP_MEMORY_LIMIT:-512M}"
post_max_size="${MFAG_POST_MAX_SIZE:-512M}"
upload_max_filesize="${MFAG_UPLOAD_MAX_FILESIZE:-512M}"
host="127.0.0.1"
port="8000"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/serve-dev.sh [--host HOST] [--port PORT]

Starts Laravel on the PHP built-in server with larger upload/body limits for local backup imports.

Environment overrides:
  MFAG_PHP_MEMORY_LIMIT
  MFAG_POST_MAX_SIZE
  MFAG_UPLOAD_MAX_FILESIZE
EOF
}

while (($# > 0)); do
  case "$1" in
    --host)
      if (($# < 2)); then
        echo "--host requires a value." >&2
        exit 1
      fi
      host="$2"
      shift 2
      ;;
    --host=*)
      host="${1#*=}"
      shift
      ;;
    --port)
      if (($# < 2)); then
        echo "--port requires a value." >&2
        exit 1
      fi
      port="$2"
      shift 2
      ;;
    --port=*)
      port="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$host" || -z "$port" ]]; then
  echo "Host and port are required." >&2
  exit 1
fi

server_script="$APP_DIR/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php"

if [[ ! -f "$server_script" ]]; then
  echo "Laravel server bootstrap not found: $server_script" >&2
  exit 1
fi

if [[ ! -d "$PUBLIC_DIR" ]]; then
  echo "Laravel public directory not found: $PUBLIC_DIR" >&2
  exit 1
fi

cd "$PUBLIC_DIR"

echo "Starting Laravel dev server on http://${host}:${port}"
echo "PHP memory_limit=${memory_limit}, post_max_size=${post_max_size}, upload_max_filesize=${upload_max_filesize}"
echo "Document root=${PUBLIC_DIR}"

exec php \
  -d "memory_limit=${memory_limit}" \
  -d "post_max_size=${post_max_size}" \
  -d "upload_max_filesize=${upload_max_filesize}" \
  -S "${host}:${port}" \
  "$server_script"
