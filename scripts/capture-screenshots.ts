import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, type Locator, type Page, type JSHandle } from '@playwright/test'
import {
  CHAOSPACE_BASE_DETAIL_URL,
  DIST_DIR,
  EXTENSION_ARGS,
  PANEL_RENDER_TIMEOUT,
  ensurePanelPinned,
  expectNoPrefixedErrors,
  mountPanelForUrl,
  setupOfflineRoutes,
  restoreBackupSnapshot,
  type PanTransferBackupSnapshot,
} from '../tests/e2e/utils/chaospace-extension'

// --- FIX: 调整 CaptureOptions 接口，增加 roundCorners 选项 ---
interface CaptureOptions {
  minViewportHeight?: number
  viewportPadding?: number
  roundCorners?: boolean // 新增选项用于处理圆角截图
}

type PanelScenario = (page: Page, panel: Locator) => Promise<void>

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')
const DOCS_DIR = path.resolve(REPO_ROOT, 'docs')
const BACKUP_PATH = path.resolve(REPO_ROOT, 'tests/chaospace-backup-20251113-042513.json')

const SCREENSHOT_VIEWPORT = { width: 1440, height: 900 }

const WAIT_FOR_IMAGES_EVALUATOR = new Function(
  'node',
  'options',
  `
    return new Promise(function(resolve) {
      if (!(node instanceof HTMLElement)) {
        resolve();
        return;
      }
      var localSelector = options.selector;
      var maxTimeout = options.timeout;
      var images = Array.from(node.querySelectorAll(localSelector));
      if (!images.length) {
        resolve();
        return;
      }
      var settled = 0;
      function flush() {
        var raf = globalThis.requestAnimationFrame;
        if (typeof raf === 'function') {
          raf(function() { resolve(); });
          return;
        }
        globalThis.setTimeout(function() { resolve(); }, 0);
      }
      function done() {
        settled += 1;
        if (settled >= images.length) {
          flush();
        }
      }
      function track(img) {
        if (img.complete && img.naturalWidth > 0) {
          done();
          return;
        }
        function cleanup() {
          img.removeEventListener('load', cleanup);
          img.removeEventListener('error', cleanup);
          done();
        }
        img.addEventListener('load', cleanup, { once: true });
        img.addEventListener('error', cleanup, { once: true });
      }
      images.forEach(track);
      globalThis.setTimeout(function() { resolve(); }, maxTimeout);
    });
  `,
) as (
  node: Element,
  options: {
    selector: string
    timeout: number
  },
) => Promise<void>

const logProgress = (message: string): void => {
  console.log(`[Pan Transfer] ${message}`)
}

async function main(): Promise<void> {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error(
      'Extension build is missing. Run `npm run build` via PowerShell before capturing screenshots.',
    )
  }
  if (!fs.existsSync(BACKUP_PATH)) {
    throw new Error(`Backup snapshot is missing at ${BACKUP_PATH}`)
  }

  logProgress('Preparing docs/ output目录')
  await fsp.mkdir(DOCS_DIR, { recursive: true })

  logProgress('加载离线快照数据')
  const backupSnapshot = loadBackupSnapshot()

  logProgress('创建临时浏览器配置目录')
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pan-transfer-screens-'))

  logProgress('启动 Chromium 并加载扩展构建')
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    args: EXTENSION_ARGS(DIST_DIR),
    viewport: SCREENSHOT_VIEWPORT,
    deviceScaleFactor: 2,
  })

  try {
    logProgress('注入浏览器初始化脚本')
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      })
    })

    logProgress('配置离线路由并准备资源')
    await setupOfflineRoutes(context, { allowExternal: true, remoteMedia: true })

    // --- OPTIMIZATION: 一次性恢复快照、创建页面并挂载面板 ---
    logProgress('恢复快照数据 (仅一次)')
    await restoreBackupSnapshot(context, backupSnapshot)

    logProgress('创建新页面 (仅一次)')
    const page = await context.newPage()
    const { panelLocator, errorTracker } = await mountPanelForUrl(
      page,
      context,
      CHAOSPACE_BASE_DETAIL_URL,
      { seedHistory: false },
    )

    try {
      await ensurePanelPinned(panelLocator)

      // --- OPTIMIZATION: 在同一个页面实例上运行所有场景 ---
      const scenarios: Array<{ label: string; handler: PanelScenario }> = [
        {
          label: '浮窗主面板（亮色）',
          handler: async (page, panel) => {
            await ensureLightTheme(page, panel)
            await waitForPanelContent(panel)
            await captureElement(page, panel, 'panel-main-light.png', { minViewportHeight: 1400 })
          },
        },
        {
          label: '历史列表与详情',
          handler: async (page, _panel) => {
            const historyOverlay = await openHistoryOverlay(page)
            await expandHistoryOverlay(historyOverlay)
            await captureElement(page, historyOverlay, 'transfer-history.png')

            const detailModal = await openHistoryDetail(page)
            await waitForHistoryDetailReady(detailModal)
            await expandHistoryDetail(detailModal)
            await waitForHistoryPoster(detailModal)
            await waitForHistoryStills(detailModal)
            await captureElement(page, detailModal, 'history-detail.png')
            await closeHistoryDetail(page) // 确保关闭弹窗，为下一个场景做准备
          },
        },
        {
          label: '设置面板',
          handler: async (page, _panel) => {
            const settingsOverlay = await openSettingsOverlay(page)
            await expandSettingsOverlay(settingsOverlay)
            const settingsDialog = settingsOverlay.locator('.chaospace-settings-dialog')
            await settingsDialog.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
            await captureElement(page, settingsDialog, 'settings-panel.png', {
              minViewportHeight: 2200,
              viewportPadding: 96,
              roundCorners: true, // --- FIX: 启用圆角截图 ---
            })
            // 注意：这里没有关闭设置面板的操作，因为它是最后一个场景。
            // 如果后面还有其他场景，需要添加关闭操作。
          },
        },
      ]

      for (const [index, scenario] of scenarios.entries()) {
        const progress = `${index + 1}/${scenarios.length}`
        logProgress(`(${progress}) 开始捕获：${scenario.label}`)
        await scenario.handler(page, panelLocator)
      }

      expectNoPrefixedErrors(errorTracker)
      console.log('✅ Screenshots updated in docs/')
    } finally {
      errorTracker.dispose()
      await page.close()
    }
  } finally {
    logProgress('清理浏览器上下文与临时目录')
    await context.close()
    await fsp.rm(userDataDir, { recursive: true, force: true })
  }
}

