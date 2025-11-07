import { state } from '../../state'
import type { createHistoryController } from '../../history/controller'
import type { createPanelPreferencesController } from '../../controllers/panel-preferences'
import type { createLoggingController } from '../../controllers/logging-controller'
import type { PanelBaseDirDomRefs, ResourceItem } from '../../types'
import { computeItemTargetPath, getTargetPath } from '../../services/season-manager'
import { normalizePageUrl } from '../../services/page-analyzer'
import { showToast } from '../../components/toast'
import type { TabSeasonPreferenceController } from '../../services/tab-season-preference'

export interface TransferController {
  handleTransfer: () => Promise<void>
  handleProgressEvent: (progress: unknown) => void
  setControlsDisabled: (disabled: boolean) => void
}

type HistoryController = ReturnType<typeof createHistoryController>
type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>
type LoggingController = ReturnType<typeof createLoggingController>

export function createTransferController(deps: {
  panelDom: PanelBaseDirDomRefs
  logging: LoggingController
  preferences: PanelPreferencesController
  history: HistoryController
  getFloatingPanel: () => HTMLElement | null
  updateTransferButton: () => void
  renderPathPreview: () => void
  seasonPreference: TabSeasonPreferenceController
}): TransferController {
  const {
    panelDom,
    logging,
    preferences,
    history,
    getFloatingPanel,
    updateTransferButton,
    renderPathPreview,
    seasonPreference,
  } = deps

  const setControlsDisabled = (disabled: boolean): void => {
    if (panelDom.baseDirInput) panelDom.baseDirInput.disabled = disabled
    if (panelDom.useTitleCheckbox) panelDom.useTitleCheckbox.disabled = disabled
    if (panelDom.useSeasonCheckbox) panelDom.useSeasonCheckbox.disabled = disabled
    if (panelDom.addPresetButton) panelDom.addPresetButton.disabled = disabled
    state.toolbarDisabled = disabled
    state.presetsDisabled = disabled
  }

  const handleProgressEvent = (progress: unknown): void => {
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
      logging.pushLog(payload.message, {
        level: (payload.level as never) || 'info',
        detail: payload.detail || '',
        stage: payload.stage || '',
      })
    }
    if (payload.statusMessage) {
      state.statusMessage = payload.statusMessage
      logging.renderStatus()
    } else if (typeof payload.current === 'number' && typeof payload.total === 'number') {
      state.statusMessage = `正在处理 ${payload.current}/${payload.total}`
      logging.renderStatus()
    }
  }

  const handleTransfer = async (): Promise<void> => {
    if (!getFloatingPanel() || state.transferStatus === 'running') {
      return
    }

    const selectedItems: ResourceItem[] = state.items.filter((item) =>
      state.selectedIds.has(item.id),
    )
    if (!selectedItems.length) {
      showToast('warning', '请选择资源', '至少勾选一个百度网盘资源再开始转存哦～')
      return
    }

    const baseDirValue = panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir
    preferences.setBaseDir(baseDirValue)

    if (panelDom.useTitleCheckbox) {
      state.useTitleSubdir = panelDom.useTitleCheckbox.checked
      void preferences.saveSettings()
    }
    if (panelDom.useSeasonCheckbox) {
      const nextSeasonValue = Boolean(panelDom.useSeasonCheckbox.checked)
      if (nextSeasonValue !== state.useSeasonSubdir) {
        await seasonPreference.applyUserSelection(nextSeasonValue)
      }
    }

    const targetDirectory = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle)

    state.jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    state.lastResult = null
    state.transferStatus = 'running'
    state.statusMessage = '正在准备转存...'
    logging.resetLogs()
    logging.pushLog('已锁定资源清单，准备开始转存', { stage: 'init' })
    logging.renderStatus()
    renderPathPreview()
    updateTransferButton()
    setControlsDisabled(true)

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

      logging.pushLog(`向后台发送 ${selectedItems.length} 条转存请求`, {
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

      logging.pushLog(`后台执行完成：${summary}`, {
        stage: 'complete',
        level: failed === 0 ? 'success' : 'warning',
      })
      logging.setStatus(failed === 0 ? 'success' : 'error', `${title}：${summary}`)

      await history.loadHistory()

      showToast(
        failed === 0 ? 'success' : success > 0 ? 'warning' : 'error',
        `${emoji} ${title}`,
        `已保存到 ${targetDirectory}`,
        { success, failed, skipped },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '后台执行发生未知错误'
      logging.pushLog(message, { level: 'error', stage: 'error' })
      logging.setStatus('error', `转存失败：${message}`)
      showToast('error', '转存失败', message)
    } finally {
      if (state.transferStatus === 'running') {
        logging.setStatus('idle', '准备就绪 ✨')
      }
      updateTransferButton()
      setControlsDisabled(false)
      state.jobId = null
      state.transferStatus = 'idle'
    }
  }

  return {
    handleTransfer,
    handleProgressEvent,
    setControlsDisabled,
  }
}
