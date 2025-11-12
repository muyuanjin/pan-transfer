import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Route,
  type ConsoleMessage,
  type Worker,
  type Locator,
} from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import type { HistoryRecord, TransferRequestPayload } from '../../src/shared/types/transfer'
import { HISTORY_VERSION, STORAGE_KEYS } from '../../src/background/common/constants'

declare global {
  interface Window {
    seedHistory?: (storageKey: string, snapshot: unknown) => Promise<void>
    clearStorage?: (storageKey: string) => Promise<void>
    setStorageProviderMode?: (mode: string) => Promise<{ ok?: boolean; mode?: string }>
    getLastTransferSnapshot?: () => Promise<{ ok?: boolean; snapshot?: unknown }>
    dispatchPendingTransfer?: (
      payload: TransferRequestPayload,
    ) => Promise<{ ok?: boolean; error?: string }>
  }
}

type ChromeStorageBridge = {
  runtime?: { lastError?: { message?: string } }
  storage?: {
    local?: {
      set: (items: Record<string, unknown>, callback: () => void) => void
      remove: (key: string, callback: () => void) => void
    }
  }
}

type TransferDispatchSnapshot = {
  payload: TransferRequestPayload
  storageProviderId: string
  timestamp: number
}

const DIST_DIR = path.resolve(__dirname, '../../dist')
const EXTENSION_ARGS = (extensionPath: string) => [
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
]

const CHAOSPACE_FIXTURE_ROOT = path.resolve(__dirname, '../../src/content/services/__fixtures__')
const CHAOSPACE_FIXTURE_CACHE = new Map<string, Promise<string>>()
const CHAOSPACE_STUB_HEADERS = {
  'access-control-allow-origin': '*',
}
const CHAOSPACE_LINK_PLACEHOLDER = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>资源详情 - CHAOSPACE</title>
  </head>
  <body>
    <div class="content">
      <a class="sbtn" href="https://pan.baidu.com/s/chaospace-test" data-pass-code="abcd">百度网盘</a>
      <div class="password">提取码：<span>abcd</span></div>
    </div>
  </body>
