import { chaosLogger } from '@/shared/log'
import {
  STORAGE_KEY,
  HISTORY_KEY,
  CACHE_KEY,
  POSITION_KEY,
  SIZE_KEY,
  PIN_STATE_KEY,
  EDGE_STATE_KEY,
  DEFAULT_PRESETS,
  DATA_EXPORT_VERSION,
  HISTORY_BATCH_RATE_LIMIT_MS,
  MIN_HISTORY_RATE_LIMIT_MS,
  MAX_HISTORY_RATE_LIMIT_MS,
} from '../constants'
import { state } from '../state'
import { normalizeDir } from '@/providers/sites/chaospace/page-analyzer'
import type {
  PanelRuntimeState,
  PanelPositionSnapshot,
  PanelSettingsDomRefs,
  PanelSizeSnapshot,
} from '../types'
import { normalizePinState } from '../utils/panel-pin'
import { normalizeEdgeState } from '../utils/panel-edge'
import { safeStorageGet as readStorageSnapshot } from '../utils/storage'
import type { ToastHandler } from './toast'
import settingsCssHref from '../styles/overlays/settings.css?url'
import { loadCss } from '../styles.loader'
import { onClickOutside, useEventListener } from '@vueuse/core'
import {
  DEFAULT_FILE_FILTER_MODE,
  normalizeFileFilterMode,
  normalizeFileFilterRules,
  normalizeFileRenameRules,
  serializeFileFilterRules,
  serializeFileRenameRules,
  type FileFilterEvaluationMode,
  type FileFilterRule,
  type FileRenameRule,
} from '@/shared/settings'
import { createFileFilterEditor, type FileFilterEditor } from './settings/file-filter-editor'
import { createFileRenameEditor, type FileRenameEditor } from './settings/file-rename-editor'
import type {
  ProviderPreferencesController,
  SiteProviderOption,
} from '../controllers/provider-preferences'

type ImportScopeKey = 'settings' | 'history' | 'cache' | 'panel'

interface ImportScopeSelection {
  settings: boolean
  history: boolean
  cache: boolean
  panel: boolean
}

type ImportScopeAvailability = Record<ImportScopeKey, boolean>

const IMPORT_SCOPE_CONFIG: Array<{
  key: ImportScopeKey
  label: string
  description: string
}> = [
  { key: 'settings', label: '插件设置', description: '基础配置、过滤规则、解析器偏好等' },
  { key: 'history', label: '转存历史', description: '检测记录、分组状态与批量任务' },
  { key: 'cache', label: '目录缓存', description: '收藏目录及转存目录缓存' },
  { key: 'panel', label: '面板布局', description: '大小、位置、固定状态、贴边与主题' },
]

const IMPORT_SCOPE_KEYS: ImportScopeKey[] = IMPORT_SCOPE_CONFIG.map((item) => item.key)
const IMPORT_SCOPE_UNAVAILABLE_HINT = '备份中未包含该数据'

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

interface ImportScopeDialogOptions {
  document: Document
  mountTarget: HTMLElement
}

interface ImportScopeDialog {
  prompt: (
    availability: ImportScopeAvailability,
    defaults: ImportScopeSelection,
  ) => Promise<ImportScopeSelection | null>
  destroy: () => void
  readonly root: HTMLElement
}

interface SettingsSnapshot {
  baseDir: string
  useTitleSubdir: boolean
  useSeasonSubdir: boolean
  presets: string[]
  theme: 'light' | 'dark'
  historyRateLimitMs: number
  fileFilterMode: FileFilterEvaluationMode
  fileFilters: FileFilterRule[]
  fileRenameRules: FileRenameRule[]
  [key: string]: unknown
}

interface SettingsDomRefs extends PanelSettingsDomRefs {
  filterEditor?: FileFilterEditor | null
  renameEditor?: FileRenameEditor | null
}

interface SettingsUpdatePayload extends Partial<SettingsSnapshot> {
  [key: string]: unknown
}

const DEFAULT_IMPORT_SCOPE: ImportScopeSelection = {
  settings: true,
  history: true,
  cache: true,
  panel: true,
}