// --- REMOVED: runPanelScenario 函数已被合并到 main 函数中，不再需要 ---

// --- FIX & REFACTOR: 更新 captureElement 函数以支持圆角截图 ---
async function captureElement(
  page: Page,
  target: Locator,
  filename: string,
  options: CaptureOptions = {},
): Promise<void> {
  const filepath = path.join(DOCS_DIR, filename)
  await target.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  await enablePanelScreenshotLayout(target)
  await waitForLayoutSettled(target)
  await target.scrollIntoViewIfNeeded()

  const initialViewport = page.viewportSize() ?? SCREENSHOT_VIEWPORT
  const boundingBox = await target.boundingBox()
  if (!boundingBox) {
    throw new Error(`Unable to measure screenshot bounds for ${filename}`)
  }

  const scrollHeight = await target.evaluate((node) =>
    node instanceof HTMLElement ? Math.ceil(node.scrollHeight) : 0,
  )
  const targetHeight = Math.max(scrollHeight, Math.ceil(boundingBox.height))
  const viewportPadding = options.viewportPadding ?? 48
  const minViewportHeight = options.minViewportHeight ?? initialViewport.height
  const desiredHeight = Math.max(minViewportHeight, targetHeight + viewportPadding)
  const viewportChanged = desiredHeight !== initialViewport.height

  if (viewportChanged) {
    await page.setViewportSize({ width: initialViewport.width, height: desiredHeight })
    await target.scrollIntoViewIfNeeded()
    await target.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  }

  // --- FIX: 实现圆角截图逻辑 ---
  const screenshotOptions: Parameters<typeof target.screenshot>[0] = {
    path: filepath,
    animations: 'disabled',
    caret: 'hide',
  }
  let styleHandle: JSHandle | null = null

  if (options.roundCorners) {
    screenshotOptions.omitBackground = true
    styleHandle = await page.addStyleTag({
      content: 'html, body { background: transparent !important; }',
    })
  }
  // --- END FIX ---

  try {
    await target.screenshot(screenshotOptions)
  } finally {
    // --- FIX: 清理注入的样式和恢复视口 ---
    if (styleHandle) {
      await styleHandle.dispose()
    }
    if (viewportChanged) {
      await page.setViewportSize(initialViewport)
    }
    // --- END FIX ---
  }
}

// ... (其他辅助函数保持不变) ...
async function openHistoryOverlay(page: Page): Promise<Locator> {
  const toggle = page
    .locator('[data-role="history-summary-entry"] [data-role="history-toggle"]')
    .first()
  await toggle.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  await toggle.click()
  const overlay = page.locator('[data-role="history-overlay"]')
  await expect(overlay).toHaveAttribute('aria-hidden', 'false')
  await page.waitForTimeout(200)
  return overlay
}