</html>`

const JQUERY_STUB_MARKER = '__pan_transfer_jquery_stub__'

const PANEL_SELECTOR = '.chaospace-panel-host .chaospace-float-panel'
const PANEL_RENDER_TIMEOUT = 15000 // 降低面板渲染超时从 30s 到 15s
const CHAOSPACE_LOG_PREFIX = '[Pan Transfer]'
const CHROME_EXTENSION_URL_PREFIX = 'chrome-extension://'
const SUPPRESSED_EXTENSION_ERROR_TOKENS = ['net::ERR_FAILED', 'net::ERR_BLOCKED_BY_CLIENT'] as const

function guessContentType(pathname: string): string {
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

async function loadFixture(filename: string): Promise<string> {
  if (!CHAOSPACE_FIXTURE_CACHE.has(filename)) {
    const fullPath = path.join(CHAOSPACE_FIXTURE_ROOT, filename)
    CHAOSPACE_FIXTURE_CACHE.set(filename, fs.promises.readFile(fullPath, 'utf8'))
  }
  return CHAOSPACE_FIXTURE_CACHE.get(filename)!
}

function resolveChaospaceFixture(pathname: string): string | null {
  if (pathname.startsWith('/tvshows/')) {
    return 'chaospace-tvshow-429052.html'
  }
  if (pathname.startsWith('/movies/')) {
    return 'chaospace-movie-432912.html'
  }
  if (pathname.startsWith('/seasons/')) {
    return 'chaospace-season-429054.html'
  }
  if (pathname === '/' || pathname.startsWith('/tvshows')) {
    return 'chaospace-tvshows.html'
  }
  return null
}

function applyChaospaceFixtureTransform(url: URL, html: string): string {
  let output = ensureJqueryStub(html)
  if (url.searchParams.has('pan-provider-demo')) {
    output = injectGenericForumDemoMarkup(output)
  }
  return output
}

function injectGenericForumDemoMarkup(html: string): string {
  let output = html
  const bodyNeedle = '<body class="archive post-type-archive post-type-archive-tvshows">'
  if (output.includes(bodyNeedle)) {
    output = output.replace(
      bodyNeedle,
      `${bodyNeedle.slice(0, -1)} data-pan-provider="generic-forum" data-pan-provider-id="generic-forum">`,
    )
  }
  const threadMeta = {
    title: 'Generic Forum Demo Thread',
    origin: 'https://forum.example',
    tags: ['demo', '论坛'],
    poster: { src: 'https://cdn.example/poster.png' },
    classification: 'forum-thread',
  }
  const metaPayload = escapeHtmlAttribute(JSON.stringify(threadMeta))
  output = output.replace(
    '</head>',
    `    <meta name="x-pan-transfer:thread" content='${metaPayload}' />\n  </head>`,
  )
  const resourcePayload = escapeHtmlAttribute(
    JSON.stringify({
      id: 'forum-resource-2',
      title: '论坛资源 2',
      linkUrl: 'https://pan.baidu.com/s/generic-demo2',
      passCode: 'gf22',
      tags: ['teal', 'sample'],
      seasonLabel: '讨论区',
    }),
  )
  const snippet = `
    <section id="generic-forum-demo" data-pan-provider="generic-forum" style="padding: 24px; background: rgba(14,165,233,0.12); margin: 24px;">
      <h2>Generic Forum Demo</h2>
      <article
        data-pan-resource
        data-pan-resource-id="forum-resource-1"
        data-pan-resource-title="论坛资源 1"
        data-pan-resource-link="https://pan.baidu.com/s/generic-demo1"
        data-pan-resource-passcode="gf11"
        data-pan-resource-tags="demo,论坛"
        data-pan-resource-season-label="番外"
        data-pan-resource-season-index="0"
      ></article>
      <article
        data-pan-resource
        data-pan-resource-json='${resourcePayload}'
      ></article>
    </section>
  `
  output = output.replace('</body>', `${snippet}\n  </body>`)
  return output
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function ensureJqueryStub(html: string): string {
  if (html.includes(JQUERY_STUB_MARKER)) {
    return html
  }
  const script = `
    <script>
      (function() {
        if (window.jQuery) {
          return
        }
        var methodNames = [
          'ready',
          'load',
          'click',
          'trigger',
          'hover',
          'on',
          'off',
          'addClass',
          'removeClass',
          'mCustomScrollbar',
          'owlCarousel',
          'scroll',
        ]
        function createChain() {
          var chain = function chain() {
            return chain
          }
          methodNames.forEach(function(name) {
            chain[name] = function() {
              var callback = arguments[0]
              if ((name === 'ready' || name === 'load') && typeof callback === 'function') {
                try {
                  callback(window.jQuery)
                } catch (error) {
                  if (typeof console !== 'undefined' && console && console.warn) {
                    console.warn('[Pan Transfer] jQuery stub callback failed', error)
                  }
                }
              }
              return chain
            }
          })
          chain.length = 0
          return chain
        }
        var chain = createChain()
        var stub = function() {
          return chain
        }
        stub.fn = {}
        stub.ready = chain.ready
        stub.load = chain.load
        stub.noConflict = function() {
          return stub
        }
        window.jQuery = window.$ = stub
        window.__PAN_TRANSFER_JQUERY_STUB__ = true
      })()
    </script>
  `.trim()
  if (html.includes('</head>')) {
    return html.replace('</head>', `  <!-- ${JQUERY_STUB_MARKER} -->\n  ${script}\n  </head>`)
  }
  return `${html}\n<!-- ${JQUERY_STUB_MARKER} -->\n${script}`
}

async function fulfillChaospace(route: Route, url: URL): Promise<boolean> {
  const { pathname } = url
  const method = route.request().method()

  if (method !== 'GET') {
    await route.fulfill({ status: 200, headers: CHAOSPACE_STUB_HEADERS, body: '' })
    return true
  }

  if (pathname.startsWith('/links/')) {
    await route.fulfill({
      status: 200,
      headers: {
        ...CHAOSPACE_STUB_HEADERS,
        'content-type': 'text/html; charset=utf-8',
      },
      body: CHAOSPACE_LINK_PLACEHOLDER,
    })
    return true
  }

  const fixture = resolveChaospaceFixture(pathname)
  if (fixture) {
    let body = await loadFixture(fixture)
    body = applyChaospaceFixtureTransform(url, body)
    await route.fulfill({
      status: 200,
      headers: {
        ...CHAOSPACE_STUB_HEADERS,
        'content-type': 'text/html; charset=utf-8',
      },
      body,
    })
    return true
  }

  const contentType = guessContentType(pathname)
  await route.fulfill({
    status: 200,
    headers: {
      ...CHAOSPACE_STUB_HEADERS,
      'content-type': contentType,
    },
    body: '',
  })
  return true
}

async function setupOfflineRoutes(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url()
    try {
      const url = new URL(requestUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        await route.continue()
        return
      }
      const hostname = url.hostname.toLowerCase()
      if (hostname.endsWith('chaospace.cc') || hostname.endsWith('chaospace.xyz')) {
        const handled = await fulfillChaospace(route, url)
        if (handled) {
          return
        }
      }
      await route.fulfill({
        status: 204,
        headers: CHAOSPACE_STUB_HEADERS,
        body: '',
      })
    } catch {
      await route.fulfill({
        status: 204,
        headers: CHAOSPACE_STUB_HEADERS,
        body: '',
      })
    }
  })
}

type ChaospaceErrorTracker = {
  consoleErrors: string[]
  runtimeErrors: string[]
  extensionConsoleErrors: string[]
  extensionRuntimeErrors: string[]
  waitForFirstChaospaceError: () => Promise<never>
  stopEarlyAbort: () => void
  dispose: () => void
  formatCollectedErrors: (headline: string) => string
}

const createChaospaceErrorTracker = (page: Page): ChaospaceErrorTracker => {
  const consoleErrors: string[] = []
  const runtimeErrors: string[] = []
  const extensionConsoleErrors: string[] = []
  const extensionRuntimeErrors: string[] = []
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

  const failForUnprefixedChaospaceLog = (
    message: ConsoleMessage,
    locationUrl: string | undefined,
  ) => {
    if (!locationUrl || !locationUrl.startsWith(CHROME_EXTENSION_URL_PREFIX)) {
      return
    }
    if (SUPPRESSED_EXTENSION_ERROR_TOKENS.some((token) => message.text().includes(token))) {
      return
    }
    if (message.text().includes(CHAOSPACE_LOG_PREFIX)) {
      return
    }
    if (!abortReject || !earlyAbortActive) {
      return
    }
    earlyAbortActive = false
    abortReject(
      new Error(
        `Detected extension console.error without ${CHAOSPACE_LOG_PREFIX} prefix:\\n${
          message.text() || '<empty>'
        }`,
      ),
    )
  }

  const consoleListener = (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const location = message.location()
    const formatted = `[${location.url || 'unknown'}:${location.lineNumber ?? '-'}] ${message.text()}`
    consoleErrors.push(formatted)
    if (location.url && location.url.startsWith(CHROME_EXTENSION_URL_PREFIX)) {
      extensionConsoleErrors.push(formatted)
    }
    failForUnprefixedChaospaceLog(message, location.url)
    maybeAbort()
  }

  const pageErrorListener = (error: Error) => {
    const serialized = error.stack ?? error.message
    runtimeErrors.push(serialized)
    if (serialized.includes(CHROME_EXTENSION_URL_PREFIX)) {
      extensionRuntimeErrors.push(serialized)
    }
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
    extensionConsoleErrors,
    extensionRuntimeErrors,
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

async function mountPanelForUrl(
  page: Page,
  context: BrowserContext,
  targetUrl: string,
  options: { seedHistory?: boolean } = {},
): Promise<{ panelLocator: Locator; errorTracker: ChaospaceErrorTracker }> {
  const errorTracker = createChaospaceErrorTracker(page)
  try {
    if (options.seedHistory !== false) {
      await seedHistoryRecords(context, [createHistoryRecordSeed(targetUrl)])
    }
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
    const panelLocator = page.locator(PANEL_SELECTOR)
    const waitForPanelRender = async () => {
      try {
        await expect(panelLocator, 'Chaospace panel should render on the page').toBeVisible({
          timeout: PANEL_RENDER_TIMEOUT,
        })
      } catch {
        throw new Error(
          errorTracker.formatCollectedErrors('Chaospace panel failed to render before timing out'),
        )
      }
    }
    await Promise.race([waitForPanelRender(), errorTracker.waitForFirstChaospaceError()])
    errorTracker.stopEarlyAbort()
    return { panelLocator, errorTracker }
  } catch (error) {
    errorTracker.dispose()
    throw error
  }
}

async function expectPanelAccentRgb(
  panelLocator: Locator,
  expected: string,
  message: string,
): Promise<void> {
  await expect
    .poll(
      () =>
        panelLocator.evaluate((panel) =>
          getComputedStyle(panel).getPropertyValue('--cp-accent-rgb').trim(),
        ),
      { message, timeout: 7000 },
    )
    .toBe(expected)
}

function expectNoPrefixedErrors(errorTracker: ChaospaceErrorTracker): void {
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

  const actionableExtensionConsoleErrors = errorTracker.extensionConsoleErrors.filter(
    (entry) => !SUPPRESSED_EXTENSION_ERROR_TOKENS.some((token) => entry.includes(token)),
  )
  expect(
    actionableExtensionConsoleErrors,
    errorTracker.formatCollectedErrors('Expected no console errors emitted by the extension'),
  ).toHaveLength(0)

  const extensionRuntimeErrors = errorTracker.extensionRuntimeErrors.filter(
    (entry) => !SUPPRESSED_EXTENSION_ERROR_TOKENS.some((token) => entry.includes(token)),
  )
  expect(
    extensionRuntimeErrors,
    errorTracker.formatCollectedErrors('Expected no runtime errors emitted by the extension'),
  ).toHaveLength(0)
}

async function ensurePanelPinned(panelLocator: Locator): Promise<void> {
  await panelLocator.hover({ position: { x: 10, y: 10 } })
  await panelLocator.evaluate((panel) => {
    panel.classList.add('is-pinned')
    panel.classList.add('is-mounted')
  })
  await expect(panelLocator).toBeVisible()
}

const HISTORY_STORAGE_KEY = STORAGE_KEYS.history

const findExtensionServiceWorker = (context: BrowserContext): Worker | null => {
  const worker = context
    .serviceWorkers()
    .find((entry) => entry.url().startsWith('chrome-extension://'))
  return worker ?? null
}

async function ensureExtensionServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = findExtensionServiceWorker(context)
  if (existing) {
    return existing
  }
  while (true) {
    const worker = await context.waitForEvent('serviceworker')
    if (worker.url().startsWith('chrome-extension://')) {
      return worker
    }
  }
}

let cachedExtensionId: string | null = null

async function resolveExtensionId(context: BrowserContext): Promise<string> {
  if (cachedExtensionId) {
    return cachedExtensionId
  }
  const worker = await ensureExtensionServiceWorker(context)
  const url = new URL(worker.url())
  cachedExtensionId = url.host
  return cachedExtensionId
}

async function withTestHookPage<T>(
  context: BrowserContext,
  callback: (page: Page) => Promise<T>,
): Promise<T> {
  const extensionId = await resolveExtensionId(context)
  const hookPage = await context.newPage()
  await hookPage.goto(`chrome-extension://${extensionId}/test-hooks.html`, {
    waitUntil: 'load',
  })
  try {
    return await callback(hookPage)
  } finally {
    await hookPage.close()
  }
}

