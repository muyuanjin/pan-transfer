import {
  STORAGE_KEY,
  POSITION_KEY,
  SIZE_KEY,
  HISTORY_KEY,
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
  normalizeDir,
  normalizePageUrl,
  isSupportedDetailPage,
  fetchHtmlDocument,
  extractItemsFromDocument,
  extractSeasonPageCompletion,
  extractPosterDetails,
  buildPanDirectoryUrl,
  sanitizeSeasonDirSegment,
} from '../services/page-analyzer'
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
} from '../services/season-manager'
import { createSeasonLoader } from '../services/season-loader'
import { prepareHistoryRecords } from '../services/history-service'
import { createResourceListRenderer } from '../components/resource-list'
import type { ResourceListPanelDom } from '../components/resource-list'
import { createHistoryController } from '../history/controller'
import { createSettingsModal, clampHistoryRateLimit } from '../components/settings-modal'
import { mountPanelShell } from '../components/panel'
import { showToast } from '../components/toast'
import { installZoomPreview } from '../components/zoom-preview'
import { disableElementDrag } from '../utils/dom'
import { safeStorageSet, safeStorageRemove } from '../utils/storage'
import { formatOriginLabel, sanitizeCssUrl } from '../utils/format'
import { summarizeSeasonCompletion } from '@/shared/utils/completion-status'
import type { PanelRuntimeState, DeferredSeasonInfo, ResourceItem } from '../types'
import { createPanelRuntimeState } from './panel-state'

type PanelShellInstance = Awaited<ReturnType<typeof mountPanelShell>>
type SettingsModalHandle = ReturnType<typeof createSettingsModal>
type HistoryController = ReturnType<typeof createHistoryController>

interface PanelCreationResult {
  panel: HTMLElement
  shell: PanelShellInstance
  settings: SettingsModalHandle
}

export class ContentRuntime {
  private floatingPanel: HTMLElement | null = null
  private settingsModalRef: SettingsModalHandle | null = null
  private panelCreationInProgress = false
  private mutationObserver: MutationObserver | null = null
  private mutationObserverTimer: number | null = null

  private readonly panelState: PanelRuntimeState = createPanelRuntimeState()

