## ![MFAG Hub](web/public/images/hub_banner.png)

This repository is a monorepo for MFAG Hub. The frontend lives in `web`: a SolidJS single-page app built with Vite, Tailwind CSS v4, and PWA support.

This README is still intentionally frontend-focused. The PHP Laravel API backend lives in `api`, and any backend behavior referenced here is described only where it affects frontend integration.

This repository root is the `apps/` directory. Unless noted otherwise, paths below are relative to this root.

The current production deployment serves the SPA from `https://hub.mfag.sg/` and mounts the Laravel backend under the same origin at `/api`, so browser API requests resolve to `https://hub.mfag.sg/api/...`.

## What This App Does

The frontend handles:

- OTP sign-in and session management
- route protection and profile-completion gating
- dashboard, closing submission, products, handbook, notifications, admin screens
- mobile/PWA install flow
- service-worker updates and mobile push-notification enforcement
- a hard maintenance-mode screen that can fully block the app during a scheduled window

## Stack

- SolidJS 1.9
- Vite 6
- TypeScript
- Tailwind CSS v4 via the Vite plugin
- `@solidjs/router` for client-side routing
- `vite-plugin-pwa` for service worker + manifest generation
- Vitest for frontend tests

## Project Scope

The repo is split into two main apps.

- `web/src/`: frontend application code
- `web/public/`: frontend static assets, icons, push handlers
- `web/dist/`: frontend production build output
- `api/`: PHP Laravel backend API server

## Getting Started

### Requirements

- Node.js 20+ is recommended
- `npm` commands are shown in this README (`web/package-lock.json` is tracked)
- `pnpm-lock.yaml` is also checked in from prior dependency maintenance, so either `npm` or `pnpm` will work if you keep the lockfile you use in sync

### Install

```bash
npm --prefix web install
```

Root-level shortcuts from `apps/`:

- `npm run dev:web`
- `npm run build:web`
- `npm run test:web`
- `npm run dev:api`
- `npm run test:api`

### Run Locally

```bash
npm --prefix web run dev
```

The dev server runs on `http://localhost:3000`.

### Production Build

```bash
npm --prefix web run build
```

### Staging Build

```bash
npm --prefix web run build:staging
```

This runs Vite in `staging` mode and automatically loads `.env.staging`.

### Preview Production Build

```bash
npm --prefix web run serve
```

### Run Frontend Tests

```bash
npm --prefix web run test
```

Watch mode:

```bash
npm --prefix web run test:watch
```

## Environment and API Integration

The frontend talks to the backend over HTTP.

Key environment variables:

- `VITE_API_BASE_URL`
  Used as the API origin host when not using the dev proxy. The service layer still normalizes request paths to `/api/...`, so a production value of `https://hub.mfag.sg` resolves to `https://hub.mfag.sg/api/...`. When unset, it falls back to `http://127.0.0.1:8000`.
- `VITE_USE_API_PROXY`
  In development, defaults to `true`. When enabled, frontend requests go through the Vite proxy instead of hitting the API host directly.
- `VITE_API_PROXY_TARGET`
  Override the Vite proxy target in development.

Tracked environment files in this repo:

- `web/.env.local`
- `web/.env.staging`
- `web/.env.production`

Current defaults:

- local direct API: `VITE_API_BASE_URL=http://127.0.0.1:8000`
- production: `VITE_API_BASE_URL=https://hub.mfag.sg`

### Dev Proxy

The Vite config proxies these paths to the backend in development:

- `/api`
- `/sanctum`

This avoids local CORS issues and keeps frontend code using relative API paths. The proxy also strips the leading `/api` before forwarding because the Laravel app itself now serves app-relative routes such as `/auth/request-otp`.

## Frontend Architecture

### Boot Sequence

The frontend starts here:

1. `web/src/index.tsx`
2. `web/src/MaintenanceRoot.tsx`
3. `web/src/App.tsx`

This order is deliberate:

- `MaintenanceRoot` wraps the entire app before routing starts.
- If maintenance mode is active, the user never reaches the router or any feature page.
- If maintenance mode is inactive, `App` renders normally.

