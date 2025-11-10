import { chaosLogger } from '@/shared/log'
import {
  EDGE_HIDE_DEFAULT_PEEK,
  EDGE_HIDE_DELAY,
  EDGE_HIDE_MAX_PEEK,
  EDGE_HIDE_MIN_PEEK,
  POSITION_KEY,
  SIZE_KEY,
  TV_SHOW_INITIAL_SEASON_BATCH,
} from '../../constants'
import type { App } from 'vue'
import type { ContentStore } from '../../state'
import type { PanelDomRefs, PanelRuntimeState } from '../../types'
import type { createPanelPreferencesController } from '../../controllers/panel-preferences'
import type { createProviderPreferencesController } from '../../controllers/provider-preferences'
import type { createPanelEdgeController } from '../../controllers/panel-edge-controller'
import type { createHistoryController } from '../../history/controller'
import type { createSeasonLoader } from '../../services/season-loader'
import type { Binder } from '../ui/binders/types'
import type { PageDataHydrator } from '../page-data-hydrator'
import type { SettingsCoordinator } from './settings-coordinator'
import type { PanelShellInstance, SettingsModalHandle } from '../types'
import type {
  AnalyzePageOptions,
  PageAnalysisResult,
} from '@/providers/sites/chaospace/page-analyzer'
import type { mountPanelShell } from '../../components/panel'
import type { ToastHandler } from '../../components/toast'
import { suggestDirectoryFromClassification } from '@/providers/sites/chaospace/page-analyzer'
import { formatOriginLabel } from '../../utils/format'
import { resetPanelRuntimeState } from '../panel-state'
import type { TabSeasonPreferenceController } from '../../services/tab-season-preference'

type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>
type PanelEdgeController = ReturnType<typeof createPanelEdgeController>
type HistoryController = ReturnType<typeof createHistoryController>
type SeasonLoader = ReturnType<typeof createSeasonLoader>
type ProviderPreferencesController = ReturnType<typeof createProviderPreferencesController>
type AnalyzePageFn = (options?: AnalyzePageOptions) => Promise<PageAnalysisResult>
interface PanelFactoryDeps {
  document: Document
  window: Window & typeof globalThis
  state: ContentStore
  panelDom: PanelDomRefs
  panelState: PanelRuntimeState
  preferences: PanelPreferencesController
  edgeController: PanelEdgeController
  history: HistoryController
  seasonLoader: SeasonLoader
  hydrator: PageDataHydrator
  analyzePage: AnalyzePageFn
  mountPanelShell: typeof mountPanelShell
  settingsCoordinator: SettingsCoordinator
  staticBinders: Binder[]
  shellBinderFactories: Array<(shell: PanelShellInstance) => Binder>
  getFloatingPanel: () => HTMLElement | null
  setFloatingPanel: (panel: HTMLElement | null) => void
  showToast: ToastHandler
  seasonPreference: TabSeasonPreferenceController
  hydratePinState: () => Promise<void>
  hydrateEdgeState: () => Promise<void>
  applyStoredEdgeState: () => void
  setupPanelApp?: (app: App<Element>) => void
  providerPreferences: ProviderPreferencesController
  renderPanelState: () => void
}

export interface PanelFactory {
  createPanel: () => Promise<boolean>
  isCreating: () => boolean
  disposePanel: () => void
  getSettingsHandle: () => SettingsModalHandle | null
}

