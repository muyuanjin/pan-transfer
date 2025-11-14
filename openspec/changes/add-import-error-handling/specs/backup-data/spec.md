# Capability: Backup Data Management

Pan Transfer 允许用户通过设置面板导入/导出本地备份。该能力确保当备份内容不符合预期时，系统可以拒绝写入并反馈可执行的修复步骤。

## ADDED Requirements

### Requirement: Backup Import Error Detection

当用户在设置面板触发「导入数据」并选择备份文件时，系统 MUST 在写入任何数据前执行分层校验，并根据失败原因返回精确提示。

#### Scenario: Invalid JSON File

- **Given** 用户选择的文件无法被 `JSON.parse` 成功解析
- **When** 校验流程启动
- **Then** 导入流程立即终止，不写入任何数据
- **And** UI toast 显示「文件不是有效的 JSON」或等效文案，并引导用户检查文件编码/内容
- **And** 日志包含 `[Pan Transfer]` 前缀及原始解析错误

#### Scenario: Incompatible Backup Version

- **Given** 备份 JSON 中的 `type` 或 `version` 字段与当前支持的格式不匹配
- **When** 校验流程比对版本矩阵
- **Then** 系统阻止导入，并在消息中指出检测到的版本号与期望版本范围
- **And** 若存在兼容策略，应在提示中包含「请更新扩展或重新导出」等指导

#### Scenario: Missing Data Sections

- **Given** JSON 解析成功，但必需的顶层 section（例如 `history`, `resources`, `settings`）缺失或为空对象
- **When** 范围可用性检查运行
- **Then** 系统报告「数据结构不完整」并列出缺失的 section 名称
- **And** 日志记录具体缺失列表，方便排查
- **And** 可用的其它 section 仍维持可被导入的状态，提示文案需指明哪些部分被跳过

#### Scenario: Partial Section Failure

- **Given** 用户选择导入全部四个 scope，但其中某个 scope 的内部字段校验失败
- **When** 校验流程确定该错误为非致命（其余 scope 完整且通过校验）
- **Then** 系统 MUST 仅跳过失败 scope，对其余 scope 完成导入
- **And** UI toast 同时提示「xx scope 已跳过」并附带字段路径
- **And** 日志记录跳过原因与受影响的 scope 列表

### Requirement: Field-Level Validation Feedback

系统 SHALL 细化 schema 校验，确保当某个字段值不符合预期类型或必填要求时，提示能够定位到具体字段路径；对于可降级的 scope，错误提示不得阻断其它 scope 的导入。

#### Scenario: Field Type Mismatch

- **Given** 备份 JSON 中 `history.records[2].createdAt` 期望为 ISO 字符串，却是数字
- **When** 校验流程遍历 schema
- **Then** 导入被拒绝，并提示「字段 `history.records[2].createdAt` 类型不正确，期望 string」
- **And** 该字段路径同时写入日志，便于开发者在调试时复制
- **And** 其他合法 section 不会被写入，确保一致性

#### Scenario: Required Field Missing

- **Given** `resources.items[n].fsId` 缺失或为空
- **When** schema 校验执行
- **Then** 系统提示缺失字段名，并建议用户使用最新版本重新导出
- **And** UI 文案与日志保持一致，防止用户对错误类别产生歧义
