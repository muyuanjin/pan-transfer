import {
  POSITION_KEY,
  SIZE_KEY,
  TV_SHOW_INITIAL_SEASON_BATCH,
  EDGE_HIDE_DELAY,
  EDGE_HIDE_MIN_PEEK,
  EDGE_HIDE_MAX_PEEK,
  EDGE_HIDE_DEFAULT_PEEK,
  INITIAL_PANEL_DELAY_MS,
  PANEL_CREATION_RETRY_DELAY_MS,
  PANEL_CREATION_MAX_ATTEMPTS,
} from '../constants'
import { state, panelDom, detailDom } from '../state'
import { createLoggingController } from '../controllers/logging-controller'
import { createPanelPreferencesController } from '../controllers/panel-preferences'
import { createPanelEdgeController } from '../controllers/panel-edge-controller'
import {
  analyzePage,
  suggestDirectoryFromClassification,
  isSupportedDetailPage,
  fetchHtmlDocument,
  extractItemsFromDocument,
  extractSeasonPageCompletion,
  extractPosterDetails,
} from '../services/page-analyzer'
import {
  updateSeasonExampleDir,
  computeSeasonTabState,
  filterItemsForActiveSeason,
  renderSeasonHint,
  renderSeasonControls,
  renderSeasonTabs,
  getTargetPath,
} from '../services/season-manager'
import { createResourceListRenderer } from '../components/resource-list'
import type { ResourceListPanelDom } from '../components/resource-list'
import { createHistoryController } from '../history/controller'
import { createSettingsModal } from '../components/settings-modal'
import { mountPanelShell } from '../components/panel'
import { showToast } from '../components/toast'
import { installZoomPreview } from '../components/zoom-preview'
import { safeStorageSet, safeStorageRemove } from '../utils/storage'
import { formatOriginLabel } from '../utils/format'
import type { PanelRuntimeState } from '../types'
import { createPanelRuntimeState } from './panel-state'
import { createTransferController } from './transfer/transfer-controller'
import { createHeaderPresenter } from './ui/header-presenter'
import { createSelectionController } from './ui/selection-controller'
import { createPageDataHydrator } from './page-data-hydrator'
import { registerChromeEvents } from './lifecycle/chrome-events'
import { closestElement } from '../utils/dom'
import type { PanelCreationResult, PanelShellInstance, SettingsModalHandle } from './types'
import { createSeasonLoader } from '../services/season-loader'
import { createBaseDirBinder } from './ui/binders/base-dir-binder'
import { createPresetsBinder } from './ui/binders/presets-binder'
import { createHistoryListBinder } from './ui/binders/history-list-binder'

type HistoryController = ReturnType<typeof createHistoryController>

export class ContentRuntime {
  private floatingPanel: HTMLElement | null = null
  private settingsModalRef: SettingsModalHandle | null = null
  private panelCreationInProgress = false
  private mutationObserver: MutationObserver | null = null
  private mutationObserverTimer: number | null = null
  private panelBinderDisposers: Array<() => void> = []

  private readonly panelState: PanelRuntimeState = createPanelRuntimeState()

  private readonly logging = createLoggingController({
    state,
    panelDom,
    document,
  })

  private readonly headerPresenter = createHeaderPresenter()

  private readonly preferences = createPanelPreferencesController({
    state,
    panelDom,
    document,
    getFloatingPanel: () => this.floatingPanel,
    renderSeasonHint,
    updateSeasonExampleDir,
    getTargetPath,
    showToast,
  })

  private readonly edgeController = createPanelEdgeController({
    state,
    panelState: this.panelState,
    panelDom,
    detailDom,
    getFloatingPanel: () => this.floatingPanel,
  })

  private readonly resourceRenderer = createResourceListRenderer({
    state,
    panelDom: panelDom as unknown as ResourceListPanelDom,
    renderSeasonTabs,
    filterItemsForActiveSeason,
    computeSeasonTabState,
    renderSeasonControls,
    updateTransferButton: () => this.headerPresenter.updateTransferButton(),
    updatePanelHeader: () => this.headerPresenter.updateHeader(),
  })

  private readonly seasonLoader = createSeasonLoader({
    getFloatingPanel: () => this.floatingPanel,
    fetchHtmlDocument,
    extractItemsFromDocument,
    extractSeasonPageCompletion,
    extractPosterDetails,
    renderResourceList: () => this.renderResourceList(),
    renderPathPreview: () => this.preferences.renderPathPreview(),
    updatePanelHeader: () => this.headerPresenter.updateHeader(),
    updateTransferButton: () => this.headerPresenter.updateTransferButton(),
  })

