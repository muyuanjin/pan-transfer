// @ts-nocheck
import {
  STORAGE_KEY,
  POSITION_KEY,
  SIZE_KEY,
  DEFAULT_PRESETS,
  MAX_LOG_ENTRIES,
  HISTORY_KEY,
  CACHE_KEY,
  HISTORY_BATCH_RATE_LIMIT_MS,
  TV_SHOW_INITIAL_SEASON_BATCH,
  EDGE_HIDE_DELAY,
  EDGE_HIDE_MIN_PEEK,
  EDGE_HIDE_MAX_PEEK,
  EDGE_HIDE_DEFAULT_PEEK,
  INITIAL_PANEL_DELAY_MS,
  PANEL_CREATION_RETRY_DELAY_MS,
  PANEL_CREATION_MAX_ATTEMPTS,
  PAN_DISK_BASE_URL,
} from './constants'
import { state, panelDom, detailDom } from './state'
import {
  analyzePage,
  getPageClassification,
  suggestDirectoryFromClassification,
  normalizeDir,
  sanitizeSeasonDirSegment,
  buildPanDirectoryUrl,
  normalizePageUrl,
  isSupportedDetailPage,
  fetchSeasonDetail,
  isSeasonUrl,
  fetchHtmlDocument,
  extractItemsFromDocument,
  extractSeasonPageCompletion,
  extractPosterDetails,
} from './services/page-analyzer'
import {
  computeItemTargetPath,
  dedupeSeasonDirMap,
  updateSeasonExampleDir,
  computeSeasonTabState,
  filterItemsForActiveSeason,
  rebuildSeasonDirMap,
  ensureSeasonSubdirDefault,
  renderSeasonHint,
  renderSeasonControls,
  renderSeasonTabs,
  getTargetPath,
} from './services/season-manager'
import { createSeasonLoader } from './services/season-loader'
import { prepareHistoryRecords } from './services/history-service'

import { createResourceListRenderer } from './components/resource-list'
import { createHistoryController } from './history/controller'
import {
  createSettingsModal,
  clampHistoryRateLimit,
  sanitizePreset,
} from './components/settings-modal'
import { mountPanelShell } from './components/panel'
import { showToast } from './components/toast'
import { installZoomPreview } from './components/zoom-preview'
import { disableElementDrag } from './utils/dom'
import { safeStorageGet, safeStorageSet, safeStorageRemove } from './utils/storage'
import { formatOriginLabel, sanitizeCssUrl } from './utils/format'
import { extractCleanTitle } from './utils/title'
import { summarizeSeasonCompletion } from '../shared/utils/completion-status'

// chaospace content entry

let floatingPanel = null
let panelShellRef = null
let settingsModalRef = null
let panelCreationInProgress = false

const panelState = {
  edgeState: { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK },
  pointerInside: false,
  lastPointerPosition: { x: Number.NaN, y: Number.NaN },
  isPinned: false,
  hideTimer: null,
  edgeAnimationTimer: null,
  edgeTransitionUnbind: null,
  scheduleEdgeHide: null,
  cancelEdgeHide: null,
  lastKnownSize: null,
  detachWindowResize: null,
  documentPointerDownBound: false,
  applyEdgeHiddenPosition: null,
  hidePanelToEdge: null,
  showPanelFromEdge: null,
  beginEdgeAnimation: null,
  lastKnownPosition: { left: 16, top: 16 },
  getPanelBounds: null,
}

function handleDocumentPointerDown(event) {
  if (!floatingPanel || panelState.isPinned) {
    return
  }
  const target = event.target
  if (!(target instanceof Node)) {
    return
  }
  if (floatingPanel.contains(target)) {
    return
  }
  if (target.closest('.zi-overlay')) {
    return
  }
  if (state.historyDetail?.isOpen) {
    if (
      (detailDom.modal && detailDom.modal.contains(target)) ||
      (detailDom.backdrop && detailDom.backdrop.contains(target))
    ) {
      return
    }
  }
  panelState.pointerInside = false
  floatingPanel.classList.remove('is-hovering')
  floatingPanel.classList.add('is-leaving')
  if (typeof panelState.scheduleEdgeHide === 'function') {
    panelState.scheduleEdgeHide(0)
  }
}

function updatePanelHeader() {
  const hasPoster = Boolean(state.poster && state.poster.src)
  if (panelDom.showTitle) {
    const title = state.pageTitle || (state.poster && state.poster.alt) || '等待选择剧集'
    panelDom.showTitle.textContent = title
  }
  if (panelDom.showSubtitle) {
    const label = formatOriginLabel(state.origin)
    const hasItemsArray = Array.isArray(state.items)
    const itemCount = hasItemsArray ? state.items.length : 0
    const infoParts = []
    if (label) {
      infoParts.push(`来源 ${label}`)
    }
    if (hasItemsArray) {
      infoParts.push(`解析到 ${itemCount} 项资源`)
    }
    if (state.completion && state.completion.label) {
      const statusLabel = state.completion.label
      infoParts.push(statusLabel)
    }
    panelDom.showSubtitle.textContent = infoParts.length
      ? infoParts.join(' · ')
      : '未检测到页面来源'
  }
  if (panelDom.header) {
    panelDom.header.classList.toggle('has-poster', hasPoster)
  }
  if (panelDom.headerArt) {
    if (hasPoster) {
      const safeUrl = sanitizeCssUrl(state.poster.src)
      panelDom.headerArt.style.backgroundImage = `url("${safeUrl}")`
      panelDom.headerArt.classList.remove('is-empty')
    } else {
      panelDom.headerArt.style.backgroundImage = ''
      panelDom.headerArt.classList.add('is-empty')
    }
  }
  if (panelDom.headerPoster) {
    disableElementDrag(panelDom.headerPoster)
    if (hasPoster) {
      panelDom.headerPoster.src = state.poster.src
      panelDom.headerPoster.alt = state.poster.alt || ''
      panelDom.headerPoster.style.display = 'block'
      panelDom.headerPoster.dataset.action = 'preview-poster'
      panelDom.headerPoster.dataset.src = state.poster.src
      panelDom.headerPoster.dataset.alt = state.poster.alt || state.pageTitle || ''
      panelDom.headerPoster.classList.add('is-clickable')
    } else {
      panelDom.headerPoster.removeAttribute('src')
      panelDom.headerPoster.alt = ''
      panelDom.headerPoster.style.display = 'none'
      delete panelDom.headerPoster.dataset.action
      delete panelDom.headerPoster.dataset.src
      delete panelDom.headerPoster.dataset.alt
      panelDom.headerPoster.classList.remove('is-clickable')
    }
  }
}

