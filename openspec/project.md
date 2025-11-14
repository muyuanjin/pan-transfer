# Project Context

## Purpose

Pan Transfer 是一个基于 Manifest V3 的浏览器扩展，目标是在受控网页（当前以 Chaospace 为主）中自动识别可下载资源，并将其批量转存到云端（核心目标是百度网盘，后续规划更多存储与站点提供方）。项目强调轻量 UI、低打扰体验与可扩展的提供方（provider）架构，以便快速接入新站点或新存储能力。

## Tech Stack

- Vite 7 + TypeScript 5.9 + Vue 3（SFC）构建内容端 UI 与业务逻辑
- Manifest V3 背景 Service Worker，采用 vite-plugin-web-extension 打包
- Pinia 管状态，VueUse/DaisyUI/Tailwind 4 负责交互与样式
- Vitest + Playwright 组成单测与端到端测试链路
- ESLint 9 + Prettier 3 保障代码质量；@tsconfig/strictest 强制严格类型

## Project Conventions

### Code Style

- 统一两空格缩进、ESM import、`const` 优先；导出函数/变量使用 camelCase，DOM 选择器使用带语义的 kebab-case data-role。
- Prettier 作为唯一格式化来源，`npm run format`/`format:check` 必须无差异；ESLint 以 `--max-warnings=0` 运行，lint 不能留下警告。
- TypeScript 走 strictest 配置，所有新代码需要补充显式类型或利用类型推导保持可读性。
- 运行时日志统一 `console.*('[Pan Transfer] ...')`，便于跨上下文检索。

### Architecture Patterns

- 背景：`src/background/index.ts` 运行 Service Worker，托管消息路由、队列与 TransferPipeline，依赖 `src/background/services/*` 与 `src/background/storage/*` 组织存储访问。
- 内容端：`src/content/index.ts` 装载 `ContentRuntime`，挂载浮动面板（`components/PanelRoot.vue`）、资源列表与历史覆盖层；按模块划分 controllers/history/runtime/ui/states。
- Provider 体系：`src/platform/registry` 注册 Site/Storage Provider，`src/core/transfer/transfer-pipeline.ts` 以 Mediator/Strategy 形式编排资源检测→选择→后台任务。Chaospace 提供方示例位于 `src/providers/sites/chaospace`，Baidu Netdisk 存储逻辑位于 `src/providers/storage/baidu-netdisk`。
- 样式：模块化 CSS 存放在 `src/content/styles/{foundation,overlays,utilities}`，通过 `styles.loader.ts` 按需注入。
- 旧版 MV2 代码位于 `chaospace-extension/`，仅作参照，不得修改。

### Testing Strategy

- 强制通过 `npm run check`（format:silent → lint:ci → build → vitest → playwright）。提交前必须保证该命令成功且没有额外 diff。
- Vitest 覆盖 registry、transfer pipeline、解析器、历史记录等核心模块（`src/**/__tests__`）；新增业务需提供同级测试夹具。
- Playwright（`tests/e2e/panel.spec.ts`）模拟真实页面装载扩展，验证浮动面板、提供方切换与转存流程；涉及 UI/交互改动需更新或新增 e2e 场景。
- 重要手动验证：真实 Chaospace 页面、Baidu 网盘授权流程、重试逻辑在 Chrome DevTools 中核查。

### Git Workflow

- 采用 trunk-based 流程：`main` 为唯一长期分支，所有改动走短期 feature 分支（命名建议 `feat/<topic>`、`fix/<topic>`），完成后发起 PR。
- Commit 提倡动词前缀（如 `feat:`, `fix:`, `chore:`）并聚焦单一主题；若涉及 OpenSpec 变更需在描述中附上 change-id。
- 在 PR 合并前必须附上 `npm run check` 的通过结论与相关手动验证说明。

## Domain Context

- 项目目前面向 Chaospace 等资源站点，解析页面 DOM/接口以收集资源清单，并通过面板提供批量转存能力。
- 用户需已在同一浏览器登录资源站与百度网盘；扩展依赖双方的 cookie/session 才能成功转存。
- 提供方机制允许新增站点或存储后端，迁移计划（`docs/pan-transfer-migration-plan.md`）描述了未来将 providers 拆分至 `src/providers/...` 的路线。
- UI 需要兼容亮/暗主题与面板位置调度，同时在历史视图中展示本地缓存记录。

## Important Constraints

- 任何提交前必须保持 `winexec npm run check` 绿色，CI 与本地命令列表不可跳过。
- 所有 runtime 日志必须带 `[Pan Transfer]` 前缀；禁止泄露用户 cookie、token、网盘路径等敏感信息。
- Manifest V3 权限需最小化，如需新增权限必须同步在 `src/manifest.json` 中注明原因并在 PR 中说明。
- `chaospace-extension/` 目录视为冻结，修改需单独确认；所有新功能只允许落在 `src/`。
- 禁止将个人百度账号或 Chaospace 凭据写入仓库；敏感配置通过 `.env` 或用户浏览器本地存储处理。

## External Dependencies

- Chrome/Edge 浏览器及其 Manifest V3 API（storage、runtime messaging、scripting、downloads 等）。
- Chaospace（及未来的其他站点）公开页面 DOM/接口，作为资源检测来源。
- 百度网盘 Web API：通过现有 cookie/session 完成批量转存、目录创建、容量查询。
- Playwright + Chromium（自动化截图与 e2e 测试环境）。
- GitHub Releases 用于分发打包后的扩展 zip。
