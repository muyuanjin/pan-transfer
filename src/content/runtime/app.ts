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
import { createPresetsBinder } from './ui/binders/presets-binder'
import { createHistoryListBinder } from './ui/binders/history-list-binder'
import { createHistoryTabsBinder } from './ui/binders/history-tabs-binder'
import { createHistorySearchBinder } from './ui/binders/history-search-binder'
import { createPosterPreviewBinder } from './ui/binders/poster-preview-binder'
import { createItemSelectionBinder } from './ui/binders/item-selection-binder'
import { createSeasonTabsBinder } from './ui/binders/season-tabs-binder'
import { createToolbarBinder } from './ui/binders/toolbar-binder'
import { createSortingBinder } from './ui/binders/sorting-binder'
import { createTransferBinder } from './ui/binders/transfer-binder'
import { createPinButtonBinder } from './ui/binders/pin-button-binder'
import { mountPanelShell } from '../components/panel'
import { showToast } from '../components/toast'
import { createTabSeasonPreferenceController } from '../services/tab-season-preference'

export function createRuntimeApp() {
  const panelState = createPanelRuntimeState()
  let floatingPanel: HTMLElement | null = null
  let cleanupChromeEvents: (() => void) | null = null
  let initialized = false
  let tabSeasonPreference: ReturnType<typeof createTabSeasonPreferenceController> | null = null

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

  const logging = createLoggingController({
    state,
    panelDom,
    document,
  })

  const headerPresenter = createHeaderPresenter()

  const preferences = createPanelPreferencesController({
    state,
    panelDom,
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
    panelDom,
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

  const pageDataHydrator = createPageDataHydrator()

  const transferController = createTransferController({
    panelDom,
    logging,
    preferences,
    history,
    getFloatingPanel,
    updateTransferButton: () => headerPresenter.updateTransferButton(),
    renderPathPreview: () => preferences.renderPathPreview(),
    seasonPreference: tabSeasonPreference!,
  })

  const baseDirBinder = createBaseDirBinder({
    panelDom,
    state,
    preferences,
    showToast,
    seasonPreference: tabSeasonPreference!,
  })

  const presetsBinder = createPresetsBinder({
    panelDom,
    state,
    preferences,
  })

  const historyListBinder = createHistoryListBinder({
    panelDom,
    state,
    history,
  })

  const historyTabsBinder = createHistoryTabsBinder({
    panelDom,
    state,
    history,
  })

  const historySearchBinder = createHistorySearchBinder({
    panelDom,
    state,
    history,
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

  const toolbarBinder = createToolbarBinder({
    getFloatingPanel,
    selection: selectionController,
    history,
  })

  const sortingBinder = createSortingBinder({
    panelDom,
    state,
    renderResourceList: () => resourceRenderer.renderResourceList(),
  })

  const transferBinder = createTransferBinder({
    panelDom,
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
      historyTabsBinder,
      historySearchBinder,
      posterPreviewBinder,
      baseDirBinder,
      presetsBinder,
      itemSelectionBinder,
      seasonTabsBinder,
      toolbarBinder,
      historyListBinder,
      sortingBinder,
      transferBinder,
    ],
    shellBinderFactories: [
      (shell) =>
        createPinButtonBinder({
          panelDom,
          panelState,
          edgeController,
          scheduleEdgeHide: shell.scheduleEdgeHide,
          cancelEdgeHide: shell.cancelEdgeHide,
        }),
    ],
    getFloatingPanel,
    setFloatingPanel: (panel) => {
      floatingPanel = panel
    },
    showToast,
    seasonPreference: tabSeasonPreference!,
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
      if (panelDom.useSeasonCheckbox) {
        panelDom.useSeasonCheckbox.checked = state.useSeasonSubdir
      }
      if (panelDom.settingsUseSeason) {
        panelDom.settingsUseSeason.checked = state.seasonSubdirDefault
      }
    }
  }

  const injectStyles = (): void => {
    if (document.getElementById('chaospace-float-styles')) {
      return
    }

    try {
      const link = document.createElement('link')
      link.id = 'chaospace-float-styles'
      link.rel = 'stylesheet'
      link.href = chrome.runtime.getURL('content/styles/index.css')

      document.head?.appendChild(link)
    } catch (error) {
      console.error('[Chaospace] Failed to inject styles:', error)
    }
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
    initialized = false
  }

  return { init, destroy }
}