### Route Layer

`web/src/App.tsx` is the central route and app-shell coordinator.

It owns:

- lazy route registration
- authentication readiness
- protected route behavior
- profile-completion redirect logic
- service-worker update prompt
- mobile push-notification blocking UI
- route transition loading states

This file is intentionally the global policy layer. Feature pages should not reimplement auth or app-wide gating decisions.

### Feature Organization

The app is organized primarily by feature area under `web/src/pages/`:

- `web/src/pages/auth/`
- `web/src/pages/dashboard/`
- `web/src/pages/admin/`

Reusable UI lives in:

- `web/src/components/ui/`

Service modules live in:

- `web/src/services/`

Shared utilities live in:

- `web/src/utils/`

### State Management

The app uses Solid primitives (`createSignal`, `createMemo`, `createResource`, `createEffect`) instead of a centralized global state library.

Why:

- most state is page-local or feature-local
- Solid signals are simple and fast
- avoiding a global store keeps data flow easier to reason about

When state must survive intra-feature navigation, the code uses small feature-scoped modules (for example `web/src/pages/dashboard/closings/SubmitClosing/_submitStore.ts`) instead of introducing app-wide state machinery.

### Service Layer

All API access should go through `web/src/services/*`.

Examples:

- `web/src/services/authService.ts`
- `web/src/services/closingsService.ts`
- `web/src/services/productsService.ts`
- `web/src/services/teamService.ts`

Why:

- components stay focused on UI and user flow
- backend payload normalization stays in one place
- auth headers, refresh handling, and error translation are centralized
- backend contract changes are easier to isolate

Do not add raw `fetch()` calls directly inside page components unless there is a very strong reason.

### Authentication Model

The current frontend is API-first.

- `web/src/services/authService.ts` handles OTP request/verification against the backend API
- access token + refresh token are stored in local storage
- `authService.onAuthStateChanged(...)` is the frontend subscription model used by the app shell
- authenticated API requests should use `authJson(...)`

### PWA and Mobile Behavior

The app is configured as an installable PWA through `vite-plugin-pwa`.

Relevant behavior:

- service worker registration uses `registerType: "prompt"`
- the app shows an explicit update UI when a new build is available
- mobile users are routed differently on first load to support install-first behavior
- push notifications are treated as mandatory for supported mobile environments

Key files:

- `web/vite.config.ts`
- `web/public/push-handlers.js`
- `web/src/services/pushService.ts`
- `web/src/App.tsx`

## Architectural Decisions

These are the current intentional design choices. Keep them consistent unless there is a clear reason to change direction.

### 1. Maintenance Mode Is a Root Wrapper, Not a Route

Maintenance mode lives above the router in `web/src/MaintenanceRoot.tsx`.

Why:

- it guarantees the rest of the app is blocked
- it avoids route-specific bypasses
- it keeps the behavior deterministic even if deep links are opened

### 2. Business Truth Comes From the Backend

The frontend should display and submit structured state, but the backend is the final source of truth for persisted business rules.

Example:

- rider status for closings is represented explicitly as `isRider`
- frontend should not infer business state from brittle UI conventions such as string prefixes in IDs

### 3. Lazy-Loaded Routes for Large Feature Areas

Most major pages are lazy-loaded from `web/src/App.tsx`.

Why:

- keeps initial bundle size down
- defers heavy screens until needed
- reduces startup cost on mobile

### 4. Feature-Local Helpers Over Premature Global Abstractions

The codebase uses helper modules like `_planUtils.ts`, `_submitStore.ts`, and `_closingsListViewState.ts` inside feature folders under `web/src/pages/`.

Why:

- keeps logic close to where it is used
- avoids bloating a generic shared layer with feature-specific behavior
- makes refactors easier because logic stays near the owning page

### 5. UI Uses Shared Primitives, Not Per-Page Reinvention

Buttons, modals, alerts, loading states, shells, and other repeated patterns live in `web/src/components/ui/`.

Why:

- consistency
- lower regression risk
- easier visual updates

