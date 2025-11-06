# Chaospace MV3 Refactor Plan

_Last updated: 2025-11-06 (UTC-8)_

## Mission & Guardrails

- Deliver the Manifest V3 extension with Vite 7 + TypeScript 5.9 + Vue 3 while matching or exceeding the frozen `chaospace-extension/` behaviour.
- Confine all active code to `src/` and keep `[Chaospace Transfer]` as the unified runtime log prefix.
- Treat `chaospace-extension/` as a read-only parity reference.
- Keep `npm run check` green before sharing builds (format → typecheck → lint → build → Vitest → Playwright).

## Recent Progress (since 2025-11-05)

- `npm run check` succeeded on 2025-11-06 02:16 (UTC-8), covering Prettier, vue-tsc, ESLint, Vite production build, 10 Vitest suites, and 3 Playwright scenarios; fresh `dist/` artifacts were produced.
- Added Pinia-driven specs for `panel-preferences` (`src/content/controllers/panel-preferences.spec.ts`) and history orchestration (`src/content/history/controller.spec.ts`), reducing manual regressions in panel state hydration and batch deletes.
- Page analyzer coverage now consumes real CHAOSPACE HTML fixtures under `src/content/services/__fixtures__/`, and the Playwright harness (`tests/e2e/panel.spec.ts`) proxies CHAOSPACE domains offline so we can stress multiple detail pages per run without external network.
- The settings modal gained fully programmatic editors for file filters and rename rules (`src/content/components/settings/file-filter-editor.ts` and `file-rename-editor.ts`), backed by new sanitizers in `src/shared/settings.ts` and surfaced through the Pinia store (`src/content/state/index.ts`).
- Migrated the resource toolbar (sorting + selection) from imperative binders to `PanelToolbar.vue` + `toolbar-context`, leveraging Pinia refs and VueUse keyboard listeners; verified via the full `npm run check` sweep on 2025-11-06 02:16 (UTC-8).
- Trimmed `page-analyzer.spec.ts` runtime (~0.89s → ~0.81s) by caching fixture reads and resetting analyzer caches through a dedicated test hook, keeping fetch/document behaviour intact.

## Current Status Snapshot

### Tooling & Build

- `vite.config.ts` bootstraps background (`src/background/index.ts`), content (`src/content/index.ts`), and shared style entrypoints via `@vitejs/plugin-vue`, PostCSS nesting/autoprefixer, and `vite-plugin-web-extension` targeting `src/manifest.json`.
- TypeScript configs split runtime (`tsconfig.app.json`) and tooling (`tsconfig.node.json`); `.vue` typing lives in `src/env.d.ts`.
- Scripts: `npm run dev`, `npm run build` (vue-tsc + Vite prod), `npm run test`, `npm run e2e`, and the aggregated `npm run check`. Formatting/linting rely on Prettier + ESLint Vue/TS presets.

### Background Service Worker

- Module worker entry `src/background/index.ts` wires message guards around history, transfer, and settings requests.
- Transfer orchestration lives in `src/background/services/transfer-service.ts`, backed by API clients in `src/background/api/` and retry/error utilities in `src/background/common/`.
- Persistent stores (`src/background/storage/{history-store.ts,cache-store.ts}`) encapsulate indexed data, while `src/background/services/history-service.ts` feeds content-side groups and detail overlays.
- HTML parsing is centralized in `src/background/services/parser/parser-service.ts` with hardened helpers and fixtures ensuring `[Chaospace Transfer]` logs surface sanitization failures.

### Content Runtime & UI

- `ContentRuntime` (`src/content/runtime/runtime.ts`) instantiates `createRuntimeApp` (`src/content/runtime/app.ts`), which coordinates the Pinia store (`src/content/state/index.ts`), panel runtime state (`src/content/runtime/panel-state.ts`), and DOM binders under `src/content/runtime/ui/binders/`.
- Controllers include logging, panel edge, and panel preferences (`src/content/controllers/*.ts`), season aggregation (`src/content/services/season-manager.ts` + `season-loader.ts`), chrome-event lifecycle hooks, and the transfer controller (`src/content/runtime/transfer/transfer-controller.ts`).
- Vue components render the floating panel shell (`src/content/components/PanelRoot.vue`), resource list (`ResourceListView.vue`), history overlays (`src/content/components/history/*.vue`), toasts, zoom preview, and the settings modal plus editors.
- `panelDom` / `detailDom` refs remain defined in `src/content/types.ts` and back the remaining imperative binders (history, presets, transfer), while the resource toolbar now renders via `PanelToolbar.vue` + the toolbar context composable.

### Shared Modules

- Cross-context payloads sit in `src/shared/types/transfer.ts`.
- Sanitizers, completion helpers, and Baidu-specific utilities live in `src/shared/utils/`.
- File filter / rename rule parsing plus evaluation helpers are centralized in `src/shared/settings.ts` and exercised by `src/shared/__tests__/settings.spec.ts`.

