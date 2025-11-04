# CHAOSPACE Transfer Assistant Chrome Extension / CHAOSPACE 转存助手 Chrome 插件

[English](#english) | [中文](#中文)

<a name="english"></a>

## English Version

### Project Overview

The CHAOSPACE Transfer Assistant is a Chrome/Edge browser extension designed to automate the process of transferring Baidu Netdisk resources from CHAOSPACE websites (chaospace.xyz, chaospace.cc, etc.) to personal Baidu Netdisk directories.

### Key Features

- **Automatic Resource Detection**: Automatically parses resource links from CHAOSPACE series pages
- **Batch Processing**: Handles multiple resources simultaneously with intelligent deduplication
- **Smart Caching**: Uses persistent caching to avoid duplicate transfers
- **History Tracking**: Maintains transfer history with incremental update detection
- **Flexible Directory Management**: Supports custom save paths with subdirectory creation
- **Real-time Progress**: Live logging and progress updates during transfers
- **Dark/Light Themes**: User-friendly interface with theme customization
- **Floating Panel**: Interactive panel that can be dragged, resized, and minimized

### Installation

#### Method 1: Developer Mode

1. Download or clone this repository
2. Open Chrome/Edge and navigate to `chrome://extensions/` or `edge://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the **`chaospace-extension`** directory
5. The extension icon will appear in the toolbar

### Building

This is a simple Chrome extension without a build process. To use it:

1. Clone or download the repository
2. Use the `chaospace-extension` directory directly for installation
3. No compilation or bundling required

### Usage Instructions

#### Basic Workflow

1. **Login to Baidu Netdisk**: Ensure you're logged into pan.baidu.com in your browser
2. **Navigate to CHAOSPACE**: Visit a series page (e.g., `https://www.chaospace.cc/seasons/xxxxxx.html`)
3. **Open Extension**: Click the extension icon in the toolbar or use the floating panel
4. **Configure Settings**:
   - Set target directory (e.g., `/视频/番剧`)
   - Choose whether to create subdirectories for each resource
   - Select resources to transfer (all, invert, or new only)
5. **Start Transfer**: Click "Transfer Selected Resources" and monitor progress
6. **Review Results**: Check transfer summary and logs

#### Interface Components

**Floating Panel** (Appears on CHAOSPACE pages):

- Resource list with selection options
- Directory configuration and presets
- Real-time transfer logs
- Transfer history panel
- Status indicators

**Popup Interface** (Toolbar click):

- Similar functionality to floating panel
- Compact interface for quick access
- Theme customization

### Technical Architecture

#### Core Components

1. **Background Script** (`background.js`)
   - Manages Baidu Netdisk API interactions
   - Handles authentication (bdstoken management)
   - Processes file transfers with retry logic
   - Manages persistent caching and history
   - Error handling and progress tracking

2. **Content Script** (`contentScript.js`)
   - Injects into CHAOSPACE pages
   - Parses DOM to extract resource information
   - Renders floating panel interface
   - Handles user interactions and UI updates

3. **Popup Interface** (`popup.html/css/js`)
   - Provides alternative access point via toolbar
   - Communicates with current tab for resource data
   - Offers theme customization options

#### Key Technologies

- **Baidu Netdisk Web API**: Uses official web APIs for authentication and transfers
- **Chrome Extension APIs**: Leverages storage, tabs, cookies, and declarativeNetRequest
- **Modern JavaScript**: ES6+ features with async/await patterns
- **CSS Grid/Flexbox**: Responsive design with dark/light themes

### Configuration Options

#### Directory Management

- **Base Directory**: Root path for all transfers (default: `/`)
- **Subdirectory Creation**: Option to create folders using resource titles
- **Path Presets**: Save frequently used paths for quick access

#### Transfer Settings

- **Auto-selection**: Options to select all, invert, or only new resources
- **Sorting**: Sort resources by page order or title (ascending/descending)
- **Retry Logic**: Automatic retry for temporary failures (max 3 attempts)

#### Theme Customization

- **Dark Theme**: Default optimized for media browsing
- **Light Theme**: Alternative for bright environments
- **Persistent Settings**: Preferences saved across sessions

### Error Handling

The extension provides detailed error messages for common issues:

- **Authentication Errors**: Invalid login, token expiration
- **Network Issues**: Connection failures, timeouts
- **Resource Errors**: Invalid links, missing extraction codes
- **Storage Errors**: Insufficient space, quota limits
- **API Limitations**: Rate limiting, temporary bans

### Privacy and Security

- **Local Processing**: All processing occurs locally in your browser
- **Cookie Usage**: Only uses existing Baidu Netdisk login cookies
- **No Data Collection**: Does not transmit personal data to external servers
- **Storage Encryption**: Uses Chrome's secure storage mechanisms

### Development

This extension does not require a build process. All files are ready to use as-is.

#### Project Structure

- **background.js**: Service Worker handling Baidu Netdisk API calls and caching
- **contentScript.js**: Injected into CHAOSPACE pages for UI and resource extraction
- **popup.js/html/css**: Extension popup interface
- **floatingButton.css**: Styles for the floating panel
- **manifest.json**: Extension configuration

#### File Structure

```
Tookit/
├── chaospace-extension/       # Extension source code directory
│   ├── background.js          # Core logic and API interactions
│   ├── contentScript.js       # Page injection and UI rendering
│   ├── floatingButton.css     # Floating panel styles
│   ├── manifest.json          # Extension manifest
│   ├── popup.html            # Popup interface structure
│   ├── popup.css             # Popup styles
│   └── popup.js              # Popup logic
├── CLAUDE.md                  # Project guidance for Claude Code
├── AGENTS.md                  # Agent configuration
└── README.md                  # This documentation
```

#### Testing

- **Manual Testing**: Load the extension in developer mode and test on CHAOSPACE pages
- **Debug Mode**: Use Chrome DevTools to debug background script and content script
  - Background: Click "Service Worker" link in chrome://extensions
  - Content Script: Use F12 DevTools on CHAOSPACE pages

### Troubleshooting

#### Common Issues

1. **"Login Invalid" Error**
   - Ensure you're logged into pan.baidu.com in the same browser
   - Try refreshing the Baidu Netdisk page first

2. **No Resources Detected**
   - Verify you're on a valid CHAOSPACE series page
   - Check if the page structure has changed
   - Use the refresh button to re-scan the page

3. **Transfer Failures**
   - Check available space in your Baidu Netdisk
   - Verify extraction codes are correct
   - Look for specific error codes in the logs

4. **Extension Not Loading**
   - Ensure Developer Mode is enabled
   - Check for error messages in chrome://extensions/
   - Try removing and re-adding the extension

#### Getting Help

- **Issue Reporting**: Use the GitHub issues page for bug reports
- **Feature Requests**: Submit suggestions via GitHub discussions
- **Community Support**: Join relevant forums or chat groups

### Contributing

We welcome contributions! Please see the CONTRIBUTING.md file for guidelines on:

- Code style and standards
- Pull request process
- Testing requirements
- Documentation updates

### License

This project is licensed under the [MIT License](LICENSE) - see the LICENSE file for details.

### Changelog

#### Version 1.0.0 (Current)

- Initial release with core transfer functionality
- Floating panel and popup interfaces
- Persistent caching and history tracking
- Dark/light theme support

### Acknowledgments

- CHAOSPACE community for resource aggregation
- Baidu Netdisk for their web API
- Chrome Extension developers for documentation and examples

---

<a name="中文"></a>

## 中文版本

### 项目概述

CHAOSPACE 转存助手是一个 Chrome/Edge 浏览器扩展，用于自动化从 CHAOSPACE 网站（chaospace.xyz、chaospace.cc 等）批量转存百度网盘资源到个人网盘目录。

### 主要功能

- **自动资源检测**: 自动解析 CHAOSPACE 剧集页面中的资源链接
- **批量处理**: 同时处理多个资源，支持智能去重
- **智能缓存**: 使用持久化缓存避免重复转存
- **历史记录**: 维护转存历史，支持增量更新检测
- **灵活目录管理**: 支持自定义保存路径和子目录创建
- **实时进度**: 转存过程中的实时日志和进度更新
- **深色/浅色主题**: 用户友好界面，支持主题定制
- **浮动面板**: 可拖拽、调整大小、最小化的交互面板

### 安装方法

#### 方法一：开发者模式

1. 下载或克隆本仓库
2. 打开 Chrome/Edge 浏览器，访问 `chrome://extensions/` 或 `edge://extensions/`
3. 右上角开启"开发者模式"
4. 点击"加载已解压的扩展程序"，选择 **`chaospace-extension`** 目录
5. 扩展图标将出现在工具栏中

### 构建说明

本扩展无需构建过程，直接使用即可：

1. 克隆或下载本仓库
2. 直接使用 `chaospace-extension` 目录进行安装
3. 无需编译或打包

### 使用说明

#### 基本工作流程

1. **登录百度网盘**: 确保浏览器中已登录 pan.baidu.com
2. **访问 CHAOSPACE**: 打开剧集页面（如 `https://www.chaospace.cc/seasons/xxxxxx.html`）
3. **打开扩展**: 点击工具栏中的扩展图标或使用浮动面板
4. **配置设置**:
   - 设置目标目录（如 `/视频/番剧`）
   - 选择是否为每个资源创建子目录
   - 选择要转存的资源（全部、反选或仅新增）
5. **开始转存**: 点击"转存选中资源"并监控进度
6. **查看结果**: 检查转存摘要和日志

#### 界面组件

**浮动面板**（在 CHAOSPACE 页面显示）:

- 资源列表和选择选项
- 目录配置和预设路径
- 实时转存日志
- 转存历史面板
- 状态指示器

**弹窗界面**（工具栏点击）:

- 与浮动面板类似的功能
- 紧凑界面便于快速访问
- 主题定制选项

### 技术架构

#### 核心组件

1. **后台脚本** (`background.js`)
   - 管理百度网盘 API 交互
   - 处理认证（bdstoken 管理）
   - 处理文件转存和重试逻辑
   - 管理持久化缓存和历史记录
   - 错误处理和进度跟踪

2. **内容脚本** (`contentScript.js`)
   - 注入到 CHAOSPACE 页面
   - 解析 DOM 提取资源信息
   - 渲染浮动面板界面
   - 处理用户交互和 UI 更新

3. **弹窗界面** (`popup.html/css/js`)
   - 通过工具栏提供替代访问点
   - 与当前标签页通信获取资源数据
   - 提供主题定制选项

#### 关键技术

- **百度网盘 Web API**: 使用官方 Web API 进行认证和转存
- **Chrome 扩展 API**: 利用存储、标签页、Cookie 和 declarativeNetRequest
- **现代 JavaScript**: ES6+ 特性，使用 async/await 模式
- **CSS Grid/Flexbox**: 响应式设计，支持深色/浅色主题

### 配置选项

#### 目录管理

- **基础目录**: 所有转存的根路径（默认：`/`）
- **子目录创建**: 选择是否使用资源标题创建文件夹
- **路径预设**: 保存常用路径以便快速访问

#### 转存设置

- **自动选择**: 全选、反选或仅选新增资源的选项
- **排序**: 按页面顺序或标题排序（升序/降序）
- **重试逻辑**: 临时失败时自动重试（最多 3 次）

#### 主题定制

- **深色主题**: 默认优化用于媒体浏览
- **浅色主题**: 明亮环境的替代方案
- **持久化设置**: 跨会话保存偏好设置

### 错误处理

扩展为常见问题提供详细的错误信息：

- **认证错误**: 无效登录、令牌过期
- **网络问题**: 连接失败、超时
- **资源错误**: 无效链接、缺少提取码
- **存储错误**: 空间不足、配额限制
- **API 限制**: 速率限制、临时封禁

### 隐私与安全

- **本地处理**: 所有处理都在浏览器本地进行
- **Cookie 使用**: 仅使用现有的百度网盘登录 Cookie
- **无数据收集**: 不向外部服务器传输个人数据
- **存储加密**: 使用 Chrome 的安全存储机制

### 开发指南

本扩展无需构建过程，所有文件可直接使用。

#### 项目结构

- **background.js**: Service Worker，处理百度网盘 API 调用和缓存管理
- **contentScript.js**: 注入到 CHAOSPACE 页面，负责 UI 和资源提取
- **popup.js/html/css**: 扩展弹窗界面
- **floatingButton.css**: 浮动面板样式
- **manifest.json**: 扩展配置文件

#### 文件结构

```
Tookit/
├── chaospace-extension/       # 扩展源码目录
│   ├── background.js          # 核心逻辑和 API 交互
│   ├── contentScript.js       # 页面注入和 UI 渲染
│   ├── floatingButton.css     # 浮动面板样式
│   ├── manifest.json          # 扩展清单
│   ├── popup.html            # 弹窗界面结构
│   ├── popup.css             # 弹窗样式
│   └── popup.js              # 弹窗逻辑
├── CLAUDE.md                  # Claude Code 项目指南
├── AGENTS.md                  # Agent 配置
└── README.md                  # 本文档
```

#### 测试

- **手动测试**: 以开发者模式加载扩展，并在 CHAOSPACE 页面上测试
- **调试模式**: 使用 Chrome DevTools 调试后台脚本和内容脚本
  - 后台脚本: 在 chrome://extensions 点击"Service Worker"链接
  - 内容脚本: 在 CHAOSPACE 页面使用 F12 开发者工具

### 故障排除

#### 常见问题

1. **"登录无效"错误**
   - 确保在同一浏览器中登录了 pan.baidu.com
   - 尝试先刷新百度网盘页面

2. **未检测到资源**
   - 确认您在有效的 CHAOSPACE 剧集页面上
   - 检查页面结构是否已更改
   - 使用刷新按钮重新扫描页面

3. **转存失败**
   - 检查百度网盘可用空间
   - 验证提取码是否正确
   - 查看日志中的具体错误代码

4. **扩展未加载**
   - 确保已启用开发者模式
   - 检查 chrome://extensions/ 中的错误消息
   - 尝试删除并重新添加扩展

#### 获取帮助

- **问题报告**: 使用 GitHub issues 页面报告错误
- **功能请求**: 通过 GitHub discussions 提交建议
- **社区支持**: 加入相关论坛或聊天群组

### 贡献指南

我们欢迎贡献！请参阅 CONTRIBUTING.md 文件了解以下指南：

- 代码风格和标准
- Pull request 流程
- 测试要求
- 文档更新

### 许可证

本项目基于 [MIT 许可证](LICENSE) - 详见 LICENSE 文件。

### 更新日志

#### 版本 1.0.0（当前）

- 初始版本，包含核心转存功能
- 浮动面板和弹窗界面
- 持久化缓存和历史记录跟踪
- 深色/浅色主题支持

### 致谢

- CHAOSPACE 社区提供资源聚合
- 百度网盘提供 Web API
- Chrome 扩展开发者提供文档和示例
