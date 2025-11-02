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

### 核心组件

1. **background.js** (Service Worker)
   - 负责所有后台业务逻辑
   - 百度网盘 API 交互:获取 bdstoken、验证分享密码、列出目录、创建目录、转存文件
   - 持久化缓存管理:`chrome.storage.local` 存储目录缓存和已转存分享链接
   - 历史记录管理:记录每个页面的转存历史,支持增量更新检测
   - 错误处理与重试机制

2. **contentScript.js** (内容脚本)
   - 注入到 CHAOSPACE 页面(`/seasons/*.html`)
   - 解析页面 DOM 结构,提取资源链接、标题、海报等信息
   - 渲染浮动面板 UI
   - 资源选择、排序、路径配置等用户交互
   - 监听后台转存进度并实时更新 UI

3. **popup.js** (弹窗脚本)
   - 扩展工具栏图标点击后的弹窗界面
   - 功能与 contentScript 类似,但用于独立弹窗环境
   - 通过 `chrome.tabs.sendMessage` 与当前标签页通信获取资源列表

### 数据流

```
CHAOSPACE 页面
    ↓ (DOM 解析)
contentScript.js → 提取资源列表
    ↓ (用户选择)
background.js → 抓取分享链接详情
    ↓ (验证提取码)
百度网盘 API → 验证分享密码
    ↓ (获取文件元数据)
百度网盘 API → 列出分享文件
    ↓ (检查目录/缓存去重)
百度网盘 API → 转存到指定目录
    ↓ (记录历史)
chrome.storage.local → 持久化缓存
```

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

### 调试扩展

1. 打开 `chrome://extensions/` 或 `edge://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序",选择 `chaospace-extension` 目录
4. 修改代码后,点击扩展卡片上的"刷新"按钮

### 调试 Service Worker (background.js)

1. 在扩展管理页面,点击扩展卡片上的"Service Worker"链接
2. 打开 DevTools 控制台查看日志
3. 所有日志以 `[Chaospace Transfer]` 前缀

### 调试内容脚本 (contentScript.js)

1. 打开 CHAOSPACE 页面(如 `https://www.chaospace.cc/seasons/123456.html`)
2. F12 打开 DevTools,查看控制台日志
3. 检查浮动面板 DOM 结构和样式

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

参考 `ERROR_MESSAGES` 对象(background.js:1-22):
- `-9`: 提取码错误或验证过期
- `-8`: 文件已存在
- `-10`/`20`: 容量不足
- `-4`: 登录失效(需要在浏览器重新登录百度网盘)

### 页面解析失败

检查 CHAOSPACE 页面结构是否变化:
- `#download` 区域是否存在
- `table tbody tr[id^="link-"]` 选择器是否匹配
- `/links/*.html` 详情页格式是否变化

相关函数:
- `locateBaiduPanRows()` (contentScript.js:77-87)
- `extractLinkInfo()` (contentScript.js:89-116)
- `parseLinkPage()` (background.js:1027-1071)

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

- 常量:大写蛇形命名法(如 `MAX_TRANSFER_ATTEMPTS`)
- 函数:驼峰命名法(如 `normalizePath`)
- DOM 相关:以 `render`、`update`、`set` 为前缀
- 异步函数:使用 `async`/`await` 而非 Promise 链

### 日志规范

统一使用 `[Chaospace Transfer]` 前缀:
```javascript
console.log('[Chaospace Transfer] bdstoken response', data);
console.warn('[Chaospace Transfer] Failed to load persistent cache', error);
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
  payload: { jobId, origin, items, targetDirectory, meta }
});
```

**background → contentScript** (进度推送):
```javascript
chrome.tabs.sendMessage(tabId, {
  type: 'chaospace:transfer-progress',
  jobId,
  stage,
  message,
  level
});
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

## 扩展功能建议

如需添加新功能,建议遵循以下模式:

1. **新增 API 交互**:在 background.js 中实现,使用 `fetchJson()` 辅助函数
2. **新增 UI 组件**:在 contentScript.js/popup.js 中实现,使用现有的 `render*()` 函数模式
3. **新增配置项**:添加到 `STORAGE_KEY` 存储对象,在 `loadSettings()`/`saveSettings()` 中处理
4. **新增缓存数据**:添加到 `persistentCacheState` 或 `historyState`,注意设置合理的上限

## 相关文档

- [Chrome Extensions API](https://developer.chrome.com/docs/extensions/)
- [chrome.storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- 百度网盘 Web API 无官方文档,通过浏览器 DevTools 抓包分析
