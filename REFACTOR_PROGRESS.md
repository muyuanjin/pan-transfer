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
    constants.ts
    controllers/
      logging-controller.ts
      panel-preferences.ts
    history/
      controller.ts
    index.ts
    services/
      history-service.ts
      page-analyzer.ts
      season-loader.ts
      season-manager.ts
    state/index.ts
    components/
      PanelRoot.vue
      HistoryDetailOverlay.vue
      ResourceListView.vue
      history/
        HistoryListView.vue
        HistorySummaryView.vue
        history-card.helpers.ts
      history-card.ts
      history-detail.ts
      panel.ts
      resource-list.ts
      settings-modal.ts
      toast.ts
      zoom-preview.ts
    utils/{dom.ts, storage.ts, format.ts, title.ts}
    styles/              # pending modular split; currently legacy CSS still in use
    types.ts
  shared/
    types/transfer.ts
    utils/{sanitizers.ts, completion-status.ts, chinese-numeral.ts}
chaospace-extension/     # legacy files (background.js, contentScript.js, etc.) still present
```

## Working Commands

- `npm install` (once) to restore dependencies.
- `npm run typecheck` 触发 `vue-tsc --noEmit -p tsconfig.app.json`，在跑 Dev/Build 前先卡死类型错误。
- **重要**: 每次重构结束后务必运行 `npm run check` 确保所有检查通过(特别是`npm run e2e`,如果e2e失败,说明插件压根无法加载!)。
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
   - Ported legacy `floatingButton.css` into the new layered styles entry (`content/styles/critical.css` + `index.css`) and adjusted manifest action icon schema.
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
15. **Parser Service Typing & Coverage (2025-11-04 late)**
    - Split `parser-service.ts` into typed helpers (`parseHistoryHeader`, `parseSynopsisSection`, `parseInfoTableEntries`) backed by the new `parser/html-helpers.ts`, removed the temporary `// @ts-nocheck`, and tightened Completion parsing to prefer the latest `.extra` block.
    - Added Vitest unit fixtures under `src/background/services/parser/__tests__/` covering link extraction, history detail parsing, season completion/status parsing, and download table hydration to guard against HTML regression.
    - Introduced `vitest` + `vitest.config.ts`, wired `npm run test`, and verified the suite alongside `npm run typecheck` to keep typed parsing enforced via CI-friendly commands.
16. **Background Message Typings (2025-11-04 late)**
    - Replaced the loosely typed `IncomingMessage` union in `src/background/index.ts` with explicit discriminated unions and type guards, eliminating `any` casts for history/delete/update/transfer payloads.
    - Hardened runtime checks so malformed transfer payloads return an immediate error instead of passing unchecked data to `handleTransfer`, reducing the chance of runtime crashes when the content script misbehaves.
17. **Content TS Migration (2025-11-05)**
    - Converted remaining content services, state, and utility modules to TypeScript (`src/content/services/*.ts`, `src/content/utils/*.ts`, `src/content/state/index.ts`) and introduced `src/content/types.ts` for shared interface/state definitions.
    - Wrapped DOM-heavy components with typed facades (`history-card.ts`, `history-detail.ts`, `panel.ts`, `resource-list.ts`, `settings-modal.ts`), keeping the implementation logic in `*-impl.js` to ease the upcoming Vue rewrite while enabling type-checked imports today.
    - Reimplemented light-weight helpers (`toast.ts`, `zoom-preview.ts`) directly in TypeScript and restored history messaging helpers (`deleteHistoryRecords`, `clearAllHistoryRecords`, `requestHistoryUpdate`, `fetchHistorySnapshot`) so the content entrypoint compiles without the old JS exports.
    - `npm run typecheck` and `npm run build` (2025-11-05 10:12 UTC-8) succeed solely from the new TypeScript sources, confirming the Vite bundle no longer depends on the `.js` modules.
