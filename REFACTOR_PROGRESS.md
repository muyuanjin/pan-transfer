# Chaospace MV3 + Vite + TS + Vue Refactor — Progress Archive

## Branch & Environment
- **Branch**: `feature/vite-refactor`
- **Date snapshot**: 2025-11-03 (UTC-8 assumed)
- **Tooling**: Node project initialized, `vite` + `vite-plugin-web-extension` installed; TypeScript + Vue toolchain being adopted for strict type checking and componentization.
- **Build config**: `vite.config.js` targets `src/manifest.json`, outputs to `dist/`, will be extended for TS/Vue entrypoints.

## Refactor Goal Update (2025-11-04)
- 之前的目标仅是把扩展搬到 Vite 构建链路，但实测纯 JS 流程缺少编译期保障，遗漏和倒退很难在重构中及时揪出。
- 即日起将目标升级为“Manifest V3 + Vite + TypeScript + Vue 的现代最佳实践方案”，要求所有新旧模块逐步迁移到 TS，开启严格类型检查，并用 Vue 组件体系承载交互界面。
- 后续的里程碑都会围绕 TypeScript 化、Vue 化、MV3 能力对齐展开：新增代码默认用 `.ts/.vue`，旧模块迁移过程中要补充类型声明，构建流程需引入 `vue-tsc`/`tsconfig` 校验，确保问题在编译阶段就被发现。

## Tooling Upgrades (2025-11-04)
- 安装并锁定 `vue@^3.5.x`、`@vitejs/plugin-vue@^6`、`typescript@5.6.3`、`vue-tsc@^3.1`、`@types/{chrome,node}` 等依赖，正式引入 Vue + TS 运行/类型链路。
- 新增 `tsconfig.json` 分片：`tsconfig.app.json`（Bundler/strict 配置，允许 JS 过渡）、`tsconfig.node.json`（NodeNext，用于 Vite 配置），并在 `src/env.d.ts` 中声明 `.vue` 模块。
- 将 `vite.config.js` 升级为 `vite.config.ts`，启用 Vue 插件 + `@` 别名，以便后续组件和服务通过绝对路径共享。
- 更新 npm scripts：`npm run typecheck` 触发 `vue-tsc --noEmit`，`npm run build` 先做类型检查再跑 `vite build --mode production`，同时保留 `npm run dev/preview`。

## Migration Plan — MV3 + Vite + TS + Vue（2025-11-04）
1. **Foundation**：为 background/content/shared 目录分别补充 `.d.ts`/类型声明，明确 MV3 环境可用的全局 API，逐步将入口文件拆成 `.ts`。
2. **Vue Shell**：用 Vue 组件重写浮动面板、历史卡片、资源列表等 UI，先在内容脚本中挂载根组件，再迁移现有 DOM 操作到 Vue 响应式状态。
3. **Type-safe Services**：把背景页服务、Chrome 消息协议、共享工具迁移到 TS/ESM，输出明确的接口和枚举，消除魔法字符串。
4. **Testing & Tooling**：集成 `vue-tsc --watch`/ESLint（待定），并在 `REFACTOR_PROGRESS.md` 中记录每个模块迁移后的人工回归检查。
5. **Legacy Sunset**：等 TS/Vue 版本达到功能对齐后，再把 `chaospace-extension/` 标记为只读基线，所有修复走新堆栈。

## Current Project Layout Snapshot
```
src/
  manifest.json
  public/               # extension icons
  background/
    api/{baidu-pan.ts, chaospace.ts}
    common/{constants.ts, errors.ts}
    services/{transfer-service.ts, history-service.ts, parser-service.ts}
    storage/{cache-store.ts, history-store.ts, utils.ts}
    utils/{path.ts, share.ts}
    types.ts
    index.ts
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
      panel.js
      resource-list.js
      settings-modal.js
    utils/{dom.js, storage.js, format.js, title.js}
    styles/              # pending modular split; currently legacy CSS still in use
    index.js             # still large orchestration script
  shared/
    types/transfer.ts
    utils/{sanitizers.ts, completion-status.ts, chinese-numeral.ts}
chaospace-extension/     # legacy files (background.js, contentScript.js, etc.) still present
```

## Working Commands
- `npm install` (once) to restore dependencies.
- `npm run typecheck` 触发 `vue-tsc --noEmit -p tsconfig.app.json`，在跑 Dev/Build 前先卡死类型错误。
- `npm run build` 会先执行类型检查，再运行 `vite build --mode production`（manifest validation 仍然关闭）并输出到 `dist/`。
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
13. **Season Manager Service**
    - Extracted season directory mapping, tab state, and hint rendering into `src/content/services/season-manager.js`, removing ~1.1k LOC from `content/index.js`.
    - Moved the title normalizer into `src/content/utils/title.js` so both the season manager and entry script consume the same helper.
    - Updated resource list/settings integrations to call into the new service; ran `npm run build` (2025-11-03 23:58 UTC-8) to confirm bundles stay green.