  private readonly history: HistoryController = createHistoryController({
    getFloatingPanel: () => this.floatingPanel,
    panelState: this.panelState,
    renderResourceList: () => this.renderResourceList(),
    renderPathPreview: () => this.preferences.renderPathPreview(),
    renderSeasonHint,
  })

  private readonly selectionController = createSelectionController({
    renderResourceList: () => this.renderResourceList(),
  })

  private readonly pageDataHydrator = createPageDataHydrator()

  private readonly transferController = createTransferController({
    panelDom,
    logging: this.logging,
    preferences: this.preferences,
    history: this.history,
    getFloatingPanel: () => this.floatingPanel,
    updateTransferButton: () => this.headerPresenter.updateTransferButton(),
    renderPathPreview: () => this.preferences.renderPathPreview(),
  })

  private readonly baseDirBinder = createBaseDirBinder({
    panelDom,
    state,
    preferences: this.preferences,
    renderResourceList: () => this.renderResourceList(),
    showToast,
  })

  private readonly presetsBinder = createPresetsBinder({
    panelDom,
    state,
    preferences: this.preferences,
  })

  private readonly historyListBinder = createHistoryListBinder({
    panelDom,
    state,
    history: this.history,
  })

  init(): void {
    if (!isSupportedDetailPage()) {
      return
    }

    installZoomPreview()
    this.injectStyles()
    registerChromeEvents({
      history: this.history,
      applyTheme: () => this.preferences.applyPanelTheme(),
      rerenderSettingsIfOpen: () => {
        if (state.settingsPanel.isOpen) {
          this.settingsModalRef?.render()
        }
      },
      renderResourceList: () => this.renderResourceList(),
      setStatusProgress: (progress) => this.transferController.handleProgressEvent(progress),
      getFloatingPanel: () => this.floatingPanel,
      analyzePageForMessage: () => analyzePage(),
    })
    this.scheduleInitialPanelCreation()
    this.observeDomChanges()
  }

  private renderResourceList(): void {
    this.resourceRenderer.renderResourceList()
  }

  private renderResourceSummary(): void {
    this.resourceRenderer.renderResourceSummary()
  }

  private applyAutoBaseDir(
    classificationInput: unknown,
    { persist = false }: { persist?: boolean } = {},
  ): boolean {
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

    const suggestion = suggestDirectoryFromClassification(
      detail || (type as string | undefined),
    ) as string | null
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

    this.preferences.setBaseDir(suggestion, { persist, lockOverride: false })
    return true
  }