export interface CreateSettingsModalOptions {
  document: Document
  floatingPanel: HTMLElement | null | undefined
  panelState: PanelRuntimeState
  panelDom: PanelSettingsDomRefs
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
  handleSeasonDefaultChange: (value: boolean) => void
  providerPreferences: ProviderPreferencesController
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
    useSeasonSubdir: state.seasonSubdirDefault,
    presets: [...state.presets],
    theme: state.theme === 'light' ? 'light' : 'dark',
    historyRateLimitMs: clampHistoryRateLimit(state.historyRateLimitMs),
    fileFilterMode: state.fileFilterMode || DEFAULT_FILE_FILTER_MODE,
    fileFilters: serializeFileFilterRules(state.fileFilters),
    fileRenameRules: serializeFileRenameRules(state.fileRenameRules),
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
    reader.onload = () => {
      const result = reader.result
      resolve(typeof result === 'string' ? result : '')
    }
    reader.readAsText(file, 'utf-8')
  })
}

function resetFileInput(input: HTMLInputElement | null): void {
  if (input) {
    input.value = ''
  }
}

function resolveBackupDataRoot(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('文件内容不合法')
  }
  const payloadRecord = payload as Record<string, unknown>
  const source = payloadRecord['data']
  const data =
    source && typeof source === 'object' ? (source as Record<string, unknown>) : payloadRecord
  return data
}

function getImportScopeAvailability(payload: unknown): ImportScopeAvailability {
  const data = resolveBackupDataRoot(payload)
  return {
    settings: Object.prototype.hasOwnProperty.call(data, 'settings'),
    history: Object.prototype.hasOwnProperty.call(data, 'history'),
    cache: Object.prototype.hasOwnProperty.call(data, 'cache'),
    panel: Object.prototype.hasOwnProperty.call(data, 'panel'),
  }
}

function hasAvailableScope(availability: ImportScopeAvailability): boolean {
  return IMPORT_SCOPE_KEYS.some((key) => availability[key])
}

function hasScopeSelection(selection: ImportScopeSelection): boolean {
  return IMPORT_SCOPE_KEYS.some((key) => selection[key])
}

function clampScopeToAvailability(
  selection: ImportScopeSelection,
  availability: ImportScopeAvailability,
): ImportScopeSelection {
  const next: ImportScopeSelection = {
    settings: selection.settings && availability.settings,
    history: selection.history && availability.history,
    cache: selection.cache && availability.cache,
    panel: selection.panel && availability.panel,
  }
  if (!hasScopeSelection(next)) {
    const fallback = IMPORT_SCOPE_KEYS.find((key) => availability[key])
    if (fallback) {
      next[fallback] = true
    }
  }
  return next
}

