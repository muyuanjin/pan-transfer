import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve(__dirname, '../../dist');
const EXTENSION_ARGS = (extensionPath: string) => [
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`
];

type Fixtures = {
  context: BrowserContext;
  page: Page;
};

const test = base.extend<Fixtures>({
  context: async ({ headless }, use, testInfo) => {
    if (!fs.existsSync(DIST_DIR)) {
      throw new Error(
        'Extension build is missing. Run `npm run build` before executing the Playwright tests.'
      );
    }
    const userDataDir = testInfo.outputPath('user-data');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      channel: 'chromium',
      args: EXTENSION_ARGS(DIST_DIR)
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    });
    // 删除不必要的页面重载逻辑,加快启动速度
    // 扩展会在导航到目标页面时自动初始化
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
  page: async ({ context }, use) => {
    const [initialPage] = context.pages();
    const page = initialPage ?? (await context.newPage());
    await page.bringToFront();
    await use(page);
  }
});

const chaospacePages = [
  'https://www.chaospace.cc/tvshows/80348.html',
  'https://www.chaospace.cc/tvshows/425308.html',
  'https://www.chaospace.cc/movies/431555.html'
];

test.describe('Chaospace panel overlay', () => {
  for (const targetUrl of chaospacePages) {
    test(`renders without Chaospace Transfer errors for ${targetUrl}`, async ({ page }, testInfo) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on('console', (message) => {
        if (message.type() === 'error') {
          const location = message.location();
          consoleErrors.push(
            `[${location.url || 'unknown'}:${location.lineNumber ?? '-'}] ${message.text()}`
          );
        }
      });

      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      // 使用 load 而非 networkidle,避免等待所有网络请求完成(可能永远无法满足)
      await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});

      const panelLocator = page.locator('.chaospace-panel-host .chaospace-float-panel');
      await expect(panelLocator, 'Chaospace panel should render on the page').toBeVisible({
        timeout: 30000 // 降低等待时间,从 45s 到 30s
      });

      await expect(
        page.locator('.chaospace-assistant-badge'),
        'Panel badge should promote the Chaospace assistant'
      ).toContainText('CHAOSPACE 转存助手');

      // 等待面板动画完成(chaospace-panel-in 持续 0.35s)
      // 额外等待一些时间确保 animationend 事件触发并添加 is-mounted 类
      await page.waitForTimeout(500);

      const panelIsMounted = await panelLocator.evaluate((panel) => panel.classList.contains('is-mounted'));
      expect(panelIsMounted, 'Panel should be fully mounted (has `is-mounted` class)').toBe(true);

      const chaospaceConsoleErrors = consoleErrors.filter((entry) =>
        entry.includes('[Chaospace Transfer]')
      );
      expect(
        chaospaceConsoleErrors,
        `Expected no Chaospace Transfer console errors, but got:\n${chaospaceConsoleErrors.join('\n')}`
      ).toHaveLength(0);

      const chaospaceRuntimeErrors = pageErrors.filter((message) =>
        message.includes('[Chaospace Transfer]')
      );
      expect(
        chaospaceRuntimeErrors,
        `Expected no Chaospace Transfer runtime errors, but got:\n${chaospaceRuntimeErrors.join('\n')}`
      ).toHaveLength(0);
    });
  }
});