### Testing & QA

- Vitest suites cover parser service, file rules, season manager, tab-season preferences, history services, panel renderers, and shared settings (10 spec files run in the latest `npm run check`).
- `tests/e2e/panel.spec.ts` spins up Chromium with the built extension, intercepts CHAOSPACE domains, and loads three representative detail pages without emitting `[Chaospace Transfer]` console errors (movie + two TV shows).
- Manual validation on live CHAOSPACE pages is still pending before shipping the next artifact.

### Legacy Baseline

- `chaospace-extension/` remains the Manifest V2 snapshot for parity checks only—do not edit.

## Completed Foundation

- MV3 manifest, Vite 7 bundling, and Vue 3 SFC build flow are stable with reproducible `dist/` outputs.
- Pinia-backed content state plus `panel-state` provide a single source of truth for transfer progress, selections, and persisted edge/pin settings.
- Season loaders, history controllers, and parser services share fixtures to guarantee deterministic transformations across background/content boundaries.
- Settings modal now exposes file filter/rename editors wired to shared sanitizers, ensuring user-configurable transfer processing is serializable.
- Playwright smoke tests run as part of `npm run check`, enabling regression catches without relying on external network access.

## Outstanding Work (Prioritized)

| Priority | Status      | Area            | Task                                                                                                                                                                    | Notes                                                                                |
| -------- | ----------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| P0       | Todo        | Verification    | Exercise the built MV3 extension on live CHAOSPACE pages (panel mount, history overlay, transfer actions, settings import/export) and capture findings for the next PR. | Fixture-backed Playwright runs do not cover production responses or auth edge cases. |
| P0       | Todo        | Transfer        | Re-run a live transfer to validate `season-manager` sanitization (`getTargetPath`, `seasonDirMap`, `seasonResolvedPaths`) against real Baidu resources.                 | Needed before enabling new presets or exposing rename rules by default.              |
| P1       | Todo        | Content Runtime | Remove catch-all index signatures from `PanelDomRefs` / `DetailDomRefs`, and require binders/controllers to enumerate the DOM hooks they need.                          | Surfaces missing data-role wiring and tightens compile-time safety.                  |
| P1       | In Progress | Testing         | Extend controller specs to cover `panel-edge-controller` and `runtime/transfer/transfer-controller` (pinning, retries, status transitions).                             | `panel-preferences` tests landed; remaining controllers still only have manual QA.   |
| P1       | Todo        | Messaging       | Introduce integration tests that simulate Chrome runtime messaging for transfer progress + history detail/delete flows.                                                 | Required before granting stricter host permissions and alarm-based retries.          |
| P1       | Todo        | Settings        | Add DOM-level tests for the file filter & rename editors to verify parsing, validation, and serialization paths.                                                        | Shared sanitizers are covered, but the UI editors remain untested.                   |
| P2       | In Progress | UI Migration    | Finish migrating history filters and presets list to Vue components/composables (toolbar now lives in `PanelToolbar.vue`).                                              | Reduces complexity inside `src/content/runtime/ui/binders/` and improves reactivity. |
| P2       | Planned     | Parser Coverage | Expand CHAOSPACE HTML fixtures with malformed or partial markup (missing passcodes, nested season links) and assert graceful fallbacks.                                 | Focus in `src/background/services/parser/__tests__`.                                 |
| P2       | Planned     | Documentation   | Publish developer notes covering ContentRuntime orchestration, edge/pin persistence, and how to run tests/e2e locally.                                                  | Can live alongside this document or under `/docs`.                                   |

## Verification History

- 2025-11-06 — `npm run check` — PASS (Prettier → vue-tsc → ESLint → Vite build → Vitest ×10 files → Playwright ×3 URLs).

## Release Verification Checklist

- `npm run check` (format → typecheck → lint → build → unit tests → Playwright).
- Manual smoke test on a live CHAOSPACE episode (panel mount, resource selection, transfer execution, history detail, settings import/export).
- Optionally run `web-ext lint --source-dir dist` before packaging/signing.

## Key References

- Background entry: `src/background/index.ts`
- Transfer orchestration: `src/background/services/transfer-service.ts`
- History service + storage: `src/background/services/history-service.ts`, `src/background/storage/history-store.ts`
- Content runtime orchestrator: `src/content/runtime/app.ts`
- Panel shell + Vue entry: `src/content/components/PanelRoot.vue`
- Resource list renderer: `src/content/components/ResourceListView.vue`
- History controller: `src/content/history/controller.ts`
- Transfer controller: `src/content/runtime/transfer/transfer-controller.ts`
- Page analyzer + fixtures: `src/content/services/page-analyzer.ts`, `src/content/services/__fixtures__/`
- Shared settings + sanitizers: `src/shared/settings.ts`