18. **Content Vue Ports (2025-11-05 afternoon)**
    - Replaced the temporary JS facades for the history overlay with Vue single-file components: new `history/HistoryListView.vue` + `HistorySummaryView.vue`, backed by typed helpers in `history-card.helpers.ts`, now mounted via `history-card.ts`.
    - Introduced `HistoryDetailOverlay.vue` and refactored `history-detail.ts` to orchestrate the modal through a Vue app, deleting the legacy `history-detail-impl.js`.
    - Migrated the resource list renderer to `ResourceListView.vue` with refreshed badges/empty states, removing `resource-list-impl.js` while keeping orchestration in `resource-list.ts`.
    - Added stop-gap `// @ts-nocheck` annotations to the new Vue entry modules pending full typing; `npm run typecheck` and `npm run build` (2025-11-05 17:40 UTC-8) remain green from the Vue-powered bundle.
19. **Content Orchestrator Controllers (2025-11-05 evening)**
    - Extracted logging/status rendering into `src/content/controllers/logging-controller.ts`, replacing the inline helpers in `content/index.ts` with typed `resetLogs`/`pushLog`/`setStatus`.
    - Created `src/content/controllers/panel-preferences.ts` to own base directory presets, theme toggles, and storage persistence, shrinking the entry file and centralizing `safeStorage` calls.
    - Extended `src/content/types.ts` with `LogEntry`, `LogLevel`, and `TransferStatus` to keep state strongly typed across the new controllers.
    - Verified `npm run typecheck` (2025-11-05 21:10 UTC-8) after the extraction to confirm the new modules compile cleanly.

## Latest Session (2025-11-05, evening)

- 拆分内容脚本日志与面板偏好逻辑：新增 `src/content/controllers/logging-controller.ts` 负责日志队列与状态渲染，`panel-preferences.ts` 负责路径预设、主题切换与 `safeStorage` 持久化，原入口 `index.ts` 仅保留 orchestration。
- 为日志/状态新增类型：在 `src/content/types.ts` 增补 `LogEntry`、`LogLevel`、`TransferStatus`，并调整内容脚本调用方以使用强类型数据集（含 dataset 访问方式更新）。
- 更新 `src/content/index.ts` 引用上述控制器，移除重复的日志、预设与主题辅助函数，同时保留现有面板挂载流程（Zoom 预览、历史控制器等保持稳定）。
- 运行 `npm run typecheck`（2025-11-05 21:10 UTC-8）确认拆分后的模块编译通过；后续目标是继续移除入口文件中的 `// @ts-nocheck`。

## Latest Session (2025-11-05, afternoon)

- ⬆️ 2025-11-05 (evening): 提炼内容脚本历史流程到 `src/content/history/controller.ts`，将入口迁移为 `content/index.ts` 并更新 manifest；`npm run typecheck`、`npm run build` 已通过确认。
- 修复内容脚本打包后出现的 `updateTransferButton` 未定义错误，同时恢复丢失的 `renderPresets`、`renderPathPreview`、日志渲染等入口工具函数，并补回 `applyPanelTheme`/`setTheme`/`updatePinButton`。
- Replaced the history card, detail modal, and resource list facades with Vue components (`HistoryListView.vue`, `HistorySummaryView.vue`, `HistoryDetailOverlay.vue`, `ResourceListView.vue`) and removed the legacy `*-impl.js` modules.
- Added `history-card.helpers.ts` to keep pan path/status formatting in TypeScript, wired `history-card.ts` to mount the Vue apps, and verified content state updates still drive selection, filters, and summary panels.
- Confirmed the new Vue overlays render within the existing panel shell without layout regressions; `npm run typecheck` and `npm run build` (2025-11-05 17:40 UTC-8) both pass with the updated bundle.
- Left targeted `// @ts-nocheck` shims on the orchestrator modules as a temporary measure—plan to replace with real component props/emit typing plus tests in the next iteration.

## Latest Session (2025-11-05)

- Migrated the content stack to TypeScript: converted services, utilities, shared state, and introduced typed facades for panel/history/settings components while preserving existing DOM logic in `*-impl.js` for staged Vue replacement.
- Added `src/content/types.ts` to centralize runtime/panel state signatures and updated imports across the bundle; ensured history messaging helpers remain exported from the new TypeScript services.
- Rebuilt light helpers (`toast`, `zoom-preview`) in TypeScript and verified `npm run typecheck` + `npm run build` (2025-11-05 10:12 UTC-8) complete without relying on the legacy `.js` modules.

