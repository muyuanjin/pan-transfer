# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Chrome/Edge 浏览器扩展程序,用于自动化从 CHAOSPACE 网站(chaospace.xyz、chaospace.cc)批量转存百度网盘资源到个人网盘目录。

**核心功能**:

- 自动解析 CHAOSPACE 剧集页面中的资源链接
- 批量提取百度网盘分享链接与提取码
- 调用百度网盘 Web API 完成转存(基于浏览器登录态)
- 智能去重:利用历史记录缓存减少重复抓取
- 持久化缓存:目录文件缓存、已转存分享链接缓存

## 架构设计

**⚠️ 重要**: 本项目已采用 **Vite + TypeScript** 构建系统,源代码位于 `src/` 目录。`chaospace-extension/` 目录为**遗留构建产物,仅供对比验证**,**禁止直接修改**。

### 项目结构

```
src/
├── background/          # Service Worker 后台逻辑(已 100% TypeScript 化)
│   ├── api/            # 百度网盘和 CHAOSPACE API 封装(baidu-pan.ts, chaospace.ts)
│   ├── common/         # 常量和错误处理(constants.ts, errors.ts)
│   ├── services/       # 业务服务(transfer-service.ts, history-service.ts, parser-service.ts)
│   ├── storage/        # 缓存和历史记录存储(cache-store.ts, history-store.ts, utils.ts)
│   ├── utils/          # 工具函数(path.ts, share.ts)
│   ├── types.ts        # 运行时类型定义(TransferRuntimeOptions, ProgressLogger)
│   └── index.ts        # 后台入口
├── content/            # Content Script 内容脚本(部分模块化,主入口待重构)
│   ├── components/     # UI 组件(panel.js[Vue], history-card.js, resource-list.js, settings-modal.js, zoom-preview.js)
│   ├── services/       # 页面解析和历史服务(page-analyzer.js, season-loader.js, history-service.js)
│   ├── state/          # 前端状态管理(index.js)
│   ├── utils/          # DOM/格式化/存储工具(dom.js, format.js, storage.js, title.js)
│   ├── styles/         # 样式文件(待模块化拆分)
│   └── index.js        # 内容脚本入口(~3k LOC,待进一步拆分)
├── shared/             # 共享工具函数(已 TypeScript 化)
│   ├── types/          # 共享类型定义(transfer.ts)
│   └── utils/          # 工具函数(sanitizers.ts, completion-status.ts, chinese-numeral.ts)
└── manifest.json       # 扩展清单

chaospace-extension/     # 遗留目录(仅用于对比验证,禁止修改)
dist/                    # Vite 构建产物(用于加载到浏览器)
```

### 核心组件