function isDefaultDirectory(value) {
  const normalized = normalizeDir(value)
  return normalized === '/' || DEFAULT_PRESETS.includes(normalized)
}

async function loadSettings() {
  try {
    const stored = await safeStorageGet(STORAGE_KEY, 'settings')
    const settings = stored[STORAGE_KEY] || {}
    if (typeof settings.baseDir === 'string') {
      const normalizedBase = normalizeDir(settings.baseDir)
      state.baseDir = normalizedBase
      state.baseDirLocked = !isDefaultDirectory(normalizedBase)
    } else {
      state.baseDir = '/'
      state.baseDirLocked = false
    }
    state.autoSuggestedDir = null
    state.classification = 'unknown'
    state.classificationDetails = null
    if (typeof settings.useTitleSubdir === 'boolean') {
      state.useTitleSubdir = settings.useTitleSubdir
    }
    if (typeof settings.useSeasonSubdir === 'boolean') {
      state.useSeasonSubdir = settings.useSeasonSubdir
      state.hasSeasonSubdirPreference = true
    }
    if (Array.isArray(settings.presets)) {
      const merged = [...settings.presets, ...DEFAULT_PRESETS].map(sanitizePreset).filter(Boolean)
      const unique = Array.from(new Set(merged))
      state.presets = unique
    } else {
      state.presets = [...DEFAULT_PRESETS]
    }
    if (settings.theme === 'light' || settings.theme === 'dark') {
      state.theme = settings.theme
    }
    const rateLimitMs = Number(settings.historyRateLimitMs)
    if (Number.isFinite(rateLimitMs)) {
      state.historyRateLimitMs = clampHistoryRateLimit(rateLimitMs)
    } else {
      state.historyRateLimitMs = HISTORY_BATCH_RATE_LIMIT_MS
    }
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to load settings', error)
  }
}

async function saveSettings() {
  const settings = {
    baseDir: state.baseDir,
    useTitleSubdir: state.useTitleSubdir,
    presets: state.presets,
    theme: state.theme,
    historyRateLimitMs: clampHistoryRateLimit(state.historyRateLimitMs),
  }
  if (state.hasSeasonSubdirPreference) {
    settings.useSeasonSubdir = state.useSeasonSubdir
  }
  await safeStorageSet(
    {
      [STORAGE_KEY]: settings,
    },
    'settings',
  )
}

function ensurePreset(value) {
  const preset = sanitizePreset(value)
  if (!preset) {
    return null
  }
  if (!state.presets.includes(preset)) {
    state.presets = [...state.presets, preset]
    saveSettings()
  }
  return preset
}

function removePreset(value) {
  const preset = sanitizePreset(value)
  if (!preset || preset === '/' || DEFAULT_PRESETS.includes(preset)) {
    return
  }
  const before = state.presets.length
  state.presets = state.presets.filter((item) => item !== preset)
  if (state.presets.length === before) {
    return
  }
  if (state.baseDir === preset) {
    setBaseDir('/', { fromPreset: true })
  } else {
    saveSettings()
    renderPresets()
  }
  showToast('info', '已移除路径', `${preset} 已从收藏中移除`)
}

installZoomPreview()

function formatStageLabel(stage) {
  if (!stage) {
    return '📡 进度'
  }
  const stageKey = String(stage)
  const base = stageKey.split(':')[0] || stageKey
  const labels = {
    bstToken: '🔐 bdstoken',
    list: '📂 列表',
    verify: '✅ 验证',
    transfer: '🚚 转存',
    item: '🎯 项目',
    bootstrap: '⚙️ 启动',
    prepare: '🧭 准备',
    dispatch: '📤 派发',
    summary: '🧮 汇总',
    complete: '✅ 完成',
    fatal: '💥 故障',
    init: '🚦 初始化',
    error: '⛔ 错误',
  }
  return labels[stageKey] || labels[base] || stageKey
}

function resetLogs() {
  state.logs = []
  renderLogs()
}

function pushLog(message, { level = 'info', detail = '', stage = '' } = {}) {
  const lastEntry = state.logs[state.logs.length - 1]
  if (
    lastEntry &&
    lastEntry.message === message &&
    lastEntry.stage === stage &&
    lastEntry.detail === detail &&
    lastEntry.level === level
  ) {
    return
  }
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    message,
    detail,
    level,
    stage,
  }
  state.logs = [...state.logs.slice(-(MAX_LOG_ENTRIES - 1)), entry]
  renderLogs()
}

function renderLogs() {
  if (!panelDom.logList) {
    return
  }
  const list = panelDom.logList
  list.innerHTML = ''

  if (!state.logs.length) {
    panelDom.logContainer?.classList.add('is-empty')
    return
  }

  panelDom.logContainer?.classList.remove('is-empty')

  state.logs.forEach((entry) => {
    const li = document.createElement('li')
    li.className = `chaospace-log-item chaospace-log-${entry.level}`
    li.dataset.logId = entry.id
    li.dataset.stage = entry.stage || ''
    const stageLabel = formatStageLabel(entry.stage)
    li.innerHTML = `
        <span class="chaospace-log-stage">${stageLabel}</span>
        <div class="chaospace-log-content">
          <span class="chaospace-log-message">${entry.message}</span>
          ${entry.detail ? `<span class="chaospace-log-detail">${entry.detail}</span>` : ''}
        </div>
      `
    list.appendChild(li)
    requestAnimationFrame(() => {
      li.classList.add('is-visible')
    })
  })

  const logWrapper = panelDom.logContainer
  if (logWrapper) {
    requestAnimationFrame(() => {
      logWrapper.scrollTo({
        top: logWrapper.scrollHeight,
        behavior: 'smooth',
      })
    })
  }
}

function setStatus(status, message) {
  state.transferStatus = status
  if (message) {
    state.statusMessage = message
  }
  renderStatus()
}

function renderStatus() {
  const emojiMap = {
    idle: '🌙',
    running: '⚙️',
    success: '🎉',
    error: '⚠️',
  }
  const emoji = emojiMap[state.transferStatus] || 'ℹ️'
  if (panelDom.statusText) {
    panelDom.statusText.innerHTML = `<span class="chaospace-status-emoji">${emoji}</span>${state.statusMessage}`
  }

  if (panelDom.resultSummary) {
    if (!state.lastResult) {
      panelDom.resultSummary.innerHTML = ''
      panelDom.resultSummary.classList.add('is-empty')
    } else {
      panelDom.resultSummary.classList.remove('is-empty')
      const title = state.lastResult.title || ''
      const detail = state.lastResult.detail || ''
      panelDom.resultSummary.innerHTML = `
          <span class="chaospace-log-summary-title">${title}</span>
          ${detail ? `<span class="chaospace-log-summary-detail">${detail}</span>` : ''}
        `
    }
  }
}