type DevStorageProviderMode = 'auto' | 'baidu' | 'mock'

async function setStorageProviderMode(
  context: BrowserContext,
  mode: DevStorageProviderMode,
): Promise<void> {
  await withTestHookPage(context, async (hookPage) => {
    await hookPage.evaluate(() => {
      if (typeof window.setStorageProviderMode === 'function') {
        return
      }
      window.setStorageProviderMode = (nextMode: string) =>
        new Promise<{ ok?: boolean; mode?: string }>((resolve, reject) => {
          try {
            const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeStorageBridge })
              .chrome
            if (!chromeApi?.runtime) {
              reject(new Error('chrome.runtime is unavailable'))
              return
            }
            chromeApi.runtime.sendMessage(
              {
                type: 'pan-transfer:dev:set-storage-mode',
                payload: { mode: nextMode },
              },
              (response) => {
                const error = chromeApi.runtime?.lastError
                if (error) {
                  reject(new Error(error.message))
                  return
                }
                resolve(response)
              },
            )
          } catch (error) {
            reject(error as Error)
          }
        })
    })
    await hookPage.evaluate(
      async ({ mode }) => {
        if (typeof window.setStorageProviderMode !== 'function') {
          throw new Error('setStorageProviderMode helper is unavailable')
        }
        await window.setStorageProviderMode(mode)
      },
      { mode },
    )
  })
}