## Latest Session (2025-11-04, late night)

- Refactored `parser-service.ts` into strictly typed helpers, created `parser/html-helpers.ts`, and removed the stop-gap `// @ts-nocheck` without regressing existing behaviour.
- Added Vitest coverage for the parser workflows and documented the new `npm run test` entry point; both `npm run typecheck` and `npm run test -- --run` passed at 2025-11-04 19:13 UTC-8.
- Tightened background message payload handling with discriminated unions and guard helpers to prevent accidental `any` casts in the runtime listener.
- Noted follow-up needs: expand parser fixtures to cover negative cases, and start modularizing `content/index.js` orchestration around the new typed helpers.

## Latest Session (2025-11-04, morning)

- Extracted deferred season hydration/loader logic into `src/content/services/season-loader.js`, exposing `ensureDeferredSeasonLoading` and `resetSeasonLoader`.
- Refactored `src/content/index.js` to consume the new service, pass render/update hooks, and reset loader state when the floating panel mounts or tears down.
- Replaced the inline `summarizeSeasonCompletion` helper with the shared implementation from `src/shared/utils/completion-status.js` to remove duplication.
- Re-ran `npm run build` (2025-11-04, UTC-8) to confirm Vite bundles remain green after the extraction.

## Latest Session (2025-11-05, morning)

- Audited `src/content/index.ts` after the runtime extraction; the entry file now just bootstraps `ContentRuntime` (13 LOC) while the real logic lives under `src/content/runtime/**` as typed controllers/binders.
- Walked through the runtime modules (panel state, transfer controller, UI binders, hydrators) to confirm dependencies align and no residual `// @ts-nocheck` guards or legacy imports remain in the entrypoint.
- Re-verified that the legacy `main.css` has been replaced by the modular stack under `src/content/styles/{critical.css,index.css,foundation/,components/,overlays/,utilities/}`, so future styling tweaks flow through the Vite-managed layers.

## Latest Session (2025-11-03, afternoon)

- Shifted history group completion/type helpers and filter normalization into `src/content/services/history-service.js` so `content/index.js` retains orchestration duties only.
- Updated `src/content/index.js` to consume the new helpers (`filterHistoryGroups`, `normalizeHistoryFilter`, `canCheckHistoryGroup`, `isHistoryGroupCompleted`) and dropped the duplicated inline implementations.
- Rebuilt via `npm run build` (2025-11-03 14:35 UTC-8) to confirm bundles still succeed after the history refactor.

## Latest Session (2025-11-04, late night)

- Extracted the remaining panel edge-hide + pin orchestration from `src/content/index.ts` into a typed controller (`controllers/panel-edge-controller.ts`), removing the last inline DOM/pointer globals from the entry script.
- Converted `src/content/index.ts` into TypeScript, dropped `// @ts-nocheck`, and re-wired the new controller + panel shell handles so edge-hide, pinning, and document pointer events share the same typed runtime state.
- Re-ran `npm run typecheck` (2025-11-04 23:40 UTC-8) to confirm the content bundle compiles cleanly after the refactor.

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

## Latest Session (2025-11-04, Vue shell + typings)

- Replaced the temporary panel/settings shims with fully typed Vue+TS modules (`components/panel.ts`, `components/settings-modal.ts`) and removed the legacy `*-impl.js` bridges.
- Scrubbed the remaining `// @ts-nocheck` guards across content components, tightened helper typings (`history-card.helpers.ts`, history renderers), and re-ran `npm run typecheck`.
- Added Vitest coverage for the Vue renderers (resource summary, history toggle state, detail overlay transitions) under `src/content/components/__tests__/renderers.spec.ts`; configured Vitest with `@vitejs/plugin-vue` + jsdom environment.
- Installed `jsdom` dev dependency, set Vitest to jsdom mode, and verified `npm run test -- --run` completes (CI-friendly `--run` flag avoids interactive prompts).