function renderPathPreview() {
  if (!panelDom.pathPreview) {
    return
  }
  const targetPath = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle)
  panelDom.pathPreview.innerHTML = `<span class="chaospace-path-label">📂 当前将保存到：</span><span class="chaospace-path-value">${targetPath}</span>`
  updateSeasonExampleDir()
  renderSeasonHint()
}

function renderPresets() {
  if (!panelDom.presetList) {
    return
  }
  panelDom.presetList.innerHTML = ''
  const presets = Array.from(new Set(['/', ...state.presets]))
  presets.forEach((preset) => {
    const group = document.createElement('div')
    group.className = 'chaospace-chip-group'

    const selectBtn = document.createElement('button')
    selectBtn.type = 'button'
    selectBtn.className = `chaospace-chip-button${preset === state.baseDir ? ' is-active' : ''}`
    selectBtn.dataset.action = 'select'
    selectBtn.dataset.value = preset
    selectBtn.textContent = preset
    group.appendChild(selectBtn)

    const isRemovable = preset !== '/' && !DEFAULT_PRESETS.includes(preset)
    if (isRemovable) {
      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.className = 'chaospace-chip-remove'
      removeBtn.dataset.action = 'remove'
      removeBtn.dataset.value = preset
      removeBtn.setAttribute('aria-label', `移除 ${preset}`)
      removeBtn.textContent = '×'
      group.appendChild(removeBtn)
    }

    panelDom.presetList.appendChild(group)
  })
}

function updateTransferButton() {
  if (!panelDom.transferBtn || !panelDom.transferLabel) {
    return
  }
  const count = state.selectedIds.size
  const isRunning = state.transferStatus === 'running'
  panelDom.transferBtn.disabled = isRunning || count === 0
  panelDom.transferBtn.classList.toggle('is-loading', isRunning)
  if (panelDom.transferSpinner) {
    panelDom.transferSpinner.classList.toggle('is-visible', isRunning)
  }
  panelDom.transferLabel.textContent = isRunning
    ? '正在转存...'
    : count > 0
      ? `转存选中 ${count} 项`
      : '请选择资源'
}

function applyPanelTheme() {
  const isLight = state.theme === 'light'
  document.documentElement.classList.toggle('chaospace-light-root', isLight)
  if (floatingPanel) {
    floatingPanel.classList.toggle('theme-light', isLight)
  }
  if (panelDom.themeToggle) {
    const label = isLight ? '切换到深色主题' : '切换到浅色主题'
    panelDom.themeToggle.textContent = isLight ? '🌙' : '🌞'
    panelDom.themeToggle.setAttribute('aria-label', label)
    panelDom.themeToggle.title = label
  }
}

function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') {
    return
  }
  if (state.theme === theme) {
    return
  }
  state.theme = theme
  applyPanelTheme()
  saveSettings()
}

function updatePinButton() {
  if (!panelDom.pinBtn) {
    return
  }
  const label = panelState.isPinned ? '取消固定面板' : '固定面板'
  panelDom.pinBtn.textContent = '📌'
  panelDom.pinBtn.title = label
  panelDom.pinBtn.setAttribute('aria-label', label)
  panelDom.pinBtn.setAttribute('aria-pressed', panelState.isPinned ? 'true' : 'false')
  panelDom.pinBtn.classList.toggle('is-active', panelState.isPinned)
  if (floatingPanel) {
    floatingPanel.classList.toggle('is-pinned', panelState.isPinned)
  }
}

const { renderResourceList, renderResourceSummary } = createResourceListRenderer({
  state,
  panelDom,
  renderSeasonTabs,
  filterItemsForActiveSeason,
  computeSeasonTabState,
  renderSeasonControls,
  updateTransferButton,
  updatePanelHeader,
})
const { ensureDeferredSeasonLoading, resetSeasonLoader } = createSeasonLoader({
  getFloatingPanel: () => floatingPanel,
  fetchHtmlDocument,
  extractItemsFromDocument,
  extractSeasonPageCompletion,
  extractPosterDetails,
  renderResourceList,
  renderPathPreview,
  updatePanelHeader,
  updateTransferButton,
})

const historyController = createHistoryController({
  getFloatingPanel: () => floatingPanel,
  panelState,
  renderResourceList,
  renderPathPreview,
  renderSeasonHint,
})

const {
  applyHistoryToCurrentPage,
  loadHistory,
  handleHistoryDeleteSelected,
  handleHistoryClear,
  handleHistoryBatchCheck,
  renderHistoryCard,
  updateHistoryBatchControls,
  updateHistorySelectionSummary,
  setHistorySelection,
  setHistorySelectAll,
  setHistoryFilter,
  toggleHistoryExpanded,
  openHistoryDetail,
  closeHistoryDetail,
  triggerHistoryUpdate,
  selectNewItems,
  updateHistoryExpansion,
  renderHistoryDetail,
} = historyController

function setBaseDir(value, { fromPreset = false, persist = true, lockOverride = null } = {}) {
  const normalized = normalizeDir(value)
  state.baseDir = normalized
  const shouldLock =
    typeof lockOverride === 'boolean' ? lockOverride : !isDefaultDirectory(normalized)
  state.baseDirLocked = shouldLock

  if (panelDom.baseDirInput) {
    if (panelDom.baseDirInput.value !== normalized) {
      panelDom.baseDirInput.value = normalized
    }
    if (!shouldLock) {
      delete panelDom.baseDirInput.dataset.dirty
    }
  }

  if (fromPreset) {
    // 选中 preset 时不立即追加, 但保持已存在
    ensurePreset(normalized)
  }

  if (persist) {
    saveSettings()
  }
  renderPresets()
  renderPathPreview()
}

function applyAutoBaseDir(classificationInput, { persist = false } = {}) {
  const detail =
    classificationInput && typeof classificationInput === 'object'
      ? classificationInput
      : {
          classification: typeof classificationInput === 'string' ? classificationInput : 'unknown',
        }
  const type = detail.classification || detail.type || 'unknown'
  state.classification = type || 'unknown'
  state.classificationDetails = detail

  const suggestion = suggestDirectoryFromClassification(detail)
  state.autoSuggestedDir = suggestion

  if (!suggestion) {
    return false
  }
  if (state.baseDirLocked && state.baseDir !== suggestion) {
    return false
  }
  if (state.baseDir === suggestion) {
    return false
  }

  setBaseDir(suggestion, { persist, lockOverride: false })
  return true
}