async function getLastTransferSnapshot(
  context: BrowserContext,
): Promise<TransferDispatchSnapshot | null> {
  return withTestHookPage(context, async (hookPage) => {
    await hookPage.evaluate(() => {
      if (typeof window.getLastTransferSnapshot === 'function') {
        return
      }
      window.getLastTransferSnapshot = () =>
        new Promise<{ ok?: boolean; snapshot?: unknown; error?: string | null | undefined }>(
          (resolve, reject) => {
            try {
              const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeStorageBridge })
                .chrome
              if (!chromeApi?.runtime) {
                reject(new Error('chrome.runtime is unavailable'))
                return
              }
              chromeApi.runtime.sendMessage(
                {
                  type: 'pan-transfer:dev:last-transfer',
                },
                (response) => {
                  const error = chromeApi.runtime?.lastError
                  if (error) {
                    resolve({ ok: false, error: error.message })
                    return
                  }
                  resolve(response)
                },
              )
            } catch (error) {
              reject(error as Error)
            }
          },
        )
    })
    return hookPage.evaluate(async () => {
      if (typeof window.getLastTransferSnapshot !== 'function') {
        throw new Error('getLastTransferSnapshot helper is unavailable')
      }
      const response = await window.getLastTransferSnapshot()
      if (!response || typeof response !== 'object') {
        return null
      }
      if ((response as { ok?: boolean }).ok === false) {
        const message =
          typeof (response as { error?: string | null }).error === 'string'
            ? (response as { error: string }).error
            : '无法读取调试状态'
        if (message.includes('message port closed before a response was received')) {
          return null
        }
        throw new Error(message)
      }
      return ((response as { snapshot?: unknown }).snapshot ??
        null) as TransferDispatchSnapshot | null
    })
  })
}