function createImportScopeDialog(options: ImportScopeDialogOptions): ImportScopeDialog {
  const { document, mountTarget } = options
  const overlay = document.createElement('div')
  overlay.className = 'chaospace-import-scope-overlay'
  overlay.hidden = true
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', '选择要导入的数据范围')

  const card = document.createElement('div')
  card.className = 'chaospace-import-scope'
  card.setAttribute('role', 'document')
  overlay.appendChild(card)

  const header = document.createElement('div')
  header.className = 'chaospace-import-scope__header'
  const title = document.createElement('div')
  title.className = 'chaospace-import-scope__title'
  title.textContent = '选择导入内容'
  const hint = document.createElement('p')
  hint.className = 'chaospace-import-scope__hint'
  hint.textContent = '导入备份会覆盖所选数据，请再次确认目标范围。'
  header.appendChild(title)
  header.appendChild(hint)
  card.appendChild(header)

  const alert = document.createElement('div')
  alert.className = 'chaospace-import-scope__alert'
  alert.textContent = '⚠️ 为避免误覆盖，请仅勾选需要恢复的部分。'
  card.appendChild(alert)

  const optionsContainer = document.createElement('div')
  optionsContainer.className = 'chaospace-import-scope__options'
  card.appendChild(optionsContainer)

  const optionNodes: Record<
    ImportScopeKey,
    {
      root: HTMLElement
      checkbox: HTMLInputElement
      title: HTMLElement
      description: HTMLElement
      label: string
      descriptionText: string
    }
  > = {} as Record<
    ImportScopeKey,
    {
      root: HTMLElement
      checkbox: HTMLInputElement
      title: HTMLElement
      description: HTMLElement
      label: string
      descriptionText: string
    }
  >

  IMPORT_SCOPE_CONFIG.forEach((config) => {
    const option = document.createElement('label')
    option.className = 'chaospace-import-scope__option'
    option.dataset['scope'] = config.key

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'chaospace-import-scope__checkbox'
    checkbox.addEventListener('change', () => {
      updateConfirmState()
    })

    const body = document.createElement('div')
    body.className = 'chaospace-import-scope__option-body'
    const optionTitle = document.createElement('div')
    optionTitle.className = 'chaospace-import-scope__option-title'
    optionTitle.textContent = config.label
    const description = document.createElement('p')
    description.className = 'chaospace-import-scope__option-desc'
    description.textContent = config.description

    body.appendChild(optionTitle)
    body.appendChild(description)

    option.appendChild(checkbox)
    option.appendChild(body)
    optionsContainer.appendChild(option)

    optionNodes[config.key] = {
      root: option,
      checkbox,
      title: optionTitle,
      description,
      label: config.label,
      descriptionText: config.description,
    }
  })

  const footer = document.createElement('div')
  footer.className = 'chaospace-import-scope__footer'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'chaospace-import-scope__btn'
  cancelBtn.textContent = '取消'
  cancelBtn.addEventListener('click', () => {
    closeDialog(null)
  })

  const confirmBtn = document.createElement('button')
  confirmBtn.type = 'button'
  confirmBtn.className = 'chaospace-import-scope__btn chaospace-import-scope__btn--primary'
  confirmBtn.textContent = '确认写入'
  confirmBtn.disabled = true
  confirmBtn.addEventListener('click', () => {
    if (confirmBtn.disabled) {
      return
    }
    closeDialog(collectSelection())
  })

  footer.appendChild(cancelBtn)
  footer.appendChild(confirmBtn)
  card.appendChild(footer)

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeDialog(null)
    }
  })
  card.addEventListener('click', (event) => {
    event.stopPropagation()
  })

  let pendingPromise: Promise<ImportScopeSelection | null> | null = null
  let resolver: ((value: ImportScopeSelection | null) => void) | null = null
  let keydownDisposer: (() => void) | null = null

  const bindKeydown = () => {
    if (keydownDisposer) {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog(null)
      }
    }
    document.addEventListener('keydown', handler, true)
    keydownDisposer = () => {
      document.removeEventListener('keydown', handler, true)
      keydownDisposer = null
    }
  }

  const focusFirstAvailable = () => {
    const target = IMPORT_SCOPE_KEYS.map((key) => optionNodes[key].checkbox).find(
      (input) => !input.disabled,
    )
    if (target) {
      target.focus({ preventScroll: true })
      return
    }
    confirmBtn.focus({ preventScroll: true })
  }

  const setAvailability = (availability: ImportScopeAvailability) => {
    IMPORT_SCOPE_KEYS.forEach((key) => {
      const node = optionNodes[key]
      const enabled = availability[key]
      node.checkbox.disabled = !enabled
      node.root.classList.toggle('is-disabled', !enabled)
      node.root.setAttribute('aria-disabled', enabled ? 'false' : 'true')
      node.title.textContent = enabled ? node.label : `${node.label}（备份缺失）`
      node.description.classList.toggle('is-muted', !enabled)
      node.description.textContent = enabled ? node.descriptionText : IMPORT_SCOPE_UNAVAILABLE_HINT
      if (!enabled) {
        node.checkbox.checked = false
      }
    })
  }

  const applySelection = (selection: ImportScopeSelection) => {
    IMPORT_SCOPE_KEYS.forEach((key) => {
      const node = optionNodes[key]
      node.checkbox.checked = !node.checkbox.disabled && selection[key]
    })
    updateConfirmState()
  }

  function collectSelection(): ImportScopeSelection {
    const snapshot: ImportScopeSelection = {
      settings: !optionNodes.settings.checkbox.disabled && optionNodes.settings.checkbox.checked,
      history: !optionNodes.history.checkbox.disabled && optionNodes.history.checkbox.checked,
      cache: !optionNodes.cache.checkbox.disabled && optionNodes.cache.checkbox.checked,
      panel: !optionNodes.panel.checkbox.disabled && optionNodes.panel.checkbox.checked,
    }
    return snapshot
  }

  function updateConfirmState(): void {
    const hasSelection = hasScopeSelection(collectSelection())
    confirmBtn.disabled = !hasSelection
  }

  function closeDialog(result: ImportScopeSelection | null): void {
    if (!pendingPromise) {
      return
    }
    overlay.classList.remove('is-open')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.hidden = true
    keydownDisposer?.()
    const resolve = resolver
    pendingPromise = null
    resolver = null
    resolve?.(result)
  }

  function openDialog(
    availability: ImportScopeAvailability,
    defaults: ImportScopeSelection,
  ): Promise<ImportScopeSelection | null> {
    if (pendingPromise) {
      return pendingPromise
    }
    if (!hasAvailableScope(availability)) {
      return Promise.resolve(null)
    }
    setAvailability(availability)
    applySelection(defaults)
    overlay.hidden = false
    overlay.setAttribute('aria-hidden', 'false')
    requestAnimationFrame(() => {
      overlay.classList.add('is-open')
    })
    bindKeydown()
    focusFirstAvailable()
    pendingPromise = new Promise<ImportScopeSelection | null>((resolve) => {
      resolver = resolve
    })
    return pendingPromise
  }

  mountTarget.appendChild(overlay)

  return {
    prompt: openDialog,
    destroy: () => {
      closeDialog(null)
      overlay.remove()
    },
    root: overlay,
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

function resolvePanelTheme(
  panelData: Record<string, unknown> | null | undefined,
  fallbackSettings: Record<string, unknown> | null,
): 'light' | 'dark' | null {
  const pickTheme = (source?: Record<string, unknown> | null): 'light' | 'dark' | null => {
    if (!source || typeof source !== 'object') {
      return null
    }
    const themeValue = source['theme']
    return themeValue === 'light' || themeValue === 'dark' ? themeValue : null
  }
  return pickTheme(panelData) ?? pickTheme(fallbackSettings)
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
    : state.seasonSubdirDefault
  const themeValue = (() => {
    if (!domRefs.themeSegment) {
      return state.theme === 'light' ? 'light' : 'dark'
    }
    const active =
      domRefs.themeSegment.querySelector<HTMLButtonElement>(
        '.chaospace-segmented-option.is-active[data-value]',
      ) ||
      domRefs.themeSegment.querySelector<HTMLButtonElement>(
        '.chaospace-segmented-option[aria-checked="true"][data-value]',
      )
    return active?.dataset['value'] === 'light' ? 'light' : 'dark'
  })()
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

  const modeValue = domRefs.filterModeSelect
    ? domRefs.filterModeSelect.value
    : state.fileFilterMode || DEFAULT_FILE_FILTER_MODE
  const fileFilterMode = normalizeFileFilterMode(modeValue)

  let fileFilters: FileFilterRule[] = []
  let fileRenameRules: FileRenameRule[] = []

  const filterEditorInstance = domRefs.filterEditor ?? null

  if (filterEditorInstance) {
    const { rules, errors } = filterEditorInstance.collect({ strict })
    if (errors.length) {
      filterEditorInstance.focusFirstInvalid()
      if (strict) {
        throw new Error(errors[0] || '文件过滤规则无效')
      }
      fileFilters = state.fileFilters
    } else {
      fileFilters = rules ?? []
    }
  } else {
    fileFilters = state.fileFilters
  }

  const renameEditorInstance = domRefs.renameEditor ?? null

  if (renameEditorInstance) {
    const { rules, errors } = renameEditorInstance.collect({ strict })
    if (errors.length) {
      renameEditorInstance.focusFirstInvalid()
      if (strict) {
        throw new Error(errors[0] || '文件重命名规则无效')
      }
      fileRenameRules = state.fileRenameRules
    } else {
      fileRenameRules = rules ?? []
    }
  } else {
    fileRenameRules = state.fileRenameRules
  }

  return {
    baseDir: sanitizedBase,
    useTitleSubdir: useTitle,
    useSeasonSubdir: useSeason,
    theme: themeValue,
    presets: presetList,
    historyRateLimitMs: rateMs,
    fileFilterMode,
    fileFilters,
    fileRenameRules,
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
    panelDom: settingsDom,
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
    handleSeasonDefaultChange,
    providerPreferences,
  } = options

  const domRefs: SettingsDomRefs = {
    ...settingsDom,
    filterEditor: null,
    renameEditor: null,
  }
  const importScopeDialog = createImportScopeDialog({
    document,
    mountTarget: domRefs.overlay,
  })
  let lastImportScopeSelection: ImportScopeSelection = { ...DEFAULT_IMPORT_SCOPE }

  const siteProviderOptions: ReadonlyArray<SiteProviderOption> =
    providerPreferences.getSiteProviderOptions()
  const siteProviderIdSet = new Set(siteProviderOptions.map((option) => option.id))

  let filterEditor: FileFilterEditor | null = null
  let renameEditor: FileRenameEditor | null = null

  if (domRefs.filterEditorRoot instanceof HTMLElement) {
    filterEditor = createFileFilterEditor(domRefs.filterEditorRoot, { document })
  }
  if (domRefs.renameEditorRoot instanceof HTMLElement) {
    renameEditor = createFileRenameEditor(domRefs.renameEditorRoot, { document })
  }
  domRefs.filterEditor = filterEditor
  domRefs.renameEditor = renameEditor

  function getThemeButtons(): HTMLButtonElement[] {
    return domRefs.themeSegment
      ? Array.from(domRefs.themeSegment.querySelectorAll<HTMLButtonElement>('[data-value]'))
      : []
  }

  function setThemeSegmentValue(value: 'light' | 'dark'): void {
    const buttons = getThemeButtons()
    buttons.forEach((button) => {
      const buttonValue =
        button.dataset['value'] === 'light' ? ('light' as const) : ('dark' as const)
      const isActive = buttonValue === value
      button.classList.toggle('is-active', isActive)
      button.setAttribute('aria-checked', isActive ? 'true' : 'false')
      button.tabIndex = isActive ? 0 : -1
      if (isActive) {
        domRefs.themeSegment?.setAttribute('data-selected', value)
      }
    })
  }

  function getThemeFocusTarget(): HTMLElement | null {
    const buttons = getThemeButtons()
    const [first] = buttons
    return first ?? domRefs.themeSegment ?? null
  }

  function ensureThemeSegmentBinding(): void {
    if (!domRefs.themeSegment || domRefs.themeSegment.dataset['bound'] === 'true') {
      return
    }
    domRefs.themeSegment.dataset['bound'] = 'true'
    getThemeButtons().forEach((button) => {
      button.addEventListener('click', () => {
        const nextValue =
          button.dataset['value'] === 'light' ? ('light' as const) : ('dark' as const)
        setThemeSegmentValue(nextValue)
      })
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
          return
        }
        event.preventDefault()
        const buttons = getThemeButtons()
        const currentIndex = buttons.indexOf(button)
        if (currentIndex === -1) {
          return
        }
        const delta = event.key === 'ArrowRight' ? 1 : -1
        const nextIndex = (currentIndex + delta + buttons.length) % buttons.length
        const nextButton = buttons[nextIndex]
        if (!nextButton) {
          return
        }
        const nextValue =
          nextButton.dataset['value'] === 'light' ? ('light' as const) : ('dark' as const)
        setThemeSegmentValue(nextValue)
        nextButton.focus()
      })
    })
  }

  ensureThemeSegmentBinding()
  setThemeSegmentValue(state.theme === 'light' ? 'light' : 'dark')

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
      domRefs.useSeasonCheckbox.checked = state.seasonSubdirDefault
    }
    ensureThemeSegmentBinding()
    setThemeSegmentValue(state.theme === 'light' ? 'light' : 'dark')
    if (domRefs.presetsTextarea) {
      domRefs.presetsTextarea.value = state.presets.join('\n')
    }
    if (domRefs.historyRateInput) {
      const seconds = state.historyRateLimitMs / 1000
      domRefs.historyRateInput.value = (Math.round(seconds * 100) / 100).toFixed(2)
      domRefs.historyRateInput.classList.remove('is-invalid')
    }
    if (domRefs.filterModeSelect) {
      domRefs.filterModeSelect.value = state.fileFilterMode || DEFAULT_FILE_FILTER_MODE
    }
    filterEditor?.render(serializeFileFilterRules(state.fileFilters))
    renameEditor?.render(serializeFileRenameRules(state.fileRenameRules))
    renderSiteProviderList()
  }

  const getEnabledSiteProviderCount = (): number => {
    const snapshot = providerPreferences.getSnapshot()
    if (!snapshot) {
      return siteProviderOptions.length
    }
    const disabled = snapshot.disabledSiteProviderIds.filter((id) => siteProviderIdSet.has(id))
    return Math.max(0, siteProviderOptions.length - disabled.length)
  }

  function renderSiteProviderList(): void {
    const container = domRefs.siteProviderList
    if (!container) {
      return
    }
    container.innerHTML = ''
    siteProviderOptions.forEach((option) => {
      const row = document.createElement('label')
      row.className = 'chaospace-provider-toggle'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = !state.disabledSiteProviderIds.has(option.id)
      checkbox.addEventListener('change', () => {
        const nextChecked = checkbox.checked
        void providerPreferences
          .toggleSiteProvider(option.id, nextChecked)
          .then(() => {
            if (!nextChecked && getEnabledSiteProviderCount() === 0) {
              showToast(
                'warning',
                '站点解析器已全部关闭',
                '如需重新启用，请点击浏览器工具栏中的 Pan Transfer 图标。',
              )
            }
          })
          .catch((error) => {
            checkbox.checked = !nextChecked
            const message =
              error instanceof Error && error.message ? error.message : '无法更新站点解析器'
            showToast('error', '更新失败', message)
          })
      })
      const body = document.createElement('div')
      body.className = 'chaospace-provider-toggle__body'
      const title = document.createElement('div')
      title.className = 'chaospace-provider-toggle__title'
      title.textContent = option.label
      const meta = document.createElement('div')
      meta.className = 'chaospace-provider-toggle__meta'
      const parts: string[] = []
      if (option.tags.length) {
        parts.push(`标签：${option.tags.join('、')}`)
      }
      if (option.supportedHosts.length) {
        parts.push(`域名：${option.supportedHosts.join(', ')}`)
      }
      meta.textContent = parts.join(' · ')
      const description = document.createElement('p')
      description.className = 'chaospace-provider-toggle__description'
      description.textContent = option.description || '—'
      body.appendChild(title)
      body.appendChild(meta)
      body.appendChild(description)
      row.appendChild(checkbox)
      row.appendChild(body)
      container.appendChild(row)
    })
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
    const seasonDefault = hasSeasonPref ? Boolean(seasonPrefValue) : state.seasonSubdirDefault
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
    if (Object.prototype.hasOwnProperty.call(nextSettings, 'fileFilterMode')) {
      state.fileFilterMode = normalizeFileFilterMode(nextSettings['fileFilterMode'])
    }
    if (Object.prototype.hasOwnProperty.call(nextSettings, 'fileFilters')) {
      const normalizedFilters = normalizeFileFilterRules(nextSettings['fileFilters'])
      state.fileFilters = normalizedFilters
    }
    if (Object.prototype.hasOwnProperty.call(nextSettings, 'fileRenameRules')) {
      const normalizedRenames = normalizeFileRenameRules(nextSettings['fileRenameRules'])
      state.fileRenameRules = normalizedRenames
    }
    if (hasSeasonPref) {
      state.seasonSubdirDefault = seasonDefault
      if (state.seasonPreferenceScope === 'default') {
        state.useSeasonSubdir = seasonDefault
      }
      handleSeasonDefaultChange(seasonDefault)
    }
    const previousTheme = state.theme
    state.theme = theme

    setBaseDir(baseDir, { persist: false })
    if (domRefs.useTitleCheckbox instanceof HTMLInputElement) {
      domRefs.useTitleCheckbox.checked = state.useTitleSubdir
    }
    if (domRefs.useSeasonCheckbox instanceof HTMLInputElement) {
      domRefs.useSeasonCheckbox.checked = state.useSeasonSubdir
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

  async function exportFullBackup(): Promise<void> {
    try {
      const keys = [
        STORAGE_KEY,
        HISTORY_KEY,
        CACHE_KEY,
        POSITION_KEY,
        SIZE_KEY,
        PIN_STATE_KEY,
        EDGE_STATE_KEY,
      ]
      const stored = await readStorageSnapshot<Record<string, unknown>>(keys, 'data export')
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
            pinned: typeof stored[PIN_STATE_KEY] === 'boolean' ? stored[PIN_STATE_KEY] : null,
            edge: stored[EDGE_STATE_KEY] || null,
            theme: state.theme === 'light' ? 'light' : 'dark',
          },
        },
      }
      downloadJsonFile(document, formatExportFilename('chaospace-backup'), payload)
      showToast('success', '插件数据已导出', '备份包含设置、历史、缓存与面板布局')
    } catch (error) {
      chaosLogger.error('[Pan Transfer] Failed to export backup', error)
      const message = error instanceof Error ? error.message : '无法导出插件数据'
      showToast('error', '导出失败', message)
    }
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

  async function importFullBackup(payload: unknown, scope: ImportScopeSelection): Promise<void> {
    if (!safeStorageSet || !safeStorageRemove) {
      throw new Error('当前环境不支持存储写入操作')
    }
    const selection = scope ?? DEFAULT_IMPORT_SCOPE
    const data = resolveBackupDataRoot(payload)
    const entries: Record<string, unknown> = {}
    const removals: string[] = []
    const hasSettingsPayload = Object.prototype.hasOwnProperty.call(data, 'settings')
    const rawSettingsPayload = hasSettingsPayload ? data['settings'] : undefined
    const normalizedSettingsPayload =
      rawSettingsPayload && typeof rawSettingsPayload === 'object'
        ? (rawSettingsPayload as Record<string, unknown>)
        : null

    let nextSettingsPayload: Record<string, unknown> | null = null
    let shouldRemoveSettings = false
    let settingsMutated = false
    let settingsScopeApplied = false
    let historyMutated = false
    let cacheMutated = false
    let panelScopeApplied = false
    let panelGeometryTouched = false
    let panelThemeTouched = false
    let importedPanelSize: PanelSizeSnapshot | null = null
    let importedPanelPosition: PanelPositionSnapshot | null = null

    const ensureSettingsPayload = async (): Promise<Record<string, unknown>> => {
      if (nextSettingsPayload) {
        return nextSettingsPayload
      }
      const storedSnapshot = await readStorageSnapshot<Record<string, unknown>>(
        [STORAGE_KEY],
        'settings merge',
      )
      const currentSettings = storedSnapshot[STORAGE_KEY]
      nextSettingsPayload =
        currentSettings && typeof currentSettings === 'object'
          ? { ...(currentSettings as Record<string, unknown>) }
          : {}
      return nextSettingsPayload
    }

    if (selection.settings && hasSettingsPayload) {
      if (normalizedSettingsPayload) {
        nextSettingsPayload = normalizedSettingsPayload
      } else {
        shouldRemoveSettings = true
      }
      settingsMutated = true
      settingsScopeApplied = true
    }

    if (selection.history && Object.prototype.hasOwnProperty.call(data, 'history')) {
      const historyData = data['history']
      if (historyData) {
        entries[HISTORY_KEY] = historyData
      } else {
        removals.push(HISTORY_KEY)
      }
      historyMutated = true
    }

    if (selection.cache && Object.prototype.hasOwnProperty.call(data, 'cache')) {
      const cacheData = data['cache']
      if (cacheData) {
        entries[CACHE_KEY] = cacheData
      } else {
        removals.push(CACHE_KEY)
      }
      cacheMutated = true
    }

    if (selection.panel && Object.prototype.hasOwnProperty.call(data, 'panel')) {
      const panelSource = data['panel']
      const panelData =
        panelSource && typeof panelSource === 'object'
          ? (panelSource as Record<string, unknown>)
          : {}
      const normalizedPanelSize = normalizePanelSizeSnapshot(panelData['size'])
      const normalizedPanelPosition = normalizePanelPositionSnapshot(panelData['position'])
      const normalizedPanelPinned = normalizePinState(panelData['pinned'])
      const normalizedPanelEdge = normalizeEdgeState(panelData['edge'])
      const importedTheme = resolvePanelTheme(panelData, normalizedSettingsPayload)
      const markPanelScope = () => {
        panelScopeApplied = true
      }
      if ('position' in panelData) {
        markPanelScope()
        panelGeometryTouched = true
        if (panelData['position'] && normalizedPanelPosition) {
          entries[POSITION_KEY] = normalizedPanelPosition
          importedPanelPosition = normalizedPanelPosition
        } else {
          removals.push(POSITION_KEY)
          importedPanelPosition = null
        }
      }
      if ('size' in panelData) {
        markPanelScope()
        panelGeometryTouched = true
        if (panelData['size'] && normalizedPanelSize) {
          entries[SIZE_KEY] = normalizedPanelSize
          importedPanelSize = normalizedPanelSize
        } else {
          removals.push(SIZE_KEY)
          importedPanelSize = null
        }
      }
      if ('pinned' in panelData) {
        markPanelScope()
        panelGeometryTouched = true
        if (typeof normalizedPanelPinned === 'boolean') {
          entries[PIN_STATE_KEY] = normalizedPanelPinned
        } else {
          removals.push(PIN_STATE_KEY)
        }
      }
      if ('edge' in panelData) {
        markPanelScope()
        panelGeometryTouched = true
        if (normalizedPanelEdge) {
          entries[EDGE_STATE_KEY] = {
            hidden: normalizedPanelEdge.isHidden,
            side: normalizedPanelEdge.side,
            peek: normalizedPanelEdge.peek,
          }
        } else {
          removals.push(EDGE_STATE_KEY)
        }
      }
      if (importedTheme && !selection.settings) {
        markPanelScope()
        panelThemeTouched = true
        const settingsPayload = await ensureSettingsPayload()
        settingsPayload['theme'] = importedTheme
        settingsMutated = true
      }
    }

    if (nextSettingsPayload) {
      entries[STORAGE_KEY] = nextSettingsPayload
    } else if (shouldRemoveSettings) {
      removals.push(STORAGE_KEY)
    }

    if (Object.keys(entries).length) {
      await safeStorageSet(entries, 'data import')
    }
    if (removals.length) {
      await safeStorageRemove(removals, 'data import cleanup')
    }

    if (settingsMutated) {
      if (loadSettings) {
        await loadSettings()
      }
      applySettingsUpdate(buildSettingsSnapshot(), { persist: false })
    }
    if (historyMutated) {
      await notifyHistoryStoreReload()
      if (loadHistory) {
        await loadHistory()
      }
      state.historyDetailCache = new Map()
      closeHistoryDetail?.({ hideDelay: 0 })
    }
    const geometrySynced = panelGeometryTouched
      ? applyImportedPanelGeometry(importedPanelSize, importedPanelPosition)
      : false

    const importedKeys: ImportScopeKey[] = []
    if (settingsScopeApplied) {
      importedKeys.push('settings')
    }
    if (historyMutated) {
      importedKeys.push('history')
    }
    if (cacheMutated) {
      importedKeys.push('cache')
    }
    if (panelScopeApplied || panelThemeTouched) {
      importedKeys.push('panel')
    }

    const detailParts: string[] = []
    if (importedKeys.length) {
      const labels = IMPORT_SCOPE_CONFIG.filter((item) => importedKeys.includes(item.key)).map(
        (item) => item.label,
      )
      detailParts.push(`导入范围：${labels.join('、')}`)
    }
    if (panelGeometryTouched) {
      detailParts.push(
        geometrySynced ? '面板布局已同步至最新备份' : '面板布局数据已写入，刷新后生效',
      )
    }
    if (panelThemeTouched) {
      detailParts.push('主题配色已更新')
    }
    if (!detailParts.length) {
      detailParts.push('未检测到需要写入的内容')
    }
    showToast('success', '数据已导入', detailParts.join('；'))
  }

  async function notifyHistoryStoreReload(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return
    }
    try {
      await chrome.runtime.sendMessage({ type: 'chaospace:history-refresh' })
    } catch (error) {
      chaosLogger.warn('[Pan Transfer] Failed to notify background history reload', error)
    }
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
        chaosLogger.error('[Pan Transfer] Failed to detach settings listener', error)
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
        const themeTarget = getThemeFocusTarget()
        const focusTarget = domRefs.baseDirInput || domRefs.historyRateInput || themeTarget
        focusTarget?.focus({ preventScroll: true })
        return
      }
      state.settingsPanel.isOpen = true
      domRefs.overlay.classList.add('is-open')
      domRefs.overlay.setAttribute('aria-hidden', 'false')
      domRefs.toggleBtn?.setAttribute('aria-expanded', 'true')
      floatingPanel?.classList.add('is-settings-open')
      renderSettingsPanel()
      const themeTarget = getThemeFocusTarget()
      const focusTarget = domRefs.baseDirInput || domRefs.historyRateInput || themeTarget
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
        chaosLogger.error('[Pan Transfer] Failed to load settings styles:', error)
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
      const ignoredElements = [domRefs.toggleBtn ?? null, importScopeDialog.root ?? null].filter(
        (element): element is HTMLElement => Boolean(element),
      )
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
            chaosLogger.error('[Pan Transfer] Failed to save settings', error)
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

    if (domRefs.exportDataBtn) {
      registerEventDisposer(
        useEventListener(domRefs.exportDataBtn, 'click', () => {
          void exportFullBackup()
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
            const parsed: unknown = JSON.parse(text)
            if (
              parsed &&
              typeof parsed === 'object' &&
              'type' in parsed &&
              (parsed as { type?: unknown }).type !== 'chaospace-transfer-backup'
            ) {
              throw new Error('请选择通过“导出数据”生成的 JSON 文件')
            }
            const availability = getImportScopeAvailability(parsed)
            if (!hasAvailableScope(availability)) {
              throw new Error('备份文件中不包含可导入的数据')
            }
            const defaults = clampScopeToAvailability(lastImportScopeSelection, availability)
            const selection = await importScopeDialog.prompt(availability, defaults)
            if (!selection) {
              showToast('info', '已取消导入', '未写入任何数据')
              return
            }
            lastImportScopeSelection = selection
            await importFullBackup(parsed, selection)
          } catch (error) {
            chaosLogger.error('[Pan Transfer] Backup import failed', error)
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
            chaosLogger.error('[Pan Transfer] Failed to reset layout from settings', error)
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
      importScopeDialog.destroy()
    },
  }
}
