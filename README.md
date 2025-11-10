# Pan Transfer Chrome Extension / Pan Transfer 转存助手

[English](#english) | [中文](#中文)

<a name="english"></a>

## English Version

### Purpose

Pan Transfer is a Manifest V3 Chrome/Edge extension built with Vite 7, TypeScript 5.9, and Vue 3. The current build is dedicated to Chaospace (chaospace.xyz / chaospace.cc) pages and helps copy the public resource metadata from those pages into a user's personal Baidu Netdisk workspace. The project is open-source, intended for research/testing, and carries no commercial promises.

### Current Capabilities

- Detect Chaospace detail pages and render a floating Vue panel with the matched titles, seasons, and downloadable assets.
- Allow users to select files, adjust renaming presets, and push the choices to Baidu Netdisk while keeping a local history of transfers.
- Provide non-intrusive toasts, toolbar actions, and panel preferences so the overlay can stay pinned or hidden per tab.
- Offer both light and dark layouts plus granular settings for filters and path presets.

### Screenshots

<p align="center">
  <img src="docs/panel-main-light.png" alt="Panel overview in light theme" width="640" />
</p>
<p align="center">
  <img src="docs/panel-main-dark.png" alt="Panel overview in dark theme" width="640" />
</p>
<p align="center">
  <img src="docs/history-detail.png" alt="History detail overlay" width="640" />
</p>
<p align="center">
  <img src="docs/transfer-history.png" alt="Transfer history list" width="640" />
</p>
<p align="center">
  <img src="docs/settings-filters.png" alt="Settings dialog - filters" width="640" />
</p>
<p align="center">
  <img src="docs/settings-rename.png" alt="Settings dialog - renaming" width="640" />
</p>
<p align="center">
  <img src="docs/settings-presets.png" alt="Settings dialog - presets" width="640" />
</p>

### Installation (Chrome/Edge)

1. Download `pan-transfer-extension.zip` from the latest GitHub Release or the `Release` workflow run artifacts.
2. Verify that the archive only contains the generated `dist/` assets, then unzip it to a convenient folder.
3. Open `chrome://extensions/` (or `edge://extensions/`), enable **Developer mode**, select **Load unpacked**, and choose the extracted `dist/` directory.
4. Sign in to Chaospace and Baidu Netdisk in your browser profile before using the panel.

### Development Workflow

1. Install dependencies once: `npm install`.
2. Start a hot-reload preview: `npm run dev`.
3. Build the MV3 bundle: `npm run build`.
4. Run lint + type + test gate: `npm run check` (runs `format:silent → typecheck → lint:ci → build → test → e2e`).

Key standalone scripts:

- `npm run typecheck` – `vue-tsc --noEmit -p tsconfig.app.json`.
- `npm run test` – Vitest suites covering parsers, renderers, and history logic.
- `npm run e2e` – Builds (if needed) then launches Playwright tests against Chaospace fixtures.
- `npm run lint` / `npm run lint:ci` – ESLint with/without the zero-warning gate.
- `node scripts/generate-icons.mjs` – re-generates the extension icons (`src/public/icon-48.png`, `src/public/icon-128.png`) using the canvas-based artwork.

### Repository Layout (excerpt)

```
pan-transfer/
├── src/
│   ├── background/        # Service worker, Baidu integrations, message routing
│   ├── content/           # Panel UI, controllers, history overlays, styles
│   ├── shared/            # Types, logging helpers, utilities
│   └── manifest.json      # MV3 definition
├── docs/                  # Screenshots and internal notes
├── tests/e2e/             # Playwright test
├── scripts/               # Helper scripts (e.g., e2e runner)
├── .github/workflows/     # Release automation (see release.yml)
└── README.md
```

### Adding Site Providers

- Provider contracts (`SiteProvider`, `StorageProvider`, etc.) live in `src/platform/registry/types.ts`. When building a new integration, start from the sample `createGenericForumSiteProvider` under `src/providers/sites/generic-forum/`.
- Every site provider should live under `src/providers/sites/<provider-id>/` and export a factory. Keep DOM analyzers, parsers, and helpers scoped to that directory so changes stay localized.
- Register the provider in both registries: `src/content/providers/registry.ts` (content runtime) and `src/background/providers/registry.ts` (background/service worker). This keeps detection, history refresh, and background transfers in sync.
- Add Vitest coverage in `src/providers/sites/<provider-id>/__tests__/` that exercises detection plus `collectResources`. Use HTML fixtures to avoid hitting live sites.
- Reference `docs/pan-transfer-migration-plan.md` for the current rollout expectations and document any manual verification steps in your PR description.

#### Provider Parity Checklist

- `npm run check` stays green (includes `format:check → typecheck → lint:ci → build → vitest → playwright`). Run `npm run e2e` locally to confirm the Chaospace baseline still passes after adding a provider.
- Provider-specific Vitest suites cover detection/resource parsing, and Playwright (or manual Chrome devtools) confirms the floating panel shows the provider badge plus resources on the target site.
- Background hooks (`collectHistorySnapshot`, `collectHistoryDetail`) are implemented or intentionally skipped with `[Pan Transfer]` logs so history refreshes remain predictable.
- README/docs note any new permissions, toggles, or manual QA steps introduced by the provider.

### Adding Storage Providers

- Storage implementations live under `src/providers/storage/<provider-id>/`. Use `baidu-netdisk` and `mock-storage-provider` as templates when wiring a new factory.
- Follow the `StorageProvider` interface in `src/platform/registry/types.ts`: expose `capabilities`, guard uploads with `ensureReady`, and keep provider-specific HTTP/retry logic colocated so errno handling stays isolated.
- Register the provider with the background registry (`src/background/providers/registry.ts`) and surface it via the pipeline (`src/background/providers/pipeline.ts`). Local testing can flip implementations through `VITE_PAN_STORAGE_PROVIDER=mock` or `window.PAN_TRANSFER_STORAGE_PROVIDER = 'mock'`, so new providers should honor that knob.
- Add Vitest suites in `src/providers/storage/<provider-id>/__tests__/` that mock `fetch`/`Response` to verify payloads, retries, and telemetry—avoid live API calls.
- Document any new permissions, env vars, or QA steps here and in `docs/pan-transfer-migration-plan.md`, and keep `npm run check` green to prove Baidu remains the default shipping backend.

### Release Automation

The `.github/workflows/release.yml` workflow can be triggered manually (`workflow_dispatch`) or by pushing a tag such as `v1.0.0`. It performs `npm ci`, runs `npm run check`, builds the extension, zips the `dist/` output, and uploads `pan-transfer-extension.zip` both as a workflow artifact and as a GitHub Release asset (for tagged runs). Review the workflow logs before distributing any build.

### Notes

- Logs are routed through `chaosLogger` and always include the `[Pan Transfer]` prefix for easier debugging.
- The project is unaffiliated with Chaospace or Baidu. Use it responsibly and follow the terms of the target services.
- Do not store personal credentials in the repository; rely on your browser profile for authentication.

---

<a name="中文"></a>

## 中文版本

### 项目说明

Pan Transfer 是一个基于 Vite 7、TypeScript 5.9 与 Vue 3 的 Manifest V3 Chrome/Edge 扩展，当前版本仅针对 Chaospace (chaospace.xyz / chaospace.cc) 页面，帮助用户把公开的资源信息整理并转存到自己的百度网盘目录。本项目开源共享，用于个人研究或自测，不包含任何商业承诺。

### 现有功能

- 识别 Chaospace 影片/剧集详情页，在页面上方渲染浮动面板并列出匹配的剧集、季和资源。
- 支持选择文件、调整重命名预设，并把选择结果提交给百度网盘，同时保留本地转存历史。
- 通过提示气泡、工具栏按钮和面板偏好设置，在不同标签页中维持独立的显示状态。
- 提供明亮/暗色主题和更细致的过滤、路径预设配置项。

### 安装步骤（Chrome/Edge）

1. 前往 GitHub Releases 或最新一次 `Release` 工作流运行记录，下载 `pan-transfer-extension.zip`。
2. 确认压缩包仅包含构建生成的 `dist/` 内容，并将其解压到本地目录。
3. 打开 `chrome://extensions/` 或 `edge://extensions/`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择刚解压的 `dist/` 目录。
4. 使用前请确保浏览器已登录 Chaospace 与百度网盘账号。

### 开发与测试

1. `npm install` 安装依赖。
2. `npm run dev` 启动带热更新的开发预览。
3. `npm run build` 构建生产包。
4. `npm run check` 运行完整质量闸门（`format:silent → typecheck → lint:ci → build → test → e2e`）。

常用脚本：

- `npm run typecheck`：`vue-tsc --noEmit -p tsconfig.app.json`。
- `npm run test`：运行 Vitest 单元测试。
- `npm run e2e`：若缺少 `dist/manifest.json` 则会先构建，再执行 Playwright 测试。
- `npm run lint` / `npm run lint:ci`：ESLint（后者警告即失败）。
- `node scripts/generate-icons.mjs`：通过画布脚本重新生成 `src/public/icon-48.png` 与 `src/public/icon-128.png`。

### 仓库结构（节选）

```
pan-transfer/
├── src/background/      # Service worker 及百度网盘 API 交互
├── src/content/         # Vue 面板、控制器、历史与样式
├── src/shared/          # 类型、日志、工具函数
├── docs/                # 截图与内部文档
├── tests/e2e/           # Playwright 测试
├── scripts/             # 辅助脚本
├── .github/workflows/   # GitHub Action（release.yml）
└── README.md
```

### 扩展站点 Provider

- Provider 协议（`SiteProvider`、`StorageProvider` 等）定义在 `src/platform/registry/types.ts`，可以参考 `src/providers/sites/generic-forum/` 下的示例 `createGenericForumSiteProvider` 来实现新的站点。
- 每个站点 Provider 都应放在 `src/providers/sites/<provider-id>/` 目录中，导出一个工厂方法，并把解析 DOM 的辅助函数保留在同一目录，避免影响其他站点。
- 记得同时在 `src/content/providers/registry.ts`（内容脚本）与 `src/background/providers/registry.ts`（后台 Service Worker）注册 Provider，这样检测、历史刷新与后台任务才能复用相同的配置。
- 在 `src/providers/sites/<provider-id>/__tests__/` 下补充 Vitest 测试，使用 HTML 固定样本覆盖 detect 与 `collectResources`，避免依赖线上站点。
- 变更时请同步查阅 `docs/pan-transfer-migration-plan.md`，并在 PR 中记录手动验证步骤或额外权限需求。

#### Provider 验证清单

- `npm run check` 必须保持通过（包含 `format:check → typecheck → lint:ci → build → vitest → playwright`）；本地执行 `npm run e2e`，确认 Chaospace 基线仍可通过。
- Provider 对应的 Vitest 套件覆盖检测/解析逻辑，并通过 Playwright 或人工在 Chrome DevTools 中确认页面浮窗显示正确的站点徽标与资源列表。
- 如实现了历史刷新，确保 `collectHistorySnapshot` / `collectHistoryDetail` 可用；若暂不支持，也要输出 `[Pan Transfer]` 日志说明跳过原因。
- README / 文档需补充 Provider 引入的新权限、开关或 QA 流程。

### 扩展存储 Provider

- 存储实现位于 `src/providers/storage/<provider-id>/`，可参考 `baidu-netdisk` 与 `mock-storage-provider` 目录学习 `StorageProvider` 工厂的组织方式。
- 遵循 `src/platform/registry/types.ts` 中的接口：实现 `capabilities`、`ensureReady`、转存调度与配额函数，并把各云厂商的 HTTP / errno 处理逻辑封装在对应目录。
- 在 `src/background/providers/registry.ts` 注册 Provider，并在 `src/background/providers/pipeline.ts` 中接入工厂。开发调试可通过 `VITE_PAN_STORAGE_PROVIDER=mock` 或 `window.PAN_TRANSFER_STORAGE_PROVIDER='mock'` 切换实现，因此新 Provider 必须兼容该开关。
- 在 `src/providers/storage/<provider-id>/__tests__/` 下添加 Vitest，使用 mock `fetch` / `Response` 校验请求体、重试策略和日志，避免调用真实接口。
- 若新增权限、环境变量或手动验证步骤，请同步更新 README 及 `docs/pan-transfer-migration-plan.md`，并持续跑通 `npm run check`，确保默认的百度网盘路径没有回归问题。

### 发布与注意事项

- 日志统一带有 `[Pan Transfer]` 前缀，便于排查。
- 项目与 Chaospace、百度无官方关联，请遵守目标站点/服务的使用条款。