export function createPanelFactory(deps: PanelFactoryDeps): PanelFactory {
  const {
    document,
    window,
    state,
    panelDom,
    panelState,
    preferences,
    edgeController,
    history,
    seasonLoader,
    hydrator,
    analyzePage,
    mountPanelShell,
    settingsCoordinator,
    staticBinders,
    shellBinderFactories,
    getFloatingPanel,
    setFloatingPanel,
    showToast,
    seasonPreference,
    hydratePinState,
    hydrateEdgeState,
    applyStoredEdgeState,
    setupPanelApp,
    providerPreferences,
    renderPanelState,
  } = deps

  let panelCreationInProgress = false
  let settingsModal: SettingsModalHandle | null = null
  let binderDisposers: Array<() => void> = []
  let lifecycleToken = 0
  let currentShell: PanelShellInstance | null = null

  const disposeBinders = (): void => {
    binderDisposers.forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        chaosLogger.warn('[Pan Transfer] Failed to dispose binder', error)
      }
    })
    binderDisposers = []
  }

  const resetRuntimeState = (): void => {
    state.deferredSeasonInfos = []
    state.isSeasonLoading = false
    state.seasonLoadProgress = { total: 0, loaded: 0 }
    state.itemIdSet = new Set()
    state.seasonEntries = []
    state.historySeasonExpanded = new Set()
    state.selectedIds = new Set()
    state.historySelectedKeys = new Set()
    state.transferredIds = new Set()
    state.newItemIds = new Set()
    state.logs = []
    state.lastResult = null
    state.transferStatus = 'idle'
    state.statusMessage = '准备就绪 ✨'
    state.toolbarDisabled = false
    state.manualSiteProviderId = null
    state.providerSwitching = false
  }

  const applyAutoBaseDir = (
    classificationInput: unknown,
    { persist = false }: { persist?: boolean } = {},
  ): boolean => {
    const detail =
      classificationInput && typeof classificationInput === 'object'
        ? classificationInput
        : {
            classification:
              typeof classificationInput === 'string' ? classificationInput : 'unknown',
          }
    const type = (detail as { classification?: string; type?: string }).classification || 'unknown'
    state.classification = type || 'unknown'
    state.classificationDetails = detail

    const suggestion = suggestDirectoryFromClassification(detail || type) as string | null
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

    preferences.setBaseDir(suggestion, { persist, lockOverride: false })
    return true
  }

  const bindPanelInteractions = (shell: PanelShellInstance): void => {
    const { syncPanelLayout, applyPanelPosition, getPanelBounds, scheduleEdgeHide } = shell

    disposeBinders()

    panelDom.set('openSettingsPanel', () => {
      settingsModal?.open()
    })
    panelDom.set('closeSettingsPanel', (options = {}) => {
      settingsModal?.close(options)
    })

    edgeController.updatePinButton()

    const shellBinders = shellBinderFactories.map((factory) => factory(shell))
    const allBinders = [...staticBinders, ...shellBinders]

    binderDisposers = allBinders.map((binder) => binder.bind())

    const bounds = getPanelBounds()
    panelState.lastKnownSize = { width: bounds.maxWidth, height: bounds.maxHeight }
    panelState.lastKnownPosition = applyPanelPosition(undefined, undefined)

    syncPanelLayout()

    if (!panelState.isPinned) {
      scheduleEdgeHide(EDGE_HIDE_DELAY)
    }
  }

  const createPanel = async (): Promise<boolean> => {
    if (getFloatingPanel() || panelCreationInProgress) {
      return Boolean(getFloatingPanel())
    }
    panelCreationInProgress = true
    const token = lifecycleToken
    seasonLoader.resetSeasonLoader()
    let panelCreated = false

    try {
      await preferences.loadSettings()
      if (token !== lifecycleToken) {
        return false
      }
      await providerPreferences.loadPreferences()
      if (token !== lifecycleToken) {
        return false
      }
      await hydrateEdgeState()
      if (token !== lifecycleToken) {
        return false
      }
      await hydratePinState()
      if (token !== lifecycleToken) {
        return false
      }
      await seasonPreference.initialize()
      if (token !== lifecycleToken) {
        return false
      }
      await history.loadHistory({ silent: true })
      if (token !== lifecycleToken) {
        return false
      }
      preferences.applyPanelTheme()
      if (token !== lifecycleToken) {
        return false
      }

      resetRuntimeState()

      const data = await analyzePage({
        deferTvSeasons: true,
        initialSeasonBatchSize: TV_SHOW_INITIAL_SEASON_BATCH,
      })
      if (token !== lifecycleToken) {
        return false
      }
      const hasItems = Array.isArray(data.items) && data.items.length > 0
      const deferredSeasons = hydrator.normalizeDeferredSeasons(data.deferredSeasons)
      if (!hasItems && deferredSeasons.length === 0) {
        return false
      }

      hydrator.hydrate(data.items || [], deferredSeasons, data)
      applyAutoBaseDir(state.classificationDetails || state.classification)
      state.logs = []
      history.applyHistoryToCurrentPage()
      if (token !== lifecycleToken) {
        return false
      }

      const originLabel = formatOriginLabel(state.origin)

      const panelShell = await mountPanelShell({
        document,
        window,
        panelDom,
        panelState,
        pageTitle: state.pageTitle,
        originLabel,
        theme: state.theme,
        handleDocumentPointerDown: edgeController.handleDocumentPointerDown,
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
        ...(setupPanelApp ? { setupApp: setupPanelApp } : {}),
      })
      if (token !== lifecycleToken) {
        panelShell.destroy()
        return false
      }

      currentShell = panelShell
      const floatingPanel = panelShell.panel
      setFloatingPanel(floatingPanel)

      settingsModal = settingsCoordinator.attachToShell(panelShell)

      if (token !== lifecycleToken) {
        return false
      }

      panelCreated = true

      history.renderHistoryDetail()
      bindPanelInteractions(panelShell)
      renderPanelState()
      applyStoredEdgeState()

      if (state.deferredSeasonInfos.length) {
        void seasonLoader.ensureDeferredSeasonLoading().catch((error) => {
          chaosLogger.error('[Pan Transfer] Failed to schedule deferred season loading:', error)
        })
      }
    } catch (error) {
      chaosLogger.error('[Pan Transfer] Failed to create floating panel:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      showToast('error', '创建面板失败', message)
    } finally {
      panelCreationInProgress = false
    }
    return panelCreated
  }

  const disposePanel = (): void => {
    lifecycleToken += 1
    disposeBinders()
    settingsModal?.destroy()
    settingsModal = null
    if (currentShell) {
      try {
        currentShell.destroy()
      } catch (error) {
        chaosLogger.warn('[Pan Transfer] Failed to destroy panel shell', error)
      }
      currentShell = null
    }
    setFloatingPanel(null)
    resetPanelRuntimeState(panelState)
  }

  return {
    createPanel,
    isCreating: () => panelCreationInProgress,
    disposePanel,
    getSettingsHandle: () => settingsModal,
  }
}
