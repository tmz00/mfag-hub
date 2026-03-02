#!/usr/bin/env bash

if [[ -z "${MFAG_OPS_COMMON_LOADED:-}" ]]; then
  MFAG_OPS_COMMON_LOADED=1

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  DEFAULT_BACKUP_ROOT="$PROJECT_DIR/storage/backups"
  DEFAULT_PRIVATE_STORAGE_PATH="$PROJECT_DIR/storage/app/private"

  load_dotenv_values() {
    local env_path="$1"
    local line=""
    local key=""
    local value=""
    local first_char=""
    local last_char=""

    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      line="${line#"${line%%[![:space:]]*}"}"

      if [[ -z "$line" || "${line:0:1}" == "#" ]]; then
        continue
      fi

      if [[ "$line" == export[[:space:]]* ]]; then
        line="${line#export}"
        line="${line#"${line%%[![:space:]]*}"}"
      fi

      if [[ "$line" != *=* ]]; then
        continue
      fi

      key="${line%%=*}"
      value="${line#*=}"
      key="${key#"${key%%[![:space:]]*}"}"
      key="${key%"${key##*[![:space:]]}"}"

      if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        continue
      fi

      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"

      if ((${#value} >= 2)); then
        first_char="${value:0:1}"
        last_char="${value: -1}"

        if [[ ("$first_char" == "'" && "$last_char" == "'") || ("$first_char" == "\"" && "$last_char" == "\"") ]]; then
          value="${value:1:${#value}-2}"
        fi
      fi

      printf -v "$key" '%s' "$value"
      export "$key"
    done < "$env_path"
  }

  load_app_env() {
    local env_path="${MFAG_OPS_ENV_FILE:-$PROJECT_DIR/.env}"

    if [[ "${MFAG_OPS_SKIP_DOTENV:-false}" != "true" ]] && [[ -f "$env_path" ]]; then
      load_dotenv_values "$env_path"
    fi

    : "${DB_CONNECTION:=mysql}"
    : "${DB_HOST:=127.0.0.1}"
    : "${DB_PORT:=3306}"
    : "${DB_DATABASE:=laravel}"
    : "${DB_USERNAME:=root}"
    : "${DB_PASSWORD:=}"
    : "${BACKUP_ROOT:=$DEFAULT_BACKUP_ROOT}"
    : "${APP_PRIVATE_PATH:=$DEFAULT_PRIVATE_STORAGE_PATH}"
    : "${BACKUP_RETENTION_COUNT:=14}"
  }

  require_command() {
    local command_name="$1"

    if ! command -v "$command_name" >/dev/null 2>&1; then
      echo "Required command not found: $command_name" >&2
      exit 1
    fi
  }

  resolve_command_path() {
    local result_var="$1"
    local display_name="$2"
    shift 2

    local candidate=""
    local resolved_path=""
    local looked_for=()

    for candidate in "$@"; do
      if [[ -z "$candidate" ]]; then
        continue
      fi

      looked_for+=("$candidate")

      if [[ "$candidate" == */* ]]; then
        if [[ -x "$candidate" ]]; then
          printf -v "$result_var" '%s' "$candidate"
          return 0
        fi

        continue
      fi

      resolved_path="$(command -v "$candidate" 2>/dev/null || true)"
      if [[ -n "$resolved_path" ]]; then
        printf -v "$result_var" '%s' "$resolved_path"
        return 0
      fi
    done

    echo "Required command not found: $display_name" >&2
    if ((${#looked_for[@]} > 0)); then
      echo "Looked for: ${looked_for[*]}" >&2
    fi
    exit 1
  }

  ensure_mysql_supported() {
    case "$DB_CONNECTION" in
      mysql|mariadb)
        ;;
      *)
        echo "These backup scripts only support DB_CONNECTION=mysql or mariadb. Current value: $DB_CONNECTION" >&2
        exit 1
        ;;
    esac
  }

  build_mysql_args() {
    MYSQL_ARGS=("-u${DB_USERNAME}")

    if [[ -n "${DB_SOCKET:-}" ]]; then
      MYSQL_ARGS+=("--socket=${DB_SOCKET}")
    else
      MYSQL_ARGS+=("-h${DB_HOST}" "-P${DB_PORT}")
    fi
  }

  run_mysql() {
    MYSQL_PWD="$DB_PASSWORD" "${MYSQL_CLIENT_COMMAND:?}" "${MYSQL_ARGS[@]}" "$@"
  }

  run_mysqldump() {
    MYSQL_PWD="$DB_PASSWORD" "${MYSQLDUMP_COMMAND:?}" "${MYSQL_ARGS[@]}" "$@"
  }

  resolve_mysql_command() {
    resolve_command_path MYSQL_CLIENT_COMMAND "mysql or mariadb" \
      "${MYSQL_BIN:-}" \
      mysql \
      mariadb \
      /opt/homebrew/opt/mysql-client/bin/mysql \
      /usr/local/opt/mysql-client/bin/mysql \
      /opt/homebrew/bin/mysql \
      /usr/local/bin/mysql \
      /opt/homebrew/opt/mariadb-client/bin/mariadb \
      /usr/local/opt/mariadb-client/bin/mariadb \
      /opt/homebrew/bin/mariadb \
      /usr/local/bin/mariadb
  }

  resolve_mysqldump_command() {
    resolve_command_path MYSQLDUMP_COMMAND "mysqldump or mariadb-dump" \
      "${MYSQLDUMP_BIN:-}" \
      mysqldump \
      mariadb-dump \
      /opt/homebrew/opt/mysql-client/bin/mysqldump \
      /usr/local/opt/mysql-client/bin/mysqldump \
      /opt/homebrew/bin/mysqldump \
      /usr/local/bin/mysqldump \
      /opt/homebrew/opt/mariadb-client/bin/mariadb-dump \
      /usr/local/opt/mariadb-client/bin/mariadb-dump \
      /opt/homebrew/bin/mariadb-dump \
      /usr/local/bin/mariadb-dump
  }

  resolve_php_command() {
    resolve_command_path PHP_COMMAND "php" \
      "${PHP_BIN:-}" \
      "${PHP_BINARY:-}" \
      php \
      /opt/homebrew/bin/php \
      /usr/local/bin/php \
      /usr/bin/php
  }

  current_timestamp_utc() {
    date -u '+%Y%m%dT%H%M%SZ'
  }

  ensure_directory() {
    mkdir -p "$1"
  }

  list_snapshots_desc() {
    local backup_root="$1"

    if [[ ! -d "$backup_root" ]]; then
      return 0
    fi

    find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'snapshot-*' -print | sort -r
  }

  clear_private_storage() {
    local private_path="${1:-$APP_PRIVATE_PATH}"

    if [[ ! -d "$private_path" ]]; then
      return 0
    fi

    find "$private_path" -mindepth 1 -maxdepth 1 ! -name '.gitignore' -exec rm -rf {} +
  }
fi
