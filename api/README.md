# MFAG Hub Laravel API

This directory contains the PHP Laravel backend that powers MFAG Hub on MySQL, including auth, business APIs, and operational backup tooling.

This repository root is `apps/`. Commands in this README are written either from that root (for example `cd api`) or from inside `api/` where shown.

## Staging / production runbook

Use this as the operational checklist for deployed environments.

1. Install the required system binaries: `bash`, `mysqldump`, `mysql`, `gzip`, `gunzip`, and `tar`.
2. Use rotating file logs in deployed environments:

```env
LOG_CHANNEL=stack
LOG_STACK=daily
LOG_DAILY_DAYS=14
LOG_LEVEL=info
```

This keeps local disk usage bounded by pruning older `storage/logs/laravel-*.log` files automatically. The app defaults to non-rotating `single` logs in `local` and `testing`, and switches the `stack` channel to `daily` outside those environments unless you override `LOG_STACK`.

3. Run Laravel's scheduler every minute from the host OS:

```bash
* * * * * cd /path/to/repo/api && php artisan schedule:run >> /dev/null 2>&1
```

4. The app already defines these scheduled jobs:
    - `auth:cleanup-expired` every 10 minutes
    - `ops:backup-database` daily at `BACKUP_SCHEDULE_TIME` (default `02:15`, app timezone default `UTC`)
5. Manual operations you may still run on demand:
    - `php artisan auth:cleanup-expired`
    - `php artisan ops:backup-database`
    - `./scripts/import-database.sh /path/to/dump.sql.gz --yes`
    - `./scripts/export-uploaded-files.sh --output /path/to/uploaded-files.tar.gz`
    - `./scripts/import-uploaded-files.sh /path/to/uploaded-files.tar.gz --yes`
6. Storage note:
    - Daily snapshots keep the newest 14 database dumps by default.
    - Scheduled snapshots only keep database dumps.

## What is included

- OTP auth API (email + FSC code) using Laravel Sanctum access tokens plus rotating refresh tokens
- MySQL schema for:
    - agencies
    - users
    - login_otps
    - auth_rate_limits
    - auth_refresh_tokens
    - personal_access_tokens
    - sessions
    - handbook_categories
    - handbook_files
    - products
    - sources
    - closings
    - notifications
    - reports
    - push_subscriptions
- JSON APIs for team, products, sources, closings, reports, and notifications
- Handbook content + file APIs (private storage, authenticated download, role-protected upload/delete)
- Legacy snapshot import commands
- File-based snapshot scripts for MySQL plus `storage/app/private`
- Scheduled auth cleanup and daily snapshot backup commands
- Backup APIs for one-step undo plus full system export/import
- Docker dev stack for MySQL, Mailpit, Adminer, and phpMyAdmin

## Local dev setup

1. Create your local environment file

```bash
cd api
cp .env.example .env
```

Update `.env` if you want different local database credentials or ports. Docker Compose reads its MySQL settings from that file.

2. Start infra

```bash
./scripts/dev-setup.sh
```

This starts MySQL and Mailpit. If you also want the bundled database UIs, run `docker compose up -d adminer phpmyadmin` and use Adminer at `http://127.0.0.1:8080` or phpMyAdmin at `http://127.0.0.1:8081`.

3. Initialize Laravel core files (skip this in the current repo; only run it if `artisan` is missing)

```bash
./scripts/init-project.sh
```

4. Install PHP dependencies

```bash
composer install
php artisan key:generate
php artisan legacy:import:all
php artisan serve --host=127.0.0.1 --port=8000
```

5. Verify email flow

- Request OTP via `POST /api/auth/request-otp`
- Open Mailpit at `http://127.0.0.1:8025` and copy OTP
- Verify via `POST /api/auth/verify-otp`

## Backup and restore

The backend now includes separate database and uploaded-file backup scripts.

Create a snapshot manually:

```bash
php artisan ops:backup-database
```

Or run the underlying shell script directly:

```bash
./scripts/backup-database.sh
```

Export the current database directly:

```bash
./scripts/export-database.sh --output /path/to/dump.sql.gz
```

Import a database dump:

```bash
./scripts/import-database.sh /path/to/dump.sql.gz --yes
```

Export the current uploaded files:

```bash
./scripts/export-uploaded-files.sh --output /path/to/uploaded-files.tar.gz
```

Import uploaded files:

```bash
./scripts/import-uploaded-files.sh /path/to/uploaded-files.tar.gz --yes
```