1. **background/** (Service Worker)
   - 负责所有后台业务逻辑
   - 百度网盘 API 交互:获取 bdstoken、验证分享密码、列出目录、创建目录、转存文件
   - 持久化缓存管理:`chrome.storage.local` 存储目录缓存和已转存分享链接
   - 历史记录管理:记录每个页面的转存历史,支持增量更新检测
   - 错误处理与重试机制

2. **content/** (内容脚本)
   - 注入到 CHAOSPACE 页面(`/seasons/*.html`, `/tvshows/*.html`)
   - 解析页面 DOM 结构,提取资源链接、标题、海报等信息
   - 渲染浮动面板 UI
   - 资源选择、排序、路径配置等用户交互
   - 监听后台转存进度并实时更新 UI

3. **shared/** (共享工具)
   - 通用工具函数,供 background 和 content 共享
   - 包含中文数字转换、路径清理、完成状态解析等功能

### 数据流

```
CHAOSPACE 页面
    ↓ (DOM 解析)
content/services/page-analyzer.js → 提取资源列表
    ↓ (用户选择)
background/services/transfer-service.js → 抓取分享链接详情
    ↓ (验证提取码)
百度网盘 API → 验证分享密码
    ↓ (获取文件元数据)
百度网盘 API → 列出分享文件
    ↓ (检查目录/缓存去重)
百度网盘 API → 转存到指定目录
    ↓ (记录历史)
chrome.storage.local → 持久化缓存
```

### 构建与开发

#### 开发流程命令

**开发模式**(监听文件变化,自动重新构建):

```bash
npm run dev  # vite build --mode development --watch
```

**类型检查**(推荐每次改动后运行):

```bash
npm run typecheck  # vue-tsc --noEmit -p tsconfig.app.json
```

**代码质量与格式化**:

```bash
npm run lint           # ESLint 检查代码质量问题
npm run lint:fix       # 自动修复可修复的 ESLint 问题
npm run format         # Prettier 格式化所有代码
npm run format:check   # 检查代码格式是否符合规范
```

**构建与测试**:

```bash
npm run build  # vite build --mode production
npm run test   # vitest run - 运行单元测试
npm run e2e    # playwright test - 端到端测试(需先构建 dist/)
```

**完整质量检查流程**:

```bash
npm run check  # 按顺序运行: format:silent → typecheck → lint → build → test → e2e
```

#### 完整 check 流程详解

`npm run check` 会按以下顺序执行所有质量检查:

1. **自动格式化** (`npm run format:silent`)
   - 使用 Prettier 自动修复所有格式问题
   - 静默模式: 仅显示警告和错误,不显示已格式化的文件列表
   - **为什么放在第一步**: 格式化会修改代码,必须在类型检查和构建前执行

2. **类型检查** (`npm run typecheck`)
   - 运行 `vue-tsc --noEmit -p tsconfig.app.json`
   - 确保所有 TypeScript 类型正确
   - 检查 `.ts`、`.tsx` 和 `.vue` 文件

3. **代码质量检查** (`npm run lint`)
   - 运行 ESLint 扫描所有源代码
   - 检查潜在的 bug、不良实践、代码规范问题
   - 当前配置: 0 错误为通过标准(警告不阻塞)

4. **生产构建** (`npm run build`)
   - 运行 Vite 构建生产版本
   - 输出到 `dist/` 目录
   - 验证构建配置正确

5. **单元测试** (`npm run test`)
   - 运行 Vitest 单元测试套件
   - 测试核心业务逻辑和工具函数

6. **端到端测试** (`npm run e2e`)
   - 使用 Playwright 在真实 Chromium 中测试
   - 验证扩展在浏览器中的实际行为

**重要提示**:

- ✅ **提交代码前务必运行** `npm run check` **确保所有检查通过**
- ✅ 首次运行 E2E 测试前需执行 `npx playwright install chromium`
- ✅ 构建产物输出到 `dist/` 目录(非 `chaospace-extension/`!)
- ✅ 加载扩展时选择 `dist/` 目录,**不要加载** `chaospace-extension/`
- ❌ `chaospace-extension/` 仅用于对比旧版行为,禁止手动修改

#### 修复代码问题的推荐流程

当遇到代码质量问题时,按以下顺序修复:

```bash
# 1. 格式化代码(自动修复格式问题)
npm run format

# 2. 自动修复 lint 问题(修复可自动修复的规范问题)
npm run lint:fix

# 3. 类型检查(手动修复类型错误)
npm run typecheck
# 根据输出修复类型错误

# 4. 运行完整检查验证
npm run check
```

#### 代码质量工具配置

**ESLint** (`eslint.config.mjs`):

- 使用 ESLint v9 扁平化配置格式
- 集成 TypeScript、Vue、Prettier 插件
- 针对不同文件类型配置专门规则:
  - 配置文件 (\*.config.ts) 使用 `tsconfig.node.json`
  - 源代码 (src/\*_/_.ts) 使用 `tsconfig.app.json`
  - Vue 文件不启用类型感知检查(由 vue-tsc 负责)
  - 测试文件放宽部分规则
- 当前状态: 0 错误, ~400 警告(渐进式改进中)

**Prettier** (`.prettierrc.json`):

- 统一代码格式规范
- 配置: 无分号、单引号、100 字符行宽、尾随逗号
- 忽略文件: `dist/`, `node_modules/`, `chaospace-extension/`, 测试 fixtures

**TypeScript** (`tsconfig.app.json`, `tsconfig.node.json`):

- 应用代码使用 `@tsconfig/strictest` 严格模式
- 配置文件和测试使用独立的 tsconfig
- 支持 Vue 单文件组件类型检查

## 技术栈

### 核心技术

- **构建工具**: Vite 7.x(多入口构建:`background/index.ts`、`content/index.js`、`content/styles/index.css`)
- **类型系统**: TypeScript 5.x + `@tsconfig/strictest`(background 已全面应用)
- **前端框架**: Vue 3.x(浮动面板 UI,渐进式迁移中)
- **浏览器 API**: Chrome Extensions Manifest V3(`chrome.storage`、`chrome.runtime`、`chrome.declarativeNetRequest`)
- **代码质量**: ESLint 9.x + Prettier 3.x + TypeScript ESLint(自动检查与格式化)
- **测试框架**: Vitest 2.x(单元测试) + Playwright 1.x(E2E 测试)
- **代码规范**: 两空格缩进,Conventional Commits 风格,`[Chaospace Transfer]` 日志前缀

### 类型系统设计

**核心类型定义**:

- `src/background/types.ts`:运行时选项(`TransferRuntimeOptions`)、进度日志器(`ProgressLogger`)
- `src/shared/types/transfer.ts`:转存请求/响应载荷、历史记录结构、状态枚举
- `src/shared/utils/completion-status.ts`:完成状态值对象(`CompletionStatus`、`SeasonEntry`)
- `src/shared/utils/sanitizers.ts`:海报信息、标题/链接清理函数类型

**严格性配置**:

- Background 模块遵循 `@tsconfig/strictest`,禁止隐式 `any`、未使用变量、非空断言

## 关键技术点

### 百度网盘 API 调用流程

1. **获取 bdstoken**:
   - 请求 `https://pan.baidu.com/api/gettemplatevariable`
   - 缓存 10 分钟(TOKEN_TTL)

2. **验证分享密码**:
   - 从链接提取 `surl`(去掉开头的 '1')
   - POST `https://pan.baidu.com/share/verify` 并设置 BDCLND Cookie

3. **获取分享文件列表**:
   - 直接 fetch 分享页面 HTML
   - 正则提取 `locals.mset({...})` 中的 JSON 数据
   - 解析 `shareid`、`share_uk`、`file_list` 等字段

4. **转存文件**:
   - POST `https://pan.baidu.com/share/transfer`
   - 参数:`fsidlist`(文件 ID 数组)、`path`(目标路径)
   - 支持最多 3 次重试(MAX_TRANSFER_ATTEMPTS)

### 缓存策略

**目录文件缓存** (`directoryFileCache`):

- 缓存每个目录下的文件名集合
- 用于跳过已存在的文件,避免重复转存
- 上限 10 万条(MAX_DIRECTORY_CACHE_ENTRIES)

**已转存分享链接缓存** (`completedShareCache`):

- 记录已成功转存的 `surl` 和时间戳
- 避免重复抓取同一分享链接
- 上限 40 万条(MAX_SHARE_CACHE_ENTRIES)

**历史记录** (`historyState`):

- 按页面 URL 索引,记录每个资源的转存状态
- 支持增量更新检测:比对页面当前资源与历史记录,识别新增项
- 上限 20 万条记录(MAX_HISTORY_RECORDS)

### 请求头修改

使用 `chrome.declarativeNetRequest` API 在运行时修改所有发往 `pan.baidu.com` 的 XHR 请求头:

- 添加 `Referer: https://pan.baidu.com`
- 添加 `Origin: https://pan.baidu.com`

这确保请求能通过百度网盘的防盗链检查。

### UI 组件

**浮动面板** (contentScript.js):

- 可拖拽、可调整大小、可最小化
- 支持深色/浅色主题切换
- 实时日志显示(最多 80 条)
- 历史记录卡片(显示最近 6-8 条)
- 资源列表:支持排序(默认顺序/标题)、全选/反选/仅选新增

**路径管理**:

- 预设路径快捷选择(收藏/删除)
- 自动为剧集创建子目录(使用页面标题)
- 路径归一化:`normalizeDir()` 统一处理路径格式

## 开发流程

### 本地开发

1. 安装依赖:

   ```bash
   npm install
   ```

2. 启动开发模式(监听文件变化):

   ```bash
   npm run dev
   ```

3. 加载扩展:
   - 打开 `chrome://extensions/` 或 `edge://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序",选择 **`dist/` 目录**(不是 `chaospace-extension/`!)

4. 修改源代码:
   - 编辑 `src/` 目录下的文件
   - TypeScript 文件修改后,运行 `npm run typecheck` 验证类型
   - Vite 会自动重新构建到 `dist/`
   - 在扩展管理页面点击"刷新"按钮重新加载扩展

5. **重要规则**:
   - ✅ **只在 `src/` 中修改代码**
   - ❌ **禁止修改 `chaospace-extension/` 中的任何文件**
   - ❌ **禁止修改 `dist/` 中的构建产物**

### 调试 Service Worker (background)

1. 在扩展管理页面,点击扩展卡片上的"Service Worker"链接
2. 打开 DevTools 控制台查看日志
3. 所有日志以 `[Chaospace Transfer]` 前缀
4. 相关文件: `src/background/index.ts`(已 TypeScript 化)

**TypeScript 源码映射**:

- 构建时已生成 Source Maps,DevTools 可以直接调试 `.ts` 源码
- 如需查看类型定义,参考 `src/background/types.ts` 和 `src/shared/types/transfer.ts`

### 调试内容脚本 (content)

1. 打开 CHAOSPACE 页面(如 `https://www.chaospace.cc/seasons/123456.html`)
2. F12 打开 DevTools,查看控制台日志
3. 检查浮动面板 DOM 结构和样式
4. 相关文件: `src/content/index.js`

### 测试网络请求

1. DevTools → Network 标签
2. 筛选 `pan.baidu.com` 域名
3. 查看请求头、响应体、errno 错误码

### 查看存储数据

1. DevTools → Application → Storage → Local Storage
2. 查看 `chaospace-transfer-cache`(目录缓存和分享链接缓存)
3. 查看 `chaospace-transfer-history`(转存历史记录)

## 常见问题与解决方案

### 转存失败错误码

参考 `ERROR_MESSAGES` 对象(`src/background/common/constants.ts:1-22`):

- `-9`: 提取码错误或验证过期
- `-8`: 文件已存在
- `-10`/`20`: 容量不足
- `-4`: 登录失效(需要在浏览器重新登录百度网盘)

### 页面解析失败

检查 CHAOSPACE 页面结构是否变化:

- `#download` 区域是否存在
- `table tbody tr[id^="link-"]` 选择器是否匹配
- `/links/*.html` 详情页格式是否变化

相关文件:

- `src/content/services/page-analyzer.js` - 页面解析逻辑(剧集资源列表提取)
- `src/background/services/parser-service.ts` - 链接详情解析(HTML 解析)

### 缓存不生效

检查:

- `ensureCacheLoaded()` 是否正常加载
- `persistCacheNow()` 是否正常保存
- 存储配额是否超限(chrome.storage.local 默认 10MB)

### 历史记录丢失

检查:

- `ensureHistoryLoaded()` 加载逻辑
- `persistHistoryNow()` 保存时机
- `MAX_HISTORY_RECORDS` 是否过小导致旧记录被清理

## 代码规范

### 命名约定

- **常量**:大写蛇形命名法(如 `MAX_TRANSFER_ATTEMPTS`)
- **函数**:驼峰命名法(如 `normalizePath`)
- **类型/接口**:帕斯卡命名法(如 `TransferRuntimeOptions`、`ProgressLogger`)
- **DOM ID/Class**:kebab-case(如 `chaospace-panel`、`season-tab-active`)
- **文件名**:kebab-case(如 `page-analyzer.js`、`transfer-service.ts`)
- **异步函数**:优先使用 `async`/`await` 而非 Promise 链

### TypeScript 规范

**类型定义位置**:

- 模块内部类型 → 文件顶部 `interface` / `type` 声明
- 跨模块共享类型 → `src/background/types.ts` 或 `src/shared/types/*.ts`
- 函数参数类型 → 优先使用已定义的接口,避免内联对象类型

**类型守卫**:

```typescript
// ✅ 推荐:使用类型守卫
function isSuccess(meta: ShareMetadata): meta is ShareMetadataSuccess {
  return !('error' in meta)
}

// ❌ 避免:类型断言
const result = meta as ShareMetadataSuccess
```

**导入路径**:

```typescript
// ✅ 推荐:无扩展名导入(Vite 自动解析)
import { normalizePath } from '../utils/path'

// ❌ 避免:显式 .ts 扩展名
import { normalizePath } from '../utils/path.ts'
```

### 日志规范

统一使用 `[Chaospace Transfer]` 前缀:

```javascript
console.log('[Chaospace Transfer] bdstoken response', data)
console.warn('[Chaospace Transfer] Failed to load persistent cache', error)
```

### 错误处理

- 网络请求失败:记录详细错误信息,抛出 Error 对象
- 用户操作错误:使用 `showToast()` 显示友好提示
- 后台任务失败:通过 `emitProgress()` 发送进度事件

### 消息通信

**contentScript ↔ background**:

```javascript
chrome.runtime.sendMessage({
  type: 'chaospace:transfer',
  payload: { jobId, origin, items, targetDirectory, meta },
})
```

**background → contentScript** (进度推送):

```javascript
chrome.tabs.sendMessage(tabId, {
  type: 'chaospace:transfer-progress',
  jobId,
  stage,
  message,
  level,
})
```

## 性能优化

1. **分页查询目录**:每次最多查询 200 条(DIRECTORY_LIST_PAGE_SIZE)
2. **缓存目录结果**:避免重复请求同一目录
3. **批量转存**:单次请求可转存多个文件(fsidlist 数组)
4. **LRU 淘汰**:缓存条目超限时按时间戳排序淘汰最旧的

## 安全注意事项

- 不要在代码或日志中暴露用户的百度网盘 Cookie
- 使用 `credentials: 'include'` 依赖浏览器自动管理 Cookie
- 避免在公共仓库中提交包含个人凭证的测试数据
- BDCLND Cookie 设置时使用 `secure: true` 和 `sameSite: 'no_restriction'`

## 相关文档

### 项目文档

- `AGENTS.md` - 项目结构、构建命令、代码规范速查表
- `CLAUDE.md` - 本文件,技术栈和开发指南

### 配置文件

**代码质量工具配置**:

- `eslint.config.mjs` - ESLint 9.x 扁平化配置,支持 TypeScript/Vue/JavaScript
- `.prettierrc.json` - Prettier 格式化规则(无分号、单引号、100 字符行宽)
- `.prettierignore` - Prettier 忽略文件列表(dist、node_modules、fixtures 等)

**TypeScript 配置**:

- `tsconfig.json` - 项目根配置(引用子配置)
- `tsconfig.app.json` - 应用代码配置(src/ 目录,使用 @tsconfig/strictest)
- `tsconfig.node.json` - 配置文件和测试配置(\*.config.ts、tests/)

**构建与测试配置**:

- `vite.config.ts` - Vite 构建配置(多入口、Vue 插件、扩展构建)
- `vitest.config.ts` - Vitest 单元测试配置
- `playwright.config.ts` - Playwright E2E 测试配置

### 外部资源

- [Chrome Extensions API](https://developer.chrome.com/docs/extensions/)
- [chrome.storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Vite 配置指南](https://vitejs.dev/config/)
- [Vue 3 组合式 API](https://vuejs.org/guide/introduction.html)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- 百度网盘 Web API 无官方文档,通过浏览器 DevTools 抓包分析

## 开发注意事项

### 禁止事项

- ❌ **禁止修改 `chaospace-extension/` 中的任何文件**(遗留目录,仅供对比)
- ❌ **禁止在代码/日志中暴露百度网盘 Cookie 或 Token**
- ❌ **禁止跳过 `npm run typecheck`**(TypeScript 模块修改后必须验证)
- ❌ **禁止在 `src/` 中使用 `.js` 扩展名导入 TypeScript 模块**(如 `import x from './foo.js'` 应改为 `import x from './foo'`)
- ❌ **禁止使用 `// @ts-ignore`**(除非有充分理由,优先修复类型错误)

### 推荐实践

- ✅ **提交前务必运行 `npm run check`**(完整质量检查,确保所有测试通过)
- ✅ **每次改动后运行 `npm run typecheck`**(验证类型正确性)
- ✅ **使用 `npm run format` 和 `npm run lint:fix`**(自动修复格式和代码质量问题)
- ✅ **提交前在真实 CHAOSPACE 页面手动测试**
- ✅ **提交信息遵循 Conventional Commits**(`feat:`、`fix:`、`refactor:`、`docs:`)
- ✅ **大功能分阶段提交**(每个提交保持构建绿色)
- ✅ **从现有代码中学习模式**(参考 `src/background/api/baidu-pan.ts` 的类型设计)
