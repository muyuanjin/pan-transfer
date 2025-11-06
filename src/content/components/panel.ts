import { createApp, effectScope } from 'vue'
import PanelRoot from './PanelRoot.vue'
import { disableElementDrag } from '../utils/dom'
import { safeStorageGet, safeStorageSet } from '../utils/storage'
import { pinia } from '../state'
import type {
  PanelRuntimeState,
  PanelDomRefs,
  PanelBounds,
  PanelSizeSnapshot,
  PanelPositionSnapshot,
} from '../types'
import { useDraggable, useEventListener } from '@vueuse/core'

const PANEL_MARGIN = 16
const PANEL_MIN_WIDTH = 360
const PANEL_MIN_HEIGHT = 380

interface PanelShellConstants {
  EDGE_HIDE_DELAY: number
  EDGE_HIDE_DEFAULT_PEEK: number
  EDGE_HIDE_MIN_PEEK: number
  EDGE_HIDE_MAX_PEEK: number
}

interface PanelStorageKeys {
  POSITION_KEY: string
  SIZE_KEY: string
}

export interface MountPanelShellOptions {
  document: Document
  window: Window
  panelDom: PanelDomRefs
  panelState: PanelRuntimeState
  pageTitle: string
  originLabel: string
  theme: string
  handleDocumentPointerDown: (event: PointerEvent) => void
  constants: PanelShellConstants
  storageKeys: PanelStorageKeys
}

export interface MountedPanelShell {
  panel: HTMLElement
  applyPanelSize: (width?: number, height?: number) => { width: number; height: number } | null
  applyPanelPosition: (left?: number, top?: number) => { left: number; top: number }
  getPanelBounds: () => PanelBounds
  syncPanelLayout: () => void
  lastKnownPosition: { left: number; top: number }
  scheduleEdgeHide: (delay?: number) => void
  cancelEdgeHide: (options?: { show?: boolean }) => void
  isPointerLikelyInsidePanel: () => boolean
  updatePointerPosition: (event?: PointerEvent) => void
  applyEdgeHiddenPosition: () => void
  destroy: () => void
}

type StoredPanelSizeSnapshot = Partial<PanelSizeSnapshot>
type StoredPanelPositionSnapshot = Partial<PanelPositionSnapshot>

type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    platform?: string
  }
}

function applyFontRenderingHints(target: HTMLElement, win: Window): void {
  const navigatorWithUAData = win.navigator as NavigatorWithUAData
  const sources = [
    navigatorWithUAData.userAgentData?.platform,
    navigatorWithUAData.platform,
    navigatorWithUAData.userAgent,
  ]
  const platform = sources.filter(Boolean).join(' ').toLowerCase()
  const devicePixelRatio = Number.isFinite(win.devicePixelRatio) ? win.devicePixelRatio : 1

  if (devicePixelRatio >= 1.25) {
    target.classList.add('chaospace-font-hidpi')
  }

  if (/mac|iphone|ipad|ipod/.test(platform)) {
    target.classList.add('chaospace-font-mac')
    if (devicePixelRatio >= 1.5) {
      target.classList.add('chaospace-font-mac-hidpi')
    }
    return
  }

  if (/win/.test(platform)) {
    target.classList.add('chaospace-font-windows')
    if (devicePixelRatio >= 1.2) {
      target.classList.add('chaospace-font-windows-hidpi')
    }
    return
  }

  if (/android|cros|linux/.test(platform) && devicePixelRatio >= 1.5) {
    target.classList.add('chaospace-font-retina')
  }
}

