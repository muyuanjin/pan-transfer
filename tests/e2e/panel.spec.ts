import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type ConsoleMessage,
} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const DIST_DIR = path.resolve(__dirname, '../../dist')
const EXTENSION_ARGS = (extensionPath: string) => [
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
]

const PANEL_SELECTOR = '.chaospace-panel-host .chaospace-float-panel'
const PANEL_RENDER_TIMEOUT = 15000 // 降低面板渲染超时从 30s 到 15s
const CHAOSPACE_LOG_PREFIX = '[Chaospace Transfer]'

type ChaospaceErrorTracker = {
  consoleErrors: string[]
  runtimeErrors: string[]
  waitForFirstChaospaceError: () => Promise<never>
  stopEarlyAbort: () => void
  dispose: () => void
  formatCollectedErrors: (headline: string) => string
}

const createChaospaceErrorTracker = (page: Page): ChaospaceErrorTracker => {
  const consoleErrors: string[] = []
  const runtimeErrors: string[] = []
  let abortReject: ((error: Error) => void) | null = null
  let earlyAbortActive = true
  let earlyAbortHandled = false

  const earlyAbortPromise = new Promise<never>((_, reject) => {
    abortReject = reject
  })

  const formatCollectedErrors = (headline: string) => {
    const consoleChunk = consoleErrors.length ? consoleErrors.join('\n') : 'none'
    const runtimeChunk = runtimeErrors.length ? runtimeErrors.join('\n') : 'none'
    return `${headline}\n\nConsole errors:\n${consoleChunk}\n\nRuntime errors:\n${runtimeChunk}`
  }

  const hasChaospaceError = () =>
    consoleErrors.some((entry) => entry.includes(CHAOSPACE_LOG_PREFIX)) ||
    runtimeErrors.some((entry) => entry.includes(CHAOSPACE_LOG_PREFIX))

  const maybeAbort = () => {
    if (!earlyAbortActive || !abortReject) return
    if (hasChaospaceError()) {
      earlyAbortActive = false
      abortReject(
        new Error(
          formatCollectedErrors('Chaospace Transfer emitted an error while waiting for the panel'),
        ),
      )
    }
  }

  const consoleListener = (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const location = message.location()
    consoleErrors.push(
      `[${location.url || 'unknown'}:${location.lineNumber ?? '-'}] ${message.text()}`,
    )
    maybeAbort()
  }

  const pageErrorListener = (error: Error) => {
    runtimeErrors.push(error.stack ?? error.message)
    maybeAbort()
  }

  page.on('console', consoleListener)
  page.on('pageerror', pageErrorListener)

  const stopEarlyAbort = () => {
    if (earlyAbortHandled) return
    earlyAbortActive = false
    earlyAbortHandled = true
    earlyAbortPromise.catch(() => {})
  }

  return {
    consoleErrors,
    runtimeErrors,
    waitForFirstChaospaceError: () => {
      maybeAbort()
      return earlyAbortPromise
    },
    stopEarlyAbort,
    dispose: () => {
      stopEarlyAbort()
      page.off('console', consoleListener)
      page.off('pageerror', pageErrorListener)
    },
    formatCollectedErrors,
  }
}

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

const chaospacePages = [
  'https://www.chaospace.cc/tvshows/80348.html',
  'https://www.chaospace.cc/tvshows/425308.html',
  'https://www.chaospace.cc/movies/431555.html',
]

test.describe('Chaospace panel overlay', () => {
  for (const targetUrl of chaospacePages) {
    test(`renders without Chaospace Transfer errors for ${targetUrl}`, async ({
      page,
    }, testInfo) => {
      const errorTracker = createChaospaceErrorTracker(page)

      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
        // 使用 load 而非 networkidle,避免等待所有网络请求完成(可能永远无法满足)
        await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})

        const panelLocator = page.locator(PANEL_SELECTOR)
        const waitForPanelRender = async () => {
          try {
            await expect(panelLocator, 'Chaospace panel should render on the page').toBeVisible({
              timeout: PANEL_RENDER_TIMEOUT,
            })
          } catch (error) {
            throw new Error(
              errorTracker.formatCollectedErrors(
                'Chaospace panel failed to render before timing out',
              ),
            )
          }
        }

        await Promise.race([waitForPanelRender(), errorTracker.waitForFirstChaospaceError()])
        errorTracker.stopEarlyAbort()

        await expect(
          page.locator('.chaospace-assistant-badge'),
          'Panel badge should promote the Chaospace assistant',
        ).toContainText('CHAOSPACE 转存助手')

        // 等待面板动画完成(chaospace-panel-in 持续 0.35s)
        // 额外等待一些时间确保 animationend 事件触发并添加 is-mounted 类
        await page.waitForTimeout(500)

        const panelIsMounted = await panelLocator.evaluate((panel) =>
          panel.classList.contains('is-mounted'),
        )
        expect(panelIsMounted, 'Panel should be fully mounted (has `is-mounted` class)').toBe(true)

        const chaospaceConsoleErrors = errorTracker.consoleErrors.filter((entry) =>
          entry.includes(CHAOSPACE_LOG_PREFIX),
        )
        expect(
          chaospaceConsoleErrors,
          errorTracker.formatCollectedErrors('Expected no Chaospace Transfer console errors'),
        ).toHaveLength(0)

        const chaospaceRuntimeErrors = errorTracker.runtimeErrors.filter((message) =>
          message.includes(CHAOSPACE_LOG_PREFIX),
        )
        expect(
          chaospaceRuntimeErrors,
          errorTracker.formatCollectedErrors('Expected no Chaospace Transfer runtime errors'),
        ).toHaveLength(0)
      } finally {
        errorTracker.dispose()
      }
    })
  }
})