### 6. Dev Proxy Instead of Hardcoded Dev Hosts in Components

Components and services should use relative API paths. Environment-specific host routing belongs in config, mainly `web/vite.config.ts` and `web/src/services/authService.ts`.

Why:

- cleaner service code
- fewer CORS surprises
- safer environment switching

## Maintenance Mode

Maintenance mode is controlled entirely in:

- `web/src/config/maintenance.ts`

This file is meant to be the single edit point for scheduling downtime.

### What To Change

Edit these values:

- `time_start`
- `time_end`
- optionally `title`
- optionally `message`

### Supported Format

Preferred local-time format:

```txt
YYYY-MM-DD HH:mm
```

Example:

```txt
2026-03-01 22:00
```

ISO timestamps also work if you want to make the timezone explicit.

### How It Works

- both `time_start` and `time_end` must parse successfully
- `time_start` must be earlier than `time_end`
- if either value is blank, maintenance mode is effectively disabled
- if the current time is inside the window, `MaintenanceRoot` renders the maintenance page instead of `App`

### Files Involved

- `web/src/config/maintenance.ts`
- `web/src/MaintenanceRoot.tsx`
- `web/src/index.tsx`

## Common Change Points

These are the files you will most likely edit for common frontend changes.

### Add or Change Routes

- `web/src/App.tsx`

Use this for:

- registering a new page
- protecting a route
- adjusting global route behavior

### Change Theme Tokens / Global Styling

- `web/src/index.css`

Use this for:

- brand colors
- font variables
- global component-level style rules
- shared animation tokens

### Change API Payloads or Endpoints

- `web/src/services/*.ts`

Use this for:

- request payload shape
- response normalization
- auth header behavior
- error handling

### Change App Name, PWA Manifest, or Icons

- `web/vite.config.ts`
- `web/public/icons/`
- `web/index.html`

Use this for:

- app display name per environment
- manifest icon set
- browser title and app-shell substitutions

### Change Push / Notification Enforcement

- `web/src/App.tsx`
- `web/src/services/pushService.ts`
- `web/public/push-handlers.js`

### Change Maintenance Window

- `web/src/config/maintenance.ts`

## Useful Frontend File Map

```txt
web/src/
  index.tsx                       app bootstrap
  MaintenanceRoot.tsx             maintenance gate
  App.tsx                         global app shell and routes
  index.css                       theme tokens and global styles
  config/
    maintenance.ts                maintenance schedule
  components/
    ui/                           shared UI primitives
  pages/
    auth/                         login + OTP flow
    dashboard/                    main product screens
    admin/                        admin-only screens
  services/                       API clients and domain data transforms
  utils/                          pure helpers
```

## Deployment Notes

The frontend is a static build output generated into `web/dist/`.

Typical flow:

1. set environment variables for the target environment
2. run `npm --prefix web run build`
3. deploy the `web/dist/` output to your static hosting target

Current production hosting shape:

1. deploy the SPA build into `public_html/`
2. deploy the Laravel app outside web root, for example `~/laravel-api`
3. expose the backend at `public_html/api -> ~/laravel-api/public`
4. keep `VITE_API_BASE_URL=https://hub.mfag.sg` so browser requests stay same-origin and resolve to `/api/...`

If backend hosts or mount points differ by environment, confirm:

- `VITE_API_BASE_URL`
- any proxy assumptions
- PWA manifest/app name behavior in `web/vite.config.ts`

## Frontend Guardrails

- Keep backend access inside service modules.
- Prefer explicit booleans/fields over name-based heuristics.
- Put app-wide gates in the root layer, not inside individual pages.
- Reuse `web/src/components/ui/` primitives before adding bespoke duplicated UI.
- For large features, keep helpers near the feature unless they are truly cross-cutting.

## When Updating This README

Update this file whenever any of these change:

- app bootstrap flow
- maintenance-mode behavior
- environment variable names
- route architecture
- service-layer conventions
- deployment assumptions

That keeps onboarding and future maintenance aligned with how the frontend actually works.