async function waitForLastTransferSnapshot(
  context: BrowserContext,
  jobId: string,
  timeoutMs = 15000,
): Promise<TransferDispatchSnapshot | null> {
  const startedAt = Date.now()
  let snapshot: TransferDispatchSnapshot | null = null
  while (Date.now() - startedAt < timeoutMs) {
    snapshot = await getLastTransferSnapshot(context)
    if (snapshot?.payload?.jobId === jobId) {
      return snapshot
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return snapshot
}

async function seedHistoryRecords(
  context: BrowserContext,
  records: HistoryRecord[],
): Promise<void> {
  await withTestHookPage(context, async (seedPage) => {
    await seedPage.evaluate(() => {
      if (typeof window.seedHistory === 'function') {
        return
      }
      const invokeStorage = (action: (cb: () => void, chromeApi: ChromeStorageBridge) => void) =>
        new Promise<void>((resolve, reject) => {
          try {
            const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeStorageBridge })
              .chrome
            if (!chromeApi?.storage?.local) {
              reject(new Error('chrome.storage.local is unavailable'))
              return
            }
            action(() => {
              const error = chromeApi.runtime?.lastError
              if (error) {
                reject(new Error(error.message))
                return
              }
              resolve()
            }, chromeApi)
          } catch (error) {
            reject(error as Error)
          }
        })
      window.seedHistory = (storageKey: string, snapshot: unknown) =>
        invokeStorage((done, chromeApi) => {
          chromeApi.storage.local.set({ [storageKey]: snapshot }, done)
        })
      window.clearStorage = (storageKey: string) =>
        invokeStorage((done, chromeApi) => {
          chromeApi.storage.local.remove(storageKey, done)
        })
    })
    await seedPage.evaluate(
      ({ storageKey, snapshot }) => {
        if (typeof window.seedHistory !== 'function') {
          throw new Error('seedHistory helper is unavailable')
        }
        return window.seedHistory(storageKey, snapshot)
      },
      {
        storageKey: HISTORY_STORAGE_KEY,
        snapshot: {
          version: HISTORY_VERSION,
          records,
        },
      },
    )
  })
}

