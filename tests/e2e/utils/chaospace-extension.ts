import fs from 'node:fs'
import path from 'node:path'
import {
  expect,
  type BrowserContext,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Route,
  type Worker,
} from '@playwright/test'
import type { HistoryRecord, TransferRequestPayload } from '../../../src/shared/types/transfer'
import { HISTORY_VERSION, STORAGE_KEYS } from '../../../src/background/common/constants'
import {
  EDGE_STATE_KEY,
  PIN_STATE_KEY,
  POSITION_KEY,
  SIZE_KEY,
} from '../../../src/content/constants'

declare global {
  interface Window {
    seedHistory?: (storageKey: string, snapshot: unknown) => Promise<void>
    clearStorage?: (storageKey: string) => Promise<void>
    setStorageProviderMode?: (mode: string) => Promise<{ ok?: boolean; mode?: string }>
    getLastTransferSnapshot?: () => Promise<{ ok?: boolean; snapshot?: unknown }>
    dispatchPendingTransfer?: (
      payload: TransferRequestPayload,
    ) => Promise<{ ok?: boolean; error?: string }>
    __panTransferInvokeStorage?: (
      action: (cb: () => void, chromeApi: ChromeStorageBridge) => void,
    ) => Promise<void>
  }
}

const REPO_ROOT = path.resolve(__dirname, '../../..')

export const DIST_DIR = path.resolve(REPO_ROOT, 'dist')
export const EXTENSION_ARGS = (extensionPath: string): string[] => [
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
]

const CHAOSPACE_FIXTURE_ROOT = path.resolve(REPO_ROOT, 'src/content/services/__fixtures__')
const CHAOSPACE_MEDIA_ROOT = path.resolve(REPO_ROOT, 'tests/e2e/assets')
const CHAOSPACE_FIXTURE_CACHE = new Map<string, Promise<string>>()
const CHAOSPACE_MEDIA_CACHE = new Map<string, Promise<Buffer>>()
const CHAOSPACE_MEDIA_PLACEHOLDERS = {
  poster: path.join(CHAOSPACE_MEDIA_ROOT, 'poster-placeholder.png'),
  still: path.join(CHAOSPACE_MEDIA_ROOT, 'still-placeholder.png'),
} as const
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

export const PANEL_SELECTOR = '.chaospace-panel-host .chaospace-float-panel'
export const PANEL_RENDER_TIMEOUT = 15000
export const CHAOSPACE_LOG_PREFIX = '[Pan Transfer]'
const CHROME_EXTENSION_URL_PREFIX = 'chrome-extension://'
export const SUPPRESSED_EXTENSION_ERROR_TOKENS = [
  'net::ERR_FAILED',
  'net::ERR_BLOCKED_BY_CLIENT',
] as const

export const CHAOSPACE_BASE_DETAIL_URL = 'https://www.chaospace.cc/tvshows/80348.html'

