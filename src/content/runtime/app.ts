import { chaosLogger } from '@/shared/log'
import { watch } from 'vue'
import {
  extractItemsFromDocument,
  extractPosterDetails,
  extractSeasonPageCompletion,
  fetchHtmlDocument,
  isSupportedDetailPage,
  suggestDirectoryFromClassification,
} from '@/providers/sites/chaospace/page-analyzer'
import { state, panelDom, detailDom } from '../state'
import { createPanelRuntimeState } from './panel-state'
import type { PanelEdgeSnapshot, PanelPositionSnapshot, PanelSizeSnapshot } from '../types'
import {
  getPanelBaseDirDom,
  getPanelEdgeDom,
  getPanelHistoryDom,
  getPanelHeaderDom,
  getPanelLoggingDom,
  getPanelResourceDom,
  getPanelSeasonDom,
  getPanelSettingsDom,
  getPanelTransferDom,
} from '../types'
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
  bindSeasonManagerDomRefs,
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
import { providerPanelContextKey } from './ui/provider-context'
import { panelPreferencesContextKey } from './ui/panel-preferences-context'
import { createPageAnalysisRunner } from '../services/page-analysis-runner'
import { getContentProviderRegistry } from '@/content/providers/registry'
import { createProviderPreferencesController } from '../controllers/provider-preferences'
import { TV_SHOW_INITIAL_SEASON_BATCH } from '../constants'
import { CHAOSPACE_SITE_PROVIDER_ID } from '@/providers/sites/chaospace/chaospace-site-provider'
import { ensureProviderAccentStyles } from '../styles/provider-accents'

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
  const panelHeaderDom = getPanelHeaderDom(panelDom)
  const panelLoggingDom = getPanelLoggingDom(panelDom)
  const panelResourceDom = getPanelResourceDom(panelDom)
  const panelSeasonDom = getPanelSeasonDom(panelDom)
  const panelHistoryDom = getPanelHistoryDom(panelDom)
  const panelSettingsDom = getPanelSettingsDom(panelDom)

  const providerRegistry = getContentProviderRegistry()
  const providerPreferences = createProviderPreferencesController({
    state,
    registry: providerRegistry,
  })

  bindSeasonManagerDomRefs({
    baseDir: panelBaseDirDom,
    resource: panelResourceDom,
    season: panelSeasonDom,
  })

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

  const DEFAULT_SITE_PROVIDER_ID = CHAOSPACE_SITE_PROVIDER_ID
  let lastAppliedProviderId: string | null = null

  const resolvePanelProviderId = (): string => {
    const active = state.activeSiteProviderId?.trim()
    if (active) {
      return active
    }
    const manual = state.manualSiteProviderId?.trim()
    if (manual) {
      return manual
    }
    return DEFAULT_SITE_PROVIDER_ID
  }

  const applyProviderAccentTheme = ({ force = false }: { force?: boolean } = {}): void => {
    const providerId = resolvePanelProviderId()
    const panel = getFloatingPanel()
    if (!panel) {
      return
    }
    if (
      !force &&
      lastAppliedProviderId === providerId &&
      panel.dataset['panProvider'] === providerId
    ) {
      return
    }
    panel.dataset['panProvider'] = providerId
    lastAppliedProviderId = providerId
    const ensurePromise = ensureProviderAccentStyles(providerId)
    if (ensurePromise) {
      ensurePromise.catch((error) => {
        chaosLogger.warn('[Pan Transfer] Failed to load provider accent styles', {
          providerId,
          message: (error as Error)?.message,
        })
      })
    }
  }

  const stopProviderAccentWatch = watch(
    () => [state.activeSiteProviderId, state.manualSiteProviderId],
    () => applyProviderAccentTheme(),
    { immediate: true },
  )

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
    panelDom: panelLoggingDom,
    document,
  })

  const headerPresenter = createHeaderPresenter({
    headerDom: panelHeaderDom,
    transferDom: panelTransferDom,
  })

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
    panelDom: panelResourceDom as ResourceListPanelDom,
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
    panelDom: panelBaseDirDom,
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
    panelDom: panelHistoryDom,
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
    panelDom: panelHeaderDom,
    state,
    history,
    getFloatingPanel,
  })

  const itemSelectionBinder = createItemSelectionBinder({
    panelDom: panelResourceDom,
    state,
    renderResourceSummary: () => resourceRenderer.renderResourceSummary(),
    updateTransferButton: () => headerPresenter.updateTransferButton(),
  })

  const seasonTabsBinder = createSeasonTabsBinder({
    panelDom: panelResourceDom,
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
    panelDom: panelSettingsDom,
    providerPreferences,
  })

  const renderPanelState = (): void => {
    headerPresenter.updateHeader()
    preferences.applyPanelTheme()
    applyProviderAccentTheme({ force: true })
    preferences.renderPresets()
    preferences.renderPathPreview()
    history.applyHistoryToCurrentPage()
    history.renderHistoryCard()
    history.updateHistoryExpansion()
    resourceRenderer.renderResourceList()
    logging.resetLogs()
    logging.setStatus('idle', state.statusMessage)
    headerPresenter.updateTransferButton()
  }

  const switchSiteProvider = async (providerId: string | null): Promise<void> => {
    if (state.providerSwitching) {
      return
    }
    const normalized =
      typeof providerId === 'string' && providerId.trim() ? providerId.trim() : null
    if (state.manualSiteProviderId === normalized && state.activeSiteProviderId === normalized) {
      return
    }
    const available = state.availableSiteProviderIds
    if (normalized && available && available.size > 0 && !available.has(normalized)) {
      chaosLogger.info('[Pan Transfer] Provider switch blocked (provider unavailable)', {
        event: 'site-provider-switch-blocked',
        requestedProviderId: normalized,
        availableProviderIds: Array.from(available),
        pageUrl: state.pageUrl,
      })
      state.providerSwitching = false
      showToast('error', '切换解析失败', '当前页面未检测到该解析器支持')
      return
    }
    const previousManualId = state.manualSiteProviderId
    state.providerSwitching = true
    state.statusMessage = '正在切换解析引擎...'
    try {
      const data = await analysisRunner.analyzePage({
        deferTvSeasons: true,
        initialSeasonBatchSize: TV_SHOW_INITIAL_SEASON_BATCH,
        siteProviderId: normalized,
      })
      seasonLoader.resetSeasonLoader()
      const deferredSeasons = pageDataHydrator.normalizeDeferredSeasons(data.deferredSeasons)
      pageDataHydrator.hydrate(data.items || [], deferredSeasons, data)
      state.autoSuggestedDir = suggestDirectoryFromClassification(
        state.classificationDetails || state.classification,
      )
      state.logs = []
      state.transferStatus = 'idle'
      state.statusMessage = '准备就绪 ✨'
      state.manualSiteProviderId = normalized
      renderPanelState()
      const availableProviderIds = Array.from(state.availableSiteProviderIds ?? [])
      chaosLogger.info('[Pan Transfer] Site provider switch completed', {
        event: 'site-provider-switch',
        mode: normalized ? 'manual' : 'auto',
        requestedProviderId: normalized,
        providerId: state.activeSiteProviderId,
        providerLabel: state.activeSiteProviderLabel,
        availableProviderIds,
      })
      if (state.deferredSeasonInfos.length) {
        void seasonLoader.ensureDeferredSeasonLoading().catch((error) => {
          chaosLogger.error('[Pan Transfer] Failed to resume deferred season loading', error)
        })
      }
    } catch (error) {
      state.manualSiteProviderId = previousManualId
      const err = error as Error
      chaosLogger.error('[Pan Transfer] Failed to switch provider', err)
      showToast('error', '切换解析失败', err?.message || '无法切换解析 Provider')
      state.statusMessage = '切换解析失败'
    } finally {
      state.providerSwitching = false
    }
  }

  const analysisRunner = createPageAnalysisRunner({
    document,
    window,
    getProviderPreferences: () => providerPreferences.getSnapshot(),
    getManualSiteProviderId: () => state.manualSiteProviderId,
  })

  const panelFactory = createPanelFactory({
    document,
    window,
    state,
    panelDom,
    panelState,
    preferences,
    edgeController,
    history,
    seasonLoader,
    hydrator: pageDataHydrator,
    analyzePage: (options) => analysisRunner.analyzePage(options),
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
      app.provide(providerPanelContextKey, {
        siteProviderOptions: providerPreferences.getSiteProviderOptions(),
        switchSiteProvider,
      })
    },
    providerPreferences,
    renderPanelState,
  })

  const domLifecycle = createDomLifecycle({
    createPanel: () => panelFactory.createPanel(),
    hasPanel: () => Boolean(getFloatingPanel()),
    isCreating: () => panelFactory.isCreating(),
    analyzePage: () => analysisRunner.analyzePage(),
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
      chaosLogger.error('[Pan Transfer] Failed to inject styles:', error)
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
      analyzePageForMessage: () => analysisRunner.analyzePage(),
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
    stopProviderAccentWatch()
    initialized = false
  }

  return { init, destroy }
}
