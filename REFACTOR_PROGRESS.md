# Chaospace MV3 Refactor Plan

_Last updated: 2025-11-06 10:20 (UTC-8)_

## Agent Operating Instructions

### Immediate Orders (execute sequentially)

1. ~~**Finish the history overlay Vue migration.** Remove `createHistoryListBinder` + related DOM wiring, provide a composable (via `history-context`) that exposes selection toggles, detail open, poster preview, open-pan, and retry actions, and inject it inside `HistoryListView.vue`, `HistorySummaryView.vue`, and the season rows. Delete any now-unused `panelDom` keys. Definition of done: Vue handles every `HISTORY_LIST_ACTION_EVENT` scenario, Vitest coverage proves the composable dispatches controller calls, and `npm run check` is green.~~ **Completed 2025-11-06 07:35 (UTC-8):** `useHistoryListActions` now wraps the history controller, Vue components call it directly, `history-card` provides the context, legacy binder/event files were deleted, and new Vitest coverage guards the action handlers with `npm run check` passing.
2. **Tighten `PanelDomRefs`.** After the binder removal, drop the proxy catch-all/index signature in `src/content/types.ts`, expose explicit getters for the few remaining DOM hooks (edge/transfer/base-dir), and fail fast when a controller asks for an unregistered key. Update all controllers/binders accordingly. Definition of done: TypeScript errors whenever arbitrary keys are accessed, and `npm run check` still passes.
3. **Backfill controller specs.** Add Vitest suites for `panel-edge-controller` and `runtime/transfer/transfer-controller` covering pointer hide/show, pin button sync, transfer state transitions, retries, and toast emission. Guard DOM references with test doubles so future refactors remain safe. Definition of done: new specs live under `src/content/controllers/__tests__` (or similar), run inside `npm run test`, and fail without the new behaviours.
4. **Stand up messaging integration tests.** Build a lightweight harness that simulates Chrome runtime messages hitting `src/background/index.ts`, asserting that transfer progress + history detail/delete flows update the content store correctly. These tests unblock stricter host permissions and alarm retries. Definition of done: integration suite runs as part of `npm run test` (or a new npm script referenced in `npm run check`).
5. **Re-verify on live CHAOSPACE pages.** After the above refactors land, load the MV3 build in Chrome, exercise panel mount, transfer, history detail, settings import/export, and re-run at least one real transfer focusing on `season-manager` sanitization. Capture findings for the next PR description.

### If Blocked

- Write down the blocker in this file under “Outstanding Work” with today’s date and what you tried.
- If tooling causes failure, log the command + error in AGENT notes (not here) and move to the next highest priority task.

### Definition of Done (per task)

- `npm run check` must be green (format → vue-tsc → ESLint → Vite build → Vitest → Playwright) before handing off.
- Update this file’s “Recent Progress” + “Verification History” entries when a task completes.
- Note any new permissions in `src/manifest.json` and document manual verification steps in your PR notes.

## Standing Guardrails

- Mission: Ship a Manifest V3 Chrome extension built with Vite 7 + TypeScript 5.9 + Vue 3 that meets or exceeds the frozen `chaospace-extension/` behaviour.
- Source of truth: keep all active code in `src/`; treat `chaospace-extension/` as read-only reference material.
- Logging: prefix runtime logs with `[Chaospace Transfer]` across background, content, and UI contexts.
- Never regress manual workflows—use the legacy MV2 bundle only for parity checks.

## Recent Progress (since 2025-11-05)

- Finished the history overlay Vue migration (2025-11-06 07:35 UTC-8): removed `createHistoryListBinder`, introduced the `useHistoryListActions` composable under `history-context`, rewired `HistoryListView`/`HistorySummaryView` and season rows to call controller APIs directly, and updated `history-card` to provide the context plus Pinia-backed unit coverage.
- `npm run check` passed on 2025-11-06 03:45 (UTC-8), producing fresh `dist/` artifacts after running Prettier, vue-tsc, ESLint, Vite build, 10 Vitest suites, and 3 Playwright scenarios.
- Added Pinia-driven specs for `panel-preferences` and history orchestration, covering panel state hydration and batch deletes.
- Page analyzer coverage now uses real CHAOSPACE fixtures under `src/content/services/__fixtures__/`, and Playwright proxies CHAOSPACE domains offline for multi-page runs.
- Settings modal now includes programmatic file filter + rename editors backed by `src/shared/settings.ts` sanitizers and Pinia state wiring.
- Resource toolbar, history filter tabs, presets list, search bar, and batch toolbar now live in Vue components with provide/inject contexts, replacing imperative binders and shrinking `panelDom` usage.
- `page-analyzer.spec.ts` runtime reduced via cached fixtures and a cache reset test hook.
- Scoped Panel DOM accessors added (2025-11-07 10:24 UTC-8): logging controller, header presenter, history controller, and season/item binders now consume `getPanelLoggingDom`/`getPanelHeaderDom`/`getPanelHistoryDom`/`getPanelResourceDom`, eliminating direct `panelDom.*` usage in those areas.

## Current Status Snapshot

### Tooling & Build