async function expandHistoryOverlay(overlay: Locator): Promise<void> {
  await overlay.evaluate((node) => {
    if (!(node instanceof HTMLElement)) return
    node.style.maxHeight = 'none'
    node.style.height = 'auto'
    node.style.overflow = 'visible'
    node.style.position = 'relative'
    node.style.top = '0'
    node.style.bottom = 'auto'
    node.style.left = '0'
    node.style.right = '0'
    node.style.transform = 'none'
    node.style.margin = '0 auto'
    const scrollArea = node.querySelector<HTMLElement>('[data-role="history-scroll"]')
    if (scrollArea) {
      scrollArea.style.maxHeight = 'none'
      scrollArea.style.height = 'auto'
      scrollArea.style.overflow = 'visible'
    }
  })
  await overlay.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  await overlay.scrollIntoViewIfNeeded()
}

async function openHistoryDetail(page: Page): Promise<Locator> {
  const historyEntry = page.locator('[data-action="history-detail"]').first()
  await historyEntry.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  await historyEntry.click()
  const modal = page.locator('[data-role="history-detail-modal"]')
  await modal.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  await page.waitForTimeout(200)
  return modal
}

async function expandHistoryDetail(modal: Locator): Promise<void> {
  await modal.evaluate((node) => {
    if (!(node instanceof HTMLElement)) return
    node.style.maxHeight = 'none'
    node.style.height = 'auto'
    node.style.overflow = 'visible'
    node.style.transform = 'translateY(0)'
    node.style.position = 'relative'
    node.style.top = '0'
    node.style.bottom = 'auto'
    node.style.left = '0'
    node.style.right = '0'
    node.style.margin = '24px auto'
  })
  await modal.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  await modal.scrollIntoViewIfNeeded()
}

async function closeHistoryDetail(page: Page): Promise<void> {
  const closeButton = page.locator('[data-role="history-detail-close"]')
  if (await closeButton.isVisible()) {
    await closeButton.click()
    await page.waitForTimeout(200)
  }
}

async function waitForHistoryDetailReady(modal: Locator): Promise<void> {
  await expect(modal).toHaveAttribute('aria-busy', 'false', { timeout: 15000 })
  const loading = modal.locator('[data-role="history-detail-loading"]')
  if (await loading.isVisible()) {
    await expect(loading).toBeHidden({ timeout: 5000 })
  }
  await modal.locator('[data-role="history-detail-body"]').waitFor({
    state: 'visible',
    timeout: PANEL_RENDER_TIMEOUT,
  })
}

async function waitForHistoryPoster(modal: Locator): Promise<void> {
  const posterHost = modal.locator('[data-role="history-detail-poster"]')
  const shouldExpectPoster = await posterHost.evaluate((node) =>
    node instanceof HTMLElement ? !node.classList.contains('is-empty') : false,
  )
  if (!shouldExpectPoster) {
    return
  }
  const posterImage = posterHost.locator('img').first()
  try {
    await posterImage.waitFor({ state: 'attached', timeout: PANEL_RENDER_TIMEOUT })
  } catch {
    return
  }
  await waitForImageAssets(modal, '[data-role="history-detail-poster"] img')
}

async function waitForHistoryStills(modal: Locator): Promise<void> {
  const stillsHost = modal.locator('[data-role="history-detail-stills"]')
  const hasStills = await stillsHost.evaluate((node) =>
    node instanceof HTMLElement ? !node.classList.contains('is-empty') : false,
  )
  if (!hasStills) {
    return
  }
  const firstStill = stillsHost.locator('img').first()
  try {
    await firstStill.waitFor({ state: 'attached', timeout: PANEL_RENDER_TIMEOUT })
  } catch {
    return
  }
  await waitForImageAssets(modal, '[data-role="history-detail-stills"] img')
}

async function openSettingsOverlay(page: Page): Promise<Locator> {
  const toggle = page.locator('[data-role="settings-toggle"]')
  await toggle.click()
  const overlay = page.locator('[data-role="settings-overlay"]')
  await expect(overlay).toHaveAttribute('aria-hidden', 'false')
  await page.waitForTimeout(200)
  return overlay
}