async function dispatchTransferViaDevHook(
  context: BrowserContext,
  payload: TransferRequestPayload,
): Promise<{ ok?: boolean; error?: string }> {
  await ensureExtensionServiceWorker(context)
  return withTestHookPage(context, async (hookPage) => {
    return hookPage.evaluate(
      async ({ transferPayload }) => {
        if (typeof window.dispatchPendingTransfer === 'function') {
          return window.dispatchPendingTransfer(transferPayload)
        }
        window.dispatchPendingTransfer = (nextPayload: TransferRequestPayload) =>
          new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
            try {
              const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeStorageBridge })
                .chrome
              if (!chromeApi?.runtime) {
                reject(new Error('chrome.runtime is unavailable'))
                return
              }
              chromeApi.runtime.sendMessage(
                {
                  type: 'chaospace:transfer',
                  payload: nextPayload,
                },
                (response) => {
                  const error = chromeApi.runtime?.lastError
                  if (error) {
                    resolve({ ok: false, error: error.message })
                    return
                  }
                  resolve(response)
                },
              )
            } catch (error) {
              reject(error as Error)
            }
          })
        return window.dispatchPendingTransfer(transferPayload)
      },
      { transferPayload: payload },
    )
  })
}

function createHistoryRecordSeed(
  pageUrl: string,
  overrides: Partial<HistoryRecord> = {},
): HistoryRecord {
  const now = Date.now()
  const baseRecord: HistoryRecord = {
    pageUrl,
    pageTitle: 'Playwright Fixture 剧集',
    pageType: 'series',
    origin: 'https://www.chaospace.cc',
    siteProviderId: 'chaospace',
    siteProviderLabel: 'CHAOSPACE',
    poster: null,
    targetDirectory: '/测试/剧集',
    baseDir: '/测试',
    useTitleSubdir: true,
    useSeasonSubdir: false,
    lastTransferredAt: now,
    lastCheckedAt: now,
    totalTransferred: 2,
    completion: { label: '连载中', state: 'ongoing' },
    seasonCompletion: {
      s1: { label: '连载中', state: 'ongoing' },
    },
    seasonDirectory: {
      s1: '/测试/剧集/第一季',
    },
    seasonEntries: [
      {
        seasonId: 's1',
        seasonIndex: 0,
        label: '第一季',
        url: `${pageUrl}?season=s1`,
        completion: { label: '连载中', state: 'ongoing' },
        poster: null,
        loaded: true,
        hasItems: true,
      },
    ],
    items: {
      'item-1': {
        id: 'item-1',
        title: '第1集',
        status: 'success',
        message: '',
      },
    },
    itemOrder: ['item-1'],
    lastResult: {
      summary: '同步完成',
      updatedAt: now,
      success: 1,
      skipped: 0,
      failed: 0,
    },
    pendingTransfer: null,
  }
  return {
    ...baseRecord,
    ...overrides,
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

const CHAOSPACE_BASE_DETAIL_URL = 'https://www.chaospace.cc/tvshows/80348.html'
const GENERIC_FORUM_DEMO_URL = `${CHAOSPACE_BASE_DETAIL_URL}?pan-provider-demo=1`

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
        'Panel badge should promote the Pan Transfer assistant with provider label',
      ).toContainText('Pan Transfer 转存助手 · CHAOSPACE')

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
  test('switches between CHAOSPACE and Generic Forum and updates accent theme', async ({
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
      await expect(providerSelect, 'Provider dropdown should be interactive').toBeEnabled()
      await expect(
        providerSelect.locator('option[value="generic-forum"]'),
        'Generic Forum option should be available when markers are present',
      ).toHaveCount(1)

      await providerSelect.selectOption('generic-forum')
      await expect(providerSelect).toHaveValue('generic-forum')
      await expect(page.locator('.chaospace-provider-mode')).toContainText('手动')
      await expect(page.locator('.chaospace-provider-label')).toContainText('Generic Forum')
      await expect(panelLocator).toHaveAttribute('data-pan-provider', 'generic-forum')
      await expectPanelAccentRgb(
        panelLocator,
        '14, 165, 233',
        'Generic Forum accent palette should be applied',
      )

      await providerSelect.selectOption('')
      await expect(providerSelect).toHaveValue('')
      await expect(page.locator('.chaospace-provider-mode')).toContainText('自动')
      expectNoPrefixedErrors(errorTracker)
    } finally {
      errorTracker.dispose()
    }

    const { panelLocator: chaosPanel, errorTracker: chaosTracker } = await mountPanelForUrl(
      page,
      context,
      CHAOSPACE_BASE_DETAIL_URL,
    )
    try {
      await ensurePanelPinned(chaosPanel)
      await expect(page.locator('.chaospace-provider-mode')).toContainText('自动')
      await expect(page.locator('.chaospace-provider-label')).toContainText('CHAOSPACE')
      await expect(chaosPanel).toHaveAttribute('data-pan-provider', 'chaospace')
      await expectPanelAccentRgb(
        chaosPanel,
        '99, 102, 241',
        'Chaospace accent palette should restore after reloading a native CHAOSPACE page',
      )
      expectNoPrefixedErrors(chaosTracker)
    } finally {
      chaosTracker.dispose()
    }
  })

  test('disabling a provider removes it from overrides and survives reload', async ({
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
      const genericProviderToggle = providerList
        .locator('label', { hasText: 'Generic Forum' })
        .first()
      const checkbox = genericProviderToggle.locator('input[type="checkbox"]')
      await expect(checkbox).toBeChecked()
      await checkbox.click()
      await expect(checkbox).not.toBeChecked()

      await page.locator('[data-role="settings-close"]').click()
      await expect(settingsOverlay).toHaveAttribute('aria-hidden', 'true')

      const providerSelect = page.locator('.chaospace-provider-select select')
      await expect(providerSelect.locator('option[value="generic-forum"]')).toHaveCount(0)
      await expect(providerSelect).toHaveValue('')
      await expect(panelLocator).toHaveAttribute('data-pan-provider', 'chaospace')

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
      await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
      const rehydratedPanel = page.locator(PANEL_SELECTOR)
      await expect(rehydratedPanel).toBeVisible({ timeout: PANEL_RENDER_TIMEOUT })
      await expect(
        page.locator('.chaospace-provider-select select').locator('option[value="generic-forum"]'),
      ).toHaveCount(0)
      await expect(page.locator('.chaospace-provider-mode')).toContainText('自动')
      await expect(rehydratedPanel).toHaveAttribute('data-pan-provider', 'chaospace')

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
      await selectAllButton.click()
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
