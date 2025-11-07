# CHAOSPACE Transfer Assistant Chrome Extension / CHAOSPACE 转存助手 Chrome 插件

[English](#english) | [中文](#中文)

<a name="english"></a>

## English Version

### Project Overview

The CHAOSPACE Transfer Assistant is a Manifest V3 Chrome/Edge extension built with Vite 7, TypeScript 5.9, and Vue 3. It automates copying CHAOSPACE resources (chaospace.xyz / chaospace.cc / etc.) into personal Baidu Netdisk folders while preserving the legacy workflow with safer tooling and stronger validation.

### Requirements

- Node.js 20+ and npm 10+
- Chrome/Edge in developer mode for local loading

### Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Start development preview** (serves the MV3 extension with HMR):
   ```bash
   npm run dev
   ```
3. **Build the production bundle** (outputs to `dist/`):
   ```bash
   npm run build
   ```
4. **Load in Chrome/Edge**
   - Run `npm run build`
   - Open `chrome://extensions/` (or `edge://extensions/`), enable Developer Mode
   - Click **Load unpacked** and select the generated `dist/` directory

> `chaospace-extension/` holds the frozen MV2 reference bundle—do **not** modify it. All active code lives under `src/`.

### Key Scripts

| Command                                   | Description                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                             | Vite development server for the MV3 extension                               |
| `npm run build`                           | Type-check + Vite production build into `dist/`                             |
| `npm run typecheck`                       | `vue-tsc --noEmit -p tsconfig.app.json`                                     |
| `npm run test`                            | Vitest unit suites                                                          |
| `npm run e2e`                             | Ensures `dist/` exists (builds if missing) then runs Playwright smoke tests |
| `npm run lint`                            | Lint with ESLint (warnings allowed)                                         |
| `npm run lint:ci`                         | Lint with `--max-warnings=0` for CI                                         |
| `npm run format` / `npm run format:check` | Prettier write/check                                                        |
| `npm run check`                           | Quality gate: `format:check → typecheck → lint:ci → build → test → e2e`     |

`npm run check` never mutates files (thanks to `format:check`) and fails on any ESLint warning via `lint:ci`. Keep this command green before handing changes off.

### Architecture Snapshot (`src/`)

- **Background service worker**: `background/index.ts` plus services under `background/services/` and storage helpers in `background/storage/`. Handles Baidu Netdisk API calls, retries, caching, and typed message handling.
- **Content runtime**: `content/index.ts` bootstraps `ContentRuntime`. Vue components render the floating panel (`components/PanelRoot.vue`, `components/ResourceListView.vue`, history overlays, detail modal). Controllers and UI binders live in `content/{controllers,history,runtime/ui}` and share state via `content/state/`.
- **Shared modules**: Types in `shared/types`, sanitizers/completion utilities in `shared/utils`, and `shared/log.ts` which exposes the `chaosLogger` helper. All runtime logs must flow through this helper so messages carry the `[Chaospace Transfer]` prefix.
- **Styles**: Modular CSS in `content/styles/{foundation,overlays,utilities}` with `styles.loader.ts` for on-demand injection.
- **Tests**: Vitest specs under `src/**/__tests__` and `tests/e2e/panel.spec.ts` for Playwright.

### Logging & Diagnostics

- Import `chaosLogger` from `@/shared/log` instead of calling `console.*`. ESLint forbids raw console usage so logs always include the `[Chaospace Transfer]` prefix.
- Playwright’s error tracker fails fast if an extension error surfaces without the prefix.

### Testing Workflow

1. `npm run test` – fast Vitest suites.
2. `npm run e2e` – automatically builds (if `dist/manifest.json` is missing) and runs Playwright. The script cleans `test-results/` afterwards.
3. `npm run check` – complete CI-equivalent pipeline.

Document any manual verification you performed (e.g., Chrome DevTools checks for Baidu errno handling) when opening a PR.

### Directory Layout (excerpt)

```
Tookit/
├── src/
│   ├── background/
│   ├── content/
│   ├── shared/
│   └── ...
├── tests/e2e/panel.spec.ts
├── scripts/run-e2e.mjs
├── chaospace-extension/   # legacy reference bundle (read-only)
├── dist/                  # built MV3 output
├── AGENTS.md              # Agent guide / quality gate requirements
└── README.md
```

### Contributing

- Follow the logging, directory, and quality-gate rules outlined above and in `AGENTS.md`.
- Run `npm run check` locally before pushing.
- Avoid leaking personal credentials or CHAOSPACE content in commits.

---

<a name="中文"></a>

## 中文版本

### 项目简介

CHAOSPACE 转存助手是基于 Vite 7、TypeScript 5.9 与 Vue 3 构建的 Manifest V3 Chrome/Edge 扩展，用于将 CHAOSPACE 站点上的资源自动转存到个人百度网盘，并在新版工具链中复刻旧版体验。

### 环境要求

- Node.js 20+、npm 10+
- Chrome/Edge 浏览器（需开启开发者模式以加载扩展）

### 快速上手

1. **安装依赖**
   ```bash
   npm install
   ```
2. **启动开发预览**（热更新调试扩展）
   ```bash
   npm run dev
   ```
3. **构建发行包**（输出到 `dist/`）
   ```bash
   npm run build
   ```
4. **在浏览器中加载**
   - 运行 `npm run build`
   - 打开 `chrome://extensions/` 或 `edge://extensions/`，启用“开发者模式”
   - 点击“加载已解压的扩展程序”，选择生成的 `dist/` 目录

> `chaospace-extension/` 为只读的 MV2 参考，不再维护，切勿修改；所有源码均位于 `src/`。

### 常用脚本

| 命令                              | 作用                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                     | 启动 Vite 开发服务器                                                 |
| `npm run build`                   | 类型检查并产出生产包到 `dist/`                                       |
| `npm run typecheck`               | `vue-tsc --noEmit` 类型检查                                          |
| `npm run test`                    | 运行 Vitest 单元测试                                                 |
| `npm run e2e`                     | 若缺少 `dist/manifest.json` 则自动构建，然后执行 Playwright 冒烟测试 |
| `npm run lint`                    | ESLint（允许警告）                                                   |
| `npm run lint:ci`                 | ESLint（警告即失败）                                                 |
| `npm run format` / `format:check` | Prettier 写入/校验                                                   |
| `npm run check`                   | 质量闸门：`format:check → typecheck → lint:ci → build → test → e2e`  |

`npm run check` 只读运行，不会改动工作区；`lint:ci` 会把任何警告视为失败。提交前务必保持该命令通过。

### 架构速览（`src/`）

- **后台 Service Worker**：`background/index.ts` 及其 `services/`、`storage/` 子目录，负责百度网盘 API、重试、缓存和消息分发。
- **内容运行时**：`content/index.ts` 启动 `ContentRuntime`，Vue 组件（如 `components/PanelRoot.vue`、`components/ResourceListView.vue`、`components/history/*.vue`）渲染浮动面板与历史弹层，控制器位于 `content/{controllers,history,runtime/ui}`，共享状态在 `content/state/`。
- **共享模块**：`shared/types`、`shared/utils` 以及 `shared/log.ts`（`chaosLogger`），所有运行期日志都必须经由该 helper，确保带有 `[Chaospace Transfer]` 前缀。
- **样式**：`content/styles` 下的模块化 CSS 及 `styles.loader.ts` 动态注入器。
- **测试**：`src/**/__tests__` 中的 Vitest 用例与 `tests/e2e/panel.spec.ts` Playwright 冒烟测试。

### 日志与诊断

- 一律通过 `@/shared/log` 暴露的 `chaosLogger` 记录日志，禁止直接调用 `console.*`。
- Playwright 监控器会在发现未带 `[Chaospace Transfer]` 前缀的扩展错误时立即失败，便于追踪。

### 测试流程

1. `npm run test`：快速单元测试。
2. `npm run e2e`：若缺少构建产物则自动执行 `npm run build`，随后运行 Playwright，并清理 `test-results/`。
3. `npm run check`：本地 CI 全流程，自检必跑。

提交 PR 时同步说明你的手动验证步骤（如在 Chrome DevTools 中确认百度 errno 重试逻辑）。

### 目录概览

```
Tookit/
├── src/
│   ├── background/
│   ├── content/
│   ├── shared/
│   └── ...
├── tests/e2e/panel.spec.ts
├── scripts/run-e2e.mjs
├── chaospace-extension/   # 仅作对照的旧版 MV2 代码
├── dist/
├── AGENTS.md
└── README.md
```

### 贡献须知

- 遵守 `AGENTS.md` 中的开发规范与日志、质量闸门要求。
- 每次提交前运行 `npm run check`，并避免提交任何个人凭据或 CHAOSPACE 受限内容。