  private readonly logging = createLoggingController({
    state,
    panelDom,
    document,
  })

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
    updateTransferButton: () => this.updateTransferButton(),
    updatePanelHeader: () => this.updatePanelHeader(),
  })

  private readonly seasonLoader = createSeasonLoader({
    getFloatingPanel: () => this.floatingPanel,
    fetchHtmlDocument,
    extractItemsFromDocument,
    extractSeasonPageCompletion,
    extractPosterDetails,
    renderResourceList: () => this.renderResourceList(),
    renderPathPreview: () => this.preferences.renderPathPreview(),
    updatePanelHeader: () => this.updatePanelHeader(),
    updateTransferButton: () => this.updateTransferButton(),
  })

  private readonly history: HistoryController = createHistoryController({
    getFloatingPanel: () => this.floatingPanel,
    panelState: this.panelState,
    renderResourceList: () => this.renderResourceList(),
    renderPathPreview: () => this.preferences.renderPathPreview(),
    renderSeasonHint,
  })

  init(): void {
    if (!isSupportedDetailPage()) {
      return
    }

    installZoomPreview()
    this.injectStyles()
    this.registerChromeListeners()
    this.scheduleInitialPanelCreation()
    this.observeDomChanges()
  }

  private renderResourceList(): void {
    this.resourceRenderer.renderResourceList()
  }

  private renderResourceSummary(): void {
    this.resourceRenderer.renderResourceSummary()
  }

  private updatePanelHeader(): void {
    const hasPoster = Boolean(state.poster && state.poster.src)
    if (panelDom.showTitle) {
      const title = state.pageTitle || state.poster?.alt || '等待选择剧集'
      panelDom.showTitle.textContent = title
    }
    if (panelDom.showSubtitle) {
      const label = formatOriginLabel(state.origin)
      const hasItemsArray = Array.isArray(state.items)
      const itemCount = hasItemsArray ? state.items.length : 0
      const infoParts: string[] = []
      if (label) {
        infoParts.push(`来源 ${label}`)
      }
      if (hasItemsArray) {
        infoParts.push(`解析到 ${itemCount} 项资源`)
      }
      if (state.completion?.label) {
        infoParts.push(state.completion.label)
      }
      panelDom.showSubtitle.textContent = infoParts.length
        ? infoParts.join(' · ')
        : '未检测到页面来源'
    }
    if (panelDom.header) {
      panelDom.header.classList.toggle('has-poster', hasPoster)
    }
    if (panelDom.headerArt) {
      if (hasPoster && state.poster?.src) {
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
      if (hasPoster && state.poster?.src) {
        panelDom.headerPoster.src = state.poster.src
        panelDom.headerPoster.alt = state.poster.alt || ''
        panelDom.headerPoster.style.display = 'block'
        panelDom.headerPoster.dataset['action'] = 'preview-poster'
        panelDom.headerPoster.dataset['src'] = state.poster.src
        panelDom.headerPoster.dataset['alt'] = state.poster.alt || state.pageTitle || ''
        panelDom.headerPoster.classList.add('is-clickable')
      } else {
        panelDom.headerPoster.removeAttribute('src')
        panelDom.headerPoster.alt = ''
        panelDom.headerPoster.style.display = 'none'
        delete panelDom.headerPoster.dataset['action']
        delete panelDom.headerPoster.dataset['src']
        delete panelDom.headerPoster.dataset['alt']
        panelDom.headerPoster.classList.remove('is-clickable')
      }
    }
  }

  private updateTransferButton(): void {
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

  private setSelectionAll(selected: boolean): void {
    const { tabItems, activeId } = computeSeasonTabState({ syncState: true })
    const hasTabs = Array.isArray(tabItems) && tabItems.length > 0
    const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items
    const visibleIds = visibleItems.map((item) => item?.id).filter(Boolean) as Array<
      string | number
    >

    if (selected) {
      visibleIds.forEach((id) => state.selectedIds.add(id))
    } else if (visibleIds.length) {
      visibleIds.forEach((id) => state.selectedIds.delete(id))
    } else if (!hasTabs) {
      state.selectedIds.clear()
    }
    this.renderResourceList()
  }

  private invertSelection(): void {
    const { tabItems, activeId } = computeSeasonTabState({ syncState: true })
    const hasTabs = Array.isArray(tabItems) && tabItems.length > 0
    const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items
    if (!visibleItems.length) {
      this.renderResourceList()
      return
    }
    const next = new Set(state.selectedIds)
    visibleItems.forEach((item) => {
      if (!item?.id) {
        return
      }
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.add(item.id)
      }
    })
    state.selectedIds = next
    this.renderResourceList()
  }

  private setPanelControlsDisabled(disabled: boolean): void {
    if (panelDom.baseDirInput) panelDom.baseDirInput.disabled = disabled
    if (panelDom.useTitleCheckbox) panelDom.useTitleCheckbox.disabled = disabled
    if (panelDom.useSeasonCheckbox) panelDom.useSeasonCheckbox.disabled = disabled
    if (panelDom.sortKeySelect) panelDom.sortKeySelect.disabled = disabled
    if (panelDom.sortOrderButton) panelDom.sortOrderButton.disabled = disabled
    if (panelDom.addPresetButton) panelDom.addPresetButton.disabled = disabled
    const selectGroup = this.floatingPanel?.querySelector('.chaospace-select-group')
    if (selectGroup) {
      selectGroup.querySelectorAll('button').forEach((button) => {
        button.disabled = disabled
      })
    }
    if (panelDom.presetList) {
      panelDom.presetList.classList.toggle('is-disabled', disabled)
    }
  }

  private handleProgressEvent(progress: unknown): void {
    if (!progress || typeof progress !== 'object') {
      return
    }
    const payload = progress as {
      jobId?: string | null
      message?: string
      level?: string
      detail?: string
      stage?: string
      statusMessage?: string
      current?: number
      total?: number
    }
    if (!payload.jobId || payload.jobId !== state.jobId) {
      return
    }
    if (payload.message) {
      this.logging.pushLog(payload.message, {
        level: (payload.level as never) || 'info',
        detail: payload.detail || '',
        stage: payload.stage || '',
      })
    }
    if (payload.statusMessage) {
      state.statusMessage = payload.statusMessage
      this.logging.renderStatus()
    } else if (typeof payload.current === 'number' && typeof payload.total === 'number') {
      state.statusMessage = `正在处理 ${payload.current}/${payload.total}`
      this.logging.renderStatus()
    }
  }

  private async handleTransfer(): Promise<void> {
    if (!this.floatingPanel || state.transferStatus === 'running') {
      return
    }

    const selectedItems = state.items.filter((item) => state.selectedIds.has(item.id))
    if (!selectedItems.length) {
      showToast('warning', '请选择资源', '至少勾选一个百度网盘资源再开始转存哦～')
      return
    }

    const baseDirValue = panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir
    this.preferences.setBaseDir(baseDirValue)
    if (panelDom.useTitleCheckbox) {
      state.useTitleSubdir = panelDom.useTitleCheckbox.checked
      void this.preferences.saveSettings()
    }
    if (panelDom.useSeasonCheckbox) {
      state.useSeasonSubdir = panelDom.useSeasonCheckbox.checked
      state.hasSeasonSubdirPreference = true
      dedupeSeasonDirMap()
      void this.preferences.saveSettings()
    }

    const targetDirectory = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle)

    state.jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    state.lastResult = null
    state.transferStatus = 'running'
    state.statusMessage = '正在准备转存...'
    this.logging.resetLogs()
    this.logging.pushLog('已锁定资源清单，准备开始转存', { stage: 'init' })
    this.logging.renderStatus()
    this.preferences.renderPathPreview()
    this.updateTransferButton()
    this.setPanelControlsDisabled(true)

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
          poster: state.poster?.src?.length
            ? { src: state.poster.src, alt: state.poster.alt || '' }
            : null,
        },
      }

      this.logging.pushLog(`向后台发送 ${selectedItems.length} 条转存请求`, {
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

      const { results = [], summary = '' } = response as {
        results: Array<{ status?: string }>
        summary?: string
      }
      const success = results.filter((r) => r.status === 'success').length
      const failed = results.filter((r) => r.status === 'failed').length
      const skipped = results.filter((r) => r.status === 'skipped').length
      const emoji = failed === 0 ? '🎯' : success > 0 ? '🟡' : '💥'
      const title = failed === 0 ? '转存成功' : success > 0 ? '部分成功' : '全部失败'

      state.lastResult = {
        title: `${emoji} ${title}`,
        detail: `成功 ${success} · 跳过 ${skipped} · 失败 ${failed}`,
      }

      this.logging.pushLog(`后台执行完成：${summary}`, {
        stage: 'complete',
        level: failed === 0 ? 'success' : 'warning',
      })

      this.logging.setStatus(failed === 0 ? 'success' : 'error', `${title}：${summary}`)

      await this.history.loadHistory()

      showToast(
        failed === 0 ? 'success' : success > 0 ? 'warning' : 'error',
        `${emoji} ${title}`,
        `已保存到 ${targetDirectory}`,
        { success, failed, skipped },
      )
    } catch (error) {
      console.error('[Chaospace Transfer] Transfer error', error)
      const message = error instanceof Error ? error.message : '后台执行发生未知错误'
      this.logging.pushLog(message, { level: 'error', stage: 'error' })
      this.logging.setStatus('error', `转存失败：${message}`)
      showToast('error', '转存失败', message)
    } finally {
      if (state.transferStatus === 'running') {
        this.logging.setStatus('idle', '准备就绪 ✨')
      }
      this.updateTransferButton()
      this.setPanelControlsDisabled(false)
      state.jobId = null
      state.transferStatus = 'idle'
    }
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
      const deferredSeasons = this.normalizeDeferredSeasons(data.deferredSeasons)
      if (!hasItems && deferredSeasons.length === 0) {
        return false
      }

      this.hydratePageAnalysis(data.items || [], deferredSeasons, data)

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
    this.bindPinButton(scheduleEdgeHide, cancelEdgeHide)
    this.bindPosterPreview(panel)
    this.bindBaseDirControls()
    this.bindPresetList()
    this.bindItemSelection()
    this.bindSeasonTabs()
    this.bindToolbar()
    this.bindHistoryList()
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
      const tab = this.closestElement<HTMLButtonElement>(
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
      const toggleBtn = this.closestElement<HTMLElement>(
        event.target,
        '[data-role="history-toggle"]',
      )
      if (!toggleBtn || !panel.contains(toggleBtn)) {
        return
      }
      if (!state.historyGroups.length) {
        return
      }
      this.history.toggleHistoryExpanded()
    })
  }

  private bindBaseDirControls(): void {
    if (panelDom.baseDirInput) {
      panelDom.baseDirInput.value = state.baseDir
      panelDom.baseDirInput.addEventListener('change', () => {
        this.preferences.setBaseDir(panelDom.baseDirInput?.value ?? state.baseDir)
      })
      panelDom.baseDirInput.addEventListener('input', () => {
        if (!panelDom.baseDirInput) {
          return
        }
        panelDom.baseDirInput.dataset['dirty'] = 'true'
        panelDom.baseDirInput.classList.remove('is-invalid')
        state.baseDir = normalizeDir(panelDom.baseDirInput.value)
        this.preferences.renderPathPreview()
      })
      panelDom.baseDirInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          if (!panelDom.baseDirInput) {
            return
          }
          this.preferences.setBaseDir(panelDom.baseDirInput.value)
          const preset = this.preferences.ensurePreset(panelDom.baseDirInput.value)
          if (preset) {
            showToast('success', '已收藏路径', `${preset} 已加入候选列表`)
          }
          this.preferences.renderPresets()
        }
      })
    }

    if (panelDom.useTitleCheckbox) {
      panelDom.useTitleCheckbox.checked = state.useTitleSubdir
      panelDom.useTitleCheckbox.addEventListener('change', () => {
        state.useTitleSubdir = Boolean(panelDom.useTitleCheckbox?.checked)
        void this.preferences.saveSettings()
        this.preferences.renderPathPreview()
      })
    }

    if (panelDom.useSeasonCheckbox) {
      panelDom.useSeasonCheckbox.checked = state.useSeasonSubdir
      panelDom.useSeasonCheckbox.addEventListener('change', () => {
        state.useSeasonSubdir = Boolean(panelDom.useSeasonCheckbox?.checked)
        state.hasSeasonSubdirPreference = true
        dedupeSeasonDirMap()
        updateSeasonExampleDir()
        this.preferences.renderPathPreview()
        this.renderResourceList()
        void this.preferences.saveSettings()
      })
    }

    if (panelDom.addPresetButton) {
      panelDom.addPresetButton.addEventListener('click', () => {
        const preset = this.preferences.ensurePreset(
          panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir,
        )
        if (preset) {
          this.preferences.setBaseDir(preset, { fromPreset: true })
          showToast('success', '已收藏路径', `${preset} 已加入候选列表`)
        }
      })
    }

    if (panelDom.themeToggle) {
      panelDom.themeToggle.addEventListener('click', () => {
        const nextTheme = state.theme === 'dark' ? 'light' : 'dark'
        this.preferences.setTheme(nextTheme)
      })
    }
  }

  private bindPresetList(): void {
    if (!panelDom.presetList) {
      return
    }
    panelDom.presetList.addEventListener('click', (event) => {
      if (state.transferStatus === 'running') {
        return
      }
      const target = this.closestElement<HTMLButtonElement>(
        event.target,
        'button[data-action][data-value]',
      )
      if (!target) return
      const { action, value } = target.dataset as { action?: string; value?: string }
      if (action === 'select' && value) {
        this.preferences.setBaseDir(value, { fromPreset: true })
      } else if (action === 'remove' && value) {
        this.preferences.removePreset(value)
      }
    })
  }

  private bindItemSelection(): void {
    if (!panelDom.itemsContainer) {
      return
    }
    panelDom.itemsContainer.addEventListener('change', (event) => {
      const checkbox = this.closestElement<HTMLInputElement>(
        event.target,
        '.chaospace-item-checkbox',
      )
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
      this.updateTransferButton()
    })
  }

  private bindSeasonTabs(): void {
    if (!panelDom.seasonTabs) {
      return
    }
    panelDom.seasonTabs.addEventListener('click', (event) => {
      const button = this.closestElement<HTMLButtonElement>(event.target, 'button[data-season-id]')
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
      const button = this.closestElement<HTMLButtonElement>(event.target, 'button[data-action]')
      if (!button) return
      const action = button.dataset?.['action']
      if (action === 'select-all') {
        this.setSelectionAll(true)
      } else if (action === 'select-invert') {
        this.invertSelection()
      } else if (action === 'select-new') {
        this.history.selectNewItems()
      }
    })
  }

  private bindHistoryList(): void {
    if (!panelDom.historyList) {
      return
    }

    if (panelDom.historySummaryBody) {
      const toggleHistoryFromSummary = () => {
        if (!state.historyRecords.length) {
          return
        }
        this.history.toggleHistoryExpanded()
      }

      panelDom.historySummaryBody.addEventListener('click', (event) => {
        const summaryEntry = this.closestElement<HTMLElement>(
          event.target,
          '[data-role="history-summary-entry"]',
        )
        if (!summaryEntry) {
          return
        }
        if (this.closestElement(event.target, '[data-role="history-toggle"]')) {
          return
        }
        toggleHistoryFromSummary()
      })

      panelDom.historySummaryBody.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        const summaryEntry = this.closestElement<HTMLElement>(
          event.target,
          '[data-role="history-summary-entry"]',
        )
        if (!summaryEntry) {
          return
        }
        if (this.closestElement(event.target, '[data-role="history-toggle"]')) {
          return
        }
        event.preventDefault()
        toggleHistoryFromSummary()
      })
    }

    if (panelDom.historySelectAll) {
      panelDom.historySelectAll.addEventListener('change', (event) => {
        if (state.historyBatchRunning) {
          event.preventDefault()
          this.history.updateHistorySelectionSummary()
          return
        }
        this.history.setHistorySelectAll(Boolean((event.target as HTMLInputElement)?.checked))
      })
    }

    if (panelDom.historyBatchCheck) {
      panelDom.historyBatchCheck.addEventListener('click', () => {
        this.history.handleHistoryBatchCheck()
      })
    }

    if (panelDom.historyDeleteSelected) {
      panelDom.historyDeleteSelected.addEventListener('click', () => {
        this.history.handleHistoryDeleteSelected()
      })
    }

    if (panelDom.historyClear) {
      panelDom.historyClear.addEventListener('click', () => {
        this.history.handleHistoryClear()
      })
    }

    panelDom.historyList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }

      const seasonToggle = this.closestElement<HTMLElement>(
        target,
        '[data-role="history-season-toggle"]',
      )
      if (seasonToggle) {
        const groupKey = seasonToggle.getAttribute('data-group-key')
        if (!groupKey) {
          return
        }
        this.toggleSeasonGroup(seasonToggle as HTMLElement, groupKey)
        event.preventDefault()
        return
      }

      const actionButton = this.closestElement<HTMLButtonElement>(target, 'button[data-action]')
      if (actionButton) {
        this.handleHistoryAction(actionButton as HTMLButtonElement)
        return
      }

      const seasonRow = this.closestElement<HTMLElement>(
        target,
        '.chaospace-history-season-item[data-detail-trigger="season"]',
      )
      if (
        seasonRow &&
        !target.closest('.chaospace-history-actions') &&
        !target.closest('button') &&
        !target.closest('input')
      ) {
        const groupKey = seasonRow.getAttribute('data-group-key')
        if (groupKey) {
          const pageUrl = seasonRow.getAttribute('data-page-url') || ''
          const title = seasonRow.getAttribute('data-title') || ''
          const posterSrc = seasonRow.getAttribute('data-poster-src') || ''
          const posterAlt = seasonRow.getAttribute('data-poster-alt') || title
          const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null
          event.preventDefault()
          this.history.openHistoryDetail(groupKey, {
            pageUrl,
            title,
            poster,
          })
        }
        return
      }

      const detailTrigger = this.closestElement<HTMLElement>(
        target,
        '[data-action="history-detail"]',
      )
      if (detailTrigger) {
        const groupKey = detailTrigger.dataset?.['groupKey']
        if (groupKey) {
          event.preventDefault()
          this.history.openHistoryDetail(groupKey)
        }
        return
      }

      const historyItem = this.closestElement<HTMLElement>(
        target,
        '.chaospace-history-item[data-detail-trigger="group"]',
      )
      if (
        historyItem &&
        !target.closest('.chaospace-history-selector') &&
        !target.closest('.chaospace-history-actions') &&
        !target.closest('button') &&
        !target.closest('input') &&
        !target.closest('[data-role="history-season-toggle"]')
      ) {
        const groupKey = historyItem.getAttribute('data-group-key')
        if (groupKey) {
          this.history.openHistoryDetail(groupKey)
        }
      }
    })

    panelDom.historyList.addEventListener('change', (event) => {
      const checkbox = this.closestElement<HTMLInputElement>(
        event.target,
        'input[type="checkbox"][data-role="history-select-item"]',
      )
      if (!checkbox) return
      const groupKey = checkbox.dataset?.['groupKey']
      if (!groupKey) return
      this.history.setHistorySelection(groupKey, checkbox.checked)
    })

    panelDom.historyList.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }
      if (this.closestElement(event.target, 'button, input')) {
        return
      }
      const seasonRow = this.closestElement<HTMLElement>(
        event.target,
        '.chaospace-history-season-item[data-detail-trigger="season"]',
      )
      if (seasonRow) {
        const groupKey = seasonRow.getAttribute('data-group-key')
        if (groupKey) {
          const pageUrl = seasonRow.getAttribute('data-page-url') || ''
          const title = seasonRow.getAttribute('data-title') || ''
          const posterSrc = seasonRow.getAttribute('data-poster-src') || ''
          const posterAlt = seasonRow.getAttribute('data-poster-alt') || title
          const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null
          event.preventDefault()
          this.history.openHistoryDetail(groupKey, {
            pageUrl,
            title,
            poster,
          })
        }
        return
      }

      const detailTrigger = this.closestElement<HTMLElement>(
        event.target,
        '[data-action="history-detail"]',
      )
      if (detailTrigger) {
        const groupKey = detailTrigger.dataset?.['groupKey']
        if (groupKey) {
          event.preventDefault()
          this.history.openHistoryDetail(groupKey)
        }
        return
      }

      const historyItem = this.closestElement<HTMLElement>(
        event.target,
        '.chaospace-history-item[data-detail-trigger="group"]',
      )
      if (historyItem) {
        const groupKey = historyItem.getAttribute('data-group-key')
        if (!groupKey) {
          return
        }
        event.preventDefault()
        this.history.openHistoryDetail(groupKey)
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
      void this.handleTransfer()
    })
  }

  private toggleSeasonGroup(toggle: HTMLElement, groupKey: string): void {
    const expanded = state.historySeasonExpanded.has(groupKey)
    if (expanded) {
      state.historySeasonExpanded.delete(groupKey)
    } else {
      state.historySeasonExpanded.add(groupKey)
    }
    const isExpanded = state.historySeasonExpanded.has(groupKey)
    toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false')
    toggle.textContent = isExpanded ? '收起季' : '展开季'
    const container = toggle.closest('.chaospace-history-item')
    const list = container?.querySelector('[data-role="history-season-list"]') as HTMLElement | null
    if (list) {
      list.hidden = !isExpanded
    }
    if (container) {
      container.classList.toggle('is-season-expanded', isExpanded)
    }
  }

  private handleHistoryAction(button: HTMLButtonElement): void {
    const action = button.dataset?.['action']
    if (action === 'preview-poster') {
      if (!button.disabled) {
        const src = button.dataset?.['src']
        if (src) {
          window.openZoomPreview?.({
            src,
            alt: button.dataset?.['alt'] || button.getAttribute('aria-label') || '',
          })
        }
      }
      return
    }

    if (button.disabled) {
      return
    }

    const url = button.dataset?.['url']
    if (action === 'open') {
      if (url) {
        window.open(url, '_blank', 'noopener')
      }
    } else if (action === 'open-pan') {
      const panUrl = url || buildPanDirectoryUrl('/')
      window.open(panUrl, '_blank', 'noopener')
    } else if (action === 'check') {
      if (url) {
        this.history.triggerHistoryUpdate(url, button)
      }
    }
  }

  private renderInitialState(): void {
    this.updatePanelHeader()

    this.preferences.applyPanelTheme()

    this.preferences.renderPresets()
    this.preferences.renderPathPreview()
    this.history.applyHistoryToCurrentPage()
    this.history.renderHistoryCard()
    this.history.updateHistoryExpansion()
    this.renderResourceList()
    this.logging.setStatus('idle', state.statusMessage)
    this.logging.renderLogs()
    this.updateTransferButton()
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

  private closestElement<T extends Element = Element>(
    target: EventTarget | null,
    selector: string,
  ): T | null {
    if (!(target instanceof Element)) {
      return null
    }
    const match = target.closest(selector)
    return (match as T | null) ?? null
  }

  private normalizeDeferredSeasons(input: unknown): DeferredSeasonInfo[] {
    if (!Array.isArray(input)) {
      return []
    }
    return input
      .map((info) => {
        if (!info || typeof info !== 'object') {
          return null
        }
        const record = info as DeferredSeasonInfo
        const normalizedLabel =
          sanitizeSeasonDirSegment(record.label || '') ||
          (typeof record.label === 'string' && record.label.trim()) ||
          (Number.isFinite(record.index) ? `第${Number(record.index) + 1}季` : '')
        return {
          ...record,
          label: normalizedLabel,
        }
      })
      .filter(Boolean) as DeferredSeasonInfo[]
  }

  private hydratePageAnalysis(
    items: ResourceItem[],
    deferredSeasons: DeferredSeasonInfo[],
    data: Awaited<ReturnType<typeof analyzePage>>,
  ): void {
    state.pageTitle = data.title || ''
    state.pageUrl = normalizePageUrl(data.url || window.location.href)
    state.poster = data.poster || null
    state.origin = data.origin || window.location.origin
    state.completion = data.completion || null
    state.seasonCompletion = data.seasonCompletion ? { ...data.seasonCompletion } : {}
    state.seasonEntries = Array.isArray(data.seasonEntries)
      ? data.seasonEntries.map((entry) => {
          const entryRecord = entry as { seasonId?: string; id?: string }
          const normalizedLabel =
            sanitizeSeasonDirSegment(entry.label || '') ||
            (typeof entry.label === 'string' && entry.label.trim()) ||
            (Number.isFinite(entry.seasonIndex) ? `第${Number(entry.seasonIndex) + 1}季` : '')
          return {
            seasonId: entryRecord.seasonId || entryRecord.id || '',
            label: normalizedLabel,
            url: entry.url || '',
            seasonIndex: Number.isFinite(entry.seasonIndex) ? Number(entry.seasonIndex) : 0,
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
    this.applyAutoBaseDir(state.classificationDetails || state.classification)
    state.items = items.map((item, index) => {
      const normalizedLabel =
        sanitizeSeasonDirSegment(item.seasonLabel || '') ||
        (Number.isFinite(item.seasonIndex) ? `第${Number(item.seasonIndex) + 1}季` : '')
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
    this.logging.resetLogs()
    this.history.applyHistoryToCurrentPage()
    state.activeSeasonId = null

    const completionEntries = Object.values(state.seasonCompletion || {}).filter(Boolean)
    if (completionEntries.length) {
      state.completion = summarizeSeasonCompletion(completionEntries)
    }
  }

  private injectStyles(): void {
    if (document.getElementById('chaospace-float-styles')) {
      return
    }

    try {
      const link = document.createElement('link')
      link.id = 'chaospace-float-styles'
      link.rel = 'stylesheet'
      link.href = chrome.runtime.getURL('content/styles/main.css')

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

  private registerChromeListeners(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return
      }
      const settingsChange = changes[STORAGE_KEY]
      if (settingsChange?.newValue) {
        const nextTheme = settingsChange.newValue.theme
        if ((nextTheme === 'light' || nextTheme === 'dark') && nextTheme !== state.theme) {
          state.theme = nextTheme
          this.preferences.applyPanelTheme()
        }
        if (typeof settingsChange.newValue.historyRateLimitMs === 'number') {
          const nextRate = clampHistoryRateLimit(settingsChange.newValue.historyRateLimitMs)
          if (nextRate !== state.historyRateLimitMs) {
            state.historyRateLimitMs = nextRate
            if (state.settingsPanel.isOpen) {
              this.settingsModalRef?.render()
            }
          }
        }
      }
      const historyChange = changes[HISTORY_KEY]
      if (historyChange) {
        const prepared = prepareHistoryRecords(historyChange.newValue)
        state.historyRecords = prepared.records
        state.historyGroups = prepared.groups
        this.history.applyHistoryToCurrentPage()
        this.history.renderHistoryCard()
        if (this.floatingPanel) {
          this.renderResourceList()
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
        this.handleProgressEvent(message)
      }

      return false
    })
  }
}
