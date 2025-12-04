# Bug login-expired: Pan 登录过期导致 CORS 且未正确引导登录

- Status: WIP
- DoD:
  - [ ] 登录过期时不会再出现 CORS 报错
  - [ ] 会稳定地弹出提示并打开百度网盘登录页（带冷却以避免刷屏）
  - [ ] npm run check 通过

## Checkpoints

- 2025-12-05T02:46:10+08:00: 初始化笔记
- 2025-12-05T02:52:33+08:00: 更新 ensureBdstoken 登录态检测逻辑 + 缩短 LOGIN_REDIRECT_COOLDOWN + 为 passport.baidu.com 增加 host_permissions
