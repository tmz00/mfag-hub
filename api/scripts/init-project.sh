#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v composer >/dev/null 2>&1; then
  echo "Composer is required." >&2
  exit 1
fi

if [ -f artisan ]; then
  echo "Laravel skeleton already initialized."
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

composer create-project laravel/laravel "$TMP_DIR/base" --no-interaction

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required to initialize the project." >&2
  exit 1
fi

rsync -a --ignore-existing "$TMP_DIR/base/" "$ROOT_DIR/"

composer require laravel/sanctum

if [ -f artisan ]; then
  php artisan vendor:publish --provider="Laravel\\Sanctum\\SanctumServiceProvider" --force
fi

echo "Laravel project initialized."
echo "Next: cp .env.example .env && php artisan key:generate && php artisan legacy:import:all"
