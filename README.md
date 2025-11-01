# CHAOSPACE 百度网盘批量转存工具

这是一个用于从 CHAOSPACE 视频资源网站批量提取百度网盘分享链接并自动转存的工具集。

## 功能特性

- 自动提取 CHAOSPACE 页面中的百度网盘分享链接
- 自动验证提取码
- 批量转存到指定的百度网盘目录
- 支持自定义子目录命名规则
- 完整的错误处理和重试机制

## 实现方式

### 1. Chrome 浏览器扩展 (推荐)

**优势**：
- 直接在浏览器中操作，复用浏览器登录态
- 无需手动提取 Cookie
- 更稳定，不易触发百度安全检测
- 支持可视化界面操作

**使用方法**：
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `chaospace-extension` 文件夹
5. 访问 CHAOSPACE 网站的剧集页面
6. 点击扩展图标，配置目标目录
7. 选择要转存的剧集，点击「开始转存」

**目录结构**：
```
chaospace-extension/
├── manifest.json       # 扩展配置文件
├── background.js       # 后台脚本 - 处理转存逻辑
├── contentScript.js    # 内容脚本 - 提取页面资源信息
├── popup.html          # 弹窗界面
└── popup.js           # 弹窗逻辑
```

### 2. Python 脚本方式

**优势**：
- 可自动化运行
- 支持批量处理多个剧集
- 灵活的配置选项

**依赖安装**：
```bash
pip install requests beautifulsoup4 retrying
```

**使用方法**：
1. 编辑 `潮片链接提取.py`，配置代理和 Cookie
2. 在 `series_list` 中添加要处理的剧集 URL 和目标目录
3. 运行脚本：
```bash
python 潮片链接提取.py
```

**主要文件**：
- `潮片链接提取.py` - 主脚本，负责抓取页面并调用转存模块
- `BaiduPanBatchTransfer.py` - 百度网盘转存核心模块
- `utils/BaiduPanBatchTransfer.py` - 工具模块副本

## 技术细节

### 百度网盘 API 调用流程

1. **获取 bdstoken**：`GET /api/gettemplatevariable?fields=["bdstoken",...]`
2. **验证提取码**：`POST /share/verify?surl={surl}&bdstoken={bdstoken}`
   - 成功后返回 `randsk`，需写入 `BDCLND` Cookie
3. **获取分享元数据**：访问分享链接，从 HTML 中提取 `locals.mset({...})` JSON
   - 关键字段：`shareid`, `share_uk`, `file_list[].fs_id`
4. **创建目录**：`POST /api/create?a=commit`
5. **转存文件**：`POST /share/transfer?shareid={}&from={}&bdstoken={}`

### 链接格式说明

百度网盘分享链接有两种格式：

1. **标准短链接**：`https://pan.baidu.com/s/1XxvgONnZLWngbROsz4DwSg`
   - surl (用于 API)：去掉开头的 `1`，即 `XxvgONnZLWngbROsz4DwSg` (22 个字符)

2. **旧格式**：`https://pan.baidu.com/share/init?surl=XxvgONnZLWngbROsz4DwSg`
   - surl 已经是不带 `1` 的格式

### 错误码说明

常见错误码及含义：

| 错误码 | 说明 |
|--------|------|
| 0 | 转存成功 |
| -1/-2/-3 | 链接元数据提取失败 |
| 2 | 提取码验证失败或需要验证码 |
| -9 | 提取码错误或验证已过期 |
| -8/4/31039 | 文件名冲突 |
| -10/20 | 容量不足 |
| 105 | 链接格式不正确 |
| 666 | 文件已存在（跳过） |

## 注意事项

### 安全性
- ⚠️ Cookie 和 access_token 属于敏感凭证，**切勿提交到代码库**
- ⚠️ 请妥善保管您的百度网盘登录信息

### API 限制
- 单次转存链接数不超过 1000 条
- bdstoken 有时效性，扩展中缓存 10 分钟
- 频繁验证错误提取码会触发限流 (errno: -62)

### Chrome 扩展特殊说明
- 扩展需要 `cookies` 权限来读写百度网盘 Cookie
- 使用 `declarativeNetRequest` API 修改请求头（Referer、Origin）
- 首次安装或更新后需重新加载扩展以应用请求头规则

## 开发调试

### Chrome 扩展调试
- **内容脚本**：在 CHAOSPACE 页面按 F12 查看控制台
- **后台脚本**：在 `chrome://extensions/` 中点击扩展的「Service Worker」
- **弹窗界面**：右键点击扩展图标 → 检查弹出内容

所有日志以 `[Chaospace Transfer]` 为前缀。

### Python 脚本调试
日志级别设置为 `INFO`，会输出详细的转存进度和错误信息。

## 许可证

本项目仅供学习交流使用，请勿用于商业用途。

## 致谢

- 百度网盘 API 参考：https://pan.baidu.com/union/doc/
- BaiduPanBatchTransfer 核心模块参考自 [hxz393](https://github.com/hxz393) 的实现