function setSelectionAll(selected) {
  const { tabItems, activeId } = computeSeasonTabState({ syncState: true })
  const hasTabs = Array.isArray(tabItems) && tabItems.length > 0
  const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items
  const visibleIds = visibleItems.map((item) => item && item.id).filter(Boolean)

  if (selected) {
    visibleIds.forEach((id) => {
      state.selectedIds.add(id)
    })
  } else if (visibleIds.length) {
    visibleIds.forEach((id) => {
      state.selectedIds.delete(id)
    })
  } else if (!hasTabs) {
    state.selectedIds.clear()
  }
  renderResourceList()
}

function invertSelection() {
  const { tabItems, activeId } = computeSeasonTabState({ syncState: true })
  const hasTabs = Array.isArray(tabItems) && tabItems.length > 0
  const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items
  if (!visibleItems.length) {
    renderResourceList()
    return
  }
  const next = new Set(state.selectedIds)
  visibleItems.forEach((item) => {
    if (!item || !item.id) {
      return
    }
    if (next.has(item.id)) {
      next.delete(item.id)
    } else {
      next.add(item.id)
    }
  })
  state.selectedIds = next
  renderResourceList()
}

function setPanelControlsDisabled(disabled) {
  if (panelDom.baseDirInput) panelDom.baseDirInput.disabled = disabled
  if (panelDom.useTitleCheckbox) panelDom.useTitleCheckbox.disabled = disabled
  if (panelDom.useSeasonCheckbox) panelDom.useSeasonCheckbox.disabled = disabled
  if (panelDom.sortKeySelect) panelDom.sortKeySelect.disabled = disabled
  if (panelDom.sortOrderButton) panelDom.sortOrderButton.disabled = disabled
  if (panelDom.addPresetButton) panelDom.addPresetButton.disabled = disabled
  const selectGroup = floatingPanel?.querySelector('.chaospace-select-group')
  if (selectGroup) {
    selectGroup.querySelectorAll('button').forEach((button) => {
      button.disabled = disabled
    })
  }
  if (panelDom.presetList) {
    panelDom.presetList.classList.toggle('is-disabled', disabled)
  }
}

function handleProgressEvent(progress) {
  if (!progress || progress.jobId !== state.jobId) {
    return
  }
  if (progress.message) {
    pushLog(progress.message, {
      level: progress.level || 'info',
      detail: progress.detail || '',
      stage: progress.stage || '',
    })
  }
  if (progress.statusMessage) {
    state.statusMessage = progress.statusMessage
    renderStatus()
  } else if (typeof progress.current === 'number' && typeof progress.total === 'number') {
    state.statusMessage = `正在处理 ${progress.current}/${progress.total}`
    renderStatus()
  }
}

async function handleTransfer() {
  if (!floatingPanel || state.transferStatus === 'running') {
    return
  }

  const selectedItems = state.items.filter((item) => state.selectedIds.has(item.id))
  if (!selectedItems.length) {
    showToast('warning', '请选择资源', '至少勾选一个百度网盘资源再开始转存哦～')
    return
  }

  const baseDirValue = panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir
  setBaseDir(baseDirValue)
  if (panelDom.useTitleCheckbox) {
    state.useTitleSubdir = panelDom.useTitleCheckbox.checked
    saveSettings()
  }
  if (panelDom.useSeasonCheckbox) {
    state.useSeasonSubdir = panelDom.useSeasonCheckbox.checked
    state.hasSeasonSubdirPreference = true
    dedupeSeasonDirMap()
    saveSettings()
  }

  const targetDirectory = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle)

  state.jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  state.lastResult = null
  state.transferStatus = 'running'
  state.statusMessage = '正在准备转存...'
  resetLogs()
  pushLog('已锁定资源清单，准备开始转存', { stage: 'init' })
  renderStatus()
  renderPathPreview()
  updateTransferButton()
  setPanelControlsDisabled(true)

  try {
    const payload = {
      jobId: state.jobId,
      origin: state.origin || window.location.origin,
      items: selectedItems.map((item) => ({
        id: item.id,
        title: item.title,
        targetPath: computeItemTargetPath(item, targetDirectory),
      })),
      targetDirectory,
      meta: {
        total: selectedItems.length,
        baseDir: state.baseDir,
        useTitleSubdir: state.useTitleSubdir,
        useSeasonSubdir: state.useSeasonSubdir,
        pageTitle: state.pageTitle,
        pageUrl: state.pageUrl || normalizePageUrl(window.location.href),
        pageType: state.items.length > 1 ? 'series' : 'movie',
        targetDirectory,
        seasonDirectory: state.useSeasonSubdir ? { ...state.seasonDirMap } : null,
        completion: state.completion || null,
        seasonCompletion: state.seasonCompletion || {},
        seasonEntries: Array.isArray(state.seasonEntries) ? state.seasonEntries : [],
        poster:
          state.poster && state.poster.src
            ? { src: state.poster.src, alt: state.poster.alt || '' }
            : null,
      },
    }

    pushLog(`向后台发送 ${selectedItems.length} 条转存请求`, {
      stage: 'dispatch',
    })

    const response = await chrome.runtime.sendMessage({
      type: 'chaospace:transfer',
      payload,
    })

    if (!response) {
      throw new Error('未收到后台响应')
    }
    if (!response.ok) {
      throw new Error(response.error || '后台执行失败')
    }

    const { results, summary } = response
    const success = results.filter((r) => r.status === 'success').length
    const failed = results.filter((r) => r.status === 'failed').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    const emoji = failed === 0 ? '🎯' : success > 0 ? '🟡' : '💥'
    const title = failed === 0 ? '转存成功' : success > 0 ? '部分成功' : '全部失败'

    state.lastResult = {
      title: `${emoji} ${title}`,
      detail: `成功 ${success} · 跳过 ${skipped} · 失败 ${failed}`,
    }

    pushLog(`后台执行完成：${summary}`, {
      stage: 'complete',
      level: failed === 0 ? 'success' : 'warning',
    })

    setStatus(failed === 0 ? 'success' : 'error', `${title}：${summary}`)

    await loadHistory()

    showToast(
      failed === 0 ? 'success' : success > 0 ? 'warning' : 'error',
      `${emoji} ${title}`,
      `已保存到 ${targetDirectory}`,
      { success, failed, skipped },
    )
  } catch (error) {
    console.error('[Chaospace Transfer] Transfer error', error)
    pushLog(error.message || '后台执行发生未知错误', { level: 'error', stage: 'error' })
    setStatus('error', `转存失败：${error.message || '未知错误'}`)
    showToast('error', '转存失败', error.message || '发生未知错误')
  } finally {
    if (state.transferStatus === 'running') {
      setStatus('idle', '准备就绪 ✨')
    }
    updateTransferButton()
    setPanelControlsDisabled(false)
    state.jobId = null
  }
}