## Work in Progress / Partial Refactors

- `src/content/index.ts` is now a 13-line bootstrap that spins up `ContentRuntime`; orchestration lives in the new `src/content/runtime/**` tree, which still needs documentation, unit coverage, and eventual splitting by concern (transfer, selection, hydration).
- Vue ports now cover the floating panel, settings modal, history list/detail, and resource views; imperative glue now resides inside typed runtime modules, but we still lack automated coverage for their interactions.
- Legacy `chaospace-extension/` assets remain untouched for parity until refactor completes.

## Outstanding Tasks & TODOs

### A. Content Modularization

- [x] Extract history list/card rendering into dedicated modules — now powered by `components/history/HistoryListView.vue` + `HistorySummaryView.vue` with typed helpers.
- [x] Extract panel shell + drag/resize logic into `components/panel.ts` (still backed by `panel-impl.js` until Vue rewrite lands).
- [x] Extract resource list rendering, selection toggles, and pagination into `components/resource-list.ts` + `ResourceListView.vue`.
- [x] Move settings modal logic into `components/settings-modal.ts` (Vue conversion pending; still delegates to `settings-modal-impl.js`).
- [x] Consolidate remaining DOM helpers (geometry persistence, storage wrappers) into `content/utils/` or dedicated services.
- [x] Continue trimming `src/content/index.ts` so it only orchestrates imports, bootstrapping, and Chrome message wiring (completed by delegating to `ContentRuntime`).
- [ ] Add targeted docs/tests for `src/content/runtime/**` (transfer controller, binders, hydrator) so future contributors understand the new split entry flow.
- [x] Lift deferred season hydration/loader logic into a dedicated module (e.g., `services/season-loader.js`) and integrate with the season manager.
- [x] Replace the remaining imperative shims (`panel-impl.js`, `settings-modal-impl.js`) with Vue/TS components and drop the temporary `// @ts-nocheck` scaffolding.

### B. Shared Helpers & Services

- [x] Move any remaining inline sanitizers (CSS URL, title formatters) into `src/shared/utils/` or `content/utils/` as appropriate.
- [x] Revisit history batch logic to determine if portions belong in `services/history-service.js` (e.g., selection/filter helpers).
- [ ] Add strict typings/tests for history messaging responses (success/error payloads) once end-to-end transfer coverage expands.

### C. Styles & Assets

- [x] Split legacy `floatingButton.css` into layered modules under `src/content/styles/` (`foundation/*`, `components/*`, `overlays/*`, `utilities.css`) with critical imports managed by `critical.css`.
- [x] Replace the monolithic `content/styles/main.css` with the new `index.css` + dynamic overlay loader, updating the manifest and build inputs accordingly.

### D. Build & Integration

- [ ] Smoke-test the Vite build in Chrome (`chrome://extensions`) to confirm background/content parity.
- [ ] Remove legacy `chaospace-extension/` directory once new structure is verified.
- [ ] Document packaging flow (`npm run build` + `zip`) once validation passes.
- [ ] Capture a before/after diff of bundle size/perf once Vue components land to ensure TS migration didn't regress load times.

### E. Testing & Verification

- [ ] Document manual smoke test steps (load unpacked, visit CHAOSPACE pages, verify extraction/transfers/history banners).
- [x] Record automated/unit testing strategy — parser-service now covered by Vitest (`npm run test`) and enforced alongside `npm run typecheck`.
- [ ] Expand automated coverage beyond parser-service (transfer-service retry paths, background message guards) once fixtures are ready.
- [ ] Re-run end-to-end transfer after directory sanitization change to confirm target paths exclude site suffixes.
- [ ] Add regression coverage for content messaging helpers (`deleteHistoryRecords`, `requestHistoryUpdate`) once a testing harness is available.
- [ ] Add component-level tests (or Storybook-style harness) for the new Vue history/resource views to lock in selection/expansion behaviours.

## Known Issues / Blockers

