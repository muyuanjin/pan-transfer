import {
  EDGE_HIDE_DEFAULT_PEEK,
  EDGE_HIDE_DELAY,
  EDGE_HIDE_MAX_PEEK,
  EDGE_HIDE_MIN_PEEK,
  POSITION_KEY,
  SIZE_KEY,
  TV_SHOW_INITIAL_SEASON_BATCH,
} from '../../constants'
import type { ContentStore } from '../../state'
import type { PanelDomRefs, PanelRuntimeState } from '../../types'
import type { createLoggingController } from '../../controllers/logging-controller'
import type { createPanelPreferencesController } from '../../controllers/panel-preferences'
import type { createPanelEdgeController } from '../../controllers/panel-edge-controller'
import type { createHistoryController } from '../../history/controller'
import type { createResourceListRenderer } from '../../components/resource-list'
import type { createSeasonLoader } from '../../services/season-loader'
import type { Binder } from '../ui/binders/types'
import type { PageDataHydrator } from '../page-data-hydrator'
import type { HeaderPresenter } from '../ui/header-presenter'
import type { SettingsCoordinator } from './settings-coordinator'
import type { PanelShellInstance, SettingsModalHandle } from '../types'
import type { analyzePage } from '../../services/page-analyzer'
import type { mountPanelShell } from '../../components/panel'
import type { ToastHandler } from '../../components/toast'
import { suggestDirectoryFromClassification } from '../../services/page-analyzer'
import { formatOriginLabel } from '../../utils/format'

type LoggingController = ReturnType<typeof createLoggingController>
type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>
type PanelEdgeController = ReturnType<typeof createPanelEdgeController>
type HistoryController = ReturnType<typeof createHistoryController>
type ResourceListRenderer = ReturnType<typeof createResourceListRenderer>
type SeasonLoader = ReturnType<typeof createSeasonLoader>
interface PanelFactoryDeps {
  document: Document
  window: Window & typeof globalThis
  state: ContentStore
  panelDom: PanelDomRefs
  panelState: PanelRuntimeState
  logging: LoggingController
  preferences: PanelPreferencesController
  edgeController: PanelEdgeController
  history: HistoryController
  headerPresenter: HeaderPresenter
  resourceRenderer: ResourceListRenderer
  seasonLoader: SeasonLoader
  hydrator: PageDataHydrator
  analyzePage: typeof analyzePage
  mountPanelShell: typeof mountPanelShell
  settingsCoordinator: SettingsCoordinator
  staticBinders: Binder[]
  shellBinderFactories: Array<(shell: PanelShellInstance) => Binder>
  getFloatingPanel: () => HTMLElement | null
  setFloatingPanel: (panel: HTMLElement | null) => void
  showToast: ToastHandler
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
    logging,
    preferences,
    edgeController,
    history,
    headerPresenter,
    resourceRenderer,
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
  } = deps

  let panelCreationInProgress = false
  let settingsModal: SettingsModalHandle | null = null
  let binderDisposers: Array<() => void> = []

  const disposeBinders = (): void => {
    binderDisposers.forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('[Chaospace Transfer] Failed to dispose binder', error)
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

  const renderInitialState = (): void => {
    headerPresenter.updateHeader()
    preferences.applyPanelTheme()
    preferences.renderPresets()
    preferences.renderPathPreview()
    history.applyHistoryToCurrentPage()
    history.renderHistoryCard()
    history.updateHistoryExpansion()
    resourceRenderer.renderResourceList()
    logging.setStatus('idle', state.statusMessage)
    logging.renderLogs()
    headerPresenter.updateTransferButton()
  }

  const bindPanelInteractions = (shell: PanelShellInstance): void => {
    const { syncPanelLayout, applyPanelPosition, getPanelBounds, scheduleEdgeHide } = shell

    disposeBinders()

    panelDom.openSettingsPanel = () => {
      settingsModal?.open()
    }
    panelDom.closeSettingsPanel = (options = {}) => {
      settingsModal?.close(options)
    }

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
    seasonLoader.resetSeasonLoader()
    let panelCreated = false

    try {
      await preferences.loadSettings()
      await history.loadHistory({ silent: true })
      preferences.applyPanelTheme()

      resetRuntimeState()

      const data = await analyzePage({
        deferTvSeasons: true,
        initialSeasonBatchSize: TV_SHOW_INITIAL_SEASON_BATCH,
      })
      const hasItems = Array.isArray(data.items) && data.items.length > 0
      const deferredSeasons = hydrator.normalizeDeferredSeasons(data.deferredSeasons)
      if (!hasItems && deferredSeasons.length === 0) {
        return false
      }

      hydrator.hydrate(data.items || [], deferredSeasons, data)
      applyAutoBaseDir(state.classificationDetails || state.classification)
      logging.resetLogs()
      history.applyHistoryToCurrentPage()

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
      })

      const floatingPanel = panelShell.panel
      setFloatingPanel(floatingPanel)

      settingsModal = settingsCoordinator.attachToShell(panelShell)

      panelCreated = true

      history.renderHistoryDetail()
      bindPanelInteractions(panelShell)
      renderInitialState()

      if (state.deferredSeasonInfos.length) {
        void seasonLoader.ensureDeferredSeasonLoading().catch((error) => {
          console.error('[Chaospace Transfer] Failed to schedule deferred season loading:', error)
        })
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to create floating panel:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      showToast('error', '创建面板失败', message)
    } finally {
      panelCreationInProgress = false
    }
    return panelCreated
  }

  const disposePanel = (): void => {
    disposeBinders()
    settingsModal?.destroy()
    settingsModal = null
    setFloatingPanel(null)
  }

  return {
    createPanel,
    isCreating: () => panelCreationInProgress,
    disposePanel,
    getSettingsHandle: () => settingsModal,
  }
}