async function createFloatingPanel() {
  if (floatingPanel || panelCreationInProgress) {
    return Boolean(floatingPanel)
  }
  panelCreationInProgress = true
  resetSeasonLoader()
  let panelCreated = false

  try {
    await loadSettings()
    await loadHistory({ silent: true })
    applyPanelTheme()

    state.deferredSeasonInfos = []
    state.isSeasonLoading = false
    state.seasonLoadProgress = { total: 0, loaded: 0 }
    state.itemIdSet = new Set()
    state.seasonEntries = []
    state.historySeasonExpanded = new Set()

    const data = await analyzePage({
      deferTvSeasons: true,
      initialSeasonBatchSize: TV_SHOW_INITIAL_SEASON_BATCH,
    })
    const hasItems = Array.isArray(data.items) && data.items.length > 0
    const deferredSeasons = Array.isArray(data.deferredSeasons)
      ? data.deferredSeasons.map((info) => {
          const normalizedLabel =
            sanitizeSeasonDirSegment(info.label || '') ||
            (typeof info.label === 'string' && info.label.trim()) ||
            (Number.isFinite(info.index) ? `第${info.index + 1}季` : '')
          return {
            ...info,
            label: normalizedLabel,
          }
        })
      : []
    if (!hasItems && deferredSeasons.length === 0) {
      return false
    }

    state.pageTitle = data.title || ''
    state.pageUrl = normalizePageUrl(data.url || window.location.href)
    state.poster = data.poster || null
    state.origin = data.origin || window.location.origin
    state.completion = data.completion || null
    state.seasonCompletion =
      data.seasonCompletion && typeof data.seasonCompletion === 'object'
        ? { ...data.seasonCompletion }
        : {}
    state.seasonEntries = Array.isArray(data.seasonEntries)
      ? data.seasonEntries.map((entry) => {
          const normalizedLabel =
            sanitizeSeasonDirSegment(entry.label || '') ||
            (typeof entry.label === 'string' && entry.label.trim()) ||
            (Number.isFinite(entry.seasonIndex) ? `第${entry.seasonIndex + 1}季` : '')
          return {
            seasonId: entry.seasonId || entry.id || '',
            label: normalizedLabel,
            url: entry.url || '',
            seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : 0,
            completion: entry.completion || null,
            poster: entry.poster || null,
            loaded: Boolean(entry.loaded),
            hasItems: Boolean(entry.hasItems),
          }
        })
      : []
    state.classification = data.classification || 'unknown'
    state.classificationDetails = data.classificationDetail || null
    state.autoSuggestedDir = suggestDirectoryFromClassification(
      state.classificationDetails || state.classification,
    )
    applyAutoBaseDir(state.classificationDetails || state.classification)
    state.items = (Array.isArray(data.items) ? data.items : []).map((item, index) => {
      const normalizedLabel =
        sanitizeSeasonDirSegment(item.seasonLabel || '') ||
        (typeof item.seasonLabel === 'string' && item.seasonLabel.trim()) ||
        (Number.isFinite(item.seasonIndex) ? `第${item.seasonIndex + 1}季` : '')
      const nextItem = {
        ...item,
        order: typeof item.order === 'number' ? item.order : index,
      }
      if (normalizedLabel) {
        nextItem.seasonLabel = normalizedLabel
      } else if ('seasonLabel' in nextItem) {
        delete nextItem.seasonLabel
      }
      return nextItem
    })
    state.itemIdSet = new Set(state.items.map((item) => item.id))
    state.selectedIds = new Set(state.items.map((item) => item.id))
    rebuildSeasonDirMap({ preserveExisting: false })
    ensureSeasonSubdirDefault()
    updateSeasonExampleDir()
    state.deferredSeasonInfos = deferredSeasons
    const declaredTotal = Number.isFinite(data.totalSeasons) ? Math.max(0, data.totalSeasons) : 0
    const declaredLoaded = Number.isFinite(data.loadedSeasons) ? Math.max(0, data.loadedSeasons) : 0
    let totalSeasons = declaredTotal
    if (!totalSeasons && (declaredLoaded || deferredSeasons.length)) {
      totalSeasons = declaredLoaded + deferredSeasons.length
    }
    let loadedSeasons = declaredLoaded
    if (!loadedSeasons && totalSeasons) {
      loadedSeasons = Math.max(0, totalSeasons - deferredSeasons.length)
    }
    if (loadedSeasons > totalSeasons) {
      loadedSeasons = totalSeasons
    }
    state.seasonLoadProgress = {
      total: totalSeasons,
      loaded: loadedSeasons,
    }
    state.isSeasonLoading = state.deferredSeasonInfos.length > 0
    state.lastResult = null
    state.transferStatus = 'idle'
    state.statusMessage = '准备就绪 ✨'
    resetLogs()
    applyHistoryToCurrentPage()
    state.activeSeasonId = null

    const originLabel = formatOriginLabel(state.origin)

    const panelShell = await mountPanelShell({
      document,
      window,
      panelDom,
      panelState,
      pageTitle: state.pageTitle,
      originLabel,
      theme: state.theme,
      handleDocumentPointerDown,
      constants: {
        EDGE_HIDE_DELAY,
        EDGE_HIDE_DEFAULT_PEEK,
        EDGE_HIDE_MIN_PEEK,
        EDGE_HIDE_MAX_PEEK,
      },
      storageKeys: {
        POSITION_KEY,
        SIZE_KEY,
      },
    })

    floatingPanel = panelShell.panel
    panelShellRef = panelShell

    const {
      applyPanelSize,
      applyPanelPosition,
      getPanelBounds,
      syncPanelLayout,
      scheduleEdgeHide,
      cancelEdgeHide,
      applyEdgeHiddenPosition,
    } = panelShell

    let lastKnownPosition = panelState.lastKnownPosition

    panelCreated = true

    renderHistoryDetail()

    const handleResetLayout = async () => {
      try {
        await safeStorageRemove([POSITION_KEY, SIZE_KEY], 'panel geometry reset')
        const bounds = getPanelBounds()
        const defaultWidth = Math.min(640, bounds.maxWidth)
        const defaultHeight = Math.min(520, bounds.maxHeight)
        applyPanelSize(defaultWidth, defaultHeight)
        const defaultPosition = applyPanelPosition(undefined, undefined)
        lastKnownPosition = defaultPosition
        panelState.lastKnownPosition = defaultPosition
        panelState.edgeState.isHidden = false
        applyEdgeHiddenPosition()
        cancelEdgeHide({ show: true })
        showToast('success', '布局已重置', '面板大小与位置已恢复默认值')
      } catch (error) {
        console.error('[Chaospace Transfer] Failed to reset layout', error)
        showToast('error', '重置失败', error.message || '无法重置面板布局')
      }
    }

    settingsModalRef = createSettingsModal({
      document,
      floatingPanel,
      panelState,
      scheduleEdgeHide,
      cancelEdgeHide,
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
      onResetLayout: handleResetLayout,
    })

    panelDom.openSettingsPanel = () => {
      settingsModalRef?.open()
    }
    panelDom.closeSettingsPanel = (options = {}) => {
      settingsModalRef?.close(options)
    }

    updatePinButton()

    if (panelDom.historyTabs) {
      panelDom.historyTabs.querySelectorAll('[data-filter]').forEach((button) => {
        const value = button.dataset.filter || 'all'
        button.classList.toggle('is-active', value === state.historyFilter)
      })
    }

    if (panelDom.pinBtn) {
      panelDom.pinBtn.addEventListener('click', (event) => {
        const nextPinnedState = !panelState.isPinned
        panelState.isPinned = nextPinnedState
        updatePinButton()
        if (nextPinnedState) {
          cancelEdgeHide({ show: true })
        } else {
          const isPointerLikeActivation =
            (typeof event?.detail === 'number' && event.detail > 0) ||
            (typeof event?.clientX === 'number' &&
              typeof event?.clientY === 'number' &&
              (event.clientX !== 0 || event.clientY !== 0))
          if (isPointerLikeActivation && typeof panelDom.pinBtn.blur === 'function') {
            panelDom.pinBtn.blur()
          }
          if (!panelState.pointerInside) {
            scheduleEdgeHide()
          }
        }
      })
    }

    if (panelDom.headerPoster) {
      panelDom.headerPoster.addEventListener('click', () => {
        const src = panelDom.headerPoster.dataset.src
        if (src) {
          window.openZoomPreview({
            src,
            alt:
              panelDom.headerPoster.dataset.alt ||
              panelDom.headerPoster.alt ||
              state.pageTitle ||
              '',
          })
        }
      })
    }

    updatePanelHeader()

    applyPanelTheme()

    if (panelDom.baseDirInput) {
      panelDom.baseDirInput.value = state.baseDir
      panelDom.baseDirInput.addEventListener('change', () => {
        setBaseDir(panelDom.baseDirInput.value)
      })
      panelDom.baseDirInput.addEventListener('input', () => {
        panelDom.baseDirInput.dataset.dirty = 'true'
        panelDom.baseDirInput.classList.remove('is-invalid')
        state.baseDir = normalizeDir(panelDom.baseDirInput.value)
        renderPathPreview()
      })
      panelDom.baseDirInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          setBaseDir(panelDom.baseDirInput.value)
          ensurePreset(panelDom.baseDirInput.value)
          renderPresets()
        }
      })
    }

    if (panelDom.useTitleCheckbox) {
      panelDom.useTitleCheckbox.checked = state.useTitleSubdir
      panelDom.useTitleCheckbox.addEventListener('change', () => {
        state.useTitleSubdir = panelDom.useTitleCheckbox.checked
        saveSettings()
        renderPathPreview()
      })
    }

    if (panelDom.useSeasonCheckbox) {
      panelDom.useSeasonCheckbox.checked = state.useSeasonSubdir
      panelDom.useSeasonCheckbox.addEventListener('change', () => {
        state.useSeasonSubdir = panelDom.useSeasonCheckbox.checked
        state.hasSeasonSubdirPreference = true
        dedupeSeasonDirMap()
        updateSeasonExampleDir()
        renderPathPreview()
        renderResourceList()
        saveSettings()
      })
    }

    if (panelDom.addPresetButton) {
      panelDom.addPresetButton.addEventListener('click', () => {
        const preset = ensurePreset(
          panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir,
        )
        if (preset) {
          setBaseDir(preset, { fromPreset: true })
          showToast('success', '已收藏路径', `${preset} 已加入候选列表`)
        }
      })
    }

    if (panelDom.themeToggle) {
      panelDom.themeToggle.addEventListener('click', () => {
        const nextTheme = state.theme === 'dark' ? 'light' : 'dark'
        setTheme(nextTheme)
      })
    }

    if (panelDom.historySummaryBody) {
      const toggleHistoryFromSummary = () => {
        if (!state.historyRecords.length) {
          return
        }
        toggleHistoryExpanded()
      }

      panelDom.historySummaryBody.addEventListener('click', (event) => {
        const summaryEntry = event.target.closest('[data-role="history-summary-entry"]')
        if (!summaryEntry) {
          return
        }
        if (event.target.closest('[data-role="history-toggle"]')) {
          return
        }
        toggleHistoryFromSummary()
      })

      panelDom.historySummaryBody.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        const summaryEntry = event.target.closest('[data-role="history-summary-entry"]')
        if (!summaryEntry) {
          return
        }
        if (event.target.closest('[data-role="history-toggle"]')) {
          return
        }
        event.preventDefault()
        toggleHistoryFromSummary()
      })
    }

    if (panelDom.presetList) {
      panelDom.presetList.addEventListener('click', (event) => {
        if (state.transferStatus === 'running') {
          return
        }
        const target = event.target.closest('button[data-action][data-value]')
        if (!target) return
        const { action, value } = target.dataset
        if (action === 'select') {
          setBaseDir(value, { fromPreset: true })
        } else if (action === 'remove') {
          removePreset(value)
        }
      })
    }

    if (panelDom.itemsContainer) {
      panelDom.itemsContainer.addEventListener('change', (event) => {
        const checkbox = event.target.closest('.chaospace-item-checkbox')
        if (!checkbox) return
        const row = checkbox.closest('.chaospace-item')
        const id = row?.dataset.id
        if (!id) return
        if (checkbox.checked) {
          state.selectedIds.add(id)
        } else {
          state.selectedIds.delete(id)
        }
        row.classList.toggle('is-muted', !checkbox.checked)
        renderResourceSummary()
        updateTransferButton()
      })
    }

    if (panelDom.seasonTabs) {
      panelDom.seasonTabs.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-season-id]')
        if (!button || button.disabled) {
          return
        }
        const nextId = button.dataset.seasonId
        if (!nextId || nextId === state.activeSeasonId) {
          return
        }
        state.activeSeasonId = nextId
        renderResourceList()
        if (panelDom.itemsContainer) {
          panelDom.itemsContainer.scrollTop = 0
        }
      })
    }

    const toolbar = floatingPanel?.querySelector('.chaospace-select-group')
    if (toolbar) {
      toolbar.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]')
        if (!button) return
        const action = button.dataset.action
        if (action === 'select-all') {
          setSelectionAll(true)
        } else if (action === 'select-invert') {
          invertSelection()
        } else if (action === 'select-new') {
          selectNewItems()
        }
      })
    }

    if (panelDom.historyTabs) {
      panelDom.historyTabs.addEventListener('click', (event) => {
        const tab = event.target.closest('.chaospace-history-tab[data-filter]')
        if (!tab) return
        if (tab.classList.contains('is-active')) {
          return
        }
        const filter = tab.dataset.filter || 'all'
        setHistoryFilter(filter)
      })
    }

    if (panelDom.historySelectAll) {
      panelDom.historySelectAll.addEventListener('change', (event) => {
        if (state.historyBatchRunning) {
          event.preventDefault()
          updateHistorySelectionSummary()
          return
        }
        setHistorySelectAll(Boolean(event.target.checked))
      })
    }

    if (panelDom.historyBatchCheck) {
      panelDom.historyBatchCheck.addEventListener('click', () => {
        handleHistoryBatchCheck()
      })
    }

    if (panelDom.historyDeleteSelected) {
      panelDom.historyDeleteSelected.addEventListener('click', () => {
        handleHistoryDeleteSelected()
      })
    }

    if (panelDom.historyClear) {
      panelDom.historyClear.addEventListener('click', () => {
        handleHistoryClear()
      })
    }

    if (panelDom.historyList) {
      panelDom.historyList.addEventListener('click', (event) => {
        const seasonToggle = event.target.closest('[data-role="history-season-toggle"]')
        if (seasonToggle) {
          const groupKey = seasonToggle.dataset.groupKey
          if (!groupKey) {
            return
          }
          const expanded = state.historySeasonExpanded.has(groupKey)
          if (expanded) {
            state.historySeasonExpanded.delete(groupKey)
          } else {
            state.historySeasonExpanded.add(groupKey)
          }
          const isExpanded = state.historySeasonExpanded.has(groupKey)
          seasonToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false')
          seasonToggle.textContent = isExpanded ? '收起季' : '展开季'
          const container = seasonToggle.closest('.chaospace-history-item')
          const list = container
            ? container.querySelector('[data-role="history-season-list"]')
            : null
          if (list) {
            list.hidden = !isExpanded
          }
          if (container) {
            container.classList.toggle('is-season-expanded', isExpanded)
          }
          event.preventDefault()
          return
        }

        const actionButton = event.target.closest('button[data-action]')
        if (actionButton) {
          const action = actionButton.dataset.action
          if (action === 'preview-poster') {
            if (!actionButton.disabled) {
              const src = actionButton.dataset.src
              if (src) {
                window.openZoomPreview({
                  src,
                  alt: actionButton.dataset.alt || actionButton.getAttribute('aria-label') || '',
                })
              }
            }
            return
          }

          if (actionButton.disabled) {
            return
          }

          const url = actionButton.dataset.url
          if (action === 'open') {
            if (url) {
              window.open(url, '_blank', 'noopener')
            }
          } else if (action === 'open-pan') {
            const panUrl = actionButton.dataset.url || buildPanDirectoryUrl('/')
            window.open(panUrl, '_blank', 'noopener')
          } else if (action === 'check') {
            if (url) {
              triggerHistoryUpdate(url, actionButton)
            }
          }
          return
        }

        const seasonRow = event.target.closest(
          '.chaospace-history-season-item[data-detail-trigger="season"]',
        )
        if (
          seasonRow &&
          !event.target.closest('.chaospace-history-actions') &&
          !event.target.closest('button') &&
          !event.target.closest('input')
        ) {
          const groupKey = seasonRow.dataset.groupKey
          if (groupKey) {
            const pageUrl = seasonRow.dataset.pageUrl || ''
            const title = seasonRow.dataset.title || ''
            const posterSrc = seasonRow.dataset.posterSrc || ''
            const posterAlt = seasonRow.dataset.posterAlt || title
            const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null
            event.preventDefault()
            openHistoryDetail(groupKey, {
              pageUrl,
              title,
              poster,
            })
          }
          return
        }

        const detailTrigger = event.target.closest('[data-action="history-detail"]')
        if (detailTrigger) {
          const groupKey = detailTrigger.dataset.groupKey
          if (groupKey) {
            event.preventDefault()
            openHistoryDetail(groupKey)
          }
          return
        }

        const historyItem = event.target.closest(
          '.chaospace-history-item[data-detail-trigger="group"]',
        )
        if (
          historyItem &&
          !event.target.closest('.chaospace-history-selector') &&
          !event.target.closest('.chaospace-history-actions') &&
          !event.target.closest('button') &&
          !event.target.closest('input') &&
          !event.target.closest('[data-role="history-season-toggle"]')
        ) {
          const groupKey = historyItem.dataset.groupKey
          if (groupKey) {
            openHistoryDetail(groupKey)
          }
          return
        }
      })
      panelDom.historyList.addEventListener('change', (event) => {
        const checkbox = event.target.closest(
          'input[type="checkbox"][data-role="history-select-item"]',
        )
        if (!checkbox) return
        const groupKey = checkbox.dataset.groupKey
        if (!groupKey) return
        setHistorySelection(groupKey, checkbox.checked)
      })
      panelDom.historyList.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        if (event.target.closest('button') || event.target.closest('input')) {
          return
        }
        const seasonRow = event.target.closest(
          '.chaospace-history-season-item[data-detail-trigger="season"]',
        )
        if (seasonRow && seasonRow === event.target.closest('.chaospace-history-season-item')) {
          const groupKey = seasonRow.dataset.groupKey
          if (groupKey) {
            const pageUrl = seasonRow.dataset.pageUrl || ''
            const title = seasonRow.dataset.title || ''
            const posterSrc = seasonRow.dataset.posterSrc || ''
            const posterAlt = seasonRow.dataset.posterAlt || title
            const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null
            event.preventDefault()
            openHistoryDetail(groupKey, {
              pageUrl,
              title,
              poster,
            })
          }
          return
        }

        const detailTrigger = event.target.closest('[data-action="history-detail"]')
        if (detailTrigger) {
          const groupKey = detailTrigger.dataset.groupKey
          if (groupKey) {
            event.preventDefault()
            openHistoryDetail(groupKey)
          }
          return
        }

        const historyItem = event.target.closest(
          '.chaospace-history-item[data-detail-trigger="group"]',
        )
        if (historyItem && historyItem === event.target.closest('.chaospace-history-item')) {
          const groupKey = historyItem.dataset.groupKey
          if (!groupKey) {
            return
          }
          event.preventDefault()
          openHistoryDetail(groupKey)
          return
        }
      })
    }

    if (floatingPanel) {
      floatingPanel.addEventListener('click', (event) => {
        const toggleBtn = event.target.closest('[data-role="history-toggle"]')
        if (!toggleBtn || !floatingPanel.contains(toggleBtn)) {
          return
        }
        if (!state.historyGroups.length) {
          return
        }
        toggleHistoryExpanded()
      })
    }

    if (panelDom.sortKeySelect) {
      panelDom.sortKeySelect.value = state.sortKey
      panelDom.sortKeySelect.addEventListener('change', () => {
        state.sortKey = panelDom.sortKeySelect.value
        renderResourceList()
      })
    }

    if (panelDom.sortOrderButton) {
      const refreshOrderButton = () => {
        panelDom.sortOrderButton.textContent = state.sortOrder === 'asc' ? '正序' : '倒序'
      }
      refreshOrderButton()
      panelDom.sortOrderButton.addEventListener('click', () => {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
        refreshOrderButton()
        renderResourceList()
      })
    }

    if (panelDom.transferBtn) {
      panelDom.transferBtn.addEventListener('click', handleTransfer)
    }

    renderPresets()
    renderPathPreview()
    applyHistoryToCurrentPage()
    renderHistoryCard()
    updateHistoryExpansion()
    renderResourceList()
    setStatus('idle', state.statusMessage)
    renderLogs()
    updateTransferButton()
    if (!panelState.isPinned) {
      scheduleEdgeHide(EDGE_HIDE_DELAY)
    }
    if (state.deferredSeasonInfos.length) {
      ensureDeferredSeasonLoading().catch((error) => {
        console.error('[Chaospace Transfer] Failed to schedule deferred season loading:', error)
      })
    }
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to create floating panel:', error)
    showToast('error', '创建面板失败', error.message)
  } finally {
    panelCreationInProgress = false
  }
  return panelCreated
}

