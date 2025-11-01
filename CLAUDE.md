# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个用于从 CHAOSPACE 视频资源网站批量提取百度网盘分享链接并自动转存的工具集。包含两个主要实现方式:

1. **Python 脚本方式** (`潮片链接提取.py`) - 命令行脚本,通过代理抓取页面并调用百度网盘 API 转存
2. **Chrome 扩展方式** (`chaospace-extension/`) - 浏览器插件,直接在页面上操作,复用浏览器登录态

## 核心架构

### Python 脚本架构

- `潮片链接提取.py` - 主脚本,负责抓取 CHAOSPACE 页面并调用转存模块
  - 使用 `requests` + `BeautifulSoup` 解析 HTML
  - 使用 `ThreadPoolExecutor` 并发获取多个剧集的百度网盘链接
  - 依赖 `BaiduPanBatchTransfer.py` 模块完成实际转存

- `BaiduPanBatchTransfer.py` - 百度网盘转存核心模块
  - 基于百度网盘 Web API (`pan.baidu.com`)
  - 支持两种链接格式: `/s/` 格式分享链接和秒传链接
  - 关键流程: 获取 bdstoken → 验证提取码 → 获取文件元数据 → 创建目录 → 调用转存 API
  - 包含完整的错误码映射 (`ERROR_CODES`) 和重试机制

### Chrome 扩展架构

扩展采用标准的 Manifest V3 架构:

- **contentScript.js** - 内容脚本,注入到 CHAOSPACE 页面
  - 定位资源表格 (`table tbody tr[id^="link-"]`)
  - 提取资源基础信息 (ID, 标题, 质量, 字幕等)
  - 响应 `chaospace:collect-links` 消息

- **background.js** - Service Worker 后台脚本
  - 抓取链接详情页 (`/links/{id}.html`) 获取百度网盘链接和提取码
  - 调用百度网盘 API 完成转存流程:
    1. `ensureBdstoken()` - 获取 bdstoken (缓存 10 分钟)
    2. `verifySharePassword()` - 验证提取码,设置 BDCLND Cookie
    3. `fetchShareMetadata()` - 解析分享页面的 `locals.mset()` 获取 shareid/uk/fsid
    4. `ensureDirectoryExists()` - 递归创建目标目录
    5. `transferShare()` - 调用 `/share/transfer` API 转存
  - 包含完整的错误处理和重试逻辑

- **popup.js + popup.html** - 扩展弹窗界面
  - 展示解析到的资源列表
  - 配置目标目录和子目录命名
  - 触发批量转存并展示结果统计

## 百度网盘 API 关键流程

扩展和 Python 脚本都遵循相同的百度网盘 API 调用流程:

1. **获取 bdstoken**: `GET /api/gettemplatevariable?fields=["bdstoken",...]`
2. **验证提取码** (如有): `POST /share/verify?surl={surl}` → 获取 randsk 写入 BDCLND Cookie
3. **获取分享元数据**: 访问分享链接,从 HTML 中提取 `locals.mset({...})` JSON 对象
   - 关键字段: `shareid`, `share_uk`, `file_list[].fs_id`
4. **创建目录**: `POST /api/create?a=commit`
5. **转存文件**: `POST /share/transfer?shareid={}&from={}&bdstoken={}`
   - Body: `fsidlist=[...]&path=/目标路径`

## 开发和调试

### Python 脚本

**运行脚本**:
```bash
python 潮片链接提取.py
```

**依赖项**: requests, beautifulsoup4, retrying (需手动安装,项目无 requirements.txt)

**配置要点**:
- 需要在 `潮片链接提取.py` 中配置代理 (`proxies`)
- 需要在 `cookie` 变量中填入有效的百度网盘 Cookie (必须包含 `BAIDUID`)
- 在 `series_list` 中添加要处理的剧集 URL 和目标目录

### Chrome 扩展

**加载扩展**:
1. 打开 `chrome://extensions/` 并启用开发者模式
2. 点击「加载已解压的扩展程序」,选择 `chaospace-extension` 文件夹

