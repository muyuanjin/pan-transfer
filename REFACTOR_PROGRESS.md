# Chaospace MV3 Refactor Plan

_Last updated: 2025-11-05 (UTC-8)_

## Mission & Guardrails

- Deliver a Manifest V3 extension with Vite 7 + TypeScript 5.9 + Vue 3 that matches or exceeds the legacy `chaospace-extension/` behaviour.
- Confine all new code to `src/`. Treat `chaospace-extension/` as read-only parity reference.
- Preserve the `[Chaospace Transfer]` logging prefix across service worker, popup, and content contexts.
- Keep `npm run check` green (format, typecheck, lint, build, unit tests, e2e) before publishing artifacts.

## Current Status Snapshot

### Tooling & Build

- Vite configuration (`vite.config.ts`) boots from `src/`, applies `@vitejs/plugin-vue`, PostCSS nesting + autoprefixer, and outputs to `dist/`.
- WebExtension bundling handled by `vite-plugin-web-extension`, targeting `src/manifest.json` (MV3 service worker + content script).
- TypeScript strict configs split into `tsconfig.app.json` (runtime) and `tsconfig.node.json` (tooling); `.vue` types declared in `src/env.d.ts`.
- Scripts: `npm run dev`, `npm run build` (typecheck + Vite production), `npm run check` (format → typecheck → lint → build → vitest → playwright).

### Background Service Worker

- Entry: `src/background/index.ts` (module service worker) with typed message guards for history/transfer/update requests.
- API clients live in `src/background/api/{baidu-pan.ts, chaospace.ts}`; errors/constants under `src/background/common/`.
- Transfer orchestration in `services/transfer-service.ts`, reusable persistence in `storage/{cache-store.ts, history-store.ts}`, and path/share helpers in `utils/`.
- HTML parsing hardened via `services/parser-service.ts` + `parser/html-helpers.ts` with Vitest fixtures.

### Content Runtime & UI

- Entry: `src/content/index.ts` instantiates `ContentRuntime` (`runtime/runtime.ts`) which wires controllers, binders, and Vue components.
- Vue SFCs: panel shell (`components/PanelRoot.vue`), resource list (`ResourceListView.vue`), history overlays (`components/history/*.vue`), detail modal (`HistoryDetailOverlay.vue`).
- Runtime controllers/binders under `src/content/{controllers,history,runtime/ui}` manage logging, panel preferences, edge-hiding, selection, presets, and history view.
- Global state defined in `state/index.ts`; DOM refs typed in `types.ts`; dynamic CSS loaded via `styles.loader.ts`.
- Modular CSS resides in `src/content/styles/{foundation,overlays,utilities}` with critical styles eagerly injected.

### Shared Modules

- `src/shared/types/transfer.ts` encodes cross-context payloads.
- Utilities (`src/shared/utils/{sanitizers.ts, completion-status.ts, chinese-numeral.ts}`) support both background and content runtimes.

### Testing & QA

- Unit tests (Vitest + jsdom) cover parser, season/page analyzers, history services, and Vue renderers.
- Playwright e2e spec (`tests/e2e/panel.spec.ts`) loads the production build inside Chromium and asserts panel boot without `[Chaospace Transfer]` errors.
- Manual validation still required on live CHAOSPACE pages for transfer and history flows.

### Legacy Baseline

- `chaospace-extension/` keeps the MV2 implementation for behavioural diffing only—do not modify.

## Completed Foundation

- Migrated build/system to Vite 7 + TypeScript + Vue 3 with MV3 manifest authored in `src/manifest.json`.
- Refactored background logic into typed services/storage layers with progress logging hooks.
- Rebuilt content runtime with `ContentRuntime`, modular controllers, Vue-driven panels, and typed shared state.
- Established automated quality gates: `vue-tsc`, ESLint (Vue/TS rules), Vitest suites, and Playwright smoke test.

## Outstanding Work (Prioritized)

| Priority | Status  | Area            | Task                                                                                                                                                              | Notes                                                             |
| -------- | ------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P0       | Todo    | Verification    | Run a full Chrome smoke test exercising history overlay, resource list interactions, transfer actions, and settings flows; capture findings for the next PR.      | Required before the next release build.                           |
| P0       | Todo    | Verification    | Re-run a live transfer to confirm `season-manager` sanitization removes legacy suffixes and directories resolve correctly.                                        | Validate `getTargetPath` output with real CHAOSPACE data.         |
| P1       | Todo    | Content Runtime | Replace catch-all index signatures in `PanelDomRefs`/`DetailDomRefs` and update binders/controllers to use explicit, typed selectors.                             | Improves compile-time safety and surfaces missing DOM hooks.      |
| P1       | Todo    | Content Runtime | Add Vitest coverage for `panel-edge-controller`, `panel-preferences`, and `runtime/transfer-controller` to lock edge-hide/pinning and transfer state transitions. | Mock DOM refs + chrome messaging for deterministic tests.         |
| P1       | Todo    | Messaging       | Introduce integration tests that cover background/content messaging flows (transfer progress, history detail/delete) with mocked Chrome APIs.                     | Prevent regressions before enabling stricter runtime permissions. |
| P2       | Planned | UI Migration    | Evaluate migrating panel history filters, presets list, and settings toggles into Vue components/composables to remove manual data-\* wiring.                     | Target: reduce `runtime/ui/binders` complexity.                   |
| P2       | Planned | Parser Coverage | Extend parser fixtures to malformed/edge CHAOSPACE markup to ensure graceful error handling.                                                                      | Augment `src/background/services/parser/__tests__`.               |
| P2       | Planned | Documentation   | Produce developer notes describing `ContentRuntime` orchestration, season loading flow, and test entry points for onboarding.                                     | Publish alongside this plan or in `/docs`.                        |

## Release Verification Checklist

- `npm run check` (format → typecheck → lint → build → unit tests → Playwright).
- Manual smoke test on a live CHAOSPACE episode (panel mount, resource selection, transfer execution, history detail, settings import/export).
- Optionally run `web-ext lint --source-dir dist` before packaging.

## Key References

- Background entry: `src/background/index.ts`
- Content runtime orchestrator: `src/content/runtime/runtime.ts`
- Vue panel shell: `src/content/components/PanelRoot.vue`
- Resource list renderer: `src/content/components/resource-list.ts`
- Season logic: `src/content/services/season-manager.ts`
- Shared transfer types: `src/shared/types/transfer.ts`