- `vite.config.ts` bundles background (`src/background/index.ts`), content (`src/content/index.ts`), and style entrypoints via `@vitejs/plugin-vue`, PostCSS nesting, autoprefixer, and `vite-plugin-web-extension` targeting `src/manifest.json`.
- TypeScript configs: `tsconfig.app.json` for runtime (with `.vue` typing in `src/env.d.ts`) and `tsconfig.node.json` for tooling. Scripts: `npm run dev`, `npm run build`, `npm run test`, `npm run e2e`, and `npm run check`.

### Background Service Worker

- Entry `src/background/index.ts` registers typed message guards for history, transfer, and settings requests.
- Transfer orchestration lives in `src/background/services/transfer-service.ts`, backed by API clients under `src/background/api/` and retry/error helpers in `src/background/common/`.
- Persistent stores (`src/background/storage/history-store.ts`, `cache-store.ts`) feed `history-service.ts`, which supplies content-side groups and detail overlays.
- Parser logic centralizes in `src/background/services/parser/parser-service.ts` with hardened helpers plus fixtures to surface `[Chaospace Transfer]` sanitization failures.

### Content Runtime & UI

- `ContentRuntime` (`src/content/runtime/runtime.ts`) spawns `createRuntimeApp` (`runtime/app.ts`), coordinating Pinia state (`src/content/state/index.ts`), panel runtime state (`runtime/panel-state.ts`), and the remaining DOM binders under `runtime/ui/binders/`.
- Controllers manage logging, panel edge, panel preferences, season aggregation (`season-manager.ts` + `season-loader.ts`), Chrome lifecycle hooks, and transfer orchestration (`runtime/transfer/transfer-controller.ts`).
- Vue components render the floating panel shell (`components/PanelRoot.vue`), resource list, history overlays (`components/history/*.vue`), toasts, zoom preview, and the settings modal editors.
- `panelDom` / `detailDom` refs still back legacy binders (history list, item selection, transfer, etc.); the binder footprint is already reduced thanks to Vue-driven toolbar/filter/search flows.

### Shared Modules

- Cross-context payloads live in `src/shared/types/transfer.ts`.
- Sanitizers, completion helpers, and Baidu-specific utilities sit in `src/shared/utils/`.
- File filter / rename rule parsing + evaluation resides in `src/shared/settings.ts` with tests under `src/shared/__tests__/settings.spec.ts`.

### Testing & QA

- Vitest suites cover parser service, file rules, season manager, tab-season preferences, history services, panel renderers, and shared settings (10 spec files in the latest `npm run check`).
- `tests/e2e/panel.spec.ts` launches Chromium with the extension, intercepts CHAOSPACE domains, and loads three representative detail pages without `[Chaospace Transfer]` errors.
- Manual validation on live CHAOSPACE pages remains outstanding before the next artifact ships.

## Action Backlog (maintain after completing Immediate Orders)

| Priority | Status      | Area            | Task                                                                                                                                               | Notes                                                                        |
| -------- | ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P0       | Todo        | Verification    | Exercise the built MV3 extension on live CHAOSPACE pages (panel mount, history overlay, transfer, settings import/export) and log findings.        | Fixture-backed Playwright runs miss production responses/auth edge cases.    |
| P0       | Todo        | Transfer        | Re-run a live transfer to validate `season-manager` sanitization (`getTargetPath`, `seasonDirMap`, `seasonResolvedPaths`) against Baidu resources. | Required before enabling new presets or exposing rename rules by default.    |
| P1       | Todo        | Content Runtime | Remove catch-all index signatures from `PanelDomRefs` / `DetailDomRefs` and require binders/controllers to enumerate DOM hooks.                    | Surfaces missing data-role wiring and tightens compile-time safety.          |
| P1       | In Progress | Testing         | Extend controller specs to cover `panel-edge-controller` and `runtime/transfer/transfer-controller`.                                               | `panel-preferences` tests exist; others still manual.                        |
| P1       | Todo        | Messaging       | Introduce integration tests simulating Chrome runtime messaging for transfer progress + history detail/delete flows.                               | Needed before stricter host permissions + alarm retries.                     |
| P1       | Todo        | Settings        | Add DOM-level tests for file filter & rename editors to verify parsing, validation, and serialization paths.                                       | Shared sanitizers are covered; UI editors aren’t.                            |
| P2       | Done        | UI Migration    | History filters + presets list live in Vue components; toolbar in `PanelToolbar.vue`.                                                              | `HistoryFilterTabs.vue` + `PresetList.vue` replace old binders (2025-11-06). |
| P2       | Planned     | Parser Coverage | Expand CHAOSPACE HTML fixtures with malformed/partial markup to assert fallbacks in `src/background/services/parser/__tests__`.                    | Focus on missing passcodes, nested season links.                             |
| P2       | Planned     | Documentation   | Publish developer notes covering ContentRuntime orchestration, edge/pin persistence, and how to run tests/e2e locally.                             | Live either alongside this document or under `/docs`.                        |

## Verification History

- 2025-11-07 10:24 (UTC-8) — `npm run check` — PASS (Prettier → vue-tsc → ESLint → Vite build → Vitest ×11 → Playwright ×3 URLs).
- 2025-11-06 07:33 (UTC-8) — `npm run check` — PASS (Prettier → vue-tsc → ESLint → Vite build → Vitest ×11 → Playwright ×3 URLs).
- 2025-11-06 — `npm run check` — PASS (Prettier → vue-tsc → ESLint → Vite build → Vitest ×10 → Playwright ×3 URLs).

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