function injectStyles() {
  if (document.getElementById('chaospace-float-styles')) {
    return
  }

  try {
    const link = document.createElement('link')
    link.id = 'chaospace-float-styles'
    link.rel = 'stylesheet'
    link.href = chrome.runtime.getURL('content/styles/main.css')

    if (document.head) {
      document.head.appendChild(link)
    }
  } catch (error) {
    console.error('[Chaospace] Failed to inject styles:', error)
  }
}

function isTvShowPage() {
  return /\/tvshows\/\d+\.html/.test(window.location.pathname)
}

function isSeasonPage() {
  return /\/seasons\/\d+\.html/.test(window.location.pathname)
}

function scheduleInitialPanelCreation() {
  let attempts = 0
  const tryCreate = async () => {
    if (floatingPanel || panelCreationInProgress) {
      return
    }
    attempts += 1
    const created = await createFloatingPanel()
    if (created || floatingPanel) {
      return
    }
    if (attempts < PANEL_CREATION_MAX_ATTEMPTS) {
      window.setTimeout(tryCreate, PANEL_CREATION_RETRY_DELAY_MS)
    }
  }

  const kickoff = () => {
    if (INITIAL_PANEL_DELAY_MS <= 0) {
      tryCreate()
    } else {
      window.setTimeout(tryCreate, INITIAL_PANEL_DELAY_MS)
    }
  }

  kickoff()
}