Database snapshots created by the scheduler are stored under `storage/backups/snapshot-<timestamp>`.

Each database snapshot contains:

- `db.sql.gz`
- `manifest.env`

Backups are also scheduled automatically once per day by Laravel's scheduler at `BACKUP_SCHEDULE_TIME` (default `02:15`, app timezone default `UTC`).

Retention defaults to the newest 14 snapshots via `BACKUP_RETENTION_COUNT=14`, which is a common lightweight rule for an app of this size. If you need longer history, a typical next step is a GFS-style policy such as 14 daily, 8 weekly, and 6 monthly backups in your infrastructure layer.

You can also prune old snapshots manually:

```bash
./scripts/prune-backups.sh --keep 14
```

These scripts require `bash`, `mysqldump` (or `mariadb-dump`), `mysql` (or `mariadb`), `gzip`, `gunzip`, `tar`, a working `php artisan`, and a configured `.env` (or equivalent exported `DB_*` variables). Staging-specific data sanitization is still app-specific and should be implemented as a separate redaction step after restore.

The snapshot scripts also have a dedicated shell test suite. Run it with:

```bash
composer test:snapshot-scripts
```

It stubs `mysqldump`, `mysql`, and `php`, uses temp directories for backups and private storage, and bypasses the local `.env` to keep the tests isolated.

For the full backend test suite, run:

```bash
composer test
```

## Maintenance commands

Remove expired auth OTPs and rate-limit buckets manually:

```bash
php artisan auth:cleanup-expired
```

This command deletes expired rows from:

- `login_otps`
- `auth_rate_limits`

Create a database snapshot manually:

```bash
php artisan ops:backup-database
```

Both commands are already scheduled; the host only needs to run `php artisan schedule:run` every minute.

## Backup API

The backend now exposes these backup endpoints for the frontend backup screen:

- `GET /api/backups/snapshots`
- `POST /api/backups/snapshots/{snapshotId}/restore`
- `POST /api/backups/database/export`
- `POST /api/backups/database/import`
- `POST /api/backups/files/export`
- `POST /api/backups/files/import`

Role access:

- `database/export` and `database/import` are `admin` only
- `snapshots`, `snapshots/{snapshotId}/restore`, `files/export`, and `files/import` are available to `admin` and `editor`

`snapshots` returns the latest 50 restorable section snapshots for products, sources, team, and handbook. Restoring one replaces that section with the saved state from that timestamp.

## API routes implemented

- Auth: `request-otp`, `verify-otp`, `refresh`, `me`, `logout`
- Handbook: content read/write plus file list/download/upload/delete
- Team: team listing, user create/update/delete, bulk agency updates, agency upsert/delete
- Closings: list/detail/create/update/delete plus month data/backups for admins
- Products: read/update
- Sources: read/update
- Reports: read/update plus admin backup list/delete
- Backups: section snapshot list/restore plus uploaded file export/import for `admin`/`editor`, and database export/import for `admin`
- Notifications: user/admin listing, detail, create/update/send/delete, attachments, read state, and push subscriptions

## Laravel wiring in this repo

The app already registers the custom `role` middleware alias in `bootstrap/app.php`.

- Laravel 11/12: already configured in this repo

```php
->withMiddleware(function (\Illuminate\Foundation\Configuration\Middleware $middleware): void {
    $middleware->alias([
        'role' => \App\Http\Middleware\EnsureRole::class,
    ]);
})
```

- Laravel 10 and below: if you port this code into an older app, add the alias to `$routeMiddleware` in `app/Http/Kernel.php`

## Frontend integration notes

- The frontend already uses backend API endpoints for auth, team, products, sources, closings, reports, notifications, and handbook content/files.
- The backup UI is now backend-driven:
    - `admin` and `editor` can restore from the latest 50 section snapshots for products, sources, team, and handbook
    - `admin` can export/import the database, while `admin` and `editor` can export/import uploaded files
- Auth uses:
    - `POST /api/auth/request-otp` body `{ email, fscCode }`
    - `POST /api/auth/verify-otp` body `{ email, otp }`
    - `Authorization: Bearer <token>` for authenticated requests

## Next recommended implementation

- Add feature coverage for closings and agency endpoints, which are implemented but not covered by the current test suite
- Add offsite/remote backup replication if filesystem-only snapshots are not sufficient for disaster recovery
- Decide whether old-snapshot restore should continue using the latest private file archive, or whether private files should move to external object storage with its own retention/versioning
