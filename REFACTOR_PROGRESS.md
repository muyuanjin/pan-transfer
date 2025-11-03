# Chaospace Vite Refactor — Progress Archive

## Branch & Environment
- **Branch**: `feature/vite-refactor`
- **Date snapshot**: 2025-11-03 (UTC-8 assumed)
- **Tooling**: Node project initialized, `vite` + `vite-plugin-web-extension` installed.
- **Build config**: `vite.config.js` targets `src/manifest.json`, outputs to `dist/`.

## Current Project Layout Snapshot
```
src/
  manifest.json
  public/               # extension icons
  background/
    api/{baidu-pan.js, chaospace.js}
    common/{constants.js, errors.js}
    services/{transfer-service.js, history-service.js, parser-service.js}
    storage/{cache-store.js, history-store.js, utils.js}
    utils/{path.js, share.js}
    index.js
  content/
    constants.js
    state/index.js
    services/page-analyzer.js
    services/history-service.js
    components/
      toast.js
      zoom-preview.js
      history-detail.js
      history-card.js
    utils/dom.js
    styles/              # pending modular split; currently legacy CSS still in use
    index.js             # still large orchestration script
  shared/utils/{sanitizers.js, completion-status.js}
chaospace-extension/     # legacy files (background.js, contentScript.js, etc.) still present
```

## Working Commands
- `npm install` (once) to restore dependencies.
- `npm run build` (alias for `vite build --mode production`; manifest validation disabled in `vite.config.js` to avoid remote schema hangs) to emit production bundles under `dist/`.
- `web-ext lint --source-dir dist` or `chaospace-extension/` (legacy) to validate manifest/API usage.
- `zip -r chaospace-extension.zip dist` when packaging for manual sharing (after parity validation).

## Completed Milestones
1. **Tooling & Build Setup**
   - Created refactor branch, initialized npm project, added Vite + web-extension plugin.
   - Added `vite.config.js`, relocated manifest/icons into `src/`.
2. **Background Modularization**
   - Broke legacy `background.js` into API, storage, service, and utility modules under `src/background/`.
   - `background/index.js` now wires Chrome listeners to modular services.
3. **Content Architecture Kick-off**
   - Ported legacy `contentScript.js` to `src/content/index.js`.
   - Added `constants.js`, `state/index.js`, and `services/page-analyzer.js`.
4. **Content History/Data Services**
   - Created `src/content/services/history-service.js` for history normalization, grouping, batching helpers, and Chrome messaging (`fetchHistorySnapshot`, `requestHistoryUpdate`, etc.).
   - `src/content/index.js` now consumes these helpers instead of duplicating logic.
5. **Component Extraction (content)**
   - `components/toast.js`: toast rendering encapsulated.
   - `components/zoom-preview.js`: image preview overlay installed via `installZoomPreview()`.
   - `components/history-detail.js`: modal layout/rendering, response normalization, and overlay mounting extracted.
   - `utils/dom.js`: currently exposes `disableElementDrag` to share drag suppression between components.
6. **Build Pipeline Unblocked**
   - Updated Vite config to use `src` as root so plugin resolves background entry.
   - Ported legacy `floatingButton.css` into `content/styles/main.css` and adjusted manifest action icon schema.
   - `npm run build` now completes successfully and emits background/content bundles plus manifest.
   - Fixed manifest icon paths so unpacked builds load in Chrome without missing asset errors.
   - Disabled manifest schema validation during Vite builds to prevent long-running HTTPS checks in offline environments.
7. **History Card Component**
   - Extracted history list + summary rendering into `src/content/components/history-card.js`.
   - Hoisted duplicate helpers (status badge, pan URL resolution, timestamp formatting) into the component.
   - Entry script now delegates to the component with explicit state/DOM context wiring.
8. **Bug Fixes & Parity**
   - Normalized season directory sanitization to drop trailing status/date clutter (e.g. `已完结` suffixes).
   - Restored poster/still zoom preview interactions inside the history detail modal.
   - Page analyzer now strips `- CHAOSPACE` suffixes from titles so suggested directories match the on-page heading.
   - Addressed pin toggle focus retention that previously disabled edge-hide and hover animations after unpinning.
   - Season tabs/items now sanitize trailing broadcast dates, status badges, and ratings so in-panel labels stay concise.
9. **Panel Shell Component**
   - Extracted the floating panel creation + drag/resize/edge-hide behaviour into `src/content/components/panel.js`, and updated the entry orchestrator to manage state via the new module.
10. **Resource List Component**
    - Moved resource list rendering, empty-state handling, and summary counters into `src/content/components/resource-list.js`.
    - `src/content/index.js` now wires list updates through the new renderer, while preserving transfer button updates and season controls.
11. **Season Label Cleanup**
    - Added `normalizeSeasonLabel` so tab labels, item badges, and path previews drop trailing broadcast dates/status badges/ratings.
    - Deferred season hydration, initial scrape results, and persisted state now re-sanitize season names before rendering.
12. **Settings Modal Component**
    - Migrated the settings overlay flow into `src/content/components/settings-modal.js`, covering open/close behavior, form submission, and import/export handlers.
    - `src/content/index.js` now delegates modal wiring to the component, with `clampHistoryRateLimit`/`sanitizePreset` exported for reuse across the entry script and component helpers.

