import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
import fs from 'node:fs'
import type { TransferRequestPayload } from '../../src/shared/types/transfer'
import {
  CHAOSPACE_BASE_DETAIL_URL,
  DIST_DIR,
  EXTENSION_ARGS,
  expectNoPrefixedErrors,
  ensurePanelPinned,
  mountPanelForUrl,
  createHistoryRecordSeed,
  seedHistoryRecords,
  dispatchTransferViaDevHook,
  setStorageProviderMode,
  waitForLastTransferSnapshot,
  setupOfflineRoutes,
} from './utils/chaospace-extension'

type Fixtures = {
  context: BrowserContext
  page: Page
}

const test = base.extend<Fixtures>({
  context: async ({ headless }, use, testInfo) => {
    if (!fs.existsSync(DIST_DIR)) {
      throw new Error(
        'Extension build is missing. Run `npm run build` before executing the Playwright tests.',
      )
    }
    const userDataDir = testInfo.outputPath('user-data')
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      channel: 'chromium',
      args: EXTENSION_ARGS(DIST_DIR),
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      })
    })
    await setupOfflineRoutes(context)
    // 删除不必要的页面重载逻辑,加快启动速度
    // 扩展会在导航到目标页面时自动初始化
    try {
      await use(context)
    } finally {
      await context.close()
    }
  },
  page: async ({ context }, use) => {
    const [initialPage] = context.pages()
    const page = initialPage ?? (await context.newPage())
    await page.bringToFront()
    await use(page)
  },
})

const GENERIC_FORUM_DEMO_URL = `${CHAOSPACE_BASE_DETAIL_URL}?pan-provider-demo=1`

async function expectPanelAccentRgb(
  panel: Locator,
  expectedRgb: string,
  failureMessage?: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        panel.evaluate((node) => getComputedStyle(node).getPropertyValue('--cp-accent-rgb').trim()),
      {
        timeout: 1500,
        message: failureMessage,
      },
    )
    .toBe(expectedRgb)
}

test.describe('Chaospace panel overlay', () => {
  test('renders without Chaospace Transfer errors for CHAOSPACE regression page', async ({
    page,
    context,
  }) => {
    const { panelLocator, errorTracker } = await mountPanelForUrl(
      page,
      context,
      CHAOSPACE_BASE_DETAIL_URL,
    )

    try {
      // 使用 load 而非 networkidle,避免等待所有网络请求完成(可能永远无法满足)
      await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})

      await expect(
        page.locator('.chaospace-assistant-badge'),
        'Legacy assistant badge should no longer render inside the header',
      ).toHaveCount(0)

      const headerProviderPanel = page.locator('.chaospace-header-body .chaospace-provider-panel')
      await expect(
        headerProviderPanel,
        'Provider panel should render within the header beneath the title',
      ).toBeVisible()
      await expect(
        headerProviderPanel,
        'Provider panel should expose the active Chaospace provider label',
      ).toContainText(/chaospace/i)

      // 等待面板动画完成(chaospace-panel-in 持续 0.35s)
      // 额外等待一些时间确保 animationend 事件触发并添加 is-mounted 类
      await page.waitForTimeout(500)

      const panelIsMounted = await panelLocator.evaluate((panel) =>
        panel.classList.contains('is-mounted'),
      )
      expect(panelIsMounted, 'Panel should be fully mounted (has `is-mounted` class)').toBe(true)
      await panelLocator.hover({ position: { x: 10, y: 10 } })
      await page.waitForTimeout(200)
      await panelLocator.evaluate((panel) => {
        panel.classList.add('is-pinned')
      })

      const historySummaryToggle = page
        .locator('[data-role="history-summary-entry"] [data-role="history-toggle"]')
        .first()
      await expect(
        historySummaryToggle,
        'History summary toggle should be available once history loads',
      ).toBeVisible()
      await historySummaryToggle.click()

      const historyOverlay = page.locator('[data-role="history-overlay"]')
      await expect(
        historyOverlay,
        'History overlay should be visible after toggling',
      ).toHaveAttribute('aria-hidden', 'false')

      const historyMeta = page.locator('.chaospace-history-meta').first()
      await expect(
        historyMeta,
        'History entry metadata should include the provider label',
      ).toContainText('CHAOSPACE')

      expectNoPrefixedErrors(errorTracker)
    } finally {
      errorTracker.dispose()
    }
  })
})