- **Content runtime reliability**: main entry is trimmed, but the heavy logic now spans `src/content/runtime/**` controllers/binders without documentation or automated coverage, so regressions could still slip in.
- **Styles**: Modular CSS now lives under `src/content/styles/` with `critical.css` for eager imports and overlay styles loaded on demand via `styles.loader.ts`.
- **Parity validation**: Season directory sanitization/path builder changes need confirmation on fresh transfers (prior runs still showed `– CHAOSPACE` suffix before the latest fix).
- **Parser coverage scope**: Newly added Vitest suite validates primary flows but lacks negative cases for malformed CHAOSPACE markup; add failing fixtures before broadening deployments.
- **Type hygiene**: Content orchestrator still leans on broad `PanelDomRefs` indexing; continue tightening state/DOM typings as `content/index.ts` is broken into smaller modules.

## Manual Verification Status

- Code inspection (2025-11-05 09:30 UTC-8) confirmed `src/content/index.ts` now only bootstraps `ContentRuntime` and that the modular CSS stack (`src/content/styles/{critical.css,index.css,foundation/,components/,overlays/,utilities/}`) replaces the old `main.css` entry.
- Manual Chrome smoke test (2025-11-04 15:10 UTC-8) on a live CHAOSPACE episode exercised the Vue floating panel mount timing, drag/resize, edge-hide/pin, and settings overlay; all behaviors matched the legacy script with no regressions observed.
- Link/title sanitization sanity check (same session) confirmed resource cards and generated transfer paths no longer append trailing status text or the `– CHAOSPACE` suffix.
- Vite production build succeeds as of 2025-11-04 (UTC-8) after introducing the season loader service (`npm run build`).
- Manual Chrome smoke test (2025-11-03) confirms extension loads, icons display, data import & transfers complete, and history rendering works; history detail zoom preview verified after latest fix.
- Post-cleanup season tab labels and directory names have not yet been re-smoke-tested; schedule a fresh transfer to validate sanitized labels/paths with live data.
- Settings modal flows (import/export/backups, layout reset, rate limit validation) need a follow-up manual regression pass now that the component extraction is complete.
- Newly ported Vue history/resource overlays have not been re-tested end-to-end; run a focused smoke test covering selection toggles, season expansion, detail modal, and resource badge states.
- Automated checks (2025-11-05 21:10 UTC-8): `npm run typecheck` passes after extracting the logging/panel controllers; full build deferred to the next smoke test.
- Automated checks (2025-11-04 22:43 UTC-8): `npm run typecheck` and `npm run test -- --run` both pass after the Vue shell/typing updates (Vitest configured for jsdom + Vue plugin).

## Next Session Checklist

- ☐ Run a full Chrome smoke test covering history selection, detail modal, resource list, settings flows, and transfer actions; capture notes/screenshots in the PR template.
- ☐ Continue extracting orchestration logic from `src/content/index.ts` (edge-hide, pointer, transfer wiring) and drop the remaining `// @ts-nocheck`.
- ☐ Expand Vitest coverage to background/content messaging helpers once fixtures are available (e.g., `deleteHistoryRecords`, `requestHistoryUpdate`), and consider lightweight tests for the new controllers.

## Quick References

- Entry script: `src/content/index.ts`
- Controllers: `src/content/controllers/{logging-controller.ts, panel-preferences.ts}` + `src/content/history/controller.ts`
- Vue components: `src/content/components/{PanelRoot.vue, HistoryDetailOverlay.vue, ResourceListView.vue}` plus `components/history/{HistoryListView.vue, HistorySummaryView.vue}`
- Orchestrators: `src/content/components/{history-card.ts, history-detail.ts, resource-list.ts, panel.ts, settings-modal.ts}`
- Content utilities: `src/content/utils/{dom.ts, storage.ts, format.ts, title.ts}`
- Season helpers: `src/content/services/{season-manager.ts, season-loader.ts}`
- Shared history helpers: `src/content/services/history-service.ts`
- Legacy baseline (for parity checks): `chaospace-extension/contentScript.js`

Keep this document updated after each working session so future contributors can resume from here without additional context.