## Latest Session (2025-11-03, evening)
- Extracted the resource list UI into `components/resource-list.js`, clearing 400+ LOC from `content/index.js`.
- Sanitized season labels end-to-end (initial scrape, deferred loads, state hydration) to remove trailing dates/status text that was leaking into the UI and filesystem paths.
- Updated the build pipeline to skip manifest schema validation and wired `npm run build` to `vite build --mode production`, eliminating the long-blocking schema download.
- Verified `npm run build` completes locally (~5.5s) and confirmed bundles land in `dist/`.
- Refreshed AGENTS.md with the new build instructions for future contributors.
- Extracted the settings modal into `components/settings-modal.js`, moving import/export, layout reset, and open/close handlers out of `content/index.js`.
- Re-ran `npm run build` (2025-11-03) after the settings refactor to confirm bundles stay green.

## Work in Progress / Partial Refactors
- `src/content/index.js` is still ~6k LOC; history list rendering, panel UI, storage persistence, and event wiring remain inline.
- HistoryDetail/Toast/ZoomPreview/HistoryCard/Panel/ResourceList/SettingsModal components extracted; remaining inline orchestration, storage helpers, and logging utilities still need modularization.
- Legacy `chaospace-extension/` assets remain untouched for parity until refactor completes.

## Outstanding Tasks & TODOs
### A. Content Modularization
- [x] Extract history list/card rendering into `components/history-card.js` (selection checkboxes, summary, batch controls).
- [x] Extract panel shell + drag/resize logic into `components/panel.js` (or similar) and import from entry script.
- [x] Extract resource list rendering, selection toggles, and pagination into `components/resource-list.js`.
- [x] Move settings modal logic into `components/settings-modal.js`.
- [ ] Consolidate remaining DOM helpers (geometry persistence, storage wrappers) into `content/utils/` or dedicated services.
- [ ] Continue trimming `src/content/index.js` so it only orchestrates imports, bootstrapping, and Chrome message wiring.

### B. Shared Helpers & Services
- [ ] Move any remaining inline sanitizers (CSS URL, title formatters) into `src/shared/utils/` or `content/utils/` as appropriate.
- [ ] Revisit history batch logic to determine if portions belong in `services/history-service.js` (e.g., selection/filter helpers).

### C. Styles & Assets
- [ ] Split legacy `floatingButton.css` (currently copied into `content/styles/main.css`) into modular styles under `src/content/styles/` (`_variables.css`, `_base.css`, `panel.css`, `components/history.css`, `components/settings.css`, `components/toast.css`, etc.).
- [ ] Replace the monolithic `content/styles/main.css` with modular imports once partials exist and update manifest references accordingly.

### D. Build & Integration
- [ ] Smoke-test the Vite build in Chrome (`chrome://extensions`) to confirm background/content parity.
- [ ] Remove legacy `chaospace-extension/` directory once new structure is verified.
- [ ] Document packaging flow (`npm run build` + `zip`) once validation passes.

### E. Testing & Verification
- [ ] Document manual smoke test steps (load unpacked, visit CHAOSPACE pages, verify extraction/transfers/history banners).
- [ ] Record any automated/unit testing strategy if introduced later.
- [ ] Re-run end-to-end transfer after directory sanitization change to confirm target paths exclude site suffixes.

## Known Issues / Blockers
- **Content script size**: `src/content/index.js` remains unwieldy; risk of regressions until more logic is modularized.
- **Styles**: `content/styles/main.css` is currently a straight copy of the legacy stylesheet; modular split still pending.
- **Parity validation**: Season directory sanitization/path builder changes need confirmation on fresh transfers (prior runs still showed `– CHAOSPACE` suffix before the latest fix).

## Manual Verification Status
- Vite production build succeeds as of 2025-11-03 (`npm run build`).
- Manual Chrome smoke test (2025-11-03) confirms extension loads, icons display, data import & transfers complete, and history rendering works; history detail zoom preview verified after latest fix.
- Post-cleanup season tab labels and directory names have not yet been re-smoke-tested; schedule a fresh transfer to validate sanitized labels/paths with live data.
- Settings modal flows (import/export/backups, layout reset, rate limit validation) need a follow-up manual regression pass now that the component extraction is complete.

## Next Session Checklist
1. Load the freshly built `dist/` in Chrome, trigger a transfer, and confirm season tabs/items/path preview reflect the sanitized labels (no trailing dates/status/ratings, no `– CHAOSPACE` suffixes).
2. Smoke-test the new panel shell component (edge-hide, drag/resize, pin behaviour) to confirm parity with the legacy script.
3. Regression-test the new settings modal (import/export, layout reset, theme toggles) to confirm parity with legacy behavior.
4. Re-run `npm run build` after each major extraction to ensure bundling stays green.
5. Update this archive with progress and any new blockers.

## Quick References
- Entry script: `src/content/index.js`
- New components: `src/content/components/{toast.js, zoom-preview.js, history-detail.js, history-card.js, panel.js, resource-list.js, settings-modal.js}`
- Shared history helpers: `src/content/services/history-service.js`
- Legacy baseline (for parity checks): `chaospace-extension/contentScript.js`

Keep this document updated after each working session so future contributors can resume from here without additional context.