  private async createFloatingPanel(): Promise<boolean> {
    if (this.floatingPanel || this.panelCreationInProgress) {
      return Boolean(this.floatingPanel)
    }
    this.panelCreationInProgress = true
    this.seasonLoader.resetSeasonLoader()
    let panelCreated = false

    try {
      await this.preferences.loadSettings()
      await this.history.loadHistory({ silent: true })
      this.preferences.applyPanelTheme()

      this.resetRuntimeState()

      const data = await analyzePage({
        deferTvSeasons: true,
        initialSeasonBatchSize: TV_SHOW_INITIAL_SEASON_BATCH,
      })
      const hasItems = Array.isArray(data.items) && data.items.length > 0
      const deferredSeasons = this.pageDataHydrator.normalizeDeferredSeasons(data.deferredSeasons)
      if (!hasItems && deferredSeasons.length === 0) {
        return false
      }

      this.pageDataHydrator.hydrate(data.items || [], deferredSeasons, data)
      this.applyAutoBaseDir(state.classificationDetails || state.classification)
      this.logging.resetLogs()
      this.history.applyHistoryToCurrentPage()

      const originLabel = formatOriginLabel(state.origin)

      const panelShell = await mountPanelShell({
        document,
        window,
        panelDom,
        panelState: this.panelState,
        pageTitle: state.pageTitle,
        originLabel,
        theme: state.theme,
        handleDocumentPointerDown: this.edgeController.handleDocumentPointerDown,
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
      this.floatingPanel = floatingPanel

      const creationResult: PanelCreationResult = {
        panel: floatingPanel,
        shell: panelShell,
        settings: this.initializeSettingsModal(panelShell),
      }
      this.settingsModalRef = creationResult.settings

      panelCreated = true

      this.history.renderHistoryDetail()
      this.bindPanelInteractions(creationResult)
      this.renderInitialState()

      if (!this.panelState.isPinned) {
        panelShell.scheduleEdgeHide(EDGE_HIDE_DELAY)
      }

      if (state.deferredSeasonInfos.length) {
        void this.seasonLoader.ensureDeferredSeasonLoading().catch((error) => {
          console.error('[Chaospace Transfer] Failed to schedule deferred season loading:', error)
        })
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to create floating panel:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      showToast('error', '创建面板失败', message)
    } finally {
      this.panelCreationInProgress = false
    }
    return panelCreated
  }

  private initializeSettingsModal(shell: PanelShellInstance): SettingsModalHandle {
    const {
      applyPanelSize,
      applyPanelPosition,
      getPanelBounds,
      scheduleEdgeHide,
      cancelEdgeHide,
      applyEdgeHiddenPosition,
    } = shell

    this.panelState.getPanelBounds = getPanelBounds
    this.panelState.scheduleEdgeHide = scheduleEdgeHide
    this.panelState.cancelEdgeHide = cancelEdgeHide
    this.panelState.applyEdgeHiddenPosition = applyEdgeHiddenPosition

    const handleResetLayout = async () => {
      try {
        await safeStorageRemove([POSITION_KEY, SIZE_KEY], 'panel geometry reset')
        const bounds = getPanelBounds()
        const defaultWidth = Math.min(640, bounds.maxWidth)
        const defaultHeight = Math.min(520, bounds.maxHeight)
        applyPanelSize(defaultWidth, defaultHeight)
        const defaultPosition = applyPanelPosition(undefined, undefined)
        this.panelState.lastKnownPosition = defaultPosition
        this.panelState.edgeState.isHidden = false
        applyEdgeHiddenPosition()
        cancelEdgeHide({ show: true })
        showToast('success', '布局已重置', '面板大小与位置已恢复默认值')
      } catch (error) {
        console.error('[Chaospace Transfer] Failed to reset layout', error)
        const message = error instanceof Error ? error.message : '无法重置面板布局'
        showToast('error', '重置失败', message)
      }
    }

    return createSettingsModal({
      document,
      floatingPanel: shell.panel,
      panelState: this.panelState,
      scheduleEdgeHide,
      cancelEdgeHide,
      applyPanelSize,
      applyPanelPosition,
      showToast,
      setBaseDir: (value, options) => {
        const normalized = options || {}
        this.preferences.setBaseDir(value, {
          persist:
            typeof normalized['persist'] === 'boolean' ? (normalized['persist'] as boolean) : true,
          fromPreset:
            typeof normalized['fromPreset'] === 'boolean'
              ? (normalized['fromPreset'] as boolean)
              : false,
          lockOverride:
            typeof normalized['lockOverride'] === 'boolean'
              ? (normalized['lockOverride'] as boolean)
              : null,
        })
      },
      renderSeasonHint,
      renderResourceList: () => this.renderResourceList(),
      applyPanelTheme: () => this.preferences.applyPanelTheme(),
      saveSettings: () => {
        void this.preferences.saveSettings()
      },
      safeStorageSet,
      safeStorageRemove,
      loadSettings: () => this.preferences.loadSettings(),
      loadHistory: () => this.history.loadHistory(),
      closeHistoryDetail: (options) => this.history.closeHistoryDetail(options),
      onResetLayout: handleResetLayout,
    })
  }

  private bindPanelInteractions({ panel, shell }: PanelCreationResult): void {
    const {
      scheduleEdgeHide,
      cancelEdgeHide,
      getPanelBounds,
      applyEdgeHiddenPosition,
      syncPanelLayout,
      applyPanelPosition,
    } = shell

    this.panelBinderDisposers.forEach((dispose) => dispose())
    this.panelBinderDisposers = []

    this.panelState.scheduleEdgeHide = scheduleEdgeHide
    this.panelState.cancelEdgeHide = cancelEdgeHide
    this.panelState.getPanelBounds = getPanelBounds
    this.panelState.applyEdgeHiddenPosition = applyEdgeHiddenPosition

    panelDom.openSettingsPanel = () => {
      this.settingsModalRef?.open()
    }
    panelDom.closeSettingsPanel = (options = {}) => {
      this.settingsModalRef?.close(options)
    }

    this.edgeController.updatePinButton()

    this.bindHistoryTabs()
    this.bindHistorySearch()
    this.bindPinButton(scheduleEdgeHide, cancelEdgeHide)
    this.bindPosterPreview(panel)
    this.panelBinderDisposers.push(this.baseDirBinder.bind())
    this.panelBinderDisposers.push(this.presetsBinder.bind())
    this.bindItemSelection()
    this.bindSeasonTabs()
    this.bindToolbar()
    this.panelBinderDisposers.push(this.historyListBinder.bind())
    this.bindSortingControls()
    this.bindTransferButton()

    const bounds = getPanelBounds()
    this.panelState.lastKnownSize = { width: bounds.maxWidth, height: bounds.maxHeight }
    this.panelState.lastKnownPosition = applyPanelPosition(undefined, undefined)

    syncPanelLayout()
  }

  private bindHistoryTabs(): void {
    if (!panelDom.historyTabs) {
      return
    }
    panelDom.historyTabs.querySelectorAll('[data-filter]').forEach((button) => {
      const value = button instanceof HTMLElement ? button.dataset?.['filter'] || 'all' : 'all'
      button.classList.toggle('is-active', value === state.historyFilter)
    })
    panelDom.historyTabs.addEventListener('click', (event) => {
      const tab = closestElement<HTMLButtonElement>(
        event.target,
        '.chaospace-history-tab[data-filter]',
      )
      if (!tab || tab.classList.contains('is-active')) {
        return
      }
      const filter = tab.dataset?.['filter'] || 'all'
      this.history.setHistoryFilter(filter)
    })
  }

  private bindHistorySearch(): void {
    const input = panelDom.historySearch ?? null
    const clearBtn = panelDom.historySearchClear ?? null
    if (!input) {
      return
    }
    input.value = state.historySearchTerm || ''
    const handleInput = () => {
      this.history.setHistorySearchTerm(input.value)
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !input.value) {
        return
      }
      event.preventDefault()
      this.history.setHistorySearchTerm('')
      input.focus()
    }
    input.addEventListener('input', handleInput)
    input.addEventListener('keydown', handleKeydown)
    this.panelBinderDisposers.push(() => {
      input.removeEventListener('input', handleInput)
      input.removeEventListener('keydown', handleKeydown)
    })
    if (clearBtn) {
      clearBtn.hidden = !state.historySearchTerm
      clearBtn.disabled = !state.historySearchTerm
      const handleClear = () => {
        if (!state.historySearchTerm) {
          return
        }
        this.history.setHistorySearchTerm('')
        input.focus()
      }
      clearBtn.addEventListener('click', handleClear)
      this.panelBinderDisposers.push(() => {
        clearBtn.removeEventListener('click', handleClear)
      })
    }
  }

  private bindPinButton(
    scheduleEdgeHide: (delay?: number) => void,
    cancelEdgeHide: (options?: { show?: boolean }) => void,
  ): void {
    if (!panelDom.pinBtn) {
      return
    }
    panelDom.pinBtn.addEventListener('click', (event) => {
      const nextPinnedState = !this.panelState.isPinned
      this.panelState.isPinned = nextPinnedState
      this.edgeController.updatePinButton()
      if (nextPinnedState) {
        cancelEdgeHide({ show: true })
      } else {
        const isPointerLikeActivation =
          (typeof (event as MouseEvent)?.detail === 'number' && (event as MouseEvent).detail > 0) ||
          (typeof (event as MouseEvent)?.clientX === 'number' &&
            typeof (event as MouseEvent)?.clientY === 'number' &&
            ((event as MouseEvent).clientX !== 0 || (event as MouseEvent).clientY !== 0))
        if (isPointerLikeActivation && typeof panelDom.pinBtn?.blur === 'function') {
          panelDom.pinBtn.blur()
        }
        if (!this.panelState.pointerInside) {
          scheduleEdgeHide()
        }
      }
    })
  }

  private bindPosterPreview(panel: HTMLElement | null): void {
    if (!panelDom.headerPoster || !panel) {
      return
    }
    panelDom.headerPoster.addEventListener('click', () => {
      const src = panelDom.headerPoster?.dataset?.['src']
      if (src) {
        window.openZoomPreview?.({
          src,
          alt:
            panelDom.headerPoster?.dataset?.['alt'] ||
            panelDom.headerPoster?.alt ||
            state.pageTitle ||
            '',
        })
      }
    })

    panel.addEventListener('click', (event) => {
      const toggleBtn = closestElement<HTMLElement>(event.target, '[data-role="history-toggle"]')
      if (!toggleBtn || !panel.contains(toggleBtn)) {
        return
      }
      if (!state.historyGroups.length) {
        return
      }
      this.history.toggleHistoryExpanded()
    })
  }

  private bindItemSelection(): void {
    if (!panelDom.itemsContainer) {
      return
    }
    panelDom.itemsContainer.addEventListener('change', (event) => {
      const checkbox = closestElement<HTMLInputElement>(event.target, '.chaospace-item-checkbox')
      if (!checkbox) return
      const row = checkbox.closest<HTMLElement>('.chaospace-item')
      const id = row?.dataset?.['id']
      if (!id) return
      if (checkbox.checked) {
        state.selectedIds.add(id)
      } else {
        state.selectedIds.delete(id)
      }
      row.classList.toggle('is-muted', !checkbox.checked)
      this.renderResourceSummary()
      this.headerPresenter.updateTransferButton()
    })
  }

  private bindSeasonTabs(): void {
    if (!panelDom.seasonTabs) {
      return
    }
    panelDom.seasonTabs.addEventListener('click', (event) => {
      const button = closestElement<HTMLButtonElement>(event.target, 'button[data-season-id]')
      if (!button || button.disabled) {
        return
      }
      const nextId = button.dataset?.['seasonId']
      if (!nextId || nextId === state.activeSeasonId) {
        return
      }
      state.activeSeasonId = nextId
      this.renderResourceList()
      if (panelDom.itemsContainer) {
        panelDom.itemsContainer.scrollTop = 0
      }
    })
  }

  private bindToolbar(): void {
    const toolbar = this.floatingPanel?.querySelector('.chaospace-select-group')
    if (!toolbar) {
      return
    }
    toolbar.addEventListener('click', (event) => {
      const button = closestElement<HTMLButtonElement>(event.target, 'button[data-action]')
      if (!button) return
      const action = button.dataset?.['action']
      if (action === 'select-all') {
        this.selectionController.selectAll(true)
      } else if (action === 'select-invert') {
        this.selectionController.invert()
      } else if (action === 'select-new') {
        this.history.selectNewItems()
      }
    })
  }

  private bindSortingControls(): void {
    if (panelDom.sortKeySelect) {
      panelDom.sortKeySelect.value = state.sortKey
      panelDom.sortKeySelect.addEventListener('change', () => {
        if (!panelDom.sortKeySelect) {
          return
        }
        state.sortKey = panelDom.sortKeySelect.value as 'page' | 'title'
        this.renderResourceList()
      })
    }

    if (panelDom.sortOrderButton) {
      const refreshOrderButton = () => {
        if (!panelDom.sortOrderButton) {
          return
        }
        panelDom.sortOrderButton.textContent = state.sortOrder === 'asc' ? '正序' : '倒序'
      }
      refreshOrderButton()
      panelDom.sortOrderButton.addEventListener('click', () => {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
        refreshOrderButton()
        this.renderResourceList()
      })
    }
  }

  private bindTransferButton(): void {
    if (!panelDom.transferBtn) {
      return
    }
    panelDom.transferBtn.addEventListener('click', () => {
      void this.transferController.handleTransfer()
    })
  }

  private renderInitialState(): void {
    this.headerPresenter.updateHeader()

    this.preferences.applyPanelTheme()

    this.preferences.renderPresets()
    this.preferences.renderPathPreview()
    this.history.applyHistoryToCurrentPage()
    this.history.renderHistoryCard()
    this.history.updateHistoryExpansion()
    this.renderResourceList()
    this.logging.setStatus('idle', state.statusMessage)
    this.logging.renderLogs()
    this.headerPresenter.updateTransferButton()
  }

  private resetRuntimeState(): void {
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

  private injectStyles(): void {
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

  private scheduleInitialPanelCreation(): void {
    let attempts = 0
    const tryCreate = async () => {
      if (this.floatingPanel || this.panelCreationInProgress) {
        return
      }
      attempts += 1
      const created = await this.createFloatingPanel()
      if (created || this.floatingPanel) {
        return
      }
      if (attempts < PANEL_CREATION_MAX_ATTEMPTS) {
        window.setTimeout(tryCreate, PANEL_CREATION_RETRY_DELAY_MS)
      }
    }

    if (INITIAL_PANEL_DELAY_MS <= 0) {
      void tryCreate()
    } else {
      window.setTimeout(() => void tryCreate(), INITIAL_PANEL_DELAY_MS)
    }
  }

  private observeDomChanges(): void {
    if (this.mutationObserver) {
      return
    }
    const observer = new MutationObserver(() => {
      if (this.mutationObserverTimer) {
        window.clearTimeout(this.mutationObserverTimer)
      }
      this.mutationObserverTimer = window.setTimeout(async () => {
        try {
          if (!this.floatingPanel && !this.panelCreationInProgress) {
            const data = await analyzePage()
            if (data.items && data.items.length > 0) {
              await this.createFloatingPanel()
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
      this.mutationObserver = observer
    }
  }
}