**调试方法**:
- 内容脚本: 在 CHAOSPACE 页面按 F12 查看控制台
- 后台脚本: 在 `chrome://extensions/` 中点击扩展的「Service Worker」查看日志
- 弹窗界面: 右键点击扩展图标 → 检查弹出内容

**关键日志标记**: 所有日志以 `[Chaospace Transfer]` 为前缀

## 关键代码位置

### Chrome 扩展核心函数
- **background.js**:
  - `ensureBdstoken()` (background.js:95) - bdstoken 获取和缓存
  - `verifySharePassword()` (background.js:149) - 提取码验证
  - `fetchShareMetadata()` (background.js:227) - 解析分享元数据
  - `ensureDirectoryExists()` (background.js:311) - 递归目录创建
  - `transferShare()` (background.js:354) - 转存 API 调用
  - `handleTransfer()` (background.js:451) - 主转存流程编排

- **contentScript.js**:
  - `locateResourceRows()` (contentScript.js:2) - 定位资源行
  - `extractLinkInfo()` (contentScript.js:11) - 提取链接信息
  - `collectLinks()` (contentScript.js:53) - 收集所有链接

- **popup.js**:
  - `sanitizeSubdir()` (popup.js:28) - 清理子目录名称
  - `normalizeDir()` (popup.js:47) - 规范化路径
  - `refreshItems()` (popup.js:276) - 刷新资源列表
  - `handleTransfer()` (popup.js:335) - 触发转存

### 消息传递机制
- `chaospace:collect-links` - popup → contentScript,获取页面资源列表
- `chaospace:transfer` - popup → background,执行批量转存

## 重要注意事项

### 安全性
- Cookie 和 access_token 属于敏感凭证,切勿提交到代码库
- 扩展需要 `cookies` 权限来读写百度网盘 Cookie
- 使用 `declarativeNetRequest` API 在运行时修改请求头 (Referer/Origin)

### API 限制
- 单次转存链接数不超过 1000 条 (BaiduPanBatchTransfer 限制)
- bdstoken 有时效性,扩展中缓存 10 分钟 (TOKEN_TTL 常量)
- 频繁验证错误提取码会触发限流 (errno: -62)

### 错误处理
- 所有错误码映射在 `ERROR_MESSAGES` 对象 (background.js:1-22)
- 关键错误:
  - `-1/-2/-3`: 链接元数据提取失败
  - `-9`: 提取码错误或已过期
  - `-8/4/31039`: 文件名冲突
  - `-10/20`: 容量不足
  - `666`: 文件已存在 (跳过)
- `mapErrorMessage()` 函数负责错误码到消息的转换

### 链接格式支持
- **Python 脚本**: 支持 `/s/` 链接和多种秒传格式 (bdlink/bdpan/BaiduPCS-Go)
- **Chrome 扩展**: 仅支持 `/s/` 格式分享链接
- `buildSurl()` 函数处理 surl 提取: `/s/1XXX` → `XXX` (去掉开头的 `1`)

## 文件和目录处理

- 所有路径会被规范化: 反斜杠转正斜杠,多斜杠合并,确保以 `/` 开头
- 子目录名称会移除非法字符: `\/:*?"<>|` (popup.js `sanitizeSubdir()`)
- 目录创建是递归的,会自动创建多级父目录 (`ensureDirectoryExists()`)
- 扩展中目录创建状态会缓存在 `ensuredDirectories` Set 中,避免重复请求

## 常见开发任务

### 修改扩展后重新加载
1. 在 `chrome://extensions/` 页面点击扩展的「重新加载」按钮
2. 如果修改了 `manifest.json` 的 `declarativeNetRequest` 规则,需要完全移除并重新加载扩展

### 添加新的错误码支持
在 `background.js` 的 `ERROR_MESSAGES` 对象中添加对应的错误码和消息

### 调整 bdstoken 缓存时间
修改 `background.js` 中的 `TOKEN_TTL` 常量 (当前为 10 分钟)
