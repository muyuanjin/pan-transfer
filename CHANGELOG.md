# Changelog

All notable changes to Pan Transfer extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2025-11-14

### Added

- **备份导入范围选择器**: 通过新对话框将设置、历史、目录缓存、面板布局拆分为独立 scope, 支持仅导入可用数据并在缺失时禁用选项, 附带覆盖警告与详细反馈 ([1076c51](https://github.com/muyuanjin/pan-transfer/commit/1076c51))
- **备份文件健壮性验证**: 抽离 `backup-validation.ts` 统一校验备份类型、版本与字段结构, 支持按 scope 过滤并在部分损坏时给出跳过提示, 避免错误数据写入 ([0841622](https://github.com/muyuanjin/pan-transfer/commit/0841622))

### Changed

- **Provider 标题排版**: Provider 名称根据标题宽度动态调整字体和字间距, 长短名称都能与标题对齐并保持可读性 ([74b5f9e](https://github.com/muyuanjin/pan-transfer/commit/74b5f9e))

## [0.2.0] - 2025-11-12

### Added

- **检测模式与手动转存**: 新增仅检测模式,支持手动暂存和批量转存,避免意外触发大批量任务 ([5841c9f](https://github.com/muyuanjin/pan-transfer/commit/5841c9f))
- **动态 Provider 主题**: 支持根据当前站点 Provider 动态切换主题色和徽标 ([30fa77f](https://github.com/muyuanjin/pan-transfer/commit/30fa77f))
- **存储模式运行时切换**: 开发/测试环境可通过 `VITE_PAN_STORAGE_PROVIDER` 或 `window.PAN_TRANSFER_STORAGE_PROVIDER` 切换存储 Provider ([a8b4455](https://github.com/muyuanjin/pan-transfer/commit/a8b4455))
- **Provider 分析事件**: 新增 Provider 偏好和切换事件日志,便于追踪用户行为 ([0d3f38b](https://github.com/muyuanjin/pan-transfer/commit/0d3f38b))
- **E2E 快照调试**: 测试失败时自动生成转存任务快照,加快问题定位 ([81849f1](https://github.com/muyuanjin/pan-transfer/commit/81849f1))

### Fixed

- **网络异常自动重试**: 转存请求遇到网络超时或临时错误时自动重试(最多 3 次),使用指数退避策略(500ms → 1000ms → 1500ms),显著提升批量转存的稳定性 ([862be96](https://github.com/muyuanjin/pan-transfer/commit/862be96))
- **历史记录滚动锚点**: 检测到更新后自动将新增记录移至顶部时,保持用户点击的卡片位置不跳动 ([2986fb4](https://github.com/muyuanjin/pan-transfer/commit/2986fb4))
- **历史列表闪烁**: 消除历史记录重新渲染时的视觉抖动和滚动跳跃 ([6364e98](https://github.com/muyuanjin/pan-transfer/commit/6364e98))

### Changed

- **⚠️ BREAKING**: 默认禁用用户手动配置存储 Provider,仅允许切换已检测到的站点 Provider ([bf1e69f](https://github.com/muyuanjin/pan-transfer/commit/bf1e69f))
- **Manifest**: 新增 `web_accessible_resources` 以支持 Provider 特定样式的动态注入 ([7fee208](https://github.com/muyuanjin/pan-transfer/commit/7fee208))

### Technical

- 新增 `transfer-service.spec.ts` 单元测试覆盖重试逻辑
- 新增 `TRANSFER_REQUEST_TIMEOUT_ERRNO (-10000)` 错误码标识网络请求异常
- 完善日志记录,所有重试和失败路径都带有详细上下文

## [0.1.0] - 2025-11-05

### Added

- 初始版本发布
- 支持 Chaospace (chaospace.xyz / chaospace.cc) 页面资源转存到百度网盘
- 浮动面板 UI,支持明亮/暗色主题
- 资源选择、排序、路径配置
- 历史记录管理与增量更新检测
- 目录文件缓存与已转存分享链接去重
- Manifest V3 + Vite 7 + TypeScript 5.9 + Vue 3 技术栈
- 完整的 ESLint、Prettier、TypeScript、Vitest、Playwright 测试覆盖

[0.2.2]: https://github.com/muyuanjin/pan-transfer/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/muyuanjin/pan-transfer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/muyuanjin/pan-transfer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/muyuanjin/pan-transfer/releases/tag/v0.1.0
