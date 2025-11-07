import {
  analyzePage,
  extractItemsFromDocument,
  extractPosterDetails,
  extractSeasonPageCompletion,
  fetchHtmlDocument,
  isSupportedDetailPage,
} from '../services/page-analyzer'
import { state, panelDom, detailDom } from '../state'
import { createPanelRuntimeState } from './panel-state'
import type { PanelEdgeSnapshot, PanelPositionSnapshot, PanelSizeSnapshot } from '../types'
import { getPanelBaseDirDom, getPanelEdgeDom, getPanelTransferDom } from '../types'
import { createLoggingController } from '../controllers/logging-controller'
import { createPanelPreferencesController } from '../controllers/panel-preferences'
import { createPanelEdgeController } from '../controllers/panel-edge-controller'
import {
  computeSeasonTabState,
  filterItemsForActiveSeason,
  getTargetPath,
  renderSeasonControls,
  renderSeasonHint,
  renderSeasonTabs,
  updateSeasonExampleDir,
} from '../services/season-manager'
import { createResourceListRenderer, type ResourceListPanelDom } from '../components/resource-list'
import { createHistoryController } from '../history/controller'
import { installZoomPreview } from '../components/zoom-preview'
import { createSeasonLoader } from '../services/season-loader'
import { createTransferController } from './transfer/transfer-controller'
import { createHeaderPresenter } from './ui/header-presenter'
import { createSelectionController } from './ui/selection-controller'
import { createPageDataHydrator } from './page-data-hydrator'
import { registerChromeEvents } from './lifecycle/chrome-events'
import { createDomLifecycle } from './lifecycle/dom-observer'
import { createPanelFactory } from './panel/panel-factory'
import { createSettingsCoordinator } from './panel/settings-coordinator'
import { createBaseDirBinder } from './ui/binders/base-dir-binder'
import { createPosterPreviewBinder } from './ui/binders/poster-preview-binder'
import { createItemSelectionBinder } from './ui/binders/item-selection-binder'
import { createSeasonTabsBinder } from './ui/binders/season-tabs-binder'
import { createTransferBinder } from './ui/binders/transfer-binder'
import { createPinButtonBinder } from './ui/binders/pin-button-binder'
import { mountPanelShell } from '../components/panel'
import { showToast } from '../components/toast'
import { createTabSeasonPreferenceController } from '../services/tab-season-preference'
import { loadStoredPinState, persistPinState } from '../utils/panel-pin'
import { loadStoredEdgeState, persistEdgeState } from '../utils/panel-edge'
import { toolbarContextKey, type ToolbarContext } from './ui/toolbar-context'
import { historyContextKey } from './ui/history-context'
import { panelPreferencesContextKey } from './ui/panel-preferences-context'

