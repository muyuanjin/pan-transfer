import {
  STORAGE_KEY,
  HISTORY_KEY,
  CACHE_KEY,
  POSITION_KEY,
  SIZE_KEY,
  DEFAULT_PRESETS,
  SETTINGS_EXPORT_VERSION,
  DATA_EXPORT_VERSION,
  HISTORY_BATCH_RATE_LIMIT_MS,
  MIN_HISTORY_RATE_LIMIT_MS,
  MAX_HISTORY_RATE_LIMIT_MS,
} from '../constants'
import { panelDom, state } from '../state'
import { normalizeDir } from '../services/page-analyzer'
import type { PanelRuntimeState } from '../types'
import type { ToastHandler } from './toast'
import settingsCssHref from '../styles/overlays/settings.css?url'
import { loadCss } from '../styles.loader'
import { onClickOutside, useEventListener } from '@vueuse/core'

const settingsCssUrl = settingsCssHref
let settingsCssPromise: Promise<void> | null = null

function ensureSettingsStyles(): Promise<void> {
  if (!settingsCssPromise) {
    const href =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL(settingsCssUrl.replace(/^\//, ''))
        : settingsCssUrl
    settingsCssPromise = loadCss(href, document).catch((error) => {
      settingsCssPromise = null
      throw error
    })
  }
  return settingsCssPromise
}

type ToastFn = ToastHandler
type SafeStorageSetFn = (
  entries: Record<string, unknown>,
  contextLabel?: string,
) => Promise<void> | void
type SafeStorageRemoveFn = (keys: string[] | string, contextLabel?: string) => Promise<void> | void

interface SettingsSnapshot {
  baseDir: string
  useTitleSubdir: boolean
  useSeasonSubdir: boolean
  presets: string[]
  theme: 'light' | 'dark'
  historyRateLimitMs: number
  [key: string]: unknown
}

interface PanelSizeSnapshot {
  width: number
  height: number
}

interface PanelPositionSnapshot {
  left: number
  top: number
}

interface SettingsDomRefs {
  overlay: HTMLElement | null
  form: HTMLFormElement | null
  closeBtn: HTMLButtonElement | null
  cancelBtn: HTMLButtonElement | null
  baseDirInput: HTMLInputElement | null
  useTitleCheckbox: HTMLInputElement | null
  useSeasonCheckbox: HTMLInputElement | null
  themeSelect: HTMLSelectElement | null
  presetsTextarea: HTMLTextAreaElement | null
  historyRateInput: HTMLInputElement | null
  exportSettingsBtn: HTMLButtonElement | null
  exportDataBtn: HTMLButtonElement | null
  importSettingsTrigger: HTMLButtonElement | null
  importSettingsInput: HTMLInputElement | null
  importDataTrigger: HTMLButtonElement | null
  importDataInput: HTMLInputElement | null
  resetLayoutBtn: HTMLButtonElement | null
  toggleBtn: HTMLButtonElement | null
}

interface SettingsUpdatePayload extends Partial<SettingsSnapshot> {
  [key: string]: unknown
}

export interface CreateSettingsModalOptions {
  document: Document
  floatingPanel: HTMLElement | null | undefined
  panelState: PanelRuntimeState
  scheduleEdgeHide: ((delay?: number) => void) | undefined
  cancelEdgeHide: ((options?: { show?: boolean }) => void) | undefined
  applyPanelSize?: (width?: number, height?: number) => PanelSizeSnapshot | null
  applyPanelPosition?: (left?: number, top?: number) => PanelPositionSnapshot
  showToast: ToastFn
  setBaseDir: (value: string, options?: Record<string, unknown>) => void
  renderSeasonHint: () => void
  renderResourceList: () => void
  applyPanelTheme: () => void
  saveSettings: () => void
  safeStorageSet: SafeStorageSetFn | undefined
  safeStorageRemove: SafeStorageRemoveFn | undefined
  loadSettings: (() => Promise<void> | void) | undefined
  loadHistory: (() => Promise<void> | void) | undefined
  closeHistoryDetail: ((options?: Record<string, unknown>) => void) | undefined
  onResetLayout: (() => void | Promise<void>) | undefined
}

export interface SettingsModalHandles {
  render: () => void
  open: () => void
  close: (options?: { restoreFocus?: boolean }) => void
  applySettingsUpdate: (
    nextSettings: SettingsUpdatePayload,
    options?: { persist?: boolean },
  ) => SettingsSnapshot & { themeChanged: boolean }
  buildSettingsSnapshot: () => SettingsSnapshot
  destroy: () => void
}

function buildSettingsSnapshot(): SettingsSnapshot {
  return {
    baseDir: state.baseDir,
    useTitleSubdir: state.useTitleSubdir,
    useSeasonSubdir: state.useSeasonSubdir,
    presets: [...state.presets],
    theme: state.theme === 'light' ? 'light' : 'dark',
    historyRateLimitMs: clampHistoryRateLimit(state.historyRateLimitMs),
  }
}

function formatExportFilename(prefix: string): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${prefix}-${datePart}-${timePart}.json`
}

function downloadJsonFile(documentRef: Document, filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = documentRef.createElement('a')
  anchor.href = url
  anchor.download = filename
  documentRef.body.appendChild(anchor)
  anchor.click()
  requestAnimationFrame(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  })
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsText(file, 'utf-8')
  })
}

function resetFileInput(input: HTMLInputElement | null): void {
  if (input) {
    input.value = ''
  }
}

export function normalizePanelSizeSnapshot(value: unknown): PanelSizeSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  const width = Number(record['width'])
  const height = Number(record['height'])
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }
  return { width, height }
}

export function normalizePanelPositionSnapshot(value: unknown): PanelPositionSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  const left = Number(record['left'])
  const top = Number(record['top'])
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null
  }
  return { left, top }
}

interface ExtractFormOptions {
  strict?: boolean
}

function extractSettingsFormValues(
  domRefs: SettingsDomRefs,
  { strict = false }: ExtractFormOptions = {},
): SettingsSnapshot | null {
  if (!domRefs.baseDirInput) {
    return null
  }

  const rawBase = domRefs.baseDirInput.value || ''
  const sanitizedBase = normalizeDir(rawBase)
  const useTitle = domRefs.useTitleCheckbox
    ? domRefs.useTitleCheckbox.checked
    : state.useTitleSubdir
  const useSeason = domRefs.useSeasonCheckbox
    ? domRefs.useSeasonCheckbox.checked
    : state.useSeasonSubdir
  const themeValue = domRefs.themeSelect && domRefs.themeSelect.value === 'light' ? 'light' : 'dark'
  const presetsText = domRefs.presetsTextarea ? domRefs.presetsTextarea.value : ''
  const presetList = presetsText
    .split(/\n+/)
    .map((item) => sanitizePreset(item))
    .filter(Boolean)
  const rateInput = domRefs.historyRateInput
    ? Number.parseFloat(domRefs.historyRateInput.value)
    : Number.NaN
  const seconds = Number.isFinite(rateInput) ? rateInput : state.historyRateLimitMs / 1000

  if (strict && (seconds < 0.5 || seconds > 60)) {
    throw new Error('历史批量检测间隔需在 0.5～60 秒之间')
  }

  const rateMs = clampHistoryRateLimit(Math.round(seconds * 1000))
  return {
    baseDir: sanitizedBase,
    useTitleSubdir: useTitle,
    useSeasonSubdir: useSeason,
    theme: themeValue,
    presets: presetList,
    historyRateLimitMs: rateMs,
  }
}

export function clampHistoryRateLimit(value: number): number {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) {
    return HISTORY_BATCH_RATE_LIMIT_MS
  }
  const clamped = Math.round(ms)
  return Math.min(MAX_HISTORY_RATE_LIMIT_MS, Math.max(MIN_HISTORY_RATE_LIMIT_MS, clamped))
}

export function sanitizePreset(value: string): string {
  if (!value) {
    return ''
  }
  let sanitized = value.trim()
  sanitized = sanitized.replace(/\s+/g, ' ')
  if (!sanitized.startsWith('/')) {
    sanitized = `/${sanitized}`
  }
  sanitized = sanitized.replace(/\/+/g, '/')
  if (sanitized.length > 1 && sanitized.endsWith('/')) {
    sanitized = sanitized.slice(0, -1)
  }
  return sanitized
}

export function createSettingsModal(options: CreateSettingsModalOptions): SettingsModalHandles {
  const {
    document,
    floatingPanel,
    panelState,
    scheduleEdgeHide,
    cancelEdgeHide,
    applyPanelSize: _applyPanelSize,
    applyPanelPosition: _applyPanelPosition,
    showToast,
    setBaseDir,
    renderSeasonHint,
    renderResourceList,
    applyPanelTheme,
    saveSettings,
    safeStorageSet,
    safeStorageRemove,
    loadSettings,
    loadHistory,
    closeHistoryDetail,
    onResetLayout,
  } = options

  const domRefs: SettingsDomRefs = {
    overlay: panelDom.settingsOverlay as HTMLElement | null,
    form: panelDom.settingsForm as HTMLFormElement | null,
    closeBtn: panelDom.settingsClose as HTMLButtonElement | null,
    cancelBtn: panelDom.settingsCancel as HTMLButtonElement | null,
    baseDirInput: panelDom.settingsBaseDir as HTMLInputElement | null,
    useTitleCheckbox: panelDom.settingsUseTitle as HTMLInputElement | null,
    useSeasonCheckbox: panelDom.settingsUseSeason as HTMLInputElement | null,
    themeSelect: panelDom.settingsTheme as HTMLSelectElement | null,
    presetsTextarea: panelDom.settingsPresets as HTMLTextAreaElement | null,
    historyRateInput: panelDom.settingsHistoryRate as HTMLInputElement | null,
    exportSettingsBtn: panelDom.settingsExportConfig as HTMLButtonElement | null,
    exportDataBtn: panelDom.settingsExportData as HTMLButtonElement | null,
    importSettingsTrigger: panelDom.settingsImportConfigTrigger as HTMLButtonElement | null,
    importSettingsInput: panelDom.settingsImportConfigInput as HTMLInputElement | null,
    importDataTrigger: panelDom.settingsImportDataTrigger as HTMLButtonElement | null,
    importDataInput: panelDom.settingsImportDataInput as HTMLInputElement | null,
    resetLayoutBtn: panelDom.settingsResetLayout as HTMLButtonElement | null,
    toggleBtn: panelDom.settingsToggle as HTMLButtonElement | null,
  }

  function renderSettingsPanel(): void {
    if (!domRefs.overlay) {
      return
    }
    if (domRefs.baseDirInput) {
      domRefs.baseDirInput.value = state.baseDir || '/'
      domRefs.baseDirInput.classList.remove('is-invalid')
    }
    if (domRefs.useTitleCheckbox) {
      domRefs.useTitleCheckbox.checked = state.useTitleSubdir
    }
    if (domRefs.useSeasonCheckbox) {
      domRefs.useSeasonCheckbox.checked = state.useSeasonSubdir
    }
    if (domRefs.themeSelect) {
      domRefs.themeSelect.value = state.theme === 'light' ? 'light' : 'dark'
    }
    if (domRefs.presetsTextarea) {
      domRefs.presetsTextarea.value = state.presets.join('\n')
    }
    if (domRefs.historyRateInput) {
      const seconds = state.historyRateLimitMs / 1000
      domRefs.historyRateInput.value = (Math.round(seconds * 100) / 100).toFixed(2)
      domRefs.historyRateInput.classList.remove('is-invalid')
    }
  }

  function applySettingsUpdate(
    nextSettings: SettingsUpdatePayload,
    { persist = true }: { persist?: boolean } = {},
  ): SettingsSnapshot & { themeChanged: boolean } {
    if (!nextSettings || typeof nextSettings !== 'object') {
      throw new Error('无效设置对象')
    }
    const baseDirValue = nextSettings['baseDir']
    const baseDir = typeof baseDirValue === 'string' ? normalizeDir(baseDirValue) : state.baseDir
    const useTitleValue = nextSettings['useTitleSubdir']
    const useTitle = typeof useTitleValue === 'boolean' ? useTitleValue : state.useTitleSubdir
    const seasonPrefValue = nextSettings['useSeasonSubdir']
    const hasSeasonPref = typeof seasonPrefValue === 'boolean'
    const useSeason = hasSeasonPref ? Boolean(seasonPrefValue) : state.useSeasonSubdir
    const themeValue = nextSettings['theme']
    const theme = themeValue === 'light' || themeValue === 'dark' ? themeValue : state.theme
    const rateValue = nextSettings['historyRateLimitMs']
    const rateMs =
      typeof rateValue === 'number'
        ? clampHistoryRateLimit(rateValue)
        : clampHistoryRateLimit(state.historyRateLimitMs)
    const presetsValue = nextSettings['presets']
    const sourcePresets = Array.isArray(presetsValue) ? presetsValue : state.presets
    const sanitizedPresets = Array.from(
      new Set([
        ...DEFAULT_PRESETS,
        ...sourcePresets.map((item) => sanitizePreset(String(item))).filter(Boolean),
      ]),
    )

    state.presets = sanitizedPresets
    state.useTitleSubdir = useTitle
    state.historyRateLimitMs = rateMs
    if (hasSeasonPref) {
      state.useSeasonSubdir = useSeason
      state.hasSeasonSubdirPreference = true
    }
    const previousTheme = state.theme
    state.theme = theme

    setBaseDir(baseDir, { persist: false })
    if (panelDom.useTitleCheckbox instanceof HTMLInputElement) {
      panelDom.useTitleCheckbox.checked = state.useTitleSubdir
    }
    if (panelDom.useSeasonCheckbox instanceof HTMLInputElement) {
      panelDom.useSeasonCheckbox.checked = state.useSeasonSubdir
    }
    if (floatingPanel) {
      renderSeasonHint()
      renderResourceList()
    }
    applyPanelTheme()
    if (persist) {
      saveSettings()
    }
    if (state.settingsPanel.isOpen) {
      renderSettingsPanel()
    }
    return {
      ...buildSettingsSnapshot(),
      themeChanged: previousTheme !== state.theme,
    }
  }

  async function exportSettingsSnapshot(): Promise<void> {
    try {
      const payload = {
        type: 'chaospace-settings-export',
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        settings: buildSettingsSnapshot(),
      }
      downloadJsonFile(document, formatExportFilename('chaospace-settings'), payload)
      showToast('success', '设置已导出', 'JSON 文件可用于快速迁移参数')
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to export settings', error)
      const message = error instanceof Error ? error.message : '无法导出设置'
      showToast('error', '导出失败', message)
    }
  }

  async function exportFullBackup(): Promise<void> {
    try {
      const keys = [STORAGE_KEY, HISTORY_KEY, CACHE_KEY, POSITION_KEY, SIZE_KEY]
      const stored = await chrome.storage.local.get(keys)
      const payload = {
        type: 'chaospace-transfer-backup',
        version: DATA_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          settings: buildSettingsSnapshot(),
          history: stored[HISTORY_KEY] || null,
          cache: stored[CACHE_KEY] || null,
          panel: {
            position: stored[POSITION_KEY] || null,
            size: stored[SIZE_KEY] || null,
          },
        },
      }
      downloadJsonFile(document, formatExportFilename('chaospace-backup'), payload)
      showToast('success', '插件数据已导出', '备份包含设置、历史、缓存与面板布局')
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to export backup', error)
      const message = error instanceof Error ? error.message : '无法导出插件数据'
      showToast('error', '导出失败', message)
    }
  }

  async function importSettingsSnapshot(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      throw new Error('文件内容不合法')
    }
    const source = (payload as Record<string, unknown>)['settings']
    const next = source && typeof source === 'object' ? source : payload
    applySettingsUpdate(next as SettingsUpdatePayload, { persist: true })
    showToast('success', '设置已导入', '已更新所有可配置参数')
  }

  function applyImportedPanelGeometry(
    sizeSnapshot: PanelSizeSnapshot | null,
    positionSnapshot: PanelPositionSnapshot | null,
  ): boolean {
    const sizeFn = typeof _applyPanelSize === 'function' ? _applyPanelSize : null
    const positionFn = typeof _applyPanelPosition === 'function' ? _applyPanelPosition : null
    if (!sizeFn && !positionFn) {
      return false
    }
    let sizeApplied = false
    let positionApplied = false
    if (sizeSnapshot && sizeFn) {
      sizeApplied = Boolean(sizeFn(sizeSnapshot.width, sizeSnapshot.height))
    }
    if (positionFn) {
      const targetPosition = positionSnapshot || panelState.lastKnownPosition || null
      if (targetPosition) {
        if (panelState.edgeState) {
          panelState.edgeState.isHidden = false
        }
        const applied = positionFn(targetPosition.left, targetPosition.top)
        panelState.lastKnownPosition = applied
        positionApplied = Boolean(positionSnapshot)
      }
    }
    if (sizeApplied || positionApplied) {
      cancelEdgeHide?.({ show: true })
      return true
    }
    return false
  }

  async function importFullBackup(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      throw new Error('文件内容不合法')
    }
    if (!safeStorageSet || !safeStorageRemove) {
      throw new Error('当前环境不支持存储写入操作')
    }
    const payloadRecord = payload as Record<string, unknown>
    const source = payloadRecord['data']
    const data =
      source && typeof source === 'object' ? (source as Record<string, unknown>) : payloadRecord
    const entries: Record<string, unknown> = {}
    const removals: string[] = []

    if ('settings' in data) {
      const settingsData = data['settings']
      if (settingsData && typeof settingsData === 'object') {
        entries[STORAGE_KEY] = settingsData
      } else {
        removals.push(STORAGE_KEY)
      }
    }
    if ('history' in data) {
      const historyData = data['history']
      if (historyData) {
        entries[HISTORY_KEY] = historyData
      } else {
        removals.push(HISTORY_KEY)
      }
    }
    if ('cache' in data) {
      const cacheData = data['cache']
      if (cacheData) {
        entries[CACHE_KEY] = cacheData
      } else {
        removals.push(CACHE_KEY)
      }
    }
    const panelData =
      data['panel'] && typeof data['panel'] === 'object'
        ? (data['panel'] as Record<string, unknown>)
        : {}
    const normalizedPanelSize = normalizePanelSizeSnapshot(panelData['size'])
    const normalizedPanelPosition = normalizePanelPositionSnapshot(panelData['position'])
    if ('position' in panelData) {
      if (panelData['position'] && normalizedPanelPosition) {
        entries[POSITION_KEY] = normalizedPanelPosition
      } else {
        removals.push(POSITION_KEY)
      }
    }
    if ('size' in panelData) {
      if (panelData['size'] && normalizedPanelSize) {
        entries[SIZE_KEY] = normalizedPanelSize
      } else {
        removals.push(SIZE_KEY)
      }
    }

    if (Object.keys(entries).length) {
      await safeStorageSet(entries, 'data import')
    }
    if (removals.length) {
      await safeStorageRemove(removals, 'data import cleanup')
    }

    if (loadSettings) {
      await loadSettings()
    }
    applySettingsUpdate(buildSettingsSnapshot(), { persist: false })
    if (loadHistory) {
      await loadHistory()
    }
    state.historyDetailCache = new Map()
    closeHistoryDetail?.({ hideDelay: 0 })
    const geometrySynced = applyImportedPanelGeometry(normalizedPanelSize, normalizedPanelPosition)
    const detail = geometrySynced
      ? '备份内容已写入，面板布局、历史记录与缓存已更新'
      : '备份内容已写入，历史记录与缓存已更新'
    showToast('success', '数据已导入', detail)
  }

  const handleSettingsKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeSettingsPanel({ restoreFocus: true })
      event.stopPropagation()
    }
  }

  let stopSettingsKeydown: (() => void) | null = null
  let stopOutsideClick: (() => void) | null = null
  const eventDisposers: Array<() => void> = []
  let listenersBound = false

  const registerEventDisposer = (stop?: () => void) => {
    if (typeof stop === 'function') {
      eventDisposers.push(stop)
    }
  }

  const detachEventListeners = (): void => {
    if (!listenersBound) {
      return
    }
    while (eventDisposers.length) {
      const stop = eventDisposers.pop()
      try {
        stop?.()
      } catch (error) {
        console.error('[Chaospace Transfer] Failed to detach settings listener', error)
      }
    }
    listenersBound = false
    stopOutsideClick = null
  }

  const bindSettingsKeydown = () => {
    if (stopSettingsKeydown) {
      return
    }
    stopSettingsKeydown = useEventListener(document, 'keydown', handleSettingsKeydown, {
      capture: true,
    })
  }

  const unbindSettingsKeydown = () => {
    if (!stopSettingsKeydown) {
      return
    }
    stopSettingsKeydown()
    stopSettingsKeydown = null
  }

  function openSettingsPanel(): void {
    if (!domRefs.overlay) {
      return
    }

    const finalizeOpen = () => {
      if (!domRefs.overlay) {
        return
      }
      if (state.settingsPanel.isOpen) {
        renderSettingsPanel()
        const focusTarget = domRefs.baseDirInput || domRefs.historyRateInput || domRefs.themeSelect
        focusTarget?.focus({ preventScroll: true })
        return
      }
      state.settingsPanel.isOpen = true
      domRefs.overlay.classList.add('is-open')
      domRefs.overlay.setAttribute('aria-hidden', 'false')
      domRefs.toggleBtn?.setAttribute('aria-expanded', 'true')
      floatingPanel?.classList.add('is-settings-open')
      renderSettingsPanel()
      const focusTarget = domRefs.baseDirInput || domRefs.historyRateInput || domRefs.themeSelect
      focusTarget?.focus({ preventScroll: true })
      panelState.pointerInside = true
      cancelEdgeHide?.({ show: true })
      bindSettingsKeydown()
    }

    void ensureSettingsStyles()
      .then(() => {
        finalizeOpen()
      })
      .catch((error) => {
        console.error('[Chaospace Transfer] Failed to load settings styles:', error)
        finalizeOpen()
      })
  }

  function closeSettingsPanel({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
    if (!state.settingsPanel.isOpen) {
      return
    }
    state.settingsPanel.isOpen = false
    domRefs.overlay?.classList.remove('is-open')
    domRefs.overlay?.setAttribute('aria-hidden', 'true')
    domRefs.toggleBtn?.setAttribute('aria-expanded', 'false')
    floatingPanel?.classList.remove('is-settings-open')
    unbindSettingsKeydown()
    if (!panelState.isPinned) {
      scheduleEdgeHide?.()
    }
    if (restoreFocus) {
      domRefs.toggleBtn?.focus({ preventScroll: true })
    }
  }

  function attachEventListeners(): void {
    if (listenersBound) {
      return
    }
    listenersBound = true

    if (!stopOutsideClick) {
      const ignoredElements = domRefs.toggleBtn ? [domRefs.toggleBtn] : []
      stopOutsideClick = onClickOutside(
        () => domRefs.overlay?.querySelector<HTMLElement>('.chaospace-settings-dialog') ?? null,
        () => {
          if (!state.settingsPanel.isOpen) {
            return
          }
          closeSettingsPanel({ restoreFocus: false })
        },
        { ignore: ignoredElements },
      )
      registerEventDisposer(stopOutsideClick)
    }

    if (domRefs.toggleBtn) {
      registerEventDisposer(
        useEventListener(domRefs.toggleBtn, 'click', () => {
          if (state.settingsPanel.isOpen) {
            closeSettingsPanel({ restoreFocus: true })
          } else {
            openSettingsPanel()
          }
        }),
      )
    }

    if (domRefs.closeBtn) {
      registerEventDisposer(
        useEventListener(domRefs.closeBtn, 'click', () => {
          closeSettingsPanel({ restoreFocus: true })
        }),
      )
    }

    if (domRefs.cancelBtn) {
      registerEventDisposer(
        useEventListener(domRefs.cancelBtn, 'click', () => {
          closeSettingsPanel({ restoreFocus: true })
        }),
      )
    }

    if (domRefs.form) {
      registerEventDisposer(
        useEventListener(domRefs.form, 'submit', async (event) => {
          event.preventDefault()
          domRefs.historyRateInput?.classList.remove('is-invalid')
          try {
            const update = extractSettingsFormValues(domRefs, { strict: true })
            if (!update) {
              closeSettingsPanel({ restoreFocus: true })
              return
            }
            applySettingsUpdate(update, { persist: true })
            showToast('success', '设置已保存', '所有参数已更新并立即生效')
            closeSettingsPanel({ restoreFocus: true })
          } catch (error) {
            console.error('[Chaospace Transfer] Failed to save settings', error)
            const message = error instanceof Error ? error.message : '请检查输入是否正确'
            if (domRefs.historyRateInput && message.includes('间隔')) {
              domRefs.historyRateInput.classList.add('is-invalid')
              domRefs.historyRateInput.focus({ preventScroll: true })
            }
            showToast('error', '保存失败', message)
          }
        }),
      )
    }

    if (domRefs.exportSettingsBtn) {
      registerEventDisposer(
        useEventListener(domRefs.exportSettingsBtn, 'click', () => {
          void exportSettingsSnapshot()
        }),
      )
    }

    if (domRefs.exportDataBtn) {
      registerEventDisposer(
        useEventListener(domRefs.exportDataBtn, 'click', () => {
          void exportFullBackup()
        }),
      )
    }

    if (domRefs.importSettingsTrigger && domRefs.importSettingsInput) {
      registerEventDisposer(
        useEventListener(domRefs.importSettingsTrigger, 'click', () => {
          domRefs.importSettingsInput?.click()
        }),
      )
      registerEventDisposer(
        useEventListener(domRefs.importSettingsInput, 'change', async (event) => {
          const input = event.currentTarget as HTMLInputElement | null
          const file = input?.files && input.files[0]
          if (!file) {
            return
          }
          try {
            const text = await readFileAsText(file)
            const parsed = JSON.parse(text)
            if (parsed.type && parsed.type !== 'chaospace-settings-export') {
              throw new Error('请选择通过“导出设置”生成的 JSON 文件')
            }
            await importSettingsSnapshot(parsed)
          } catch (error) {
            console.error('[Chaospace Transfer] Settings import failed', error)
            const message = error instanceof Error ? error.message : '无法导入设置文件'
            showToast('error', '导入失败', message)
          } finally {
            resetFileInput(domRefs.importSettingsInput)
          }
        }),
      )
    }

    if (domRefs.importDataTrigger && domRefs.importDataInput) {
      registerEventDisposer(
        useEventListener(domRefs.importDataTrigger, 'click', () => {
          domRefs.importDataInput?.click()
        }),
      )
      registerEventDisposer(
        useEventListener(domRefs.importDataInput, 'change', async (event) => {
          const input = event.currentTarget as HTMLInputElement | null
          const file = input?.files && input.files[0]
          if (!file) {
            return
          }
          try {
            const text = await readFileAsText(file)
            const parsed = JSON.parse(text)
            if (parsed.type && parsed.type !== 'chaospace-transfer-backup') {
              throw new Error('请选择通过“导出全部数据”生成的 JSON 文件')
            }
            await importFullBackup(parsed)
          } catch (error) {
            console.error('[Chaospace Transfer] Backup import failed', error)
            const message = error instanceof Error ? error.message : '无法导入数据备份'
            showToast('error', '导入失败', message)
          } finally {
            resetFileInput(domRefs.importDataInput)
          }
        }),
      )
    }

    if (domRefs.resetLayoutBtn) {
      registerEventDisposer(
        useEventListener(domRefs.resetLayoutBtn, 'click', async () => {
          try {
            await onResetLayout?.()
          } catch (error) {
            console.error('[Chaospace Transfer] Failed to reset layout from settings', error)
            const message = error instanceof Error ? error.message : '无法完成布局重置'
            showToast('error', '重置失败', message)
          }
        }),
      )
    }
  }

  attachEventListeners()
  renderSettingsPanel()

  return {
    render: renderSettingsPanel,
    open: openSettingsPanel,
    close: closeSettingsPanel,
    applySettingsUpdate,
    buildSettingsSnapshot,
    destroy: () => {
      detachEventListeners()
      unbindSettingsKeydown()
    },
  }
}