14. **Background TS Migration (Phase 1)**
    - Renamed all background modules to `.ts`, added shared runtime typings (`src/background/types.ts`, `src/shared/types/transfer.ts`), and refactored storage/history helpers to satisfy `@tsconfig/strictest` (with `parser-service.ts` temporarily `ts-nocheck`).
    - Converted shared utilities (`completion-status`, `chinese-numeral`) to TypeScript, updated content/background imports, and introduced safer poster/type guards.
    - `npm run typecheck` + `npm run build` (2025-11-04 18:20 UTC-8) now pass with the background bundle rebuilt from the new TypeScript sources.

## Latest Session (2025-11-04, morning)
- Extracted deferred season hydration/loader logic into `src/content/services/season-loader.js`, exposing `ensureDeferredSeasonLoading` and `resetSeasonLoader`.
- Refactored `src/content/index.js` to consume the new service, pass render/update hooks, and reset loader state when the floating panel mounts or tears down.
- Replaced the inline `summarizeSeasonCompletion` helper with the shared implementation from `src/shared/utils/completion-status.js` to remove duplication.
- Re-ran `npm run build` (2025-11-04, UTC-8) to confirm Vite bundles remain green after the extraction.

## Latest Session (2025-11-03, afternoon)
- Shifted history group completion/type helpers and filter normalization into `src/content/services/history-service.js` so `content/index.js` retains orchestration duties only.
- Updated `src/content/index.js` to consume the new helpers (`filterHistoryGroups`, `normalizeHistoryFilter`, `canCheckHistoryGroup`, `isHistoryGroupCompleted`) and dropped the duplicated inline implementations.
- Rebuilt via `npm run build` (2025-11-03 14:35 UTC-8) to confirm bundles still succeed after the history refactor.

## Latest Session (2025-11-04, evening)
- Migrated the entire background stack to TypeScript: `api/baidu-pan`, `api/chaospace`, `common/constants|errors`, `services/{transfer,history}`, background `index`, storage helpers, and utility modules now live under `.ts` entries with shared types sourced from the new `src/background/types.ts` and `src/shared/types/transfer.ts`.
- Ported `shared/utils/completion-status` and `shared/utils/chinese-numeral` to TypeScript, introduced richer value objects (`CompletionStatus`, `SeasonEntry`, poster typing), and replaced legacy JS imports across background/content with extension-less paths.
- Added transitional `// @ts-nocheck` shielding to the oversized `parser-service.ts` while keeping build parity; all other migrated modules compile under `@tsconfig/strictest`.
- Updated content-side imports (`page-analyzer`, `season-loader`, `settings-modal`, `index`) to consume the new TypeScript utilities, then ran `npm run typecheck` and `npm run build` (2025-11-04 18:20 UTC-8) — both finished green with the background bundle rebuilding successfully.

## Latest Session (2025-11-04, midday)
- Migrated `src/shared/utils/sanitizers` to TypeScript (`sanitizers.ts`), added explicit typings for link/title/poster helpers, and updated all background/content import sites to consume the `.ts` module so the new toolchain can type-check shared utilities.
- Introduced `src/content/components/PanelRoot.vue` as the floating panel's Vue root, then refactored `components/panel.js` to bootstrap the shell through `createApp`, keeping all existing drag/resize/edge-hide logic while letting Vite/Vue own the DOM tree.
- Ran `npm run typecheck` and `npm run build` (2025-11-04 UTC-8) to validate the end-to-end TS+Vue pipeline after the migrated utility and new root component landed; both commands finished cleanly.

## Latest Session (2025-11-03, late night)
- Hoisted storage safety helpers (`safeStorageGet/Set/Remove`) into `src/content/utils/storage.js` and updated `content/index.js` plus `components/panel.js` to consume them.
- Added `src/content/utils/format.js` for `formatOriginLabel` and `sanitizeCssUrl`, trimming related inline helpers from the entry script.
- Confirmed Vite production build still succeeds after the utility extraction (`npm run build`, 2025-11-03 23:40 UTC-8).

## Latest Session (2025-11-03, evening)
- Extracted the resource list UI into `components/resource-list.js`, clearing 400+ LOC from `content/index.js`.
- Sanitized season labels end-to-end (initial scrape, deferred loads, state hydration) to remove trailing dates/status text that was leaking into the UI and filesystem paths.
- Updated the build pipeline to skip manifest schema validation and wired `npm run build` to `vite build --mode production`, eliminating the long-blocking schema download.
- Verified `npm run build` completes locally (~5.5s) and confirmed bundles land in `dist/`.
- Refreshed AGENTS.md with the new build instructions for future contributors.
- Extracted the settings modal into `components/settings-modal.js`, moving import/export, layout reset, and open/close handlers out of `content/index.js`.
- Re-ran `npm run build` (2025-11-03) after the settings refactor to confirm bundles stay green.

