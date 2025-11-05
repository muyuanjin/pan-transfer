import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000, // 单个测试总超时 45s(导航 15s + 面板渲染 15s + 断言 10s + buffer 5s)
  expect: {
    timeout: 10000, // 降低断言超时到 10s
  },
  fullyParallel: true, // 启用并行测试
  workers: 3, // 3 个测试并行运行
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    headless: true, // 无头模式
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    actionTimeout: 10000, // 操作超时 10s
    navigationTimeout: 15000, // 导航超时 15s(与测试中的 goto timeout 一致)
  },
})
