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

## 重要注意事项

### 安全性
- Cookie 和 access_token 属于敏感凭证,切勿提交到代码库
- 扩展需要 `cookies` 权限来读写百度网盘 Cookie

### API 限制
- 单次转存链接数不超过 1000 条 (BaiduPanBatchTransfer 限制)
- bdstoken 有时效性,扩展中缓存 10 分钟
- 频繁验证错误提取码会触发限流 (errno: -62)

### 错误处理
- 所有错误码映射在 `ERROR_CODES` 对象中
- 关键错误:
  - `-1/-2/-3`: 链接元数据提取失败
  - `-9`: 提取码错误或已过期
  - `-8/4/31039`: 文件名冲突
  - `-10/20`: 容量不足
  - `666`: 文件已存在 (跳过)

### 链接格式支持
- **Python 脚本**: 支持 `/s/` 链接和多种秒传格式 (bdlink/bdpan/BaiduPCS-Go)
- **Chrome 扩展**: 仅支持 `/s/` 格式分享链接

## 文件和目录处理

- 所有路径会被规范化: 反斜杠转正斜杠,多斜杠合并,确保以 `/` 开头
- 子目录名称会移除非法字符: `\/:*?"<>|`
- 目录创建是递归的,会自动创建多级父目录
- 扩展中目录创建状态会缓存在 `ensuredDirectories` Set 中,避免重复请求
