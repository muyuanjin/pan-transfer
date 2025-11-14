<!-- OPENSPEC:START -->

# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:

- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:

- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Chaospace Extension — Agent Guide

_Last updated: 2025-11-05 (UTC-8)_

## Core Principles

- **Mission**: Deliver a Manifest V3 Chrome extension using Vite 7 + TypeScript 5.9 + Vue 3 that mirrors the legacy behaviour while adding modern safety/tooling.
- **Source of truth**: All active code lives in `src/`. Treat `chaospace-extension/` as read-only reference for parity checks.
- **Quality gate**: Keep `npm run check` green (format:check → typecheck → lint:ci → build → vitest → playwright) before handing work back.
- **Logging**: Prefix runtime logs with `[Pan Transfer]` across background, content, and UI contexts.

## !!IMPORTANT!! Keep `winexec npm run check` green before handing work back!!!

## Architecture Snapshot

- **Background service worker**: `src/background/index.ts` (module). Uses typed message guards, services under `src/background/services/`, and storage/cache utilities in `src/background/storage/`.
- **Content runtime**: `src/content/index.ts` instantiates `ContentRuntime` (`src/content/runtime/runtime.ts`). Vue components render the floating panel (`components/PanelRoot.vue`), resource list (`components/ResourceListView.vue`), history overlays (`components/history/*.vue`), and detail modal. Controllers/binders live under `src/content/{controllers,history,runtime/ui}`; shared state sits in `src/content/state/index.ts`.
- **Shared modules**: Cross-context types in `src/shared/types/transfer.ts`; sanitizers/completion helpers in `src/shared/utils/`.
- **Styles**: Modular CSS under `src/content/styles/{foundation,overlays,utilities}` with `styles.loader.ts` for on-demand injection.
- **Testing**: Vitest specs cover parser/page analyzer/history/resource renderers (`src/**/__tests__`), and Playwright e2e (`tests/e2e/panel.spec.ts`) validates the built extension.

## Tooling & Commands

- Install deps once with `npm install`.
- Development preview: `npm run dev`.
- Primary checks: `npm run check` (required), which runs `format:check → typecheck → lint:ci → build → vitest → e2e` without mutating the worktree and fails on any ESLint warning.
- Individual commands:
  - `npm run typecheck` — `vue-tsc --noEmit -p tsconfig.app.json`
  - `npm run build` — typecheck + Vite production build to `dist/`
  - `npm run test` — Vitest suites
  - `npm run e2e` — Playwright smoke (builds automatically if `dist/` is missing)
  - `npm run lint:ci` — ESLint with `--max-warnings=0` for CI parity
- Optional: `web-ext lint --source-dir dist` for manifest/API validation.

## Coding Conventions

- TypeScript + Vue SFC; two-space indentation; prefer `const`/`let`; trailing commas when helpful.
- DOM hooks follow clear kebab-case data-role or class selectors. Exported functions use camelCase (`normalizePath`, `buildSurl`).
- Keep reusable helpers near consumers; only create new shared subdirectories when multiple entry points rely on the code.
- New Vue components should load scoped styles via existing modular CSS patterns.

## Testing Expectations

- Run Playwright (`npm run e2e`) after building; ensure the panel loads on real CHAOSPACE pages without `[Pan Transfer]` errors.
- When touching background transfer/history flows, manually verify via Chrome devtools (Network tab) and ensure retries handle known Baidu errno codes.
- Document new manual verification steps alongside code changes (PR descriptions or notes).

## Safety & Compliance

- Never commit personal Baidu credentials, cookies, or user data; rely on local `.env` or Chrome profile storage.
- Highlight any new permissions requested in `src/manifest.json` so reviewers can assess risk.
- Remember the legacy MV2 bundle is frozen—do not modify files in `chaospace-extension/`.
