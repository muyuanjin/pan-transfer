import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000, // 降低超时时间,从 120s 到 90s
  expect: {
    timeout: 20000 // 降低断言超时,从 30s 到 20s
  },
  fullyParallel: true, // 启用并行测试
  workers: 3, // 3个页面并行测试
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    headless: true, // 无头模式
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    // 减少不必要的等待
    actionTimeout: 15000, // 操作超时 15s
    navigationTimeout: 30000 // 导航超时 30s
  }
});