export function createRuntimeApp() {
  const panelState = createPanelRuntimeState()
  let floatingPanel: HTMLElement | null = null
  let cleanupChromeEvents: (() => void) | null = null
  let initialized = false
  let tabSeasonPreference: ReturnType<typeof createTabSeasonPreferenceController> | null = null
  let stylesObserver: MutationObserver | null = null
  let stylesObserverRaf: number | null = null
  const panelEdgeDom = getPanelEdgeDom(panelDom)
  const panelBaseDirDom = getPanelBaseDirDom(panelDom)
  const panelTransferDom = getPanelTransferDom(panelDom)

  const handleSeasonDefaultChange = (value: boolean): void => {
    const normalized = Boolean(value)
    if (tabSeasonPreference) {
      tabSeasonPreference.handleGlobalDefaultChange(normalized)
      return
    }
    const previousDefault = state.seasonSubdirDefault
    state.seasonSubdirDefault = normalized
    if (state.seasonPreferenceScope === 'default' || previousDefault !== normalized) {
      state.useSeasonSubdir = normalized
    }
  }

  const getFloatingPanel = (): HTMLElement | null => floatingPanel

  type PinUpdateSource = 'user' | 'storage' | 'hydrate'

  let persistedEdgeState: PanelEdgeSnapshot | null = null
  let suppressEdgePersist = false

  const ensureEdgeStateHydrated = (() => {
    let hydrated = false
    let pending: Promise<void> | null = null
    return async (): Promise<void> => {
      if (hydrated) {
        return
      }
      if (pending) {
        await pending
        return
      }
      pending = loadStoredEdgeState()
        .then((stored) => {
          persistedEdgeState = stored ? { ...stored } : null
          if (stored) {
            panelState.edgeState.isHidden = stored.isHidden
            panelState.edgeState.side = stored.side
            if (typeof stored.peek === 'number' && Number.isFinite(stored.peek)) {
              panelState.edgeState.peek = stored.peek
            }
          } else {
            edgePersistEnabled = true
          }
        })
        .finally(() => {
          hydrated = true
          pending = null
        })
      await pending
    }
  })()

  let edgePersistEnabled = false

  const recordEdgeState = (
    edge: PanelEdgeSnapshot,
    { persist = true }: { persist?: boolean } = {},
  ): void => {
    if (persist && !edgePersistEnabled && persistedEdgeState) {
      return
    }
    const snapshot: PanelEdgeSnapshot = {
      isHidden: Boolean(edge.isHidden),
      side: edge.side === 'left' ? 'left' : 'right',
    }
    if (typeof edge.peek === 'number' && Number.isFinite(edge.peek) && edge.peek > 0) {
      snapshot.peek = edge.peek
    }
    persistedEdgeState = snapshot
    if (!persist || suppressEdgePersist || !edgePersistEnabled) {
      return
    }
    void persistEdgeState(snapshot)
  }

  const applyEdgeState = (
    snapshot: PanelEdgeSnapshot | null,
    { source, force = false }: { source?: PinUpdateSource; force?: boolean } = {},
  ): void => {
    if (!snapshot) {
      return
    }

    const last = persistedEdgeState
    const isSame =
      !force &&
      last &&
      last.isHidden === snapshot.isHidden &&
      last.side === snapshot.side &&
      (last.peek ?? Number.NaN) === (snapshot.peek ?? Number.NaN)
    if (isSame) {
      return
    }

    recordEdgeState(snapshot, { persist: false })

    const shouldHide = snapshot.isHidden && !panelState.isPinned
    const hasPanel = Boolean(getFloatingPanel()) && Boolean(panelState.applyEdgeHiddenPosition)
    panelState.edgeState.isHidden = shouldHide
    panelState.edgeState.side = snapshot.side
    if (typeof snapshot.peek === 'number' && Number.isFinite(snapshot.peek) && snapshot.peek > 0) {
      panelState.edgeState.peek = snapshot.peek
    }

    if (!hasPanel) {
      if (!shouldHide) {
        panelState.edgeState.isHidden = false
      }
      if (source === 'hydrate' || source === 'storage') {
        edgePersistEnabled = true
      }
      return
    }

    suppressEdgePersist = true
    try {
      if (shouldHide) {
        panelState.beginEdgeAnimation?.()
      } else {
        panelState.edgeState.isHidden = false
      }
      panelState.applyEdgeHiddenPosition?.()
      if (!panelState.edgeState.isHidden) {
        panelState.cancelEdgeHide?.({ show: true })
      }
    } finally {
      suppressEdgePersist = false
      if (source === 'hydrate' || source === 'storage') {
        edgePersistEnabled = true
      }
    }
  }

  panelState.edgeStateChange = (edgeSnapshot) => {
    recordEdgeState(edgeSnapshot)
  }

  const syncEdgeStateFromStorage = (snapshot: PanelEdgeSnapshot | null): void => {
    if (!snapshot) {
      const fallback: PanelEdgeSnapshot = {
        isHidden: false,
        side: persistedEdgeState?.side ?? 'right',
      }
      applyEdgeState(fallback, { source: 'storage', force: true })
      return
    }
    applyEdgeState(snapshot, { source: 'storage', force: true })
  }

  interface ApplyPinOptions {
    source?: PinUpdateSource
    event?: MouseEvent | null
    persist?: boolean
    force?: boolean
  }

  const ensurePinStateHydrated = (() => {
    let hydrated = false
    let pending: Promise<void> | null = null
    return async (): Promise<void> => {
      if (hydrated) {
        return
      }
      if (pending) {
        await pending
        return
      }
      pending = loadStoredPinState()
        .then((stored) => {
          if (typeof stored === 'boolean') {
            panelState.isPinned = stored
          }
        })
        .finally(() => {
          hydrated = true
          pending = null
        })
      await pending
    }
  })()

  const applyPinnedState = (nextPinned: boolean, options: ApplyPinOptions = {}): void => {
    const { force = false, persist = false, source, event = null } = options
    if (!force && panelState.isPinned === nextPinned) {
      return
    }

    panelState.isPinned = nextPinned
    edgeController.updatePinButton()

    if (nextPinned) {
      panelState.cancelEdgeHide?.({ show: true })
    } else if (!panelState.pointerInside) {
      panelState.scheduleEdgeHide?.()
    }

    if (persist) {
      void persistPinState(nextPinned)
    }

    if (source === 'user' && !nextPinned) {
      const isPointerActivation =
        Boolean(event) &&
        ((typeof event?.detail === 'number' && event.detail > 0) ||
          (typeof event?.clientX === 'number' &&
            typeof event?.clientY === 'number' &&
            ((event?.clientX ?? 0) !== 0 || (event?.clientY ?? 0) !== 0)))
      const pinButton = panelEdgeDom.pinButton
      if (isPointerActivation && pinButton && typeof pinButton.blur === 'function') {
        pinButton.blur()
      }
    }
  }

  const syncPinStateFromStorage = (nextPinned: boolean): void => {
    applyPinnedState(Boolean(nextPinned), { source: 'storage' })
  }

  const applyDefaultPanelSize = (): PanelSizeSnapshot | null => {
    if (!panelState.applyPanelSize) {
      return null
    }
    const bounds = panelState.getPanelBounds ? panelState.getPanelBounds() : null
    const fallbackWidth = bounds ? Math.min(640, bounds.maxWidth) : undefined
    const fallbackHeight = bounds ? Math.min(520, bounds.maxHeight) : undefined
    return panelState.applyPanelSize(fallbackWidth, fallbackHeight)
  }

  const syncPanelSizeFromStorage = (snapshot: PanelSizeSnapshot | null): void => {
    const previous = panelState.lastKnownSize
    const hasPanel = Boolean(getFloatingPanel())
    const isSame =
      Boolean(snapshot) &&
      Boolean(previous) &&
      previous?.width === snapshot?.width &&
      previous?.height === snapshot?.height
    if (isSame) {
      if (!hasPanel && snapshot) {
        panelState.lastKnownSize = { ...snapshot }
      }
      return
    }

    panelState.lastKnownSize = snapshot ? { ...snapshot } : null

    if (!hasPanel || !panelState.applyPanelSize) {
      return
    }

    if (panelState.edgeState) {
      panelState.edgeState.isHidden = false
    }

    const applied = snapshot
      ? panelState.applyPanelSize(snapshot.width, snapshot.height)
      : applyDefaultPanelSize()
    if (applied) {
      panelState.lastKnownSize = applied
      panelState.cancelEdgeHide?.({ show: true })
    }
  }

  const syncPanelPositionFromStorage = (snapshot: PanelPositionSnapshot | null): void => {
    const previous = panelState.lastKnownPosition
    const hasPanel = Boolean(getFloatingPanel())
    const isSame =
      Boolean(snapshot) &&
      Boolean(previous) &&
      previous?.left === snapshot?.left &&
      previous?.top === snapshot?.top
    if (isSame) {
      if (!hasPanel && snapshot) {
        panelState.lastKnownPosition = { ...snapshot }
      }
      return
    }

    panelState.lastKnownPosition = snapshot ? { ...snapshot } : null

    if (!hasPanel || !panelState.applyPanelPosition) {
      return
    }

    if (panelState.edgeState) {
      panelState.edgeState.isHidden = false
    }

    const applied = snapshot
      ? panelState.applyPanelPosition(snapshot.left, snapshot.top)
      : panelState.applyPanelPosition(undefined, undefined)
    panelState.lastKnownPosition = applied
    panelState.cancelEdgeHide?.({ show: true })
  }

  const logging = createLoggingController({
    state,
    panelDom,
    document,
  })

  const headerPresenter = createHeaderPresenter()

  const preferences = createPanelPreferencesController({
    state,
    panelDom: panelBaseDirDom,
    document,
    getFloatingPanel,
    renderSeasonHint,
    updateSeasonExampleDir,
    getTargetPath,
    showToast,
    onSeasonDefaultChange: handleSeasonDefaultChange,
  })

  const edgeController = createPanelEdgeController({
    state,
    panelState,
    panelDom: panelEdgeDom,
    detailDom,
    getFloatingPanel,
  })

  const resourceRenderer = createResourceListRenderer({
    state,
    panelDom: panelDom as unknown as ResourceListPanelDom,
    renderSeasonTabs,
    filterItemsForActiveSeason,
    computeSeasonTabState,
    renderSeasonControls,
    updateTransferButton: () => headerPresenter.updateTransferButton(),
    updatePanelHeader: () => headerPresenter.updateHeader(),
  })

  tabSeasonPreference = createTabSeasonPreferenceController({
    getFloatingPanel,
    renderResourceList: () => resourceRenderer.renderResourceList(),
    renderPathPreview: () => preferences.renderPathPreview(),
  })
  tabSeasonPreference.handleGlobalDefaultChange(state.seasonSubdirDefault)

  const seasonLoader = createSeasonLoader({
    getFloatingPanel,
    fetchHtmlDocument,
    extractItemsFromDocument,
    extractSeasonPageCompletion,
    extractPosterDetails,
    renderResourceList: () => resourceRenderer.renderResourceList(),
    renderPathPreview: () => preferences.renderPathPreview(),
    updatePanelHeader: () => headerPresenter.updateHeader(),
    updateTransferButton: () => headerPresenter.updateTransferButton(),
  })

  const history = createHistoryController({
    getFloatingPanel,
    panelState,
    renderResourceList: () => resourceRenderer.renderResourceList(),
    renderPathPreview: () => preferences.renderPathPreview(),
    renderSeasonHint,
    seasonPreference: tabSeasonPreference!,
  })

  const selectionController = createSelectionController({
    renderResourceList: () => resourceRenderer.renderResourceList(),
  })

  const toolbarContext: ToolbarContext = {
    selection: selectionController,
    selectNewItems: () => history.selectNewItems(),
    renderResourceList: () => resourceRenderer.renderResourceList(),
  }

  const pageDataHydrator = createPageDataHydrator()

  const transferController = createTransferController({
    panelDom: panelBaseDirDom,
    logging,
    preferences,
    history,
    getFloatingPanel,
    updateTransferButton: () => headerPresenter.updateTransferButton(),
    renderPathPreview: () => preferences.renderPathPreview(),
    seasonPreference: tabSeasonPreference!,
  })

  const baseDirBinder = createBaseDirBinder({
    panelDom: panelBaseDirDom,
    state,
    preferences,
    showToast,
    seasonPreference: tabSeasonPreference!,
  })

  const posterPreviewBinder = createPosterPreviewBinder({
    panelDom,
    state,
    history,
    getFloatingPanel,
  })

  const itemSelectionBinder = createItemSelectionBinder({
    panelDom,
    state,
    renderResourceSummary: () => resourceRenderer.renderResourceSummary(),
    updateTransferButton: () => headerPresenter.updateTransferButton(),
  })

  const seasonTabsBinder = createSeasonTabsBinder({
    panelDom,
    state,
    renderResourceList: () => resourceRenderer.renderResourceList(),
  })

  const transferBinder = createTransferBinder({
    panelDom: panelTransferDom,
    transfer: transferController,
  })

  const settingsCoordinator = createSettingsCoordinator({
    document,
    panelState,
    preferences,
    history,
    renderResourceList: () => resourceRenderer.renderResourceList(),
    showToast,
    seasonPreference: tabSeasonPreference!,
  })

  const panelFactory = createPanelFactory({
    document,
    window,
    state,
    panelDom,
    panelState,
    logging,
    preferences,
    edgeController,
    history,
    headerPresenter,
    resourceRenderer,
    seasonLoader,
    hydrator: pageDataHydrator,
    analyzePage,
    mountPanelShell,
    settingsCoordinator,
    staticBinders: [
      posterPreviewBinder,
      baseDirBinder,
      itemSelectionBinder,
      seasonTabsBinder,
      transferBinder,
    ],
    shellBinderFactories: [
      () =>
        createPinButtonBinder({
          panelDom: panelEdgeDom,
          getPinnedState: () => panelState.isPinned,
          onPinChange: (nextPinned, context) =>
            applyPinnedState(nextPinned, {
              source: 'user',
              event: context.event,
              persist: true,
            }),
        }),
    ],
    getFloatingPanel,
    setFloatingPanel: (panel) => {
      floatingPanel = panel
    },
    showToast,
    seasonPreference: tabSeasonPreference!,
    hydratePinState: ensurePinStateHydrated,
    hydrateEdgeState: ensureEdgeStateHydrated,
    applyStoredEdgeState: () => {
      if (persistedEdgeState) {
        applyEdgeState(persistedEdgeState, { source: 'hydrate', force: true })
      } else {
        edgePersistEnabled = true
      }
    },
    setupPanelApp: (app) => {
      app.provide(toolbarContextKey, toolbarContext)
      app.provide(historyContextKey, history)
      app.provide(panelPreferencesContextKey, preferences)
    },
  })

  const domLifecycle = createDomLifecycle({
    createPanel: () => panelFactory.createPanel(),
    hasPanel: () => Boolean(getFloatingPanel()),
    isCreating: () => panelFactory.isCreating(),
    analyzePage: () => analyzePage(),
  })

  const syncSeasonPreferenceFromStorage = (nextValue: boolean | null): void => {
    const normalized = typeof nextValue === 'boolean' ? nextValue : false
    handleSeasonDefaultChange(normalized)
    if (tabSeasonPreference) {
      tabSeasonPreference.syncCheckboxes()
    } else {
      const useSeasonCheckbox = panelBaseDirDom.useSeasonCheckbox
      if (useSeasonCheckbox) {
        useSeasonCheckbox.checked = state.useSeasonSubdir
      }
      const settingsUseSeason = panelBaseDirDom.settingsUseSeason
      if (settingsUseSeason) {
        settingsUseSeason.checked = state.seasonSubdirDefault
      }
    }
  }

  const getStylesHref = (): string => chrome.runtime.getURL('content/styles/index.css')

  const resolveStyleMount = (): HTMLElement | null => {
    if (document.head) {
      return document.head
    }
    if (document.documentElement instanceof HTMLElement) {
      return document.documentElement
    }
    if (document.body) {
      return document.body
    }
    return null
  }

  const ensureStyleLink = (): HTMLLinkElement | null => {
    const mountPoint = resolveStyleMount()
    if (!mountPoint) {
      return null
    }
    const href = getStylesHref()
    const existing = document.getElementById('chaospace-float-styles') as HTMLLinkElement | null
    if (existing) {
      if (existing.href !== href) {
        existing.href = href
      }
      if (!existing.isConnected) {
        mountPoint.appendChild(existing)
      }
      return existing
    }
    try {
      const link = document.createElement('link')
      link.id = 'chaospace-float-styles'
      link.rel = 'stylesheet'
      link.href = href
      mountPoint.appendChild(link)
      return link
    } catch (error) {
      console.error('[Chaospace] Failed to inject styles:', error)
      return null
    }
  }

  const scheduleStyleGuard = (): void => {
    if (stylesObserverRaf !== null) {
      return
    }
    stylesObserverRaf = window.requestAnimationFrame(() => {
      stylesObserverRaf = null
      const link = document.getElementById('chaospace-float-styles') as HTMLLinkElement | null
      if (!link || !link.isConnected) {
        ensureStyleLink()
        return
      }
      const href = getStylesHref()
      if (link.href !== href) {
        link.href = href
      }
      if (link.rel !== 'stylesheet') {
        link.rel = 'stylesheet'
      }
    })
  }

  const ensureStyleObserver = (): void => {
    if (stylesObserver) {
      return
    }
    const observerTarget =
      document.documentElement instanceof HTMLElement
        ? document.documentElement
        : resolveStyleMount()
    if (!observerTarget) {
      return
    }
    stylesObserver = new MutationObserver(() => {
      scheduleStyleGuard()
    })
    stylesObserver.observe(observerTarget, {
      childList: true,
      subtree: true,
    })
  }

  const teardownStyleObserver = (): void => {
    if (!stylesObserver) {
      return
    }
    stylesObserver.disconnect()
    stylesObserver = null
    if (stylesObserverRaf !== null) {
      window.cancelAnimationFrame(stylesObserverRaf)
      stylesObserverRaf = null
    }
  }

  const injectStyles = (): void => {
    if (!ensureStyleLink()) {
      return
    }
    ensureStyleObserver()
  }

  const init = (): void => {
    if (initialized) {
      return
    }
    if (!isSupportedDetailPage()) {
      return
    }
    initialized = true

    installZoomPreview()
    injectStyles()

    cleanupChromeEvents = registerChromeEvents({
      history,
      applyTheme: () => preferences.applyPanelTheme(),
      rerenderSettingsIfOpen: () => {
        if (state.settingsPanel.isOpen) {
          panelFactory.getSettingsHandle()?.render()
        }
      },
      renderResourceList: () => resourceRenderer.renderResourceList(),
      syncSeasonPreference: syncSeasonPreferenceFromStorage,
      syncPanelSizeFromStorage,
      syncPanelPositionFromStorage,
      syncEdgeStateFromStorage,
      syncPinStateFromStorage,
      setStatusProgress: (progress) => transferController.handleProgressEvent(progress),
      getFloatingPanel,
      analyzePageForMessage: () => analyzePage(),
    })

    domLifecycle.scheduleInitialPanelCreation()
    domLifecycle.observeDomChanges()
  }

  const destroy = (): void => {
    domLifecycle.cancelInitialPanelCreation()
    domLifecycle.disconnect()
    seasonLoader.resetSeasonLoader()
    panelFactory.disposePanel()
    cleanupChromeEvents?.()
    cleanupChromeEvents = null
    teardownStyleObserver()
    initialized = false
  }

  return { init, destroy }
}
