# Tasks for add-import-error-handling

- [ ] 设计导入校验 schema，列出需支持的错误类别（JSON 无效、版本不兼容、结构缺失、字段类型错误）。
- [ ] 在导入流程中实现分层校验与细化的错误消息映射，同时对可降级 scope 保持部分导入能力。
- [ ] 为新校验补充 Vitest 覆盖（含各错误分支）。
- [ ] 更新 Playwright/手动验证步骤，确保 UI 提示与日志一致。
- [ ] 运行 `winexec npm run check` 并记录验证结果。