export type ChaospaceErrorTracker = {
  consoleErrors: string[]
  runtimeErrors: string[]
  extensionConsoleErrors: string[]
  extensionRuntimeErrors: string[]
  waitForFirstChaospaceError: () => Promise<never>
  stopEarlyAbort: () => void
  dispose: () => void
  formatCollectedErrors: (headline: string) => string
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

const HISTORY_STORAGE_KEY = STORAGE_KEYS.history

export type PanTransferBackupSnapshot = {
  settings?: Record<string, unknown>
  history?: { version: number; records: HistoryRecord[] }
  cache?: Record<string, unknown>
  panel?: {
    position?: { left: number; top: number }
    size?: { width: number; height: number }
    pinned?: boolean
    edge?: {
      hidden?: boolean
      peek?: number
      side?: 'left' | 'right'
    }
  }
}

function guessContentType(pathname: string): string {
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.webp')) return 'image/webp'
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

async function resolveChaospaceMediaAsset(pathname: string): Promise<Buffer | null> {
  if (!isMediaAssetPath(pathname)) {
    return null
  }
  const normalized = pathname.toLowerCase()
  const key: keyof typeof CHAOSPACE_MEDIA_PLACEHOLDERS =
    normalized.includes('still') ||
    normalized.includes('stills') ||
    normalized.includes('backdrop') ||
    normalized.includes('gallery') ||
    normalized.includes('shot')
      ? 'still'
      : 'poster'
  return loadMediaPlaceholder(key)
}

function loadMediaPlaceholder(key: keyof typeof CHAOSPACE_MEDIA_PLACEHOLDERS): Promise<Buffer> {
  if (!CHAOSPACE_MEDIA_CACHE.has(key)) {
    const filepath = CHAOSPACE_MEDIA_PLACEHOLDERS[key]
    CHAOSPACE_MEDIA_CACHE.set(key, fs.promises.readFile(filepath))
  }
  return CHAOSPACE_MEDIA_CACHE.get(key)!
}

function isMediaAssetPath(pathname: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(pathname)
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

type ChaospaceRouteResult = 'handled' | 'passthrough'

type ChaospaceFulfillOptions = {
  remoteMedia?: boolean
}

async function fulfillChaospace(
  route: Route,
  url: URL,
  options: ChaospaceFulfillOptions = {},
): Promise<ChaospaceRouteResult> {
  const { pathname } = url
  const method = route.request().method()
  const remoteMedia = Boolean(options.remoteMedia)

  if (method !== 'GET') {
    await route.fulfill({ status: 200, headers: CHAOSPACE_STUB_HEADERS, body: '' })
    return 'handled'
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
    return 'handled'
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
    return 'handled'
  }

  if (remoteMedia && isMediaAssetPath(pathname)) {
    return 'passthrough'
  }

  const mediaAsset = await resolveChaospaceMediaAsset(pathname)
  if (mediaAsset) {
    await route.fulfill({
      status: 200,
      headers: {
        ...CHAOSPACE_STUB_HEADERS,
        'content-type': guessContentType(pathname),
      },
      body: mediaAsset,
    })
    return 'handled'
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
  return 'handled'
}

export async function setupOfflineRoutes(
  context: BrowserContext,
  options: { allowExternal?: boolean; remoteMedia?: boolean } = {},
): Promise<void> {
  const allowExternal = Boolean(options.allowExternal)
  const remoteMedia = Boolean(options.remoteMedia)
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
        const outcome = await fulfillChaospace(route, url, { remoteMedia })
        if (outcome === 'handled') {
          return
        }
        if (outcome === 'passthrough') {
          await route.continue()
          return
        }
      } else if (allowExternal) {
        await route.continue()
        return
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

export const createChaospaceErrorTracker = (page: Page): ChaospaceErrorTracker => {
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
        `Detected extension console.error without ${CHAOSPACE_LOG_PREFIX} prefix:\n${
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

export async function mountPanelForUrl(
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

export async function ensurePanelPinned(panelLocator: Locator): Promise<void> {
  await panelLocator.hover({ position: { x: 10, y: 10 } })
  await panelLocator.evaluate((panel) => {
    panel.classList.add('is-pinned')
    panel.classList.add('is-mounted')
  })
  await expect(panelLocator).toBeVisible()
}

export function expectNoPrefixedErrors(errorTracker: ChaospaceErrorTracker): void {
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

export function createHistoryRecordSeed(
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

export async function seedHistoryRecords(
  context: BrowserContext,
  records: HistoryRecord[],
): Promise<void> {
  await withTestHookPage(context, async (seedPage) => {
    await seedPage.evaluate(() => {
      const globalScope = globalThis as typeof globalThis & {
        __name?: (target: unknown, label?: string) => void
      }
      if (typeof globalScope.__name !== 'function') {
        globalScope.__name = () => {}
      }
      if (typeof window.__panTransferInvokeStorage !== 'function') {
        window.__panTransferInvokeStorage = (action) =>
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
      }
      if (typeof window.seedHistory === 'function') {
        return
      }
      window.seedHistory = (storageKey: string, snapshot: unknown) =>
        window.__panTransferInvokeStorage?.((done, chromeApi) => {
          chromeApi.storage.local.set({ [storageKey]: snapshot }, done)
        })
      window.clearStorage = (storageKey: string) =>
        window.__panTransferInvokeStorage?.((done, chromeApi) => {
          chromeApi.storage.local.remove(storageKey, done)
        })
    })
    await seedPage.evaluate(
      ({ storageKey, snapshot }) => {
        const globalScope = globalThis as typeof globalThis & {
          __name?: (target: unknown, label?: string) => void
        }
        if (typeof globalScope.__name !== 'function') {
          globalScope.__name = () => {}
        }
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

export async function setStorageProviderMode(context: BrowserContext, mode: string): Promise<void> {
  await ensureExtensionServiceWorker(context)
  await withTestHookPage(context, async (hookPage) => {
    await hookPage.evaluate(() => {
      const globalScope = globalThis as typeof globalThis & {
        __name?: (target: unknown, label?: string) => void
      }
      if (typeof globalScope.__name !== 'function') {
        globalScope.__name = () => {}
      }
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
                  resolve({ ok: false, mode: undefined })
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
        const globalScope = globalThis as typeof globalThis & {
          __name?: (target: unknown, label?: string) => void
        }
        if (typeof globalScope.__name !== 'function') {
          globalScope.__name = () => {}
        }
        if (typeof window.setStorageProviderMode !== 'function') {
          throw new Error('setStorageProviderMode helper is unavailable')
        }
        await window.setStorageProviderMode(mode)
      },
      { mode },
    )
  })
}

export async function restoreBackupSnapshot(
  context: BrowserContext,
  snapshot: PanTransferBackupSnapshot,
): Promise<void> {
  await withTestHookPage(context, async (hookPage) => {
    await hookPage.evaluate(
      async ({ snapshot, storageKeys, panelKeys }) => {
        const globalScope = globalThis as typeof globalThis & {
          __name?: (target: unknown, label?: string) => void
        }
        if (typeof globalScope.__name !== 'function') {
          globalScope.__name = () => {}
        }
        if (typeof window.__panTransferInvokeStorage !== 'function') {
          window.__panTransferInvokeStorage = (action) =>
            new Promise<void>((resolve, reject) => {
              try {
                const chromeApi = (
                  globalThis as typeof globalThis & { chrome?: ChromeStorageBridge }
                ).chrome
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
        }
        const payload: Record<string, unknown> = {}
        if (snapshot.settings) {
          payload[storageKeys.settings] = snapshot.settings
        }
        if (snapshot.history) {
          payload[storageKeys.history] = snapshot.history
        }
        if (snapshot.cache) {
          payload[storageKeys.cache] = snapshot.cache
        }
        if (snapshot.panel?.position) {
          payload[panelKeys.position] = snapshot.panel.position
        }
        if (snapshot.panel?.size) {
          payload[panelKeys.size] = snapshot.panel.size
        }
        if (typeof snapshot.panel?.pinned === 'boolean') {
          payload[panelKeys.pin] = snapshot.panel.pinned
        }
        if (snapshot.panel?.edge) {
          payload[panelKeys.edge] = snapshot.panel.edge
        }
        if (!Object.keys(payload).length) {
          return
        }
        await window.__panTransferInvokeStorage?.((done, chromeApi) => {
          chromeApi.storage.local.set(payload, done)
        })
      },
      {
        snapshot,
        storageKeys: STORAGE_KEYS,
        panelKeys: {
          position: POSITION_KEY,
          size: SIZE_KEY,
          pin: PIN_STATE_KEY,
          edge: EDGE_STATE_KEY,
        },
      },
    )
  })
}

export async function dispatchTransferViaDevHook(
  context: BrowserContext,
  payload: TransferRequestPayload,
): Promise<{ ok?: boolean; error?: string }> {
  await ensureExtensionServiceWorker(context)
  return withTestHookPage(context, async (hookPage) => {
    return hookPage.evaluate(
      async ({ transferPayload }) => {
        const globalScope = globalThis as typeof globalThis & {
          __name?: (target: unknown, label?: string) => void
        }
        if (typeof globalScope.__name !== 'function') {
          globalScope.__name = () => {}
        }
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

export async function getLastTransferSnapshot(
  context: BrowserContext,
): Promise<TransferDispatchSnapshot | null> {
  return withTestHookPage(context, async (hookPage) => {
    await hookPage.evaluate(() => {
      const globalScope = globalThis as typeof globalThis & {
        __name?: (target: unknown, label?: string) => void
      }
      if (typeof globalScope.__name !== 'function') {
        globalScope.__name = () => {}
      }
      if (typeof window.getLastTransferSnapshot !== 'function') {
        window.getLastTransferSnapshot = () =>
          new Promise<{ ok?: boolean; snapshot?: unknown; error?: string | null | undefined }>(
            (resolve, reject) => {
              try {
                const chromeApi = (
                  globalThis as typeof globalThis & { chrome?: ChromeStorageBridge }
                ).chrome
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
      }
    })
    return hookPage.evaluate(async () => {
      const globalScope = globalThis as typeof globalThis & {
        __name?: (target: unknown, label?: string) => void
      }
      if (typeof globalScope.__name !== 'function') {
        globalScope.__name = () => {}
      }
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

export async function waitForLastTransferSnapshot(
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

async function withTestHookPage<T>(
  context: BrowserContext,
  handler: (page: Page) => Promise<T>,
): Promise<T> {
  const extensionId = await resolveExtensionId(context)
  const hookUrl = `chrome-extension://${extensionId}/test-hooks.html`
  const hookPage = await context.newPage()
  try {
    await hookPage.goto(hookUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    return await handler(hookPage)
  } finally {
    await hookPage.close()
  }
}

function findExtensionServiceWorker(context: BrowserContext): Worker | null {
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