function init() {
  if (!isSupportedDetailPage()) {
    return
  }

  try {
    injectStyles()

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        scheduleInitialPanelCreation()
      })
    } else {
      scheduleInitialPanelCreation()
    }

    // 监听 DOM 变化,如果窗口被移除且有资源则重新创建
    let observerTimeout = null
    const observer = new MutationObserver(() => {
      if (observerTimeout) {
        clearTimeout(observerTimeout)
      }

      observerTimeout = setTimeout(async () => {
        try {
          if (!floatingPanel && !panelCreationInProgress) {
            const data = await analyzePage()
            if (data.items && data.items.length > 0) {
              await createFloatingPanel()
            }
          }
        } catch (error) {
          console.error('[Chaospace Transfer] Observer error:', error)
        }
      }, 1000)
    })

    const targetNode = document.body
    if (targetNode) {
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
      })
    }
  } catch (error) {
    console.error('[Chaospace] Init error:', error)
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return
  }
  const settingsChange = changes[STORAGE_KEY]
  if (settingsChange?.newValue) {
    const nextTheme = settingsChange.newValue.theme
    if ((nextTheme === 'light' || nextTheme === 'dark') && nextTheme !== state.theme) {
      state.theme = nextTheme
      applyPanelTheme()
    }
    if (typeof settingsChange.newValue.historyRateLimitMs === 'number') {
      const nextRate = clampHistoryRateLimit(settingsChange.newValue.historyRateLimitMs)
      if (nextRate !== state.historyRateLimitMs) {
        state.historyRateLimitMs = nextRate
        if (state.settingsPanel.isOpen) {
          settingsModalRef?.render()
        }
      }
    }
  }
  const historyChange = changes[HISTORY_KEY]
  if (historyChange) {
    const prepared = prepareHistoryRecords(historyChange.newValue)
    state.historyRecords = prepared.records
    state.historyGroups = prepared.groups
    applyHistoryToCurrentPage()
    renderHistoryCard()
    if (floatingPanel) {
      renderResourceList()
    }
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'chaospace:collect-links') {
    analyzePage()
      .then((result) => {
        sendResponse(result)
      })
      .catch((error) => {
        console.error('[Chaospace Transfer] Message handler error:', error)
        sendResponse({ items: [], url: '', origin: '', title: '', poster: null })
      })
    return true
  }

  if (message?.type === 'chaospace:transfer-progress') {
    handleProgressEvent(message)
  }

  return false
})

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