export async function mountPanelShell(options: MountPanelShellOptions): Promise<MountedPanelShell> {
  const {
    document,
    window,
    panelDom,
    panelState,
    pageTitle,
    originLabel,
    theme,
    handleDocumentPointerDown,
    constants,
    storageKeys,
  } = options

  const { EDGE_HIDE_DELAY, EDGE_HIDE_DEFAULT_PEEK, EDGE_HIDE_MIN_PEEK, EDGE_HIDE_MAX_PEEK } =
    constants
  const { POSITION_KEY, SIZE_KEY } = storageKeys

  const host = document.createElement('div')
  host.className = 'chaospace-panel-host'
  document.body.appendChild(host)

  const vueApp = createApp(PanelRoot, {
    pageTitle,
    originLabel,
    theme,
  })
  vueApp.use(pinia)
  vueApp.mount(host)

  const panel = host.querySelector<HTMLElement>('.chaospace-float-panel')
  if (!panel) {
    vueApp.unmount()
    host.remove()
    throw new Error('[Chaospace Transfer] Failed to mount floating panel')
  }
  applyFontRenderingHints(panel, window)

  const handlePanelIntroEnd = (event: AnimationEvent) => {
    if (event.animationName === 'chaospace-panel-in') {
      panel.classList.add('is-mounted')
      panel.removeEventListener('animationend', handlePanelIntroEnd)
    }
  }
  panel.addEventListener('animationend', handlePanelIntroEnd)

  const shouldEdgeHideOnMount = true
  panelState.edgeState = {
    isHidden: shouldEdgeHideOnMount,
    side: 'right',
    peek: EDGE_HIDE_DEFAULT_PEEK,
  }
  const emitEdgeStateChange = () => {
    if (typeof panelState.edgeStateChange !== 'function' || !panelState.edgeState) {
      return
    }
    panelState.edgeStateChange({
      isHidden: panelState.edgeState.isHidden,
      side: panelState.edgeState.side,
      peek: panelState.edgeState.peek,
    })
  }
  emitEdgeStateChange()
  panelState.pointerInside = false
  panelState.lastPointerPosition = { x: Number.NaN, y: Number.NaN }
  panelState.isPinned = false
  if (panelState.hideTimer) {
    window.clearTimeout(panelState.hideTimer)
    panelState.hideTimer = null
  }
  if (panelState.edgeAnimationTimer) {
    window.clearTimeout(panelState.edgeAnimationTimer)
    panelState.edgeAnimationTimer = null
  }
  if (panelState.edgeTransitionUnbind) {
    panelState.edgeTransitionUnbind()
    panelState.edgeTransitionUnbind = null
  }
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max)

  let lastKnownPosition = { left: PANEL_MARGIN, top: PANEL_MARGIN }
  let isDragging = false
  let isResizing = false
  let resizeStartX = 0
  let resizeStartY = 0
  let resizeStartWidth = 0
  let resizeStartHeight = 0
  let resizeAnchorRight = 0
  const dragScope = effectScope()
  let draggableState: ReturnType<typeof useDraggable> | null = null
  let stopDocumentPointerDown: (() => void) | null = null

  panel.style.transition = 'none'
  if (!panelState.documentPointerDownBound) {
    stopDocumentPointerDown = useEventListener(document, 'pointerdown', handleDocumentPointerDown, {
      capture: true,
    })
    panelState.documentPointerDownBound = true
  }

  const updatePointerPosition = (event?: PointerEvent) => {
    if (!event) {
      return
    }
    panelState.lastPointerPosition.x = event.clientX
    panelState.lastPointerPosition.y = event.clientY
  }

  const isPointerLikelyInsidePanel = (): boolean => {
    if (!panel || !panel.isConnected) {
      return false
    }
    const { x, y } = panelState.lastPointerPosition
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false
    }
    const hoveredElement = document.elementFromPoint(x, y)
    if (hoveredElement instanceof HTMLElement && panel.contains(hoveredElement)) {
      return true
    }
    const rect = panel.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  const computeEdgePeek = (): number => {
    const width = panel.offsetWidth || PANEL_MIN_WIDTH
    const derived = Math.round(width * 0.18)
    const normalized = Number.isFinite(derived) ? derived : EDGE_HIDE_DEFAULT_PEEK
    const viewportWidth = Math.max(window.innerWidth || 0, 0)
    const baseMax = Math.max(16, viewportWidth - 8)
    const dynamicMax = Math.max(16, Math.min(EDGE_HIDE_MAX_PEEK, baseMax))
    const dynamicMin = Math.min(EDGE_HIDE_MIN_PEEK, dynamicMax)
    return Math.max(dynamicMin, Math.min(dynamicMax, normalized))
  }

  const determineDockSide = (): 'left' | 'right' => {
    const panelCenter = lastKnownPosition.left + panel.offsetWidth / 2
    const viewportCenter = window.innerWidth / 2
    return panelCenter < viewportCenter ? 'left' : 'right'
  }

  const syncDraggablePosition = (position: { left: number; top: number }): void => {
    if (!draggableState || !draggableState.x || !draggableState.y) {
      return
    }
    if (draggableState.x.value !== position.left) {
      draggableState.x.value = position.left
    }
    if (draggableState.y.value !== position.top) {
      draggableState.y.value = position.top
    }
  }

  const getPanelBounds = (): PanelBounds => {
    const availableWidth = window.innerWidth - PANEL_MARGIN * 2
    const availableHeight = window.innerHeight - PANEL_MARGIN * 2
    const maxWidth = Math.max(PANEL_MIN_WIDTH, availableWidth)
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, availableHeight)
    return {
      minWidth: PANEL_MIN_WIDTH,
      minHeight: PANEL_MIN_HEIGHT,
      maxWidth,
      maxHeight,
    }
  }

  const syncPanelLayout = (): void => {
    const width = panel.offsetWidth
    panel.classList.toggle('is-narrow', width < 620)
    panel.classList.toggle('is-compact', width < 520)
  }

  const applyEdgeHiddenPosition = (): void => {
    if (!panelState.edgeState) {
      panelState.edgeState = { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK }
    }
    const shouldHide = panelState.edgeState.isHidden && !panelState.isPinned
    panel.classList.toggle('is-edge-left', panelState.edgeState.side === 'left')
    panel.classList.toggle('is-edge-right', panelState.edgeState.side === 'right')
    if (!shouldHide) {
      panelState.edgeState.isHidden = false
      panel.classList.remove('is-edge-hidden')
      panel.classList.remove('is-leaving')
      panel.style.left = `${lastKnownPosition.left}px`
      panel.style.top = `${lastKnownPosition.top}px`
      panel.style.right = 'auto'
      panel.style.removeProperty('--chaospace-edge-peek')
      emitEdgeStateChange()
      return
    }

    const peek = computeEdgePeek()
    panelState.edgeState.peek = peek
    panel.style.setProperty('--chaospace-edge-peek', `${peek}px`)

    const panelHeight = panel.offsetHeight
    const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN)
    const safeTop = clamp(lastKnownPosition.top, PANEL_MARGIN, maxTop)
    lastKnownPosition.top = safeTop
    panel.style.top = `${safeTop}px`

    const targetLeft =
      panelState.edgeState.side === 'left' ? -(panel.offsetWidth - peek) : window.innerWidth - peek
    panel.style.left = `${targetLeft}px`
    panel.style.right = 'auto'
    panel.classList.remove('is-hovering')
    panel.classList.add('is-edge-hidden')
    emitEdgeStateChange()
  }

  const beginEdgeAnimation = (): void => {
    if (panelState.edgeTransitionUnbind) {
      panelState.edgeTransitionUnbind()
      panelState.edgeTransitionUnbind = null
    }
    panel.classList.add('is-edge-animating')
    if (panelState.edgeAnimationTimer) {
      window.clearTimeout(panelState.edgeAnimationTimer)
      panelState.edgeAnimationTimer = null
    }
    const cleanup = () => {
      panel.classList.remove('is-edge-animating')
      panel.removeEventListener('transitionend', handleTransitionEnd)
      if (panelState.edgeAnimationTimer) {
        window.clearTimeout(panelState.edgeAnimationTimer)
        panelState.edgeAnimationTimer = null
      }
      panelState.edgeTransitionUnbind = null
    }
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== panel) {
        return
      }
      if (event.propertyName === 'left' || event.propertyName === 'transform') {
        cleanup()
      }
    }
    panel.addEventListener('transitionend', handleTransitionEnd)
    panelState.edgeAnimationTimer = window.setTimeout(() => {
      cleanup()
    }, 760)
    panelState.edgeTransitionUnbind = cleanup
  }

  const showPanelFromEdge = (): void => {
    if (!panelState.edgeState.isHidden) {
      return
    }
    panelState.edgeState.isHidden = false
    panel.classList.remove('is-leaving')
    beginEdgeAnimation()
    applyEdgeHiddenPosition()
    emitEdgeStateChange()
  }

  const hidePanelToEdge = (): void => {
    if (panelState.isPinned || isDragging || isResizing) {
      return
    }
    panel.classList.remove('is-hovering')
    panelState.edgeState.side = determineDockSide()
    panelState.edgeState.isHidden = true
    beginEdgeAnimation()
    applyEdgeHiddenPosition()
    panel.classList.remove('is-leaving')
    emitEdgeStateChange()
  }

  const scheduleEdgeHide = (delay = EDGE_HIDE_DELAY): void => {
    if (panelState.isPinned || isDragging || isResizing) {
      return
    }
    if (panelState.hideTimer) {
      window.clearTimeout(panelState.hideTimer)
    }
    panelState.hideTimer = window.setTimeout(
      () => {
        panelState.hideTimer = null
        const hasFocusWithin = panel.matches(':focus-within')
        if (!panelState.pointerInside && !hasFocusWithin) {
          hidePanelToEdge()
        }
      },
      Math.max(0, delay),
    )
  }

  const cancelEdgeHide = ({ show = false }: { show?: boolean } = {}): void => {
    if (panelState.hideTimer) {
      window.clearTimeout(panelState.hideTimer)
      panelState.hideTimer = null
    }
    panel.classList.remove('is-leaving')
    if (show) {
      showPanelFromEdge()
    }
  }

  panelState.scheduleEdgeHide = scheduleEdgeHide
  panelState.cancelEdgeHide = cancelEdgeHide
  panelState.applyEdgeHiddenPosition = applyEdgeHiddenPosition
  panelState.hidePanelToEdge = hidePanelToEdge
  panelState.showPanelFromEdge = showPanelFromEdge
  panelState.beginEdgeAnimation = beginEdgeAnimation

  const applyPanelSize = (
    width?: number,
    height?: number,
  ): { width: number; height: number } | null => {
    const bounds = getPanelBounds()
    const nextWidth = clamp(width ?? panel.offsetWidth, bounds.minWidth, bounds.maxWidth)
    const nextHeight = clamp(height ?? panel.offsetHeight, bounds.minHeight, bounds.maxHeight)
    panel.style.width = `${nextWidth}px`
    panel.style.height = `${nextHeight}px`
    panelState.lastKnownSize = { width: nextWidth, height: nextHeight }
    syncPanelLayout()
    panelState.edgeState.side = determineDockSide()
    applyEdgeHiddenPosition()
    emitEdgeStateChange()
    return panelState.lastKnownSize
  }

  const applyPanelPosition = (left?: number, top?: number): { left: number; top: number } => {
    const panelWidth = panel.offsetWidth
    const panelHeight = panel.offsetHeight
    const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - panelWidth - PANEL_MARGIN)
    const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN)
    const fallbackLeft = maxLeft
    const fallbackTop = PANEL_MARGIN
    const safeLeft = clamp(
      Number.isFinite(left ?? NaN) ? (left as number) : fallbackLeft,
      PANEL_MARGIN,
      maxLeft,
    )
    const safeTop = clamp(
      Number.isFinite(top ?? NaN) ? (top as number) : fallbackTop,
      PANEL_MARGIN,
      maxTop,
    )
    lastKnownPosition = { left: safeLeft, top: safeTop }
    panel.style.left = `${safeLeft}px`
    panel.style.top = `${safeTop}px`
    panel.style.right = 'auto'
    panelState.edgeState.side = determineDockSide()
    applyEdgeHiddenPosition()
    syncDraggablePosition(lastKnownPosition)
    emitEdgeStateChange()
    return lastKnownPosition
  }

  const savedState = await safeStorageGet<
    Record<string, StoredPanelSizeSnapshot | StoredPanelPositionSnapshot>
  >([POSITION_KEY, SIZE_KEY], 'panel geometry')
  const savedSize = savedState[SIZE_KEY] as StoredPanelSizeSnapshot | undefined
  if (savedSize && Number.isFinite(savedSize.width) && Number.isFinite(savedSize.height)) {
    applyPanelSize(savedSize.width, savedSize.height)
  } else {
    const bounds = getPanelBounds()
    const fallbackWidth = Math.min(640, bounds.maxWidth)
    const fallbackHeight = Math.min(520, bounds.maxHeight)
    applyPanelSize(fallbackWidth, fallbackHeight)
  }

  const savedPosition = savedState[POSITION_KEY] as StoredPanelPositionSnapshot | undefined
  lastKnownPosition = applyPanelPosition(savedPosition?.left, savedPosition?.top)
  panelState.lastKnownPosition = lastKnownPosition
  panelState.getPanelBounds = getPanelBounds

  if (shouldEdgeHideOnMount && !panelState.isPinned) {
    const dockSide = panelState.edgeState.side
    const peekForMount = Number.isFinite(panelState.edgeState.peek)
      ? panelState.edgeState.peek
      : computeEdgePeek()
    const offscreenBuffer = Math.max(24, peekForMount + 24)
    const offscreenLeft =
      dockSide === 'right'
        ? window.innerWidth + offscreenBuffer
        : -(panel.offsetWidth + offscreenBuffer)
    panelState.edgeState.peek = peekForMount
    panel.style.setProperty('--chaospace-edge-peek', `${peekForMount}px`)
    panel.style.left = `${offscreenLeft}px`
    panel.style.right = 'auto'
    panel.classList.remove('is-hovering')
    panel.classList.remove('is-leaving')
    panel.classList.add('is-edge-hidden')
    emitEdgeStateChange()
  }

  const finalizeInitialLayout = () => {
    panel.style.removeProperty('transition')
    if (shouldEdgeHideOnMount && !panelState.isPinned) {
      beginEdgeAnimation()
      applyEdgeHiddenPosition()
    } else if (shouldEdgeHideOnMount) {
      panelState.edgeState.isHidden = false
      applyEdgeHiddenPosition()
    }
    emitEdgeStateChange()
  }
  window.requestAnimationFrame(finalizeInitialLayout)

  panelDom.container = panel
  panelDom.header = panel.querySelector<HTMLElement>('.chaospace-float-header')
  panelDom.headerArt = panel.querySelector<HTMLElement>('[data-role="header-art"]')
  panelDom.headerPoster = panel.querySelector<HTMLImageElement>('[data-role="header-poster"]')
  if (panelDom.headerPoster) {
    disableElementDrag(panelDom.headerPoster)
  }
  panelDom.showTitle = panel.querySelector<HTMLElement>('[data-role="show-title"]')
  panelDom.showSubtitle = panel.querySelector<HTMLElement>('[data-role="show-subtitle"]')
  panelDom.baseDirInput = panel.querySelector<HTMLInputElement>('[data-role="base-dir"]')
  panelDom.useTitleCheckbox = panel.querySelector<HTMLInputElement>('[data-role="use-title"]')
  panelDom.useSeasonCheckbox = panel.querySelector<HTMLInputElement>('[data-role="use-season"]')
  panelDom.seasonRow = panel.querySelector<HTMLElement>('[data-role="season-row"]')
  panelDom.seasonPathHint = panel.querySelector<HTMLElement>('[data-role="season-path-hint"]')
  panelDom.pathPreview = panel.querySelector<HTMLElement>('[data-role="path-preview"]')
  panelDom.presetList = panel.querySelector<HTMLElement>('[data-role="preset-list"]')
  panelDom.addPresetButton = panel.querySelector<HTMLButtonElement>('[data-role="add-preset"]')
  panelDom.themeToggle = panel.querySelector<HTMLButtonElement>('[data-role="theme-toggle"]')
  panelDom.settingsToggle = panel.querySelector<HTMLButtonElement>('[data-role="settings-toggle"]')
  panelDom.settingsOverlay = panel.querySelector<HTMLElement>('[data-role="settings-overlay"]')
  panelDom.settingsForm = panel.querySelector<HTMLFormElement>('[data-role="settings-form"]')
  panelDom.settingsClose = panel.querySelector<HTMLButtonElement>('[data-role="settings-close"]')
  panelDom.settingsCancel = panel.querySelector<HTMLButtonElement>('[data-role="settings-cancel"]')
  panelDom.settingsBaseDir = panel.querySelector<HTMLInputElement>(
    '[data-role="settings-base-dir"]',
  )
  panelDom.settingsUseTitle = panel.querySelector<HTMLInputElement>(
    '[data-role="settings-use-title"]',
  )
  panelDom.settingsUseSeason = panel.querySelector<HTMLInputElement>(
    '[data-role="settings-use-season"]',
  )
  panelDom.settingsThemeGroup = panel.querySelector<HTMLElement>('[data-role="settings-theme"]')
  panelDom.settingsPresets = panel.querySelector<HTMLTextAreaElement>(
    '[data-role="settings-presets"]',
  )
  panelDom.settingsHistoryRate = panel.querySelector<HTMLInputElement>(
    '[data-role="settings-history-rate"]',
  )
  panelDom.settingsExportConfig = panel.querySelector<HTMLButtonElement>(
    '[data-role="settings-export-config"]',
  )
  panelDom.settingsExportData = panel.querySelector<HTMLButtonElement>(
    '[data-role="settings-export-data"]',
  )
  panelDom.settingsImportConfigTrigger = panel.querySelector<HTMLButtonElement>(
    '[data-role="settings-import-config-trigger"]',
  )
  panelDom.settingsImportDataTrigger = panel.querySelector<HTMLButtonElement>(
    '[data-role="settings-import-data-trigger"]',
  )
  panelDom.settingsImportConfigInput = panel.querySelector<HTMLInputElement>(
    '[data-role="settings-import-config"]',
  )
  panelDom.settingsImportDataInput = panel.querySelector<HTMLInputElement>(
    '[data-role="settings-import-data"]',
  )
  panelDom.settingsResetLayout = panel.querySelector<HTMLButtonElement>(
    '[data-role="settings-reset-layout"]',
  )
  panelDom.pinBtn = panel.querySelector<HTMLButtonElement>('[data-role="pin-toggle"]')
  panelDom.logContainer = panel.querySelector<HTMLElement>('[data-role="log-container"]')
  panelDom.logList = panel.querySelector<HTMLUListElement>('[data-role="log-list"]')
  panelDom.resultSummary = panel.querySelector<HTMLElement>('[data-role="result-summary"]')
  panelDom.itemsContainer = panel.querySelector<HTMLElement>('[data-role="items"]')
  panelDom.sortKeyGroup = panel.querySelector<HTMLElement>('[data-role="sort-key"]')
  panelDom.sortOrderButton = panel.querySelector<HTMLButtonElement>('[data-role="sort-order"]')
  panelDom.historyOverlay = panel.querySelector<HTMLElement>('[data-role="history-overlay"]')
  panelDom.historyList = panel.querySelector<HTMLElement>('[data-role="history-list"]')
  panelDom.historyEmpty = panel.querySelector<HTMLElement>('[data-role="history-empty"]')
  panelDom.historySummary = panel.querySelector<HTMLElement>('[data-role="history-summary"]')
  panelDom.historySummaryBody = panel.querySelector<HTMLElement>(
    '[data-role="history-summary-body"]',
  )
  panelDom.historyControls = panel.querySelector<HTMLElement>('[data-role="history-controls"]')
  panelDom.historyTabs = panel.querySelector<HTMLElement>('[data-role="history-tabs"]')
  panelDom.historySearch = panel.querySelector<HTMLInputElement>('[data-role="history-search"]')
  panelDom.historySearchClear = panel.querySelector<HTMLButtonElement>(
    '[data-role="history-search-clear"]',
  )
  panelDom.historySelectAll = panel.querySelector<HTMLInputElement>(
    '[data-role="history-select-all"]',
  )
  panelDom.historySelectionCount = panel.querySelector<HTMLElement>(
    '[data-role="history-selection-count"]',
  )
  panelDom.historyBatchCheck = panel.querySelector<HTMLButtonElement>(
    '[data-role="history-batch-check"]',
  )
  panelDom.historyDeleteSelected = panel.querySelector<HTMLButtonElement>(
    '[data-role="history-delete-selected"]',
  )
  panelDom.historyClear = panel.querySelector<HTMLButtonElement>('[data-role="history-clear"]')
  panelDom.historyToolbar = panel.querySelector<HTMLElement>('[data-role="history-toolbar"]')
  panelDom.historyToggleButtons = Array.from(
    panel.querySelectorAll<HTMLButtonElement>('[data-role="history-toggle"]'),
  )
  panelDom.resourceSummary = panel.querySelector<HTMLElement>('[data-role="resource-summary"]')
  panelDom.resourceTitle = panel.querySelector<HTMLElement>('[data-role="resource-title"]')
  panelDom.seasonTabs = panel.querySelector<HTMLElement>('[data-role="season-tabs"]')
  panelDom.transferBtn = panel.querySelector<HTMLButtonElement>('[data-role="transfer-btn"]')
  panelDom.transferLabel = panel.querySelector<HTMLElement>('[data-role="transfer-label"]')
  panelDom.transferSpinner = panel.querySelector<HTMLElement>('[data-role="transfer-spinner"]')
  panelDom.resizeHandle = panel.querySelector<HTMLElement>('[data-role="resize-handle"]')
  panelDom.statusText = panel.querySelector<HTMLElement>('[data-role="status-text"]')

  const handlePointerEnter = (event: PointerEvent) => {
    updatePointerPosition(event)
    panelState.pointerInside = true
    panel.classList.add('is-hovering')
    panel.classList.remove('is-leaving')
    cancelEdgeHide({ show: true })
  }

  const handlePointerLeave = (event: PointerEvent) => {
    updatePointerPosition(event)
    const verifyHoverState = () => {
      if (isDragging || isResizing) {
        panelState.pointerInside = true
        panel.classList.add('is-hovering')
        panel.classList.remove('is-leaving')
        cancelEdgeHide({ show: true })
        return
      }
      if (!panel || !panel.isConnected) {
        return
      }
      const hasFocusWithin = panel.matches(':focus-within')
      if (hasFocusWithin || panel.matches(':hover') || isPointerLikelyInsidePanel()) {
        panelState.pointerInside = true
        panel.classList.add('is-hovering')
        panel.classList.remove('is-leaving')
        cancelEdgeHide({ show: true })
        return
      }
      panelState.pointerInside = false
      panel.classList.remove('is-hovering')
      panel.classList.add('is-leaving')
      scheduleEdgeHide()
    }
    window.requestAnimationFrame(verifyHoverState)
  }

  const handleFocusIn = () => {
    panel.classList.add('is-hovering')
    panel.classList.remove('is-leaving')
    cancelEdgeHide({ show: true })
  }

  const handleFocusOut = (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof HTMLElement) || !panel.contains(event.relatedTarget)) {
      panel.classList.remove('is-hovering')
      panel.classList.add('is-leaving')
      scheduleEdgeHide()
    }
  }

  const refreshHoverState = (): void => {
    window.requestAnimationFrame(() => {
      if (!panel || !panel.isConnected) {
        return
      }
      const hovering = panel.matches(':hover')
      panelState.pointerInside = hovering
      if (hovering) {
        panel.classList.add('is-hovering')
        panel.classList.remove('is-leaving')
        cancelEdgeHide({ show: true })
      } else {
        panel.classList.remove('is-hovering')
        panel.classList.add('is-leaving')
        scheduleEdgeHide()
      }
    })
  }

  panel.addEventListener('pointerenter', handlePointerEnter)
  panel.addEventListener('pointermove', updatePointerPosition)
  panel.addEventListener('pointerdown', updatePointerPosition)
  panel.addEventListener('pointerup', updatePointerPosition)
  panel.addEventListener('pointerleave', handlePointerLeave)
  panel.addEventListener('focusin', handleFocusIn)
  panel.addEventListener('focusout', handleFocusOut)

  const header = panelDom.header

  const shouldIgnoreDragTarget = (event: Event): boolean => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return false
    }
    return Boolean(
      target.closest('button') ||
        target.closest('input') ||
        target.closest('.chaospace-theme-toggle'),
    )
  }

  const startResize = (event: MouseEvent) => {
    if (event.button !== 0 || !(panelDom.resizeHandle instanceof HTMLElement)) {
      return
    }
    if (!panelDom.resizeHandle.contains(event.target as Node)) {
      return
    }
    cancelEdgeHide({ show: true })
    panelState.edgeState.isHidden = false
    panelState.pointerInside = true
    applyEdgeHiddenPosition()
    event.preventDefault()
    event.stopPropagation()
    isResizing = true
    resizeStartWidth = panel.offsetWidth
    resizeStartHeight = panel.offsetHeight
    resizeStartX = event.clientX
    resizeStartY = event.clientY
    const rect = panel.getBoundingClientRect()
    resizeAnchorRight = rect.right
    panel.classList.add('is-resizing')
    panel.style.transition = 'none'
    document.body.style.userSelect = 'none'
  }

  if (header instanceof HTMLElement) {
    dragScope.run(() => {
      const state = useDraggable(() => panel, {
        handle: () => header,
        initialValue: () => ({
          x: lastKnownPosition.left,
          y: lastKnownPosition.top,
        }),
        preventDefault: true,
        stopPropagation: true,
        draggingElement: () => document,
        onStart: (_position, event) => {
          if (shouldIgnoreDragTarget(event)) {
            return false
          }
          cancelEdgeHide({ show: true })
          panelState.edgeState.isHidden = false
          panelState.pointerInside = true
          applyEdgeHiddenPosition()
          isDragging = true
          panel.style.transition = 'none'
          document.body.style.userSelect = 'none'
          header.style.cursor = 'grabbing'
          return undefined
        },
        onMove: (position) => {
          if (!isDragging) {
            return
          }
          lastKnownPosition = applyPanelPosition(position.x, position.y)
        },
        onEnd: () => {
          if (!isDragging) {
            return
          }
          isDragging = false
          panel.style.transition = ''
          panel.style.removeProperty('transform')
          header.style.cursor = 'move'
          document.body.style.userSelect = ''
          void safeStorageSet(
            {
              [POSITION_KEY]: lastKnownPosition,
            },
            'panel position',
          )
          refreshHoverState()
        },
      })
      draggableState = state
      syncDraggablePosition(lastKnownPosition)
    })
  }

  const stopResizeHandleMouseDown = panelDom.resizeHandle
    ? useEventListener(panelDom.resizeHandle, 'mousedown', startResize)
    : null

  const handleDocumentMouseMove = (event: MouseEvent) => {
    if (!isResizing) {
      return
    }
    event.preventDefault()
    const deltaX = resizeStartX - event.clientX
    const deltaY = event.clientY - resizeStartY
    const nextSize = applyPanelSize(resizeStartWidth + deltaX, resizeStartHeight + deltaY)
    if (nextSize) {
      const targetLeft = resizeAnchorRight - nextSize.width
      lastKnownPosition = applyPanelPosition(targetLeft, lastKnownPosition.top)
    }
  }

  const handleDocumentMouseUp = () => {
    if (!isResizing) {
      return
    }
    isResizing = false
    panel.classList.remove('is-resizing')
    panel.style.transition = ''
    lastKnownPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top)
    document.body.style.userSelect = ''
    syncDraggablePosition(lastKnownPosition)
    void safeStorageSet(
      {
        [SIZE_KEY]: panelState.lastKnownSize,
        [POSITION_KEY]: lastKnownPosition,
      },
      'panel geometry',
    )
    refreshHoverState()
  }

  const stopDocumentMouseMove = useEventListener(document, 'mousemove', handleDocumentMouseMove)
  const stopDocumentMouseUp = useEventListener(document, 'mouseup', handleDocumentMouseUp)

  const handleWindowResize = () => {
    if (!panel || !panel.isConnected) {
      return
    }
    const sourceWidth = panelState.lastKnownSize?.width ?? panel.offsetWidth
    const sourceHeight = panelState.lastKnownSize?.height ?? panel.offsetHeight
    applyPanelSize(sourceWidth, sourceHeight)
    lastKnownPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top)
    safeStorageSet(
      {
        [SIZE_KEY]: panelState.lastKnownSize,
        [POSITION_KEY]: lastKnownPosition,
      },
      'panel geometry',
    )
  }

  const stopWindowResize = useEventListener(window, 'resize', handleWindowResize)
  panelState.detachWindowResize = () => {
    stopWindowResize()
  }

  const destroy = () => {
    panel.removeEventListener('animationend', handlePanelIntroEnd)
    panel.removeEventListener('pointerenter', handlePointerEnter)
    panel.removeEventListener('pointermove', updatePointerPosition)
    panel.removeEventListener('pointerdown', updatePointerPosition)
    panel.removeEventListener('pointerup', updatePointerPosition)
    panel.removeEventListener('pointerleave', handlePointerLeave)
    panel.removeEventListener('focusin', handleFocusIn)
    panel.removeEventListener('focusout', handleFocusOut)
    dragScope.stop()
    draggableState = null
    stopResizeHandleMouseDown?.()
    stopDocumentMouseMove()
    stopDocumentMouseUp()
    if (panelState.detachWindowResize) {
      panelState.detachWindowResize()
      panelState.detachWindowResize = null
    }
    if (panelState.edgeTransitionUnbind) {
      panelState.edgeTransitionUnbind()
      panelState.edgeTransitionUnbind = null
    }
    if (panelState.edgeAnimationTimer) {
      window.clearTimeout(panelState.edgeAnimationTimer)
      panelState.edgeAnimationTimer = null
    }
    if (panelState.hideTimer) {
      window.clearTimeout(panelState.hideTimer)
      panelState.hideTimer = null
    }
    if (panelState.documentPointerDownBound) {
      stopDocumentPointerDown?.()
      stopDocumentPointerDown = null
      panelState.documentPointerDownBound = false
    }
    panelState.scheduleEdgeHide = null
    panelState.cancelEdgeHide = null
    panelState.applyEdgeHiddenPosition = null
    panelState.hidePanelToEdge = null
    panelState.showPanelFromEdge = null
    panelState.beginEdgeAnimation = null
    panelState.lastKnownSize = null
    panelState.lastKnownPosition = null
    panelState.getPanelBounds = null
    panelState.detachWindowResize = null
    vueApp.unmount()
    const domRecord = panelDom as Record<string, unknown>
    for (const key of Object.keys(domRecord)) {
      delete domRecord[key]
    }
    if (host.isConnected) {
      host.remove()
    }
  }

  return {
    panel,
    applyPanelSize,
    applyPanelPosition,
    getPanelBounds,
    syncPanelLayout,
    lastKnownPosition,
    scheduleEdgeHide,
    cancelEdgeHide,
    isPointerLikelyInsidePanel,
    updatePointerPosition,
    applyEdgeHiddenPosition,
    destroy,
  }
}