async function expandSettingsOverlay(overlay: Locator): Promise<void> {
  await overlay.evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      return
    }
    const panel = node.closest<HTMLElement>('.chaospace-float-panel')
    if (panel) {
      panel.style.overflow = 'visible'
    }
    node.style.display = 'block'
    node.style.width = 'fit-content'
    node.style.maxWidth = 'calc(100vw - 32px)'
    node.style.margin = '0 auto'
    node.style.position = 'relative'
    node.style.inset = 'auto'
    node.style.height = 'auto'
    node.style.maxHeight = 'none'
    node.style.minHeight = '0'
    node.style.alignItems = 'stretch'
    node.style.justifyContent = 'flex-start'
    node.style.paddingTop = '24px'
    node.style.paddingBottom = '24px'
    node.style.paddingLeft = '0'
    node.style.paddingRight = '0'
    node.style.overflow = 'visible'
    node.style.background = 'transparent'
    node.style.backdropFilter = 'none'
    node.style.borderRadius = '0'
    const dialog = node.querySelector<HTMLElement>('.chaospace-settings-dialog')
    if (dialog) {
      dialog.style.maxHeight = 'none'
      dialog.style.height = 'auto'
      dialog.style.minHeight = '0'
      dialog.style.top = '0'
      dialog.style.bottom = 'auto'
      dialog.style.left = '0'
      dialog.style.right = '0'
      dialog.style.margin = '0 auto'
      dialog.style.transform = 'none'
      dialog.style.position = 'relative'
      dialog.style.overflow = 'visible'
    }
    const body = dialog?.querySelector<HTMLElement>('.chaospace-settings-body')
    if (body) {
      body.style.maxHeight = 'none'
      body.style.height = 'auto'
      body.style.overflow = 'visible'
      body.style.flex = '0 0 auto'
      body.style.minHeight = '0'
    }
    const form = dialog?.querySelector<HTMLElement>('.chaospace-settings-form')
    if (form) {
      form.style.maxHeight = 'none'
      form.style.height = 'auto'
      form.style.overflow = 'visible'
      form.style.minHeight = '0'
      form.scrollTop = 0
    }
    node.setAttribute('data-screenshot-mode', 'expanded')
  })
  await overlay.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
  await overlay.scrollIntoViewIfNeeded()
}

async function enablePanelScreenshotLayout(target: Locator): Promise<void> {
  await target.evaluate((node) => {
    const panel = node.closest<HTMLElement>('.chaospace-float-panel')
    if (!panel) {
      return
    }
    panel.style.maxHeight = 'none'
    panel.style.height = 'auto'
    panel.style.minHeight = '0'
    panel.style.overflow = 'visible'
    panel.style.position = 'relative'
    panel.style.left = '0'
    panel.style.right = '0'
    panel.style.transform = 'none'
    panel.style.margin = '0 auto'
    const body = panel.querySelector<HTMLElement>('.chaospace-float-body')
    if (body) {
      body.style.overflow = 'visible'
      body.style.height = 'auto'
      body.style.minHeight = '0'
      body.style.flex = '1 1 auto'
    }
  })
}

async function waitForPanelContent(panel: Locator): Promise<void> {
  const footerButton = panel.locator('.chaospace-float-footer [data-role="transfer-label"]').first()
  await footerButton.waitFor({ state: 'visible', timeout: PANEL_RENDER_TIMEOUT })
}

async function ensureLightTheme(page: Page, panel: Locator): Promise<void> {
  const themeToggle = panel.locator('[data-role="theme-toggle"]')
  const isLight = await panel.evaluate((node) => node.classList.contains('theme-light'))
  if (isLight) {
    return
  }
  await themeToggle.click()
  await page.waitForTimeout(200)
  const applied = await panel.evaluate((node) => node.classList.contains('theme-light'))
  if (!applied) {
    await panel.evaluate((node) => node.classList.add('theme-light'))
  }
  await page.waitForTimeout(200)
}

async function waitForImageAssets(
  target: Locator,
  selector: string,
  timeout = 10000,
): Promise<void> {
  await target.evaluate(WAIT_FOR_IMAGES_EVALUATOR, { selector, timeout })
}

async function waitForLayoutSettled(target: Locator): Promise<void> {
  await target.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const raf =
          globalThis.requestAnimationFrame ??
          ((cb: (timestamp: number) => void) => globalThis.setTimeout(() => cb(Date.now()), 16))
        raf(() => raf(() => resolve()))
      }),
  )
}

void main().catch((error) => {
  console.error('[Pan Transfer] Screenshot capture failed:', error)
  process.exitCode = 1
})

function loadBackupSnapshot(): PanTransferBackupSnapshot {
  const raw = fs.readFileSync(BACKUP_PATH, 'utf8')
  const parsed = JSON.parse(raw) as { data?: PanTransferBackupSnapshot }
  if (!parsed?.data) {
    throw new Error('Invalid backup snapshot file')
  }
  return parsed.data
}