## Latest Session (2025-11-03, nightcap)
- Created `src/content/services/season-manager.js` to centralize season tab computation, directory deduping, and hint rendering, trimming `content/index.js` to ~3.4k LOC.
- Added `src/content/utils/title.js` and replaced the inlined cleaner so page title sanitization stays DRY across modules.
- Wired resource list/settings flows to the service exports, refreshed imports, and reran `npm run build` (2025-11-03 23:58 UTC-8) to verify production bundles.

## Work in Progress / Partial Refactors
- `src/content/index.js` is down to ~3.4k LOC; deferred season hydration, transfer dispatch, and logging/event wiring remain inline and should be modularized next.
- HistoryDetail/Toast/ZoomPreview/HistoryCard/Panel/ResourceList/SettingsModal components plus the new season manager extracted; remaining inline orchestration, storage helpers, and logging utilities still need modularization.
- Legacy `chaospace-extension/` assets remain untouched for parity until refactor completes.

## Outstanding Tasks & TODOs
### A. Content Modularization
- [x] Extract history list/card rendering into `components/history-card.js` (selection checkboxes, summary, batch controls).
- [x] Extract panel shell + drag/resize logic into `components/panel.js` (or similar) and import from entry script.
- [x] Extract resource list rendering, selection toggles, and pagination into `components/resource-list.js`.
- [x] Move settings modal logic into `components/settings-modal.js`.
- [x] Consolidate remaining DOM helpers (geometry persistence, storage wrappers) into `content/utils/` or dedicated services.
- [ ] Continue trimming `src/content/index.js` so it only orchestrates imports, bootstrapping, and Chrome message wiring.
- [x] Lift deferred season hydration/loader logic into a dedicated module (e.g., `services/season-loader.js`) and integrate with the season manager.

### B. Shared Helpers & Services
- [x] Move any remaining inline sanitizers (CSS URL, title formatters) into `src/shared/utils/` or `content/utils/` as appropriate.
- [x] Revisit history batch logic to determine if portions belong in `services/history-service.js` (e.g., selection/filter helpers).

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
- Manual Chrome smoke test (2025-11-04 15:10 UTC-8) on a live CHAOSPACE episode exercised the Vue floating panel mount timing, drag/resize, edge-hide/pin, and settings overlay; all behaviors matched the legacy script with no regressions observed.
- Link/title sanitization sanity check (same session) confirmed resource cards and generated transfer paths no longer append trailing status text or the `– CHAOSPACE` suffix.
- Vite production build succeeds as of 2025-11-04 (UTC-8) after introducing the season loader service (`npm run build`).
- Manual Chrome smoke test (2025-11-03) confirms extension loads, icons display, data import & transfers complete, and history rendering works; history detail zoom preview verified after latest fix.
- Post-cleanup season tab labels and directory names have not yet been re-smoke-tested; schedule a fresh transfer to validate sanitized labels/paths with live data.
- Settings modal flows (import/export/backups, layout reset, rate limit validation) need a follow-up manual regression pass now that the component extraction is complete.

## Next Session Checklist
1. ✅ Load the freshly built `dist/` in Chrome, trigger a transfer, and confirm season tabs/items/path preview reflect the sanitized labels (no trailing dates/status/ratings, no `– CHAOSPACE` suffixes).
2. ✅ Smoke-test the new Vue panel root (edge-hide, drag/resize, pin behaviour) to confirm parity with the legacy script.
3. ✅ Regression-test the new settings modal (import/export, layout reset, theme toggles) to confirm parity with legacy behavior.
4. ✅ Carved out deferred season hydration into `src/content/services/season-loader.js`; continue monitoring `content/index.js` for remaining orchestration logic.
5. Re-run `npm run build` after each major extraction to ensure bundling stays green.
6. Update this archive with progress and any new blockers.
7. Remove the temporary `// @ts-nocheck` from `src/background/services/parser-service.ts` by breaking the parser into typed helpers (HTML tokenizer, metadata extractor) and backfilling unit tests around the HTML fixtures.
8. Flesh out background message payload typings (history/delete/check-updates/transfer) so `background/index.ts` no longer casts to `any` when reading `message.payload`.

## Quick References
- Entry script: `src/content/index.js`
- New components: `src/content/components/{toast.js, zoom-preview.js, history-detail.js, history-card.js, panel.js, resource-list.js, settings-modal.js}`
- Content utilities: `src/content/utils/{dom.js, storage.js, format.js, title.js}`
- Season helpers: `src/content/services/season-manager.js`
- Shared history helpers: `src/content/services/history-service.js`
- Legacy baseline (for parity checks): `chaospace-extension/contentScript.js`

Keep this document updated after each working session so future contributors can resume from here without additional context.
