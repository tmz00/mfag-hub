#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local MySQL/Mailpit." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing apps/api/.env. Copy .env.example to .env before starting Docker." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "./scripts/_ops-common.sh"
load_app_env

docker compose up -d mysql mailpit

echo "\nContainers started."
echo "MySQL: 127.0.0.1:${DB_PORT} (db=${DB_DATABASE}, user=${DB_USERNAME})"
echo "Database password: use DB_PASSWORD from apps/api/.env"
echo "Mailpit UI: http://127.0.0.1:8025"
echo "\nNext:"
echo "1) Install PHP 8.2+ and Composer"
echo "2) composer install"
echo "3) php artisan key:generate"
echo "4) php artisan legacy:import:all"
echo "5) php artisan serve --host=127.0.0.1 --port=8000"