test.describe('Provider overrides', () => {
  test('ignores Generic Forum markers and keeps CHAOSPACE as the active provider', async ({
    page,
    context,
  }) => {
    const { panelLocator, errorTracker } = await mountPanelForUrl(
      page,
      context,
      GENERIC_FORUM_DEMO_URL,
    )

    try {
      await ensurePanelPinned(panelLocator)
      const providerSelect = page.locator('.chaospace-provider-select select')
      await expect(
        providerSelect.locator('option[value="generic-forum"]'),
        'Generic Forum option must never be exposed in production builds',
      ).toHaveCount(0)
      await expect(providerSelect).toHaveValue('')
      await expect(page.locator('.chaospace-provider-mode')).toContainText('自动')
      await expect(page.locator('.chaospace-provider-active')).toContainText('CHAOSPACE')
      await expect(panelLocator).toHaveAttribute('data-pan-provider', 'chaospace')
      await expectPanelAccentRgb(
        panelLocator,
        '99, 102, 241',
        'Panel accent should stick to the CHAOSPACE palette even for override markers',
      )
      expectNoPrefixedErrors(errorTracker)
    } finally {
      errorTracker.dispose()
    }
  })

  test('settings overlay never lists the Generic Forum provider toggle', async ({
    page,
    context,
  }) => {
    const { panelLocator, errorTracker } = await mountPanelForUrl(
      page,
      context,
      GENERIC_FORUM_DEMO_URL,
    )

    try {
      await ensurePanelPinned(panelLocator)
      const settingsToggle = page.locator('[data-role="settings-toggle"]')
      await settingsToggle.click()
      const settingsOverlay = page.locator('[data-role="settings-overlay"]')
      await expect(settingsOverlay).toHaveAttribute('aria-hidden', 'false')

      const providerList = settingsOverlay.locator('[data-role="settings-site-provider-list"]')
      await expect(
        providerList.locator('label', { hasText: /Generic Forum/i }),
        'Settings should not mention Generic Forum providers',
      ).toHaveCount(0)

      await settingsToggle.click()
      await expect(settingsOverlay).toHaveAttribute('aria-hidden', 'true')
      await expect(panelLocator).toHaveAttribute('data-pan-provider', 'chaospace')
      expectNoPrefixedErrors(errorTracker)
    } finally {
      errorTracker.dispose()
    }
  })

  test('pending history transfer button dispatches through the storage pipeline', async ({
    page,
    context,
  }) => {
    await setStorageProviderMode(context, 'mock')
    const pendingJobId = 'pending-history-e2e'
    const pendingPayload: TransferRequestPayload = {
      jobId: pendingJobId,
      origin: 'https://forum.example',
      targetDirectory: '/论坛/讨论区',
      items: [
        {
          id: 'forum-resource-1',
          title: '论坛资源 1',
          linkUrl: 'https://pan.baidu.com/s/mock-gf-1',
          passCode: 'abcd',
        },
      ],
      meta: {
        total: 1,
        pageUrl: GENERIC_FORUM_DEMO_URL,
        pageTitle: 'Generic Forum Demo Thread',
        siteProviderId: 'generic-forum',
        siteProviderLabel: 'Generic Forum',
      },
    }
    const pendingRecord = createHistoryRecordSeed(GENERIC_FORUM_DEMO_URL, {
      origin: 'https://forum.example',
      siteProviderId: 'generic-forum',
      siteProviderLabel: 'Generic Forum',
      targetDirectory: '/论坛/讨论区',
      baseDir: '/论坛',
      pendingTransfer: {
        jobId: pendingJobId,
        detectedAt: Date.now(),
        summary: '检测到 1 个新资源',
        newItemIds: pendingPayload.items.map((item) => item.id),
        payload: pendingPayload,
      },
      completion: null,
      seasonCompletion: {},
      seasonEntries: [],
      items: {},
      itemOrder: [],
      lastResult: null,
    })
    await seedHistoryRecords(context, [pendingRecord])

    const { panelLocator, errorTracker } = await mountPanelForUrl(
      page,
      context,
      GENERIC_FORUM_DEMO_URL,
      { seedHistory: false },
    )
    try {
      await ensurePanelPinned(panelLocator)
      const transferButton = panelLocator.locator('.chaospace-history-action-transfer').first()
      await expect(
        transferButton,
        'Pending transfer button should surface the summary tooltip',
      ).toHaveAttribute('title', /检测到 1 个新资源/)
      await transferButton.scrollIntoViewIfNeeded()
      await transferButton.click({ force: true })
      for (let attempts = 0; attempts < 2; attempts += 1) {
        const result = await dispatchTransferViaDevHook(context, pendingPayload)
        if (
          result.ok === false &&
          typeof result.error === 'string' &&
          result.error.includes('message port closed')
        ) {
          await page.waitForTimeout(250)
          continue
        }
        break
      }
      const lastSnapshot = await waitForLastTransferSnapshot(context, pendingJobId)
      expect(lastSnapshot?.payload?.jobId).toBe(pendingJobId)
      expect(lastSnapshot?.storageProviderId).toBe('mock-storage')
      expectNoPrefixedErrors(errorTracker)
    } finally {
      errorTracker.dispose()
    }
  })
})

test.describe('Storage providers', () => {
  test('mock provider handles transfer dispatch without Baidu APIs', async ({ page, context }) => {
    await setStorageProviderMode(context, 'mock')
    const { panelLocator, errorTracker } = await mountPanelForUrl(
      page,
      context,
      CHAOSPACE_BASE_DETAIL_URL,
    )
    try {
      await ensurePanelPinned(panelLocator)
      const selectAllButton = page.getByRole('button', { name: '全选' })
      await expect(selectAllButton, 'Select-all button should be visible').toBeVisible()
      await selectAllButton.click({ force: true }) // 规避无头模式下的虚假覆盖检测
      const transferButton = page.locator('[data-role="transfer-btn"]')
      await expect(
        transferButton,
        'Transfer button should be enabled once resources are selected',
      ).toBeEnabled()
      await transferButton.click()

      const successToast = page.locator('.chaospace-toast.success')
      await expect(successToast, 'Mock storage provider should emit a success toast').toContainText(
        '转存成功',
        { timeout: 15000 },
      )

      await expect(
        page.locator('.chaospace-log-summary'),
        'Log summary should surface the mock-transfer aggregate counts',
      ).toContainText('成功 0 · 跳过 0 · 失败 0')
      await expect(
        page.locator('[data-role="transfer-label"]'),
        'Transfer button label should exit the running state',
      ).toContainText('转存选中')

      expectNoPrefixedErrors(errorTracker)
    } finally {
      errorTracker.dispose()
      await setStorageProviderMode(context, 'baidu')
    }
  })
})
