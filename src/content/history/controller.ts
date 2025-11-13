import { chaosLogger } from '@/shared/log'
import { state, detailDom } from '../state'
import {
  deleteHistoryRecords,
  clearAllHistoryRecords,
  requestHistoryUpdate,
  fetchHistorySnapshot,
  filterHistoryGroups,
  canCheckHistoryGroup,
  isHistoryGroupCompleted,
  normalizeHistoryFilter,
  primeHistorySearchTransliteration,
  getHistoryPendingTransfer,
  buildHistoryGroupSeasonRows,
} from '../services/history-service'
import type { HistoryUpdateResponse } from '../services/history-service'
import { dedupeSeasonDirMap, updateSeasonExampleDir } from '../services/season-manager'
import { normalizePageUrl } from '@/providers/sites/chaospace/page-analyzer'
import {
  ensureHistoryDetailOverlay,
  renderHistoryDetail as renderHistoryDetailComponent,
  buildHistoryDetailFallback,
  normalizeHistoryDetailResponse,
} from '../components/history-detail'
import type { HistoryDetailOverrides as HistoryDetailOverridesInput } from '../components/history-detail'
import { renderHistoryCard as renderHistoryCardComponent } from '../components/history-card'
import { showToast } from '../components/toast'
import type {
  PanelRuntimeState,
  HistoryGroup,
  PanelHistoryDomRefs,
  ContentHistoryRecord,
} from '../types'
import { HISTORY_BATCH_RATE_LIMIT_MS, EDGE_HIDE_DELAY } from '../constants'
import historyDetailCssHref from '../styles/overlays/history-detail.css?url'
import { loadCss } from '../styles.loader'
import type { TabSeasonPreferenceController } from '../services/tab-season-preference'
import { resolveHistoryCheckTargets } from './history-check.helpers'
import { normalizeSeasonDirectoryMap } from '@/shared/utils/completion-status'

interface HistoryDetailResponsePayload {
  ok: boolean
  error?: string
  detail?: unknown
}

function isHistoryDetailResponsePayload(value: unknown): value is HistoryDetailResponsePayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  return 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean'
}

const historyDetailCssUrl = historyDetailCssHref
let historyDetailCssPromise: Promise<void> | null = null
function ensureHistoryDetailStyles(): Promise<void> {
  if (!historyDetailCssPromise) {
    const href =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL(historyDetailCssUrl.replace(/^\//, ''))
        : historyDetailCssUrl
    historyDetailCssPromise = loadCss(href, document).catch((error) => {
      historyDetailCssPromise = null
      throw error
    })
  }
  return historyDetailCssPromise
}

interface HistoryControllerDeps {
  getFloatingPanel: () => HTMLElement | null
  panelState: PanelRuntimeState
  renderResourceList: () => void
  renderPathPreview: () => void
  renderSeasonHint: () => void
  seasonPreference: TabSeasonPreferenceController
  panelDom: PanelHistoryDomRefs
}

interface LoadHistoryOptions {
  silent?: boolean
}

export interface TriggerHistoryUpdateOptions {
  silent?: boolean
  deferRender?: boolean
}

export interface TriggerHistoryTransferOptions {
  silent?: boolean
  deferRender?: boolean
}

interface CloseHistoryDetailOptions {
  hideDelay?: number
}

type ExtendedHistoryUpdateResponse = HistoryUpdateResponse & {
  hasUpdates?: boolean
  completion?: { label?: string; state?: string } | null
  completionLabel?: string
  reason?: string
  results?: Array<{ status?: string | null | undefined }>
  summary?: string
  newItems?: number
}

interface TransferResponsePayload {
  ok: boolean
  error?: string
  results?: Array<{ status?: string | null | undefined }>
  summary?: string
}

function isTransferResponsePayload(value: unknown): value is TransferResponsePayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  return 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean'
}

function summarizeTransferResults(results: TransferResponsePayload['results']): {
  success: number
  skipped: number
  failed: number
} {
  const stats = { success: 0, skipped: 0, failed: 0 }
  if (!Array.isArray(results)) {
    return stats
  }
  results.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const status = (entry as { status?: string }).status
    if (status === 'success') {
      stats.success += 1
    } else if (status === 'skipped') {
      stats.skipped += 1
    } else if (status === 'failed') {
      stats.failed += 1
    }
  })
  return stats
}

function wait(ms: number): Promise<void> {
  const duration = Number.isFinite(ms) ? Math.max(0, ms) : 0
  return new Promise((resolve) => setTimeout(resolve, duration))
}

export function createHistoryController(deps: HistoryControllerDeps) {
  const {
    getFloatingPanel,
    panelState,
    renderResourceList,
    renderPathPreview,
    renderSeasonHint,
    seasonPreference,
    panelDom,
  } = deps
  const historyDom = panelDom

  let historyControllerRef: ReturnType<typeof createHistoryController> | null = null

  function getHistoryGroupByKey(key: string): HistoryGroup | null {
    if (!key) {
      return null
    }
    return state.historyGroups.find((group) => group && group.key === key) || null
  }

  function applyHistoryToCurrentPage(): void {
    const normalizedUrl = normalizePageUrl(state.pageUrl || window.location.href)
    state.transferredIds = new Set()
    state.newItemIds = new Set()
    state.currentHistory = null

    if (!normalizedUrl || !state.historyRecords.length) {
      return
    }

    const matched = state.historyRecords.find(
      (record) => normalizePageUrl(record.pageUrl) === normalizedUrl,
    )
    if (!matched) {
      return
    }

    state.currentHistory = matched
    const knownIds = new Set<string>(Object.keys(matched.items || {}))
    if (!state.completion && matched.completion) {
      state.completion = matched.completion
    }
    if (matched.seasonDirectory && typeof matched.seasonDirectory === 'object') {
      const seasonMap = normalizeSeasonDirectoryMap(matched.seasonDirectory)
      if (Object.keys(seasonMap).length) {
        state.seasonDirMap = { ...state.seasonDirMap, ...seasonMap }
        dedupeSeasonDirMap()
        updateSeasonExampleDir()
        renderSeasonHint()
        renderPathPreview()
      }
    }
    if (typeof matched.useSeasonSubdir === 'boolean') {
      Promise.resolve(seasonPreference.applyHistorySelection(matched.useSeasonSubdir)).catch(
        (error) => {
          chaosLogger.warn('[Pan Transfer] Failed to apply history season preference', error)
        },
      )
    }
    state.transferredIds = new Set<string | number>(knownIds)
    const nextNewItemIds = new Set<string | number>()
    state.items.forEach((item) => {
      if (!item) {
        return
      }
      const key = String(item.id)
      if (!knownIds.has(key)) {
        nextNewItemIds.add(item.id)
      }
    })
    state.newItemIds = nextNewItemIds
    if (nextNewItemIds.size > 0) {
      const hasSameSelection =
        state.selectedIds.size === nextNewItemIds.size &&
        Array.from(nextNewItemIds).every((id) => state.selectedIds.has(id))
      if (!hasSameSelection) {
        state.selectedIds = new Set(nextNewItemIds)
      }
    }
  }

  function getFilteredHistoryGroups(): HistoryGroup[] {
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : []
    return filterHistoryGroups(groups, state.historyFilter, {
      searchTerm: state.historySearchTerm,
    })
  }

  function pruneHistorySelection(): void {
    const groups = getFilteredHistoryGroups()
    const next = new Set(state.historySelectedKeys)
    next.forEach((key) => {
      const exists = groups.some((group) => group.key === key)
      if (!exists) {
        next.delete(key)
      }
    })
    if (next.size !== state.historySelectedKeys.size) {
      state.historySelectedKeys = next
    }
  }

  function updateHistoryExpansion(): void {
    const floatingPanel = getFloatingPanel()
    if (!floatingPanel) {
      return
    }
    if (!state.historyGroups.length && state.historyExpanded) {
      state.historyExpanded = false
    }
    const expanded = Boolean(state.historyExpanded && state.historyGroups.length)
    floatingPanel.classList.toggle('is-history-expanded', expanded)
    if (historyDom.historyOverlay) {
      historyDom.historyOverlay.setAttribute('aria-hidden', expanded ? 'false' : 'true')
    }
  }

  function renderHistoryCard(): void {
    pruneHistorySelection()
    renderHistoryCardComponent({
      state,
      panelDom: historyDom,
      floatingPanel: getFloatingPanel(),
      pruneHistorySelection,
      getHistoryGroupByKey,
      closeHistoryDetail,
      getFilteredHistoryGroups,
      updateHistoryExpansion,
      isHistoryGroupCompleted,
      historyController: historyControllerRef ?? null,
    })
  }

  function ensureHistoryDetailOverlayMounted(): void {
    ensureHistoryDetailOverlay(detailDom, { onClose: () => closeHistoryDetail() })
  }

  function renderHistoryDetail(): void {
    const overlayExists = Boolean(detailDom.backdrop)
    if (!state.historyDetail.isOpen && !overlayExists) {
      document.body.classList.remove('chaospace-history-detail-active')
      return
    }

    ensureHistoryDetailOverlayMounted()
    renderHistoryDetailComponent({
      state,
      detailDom,
      getHistoryGroupByKey,
      onClose: () => closeHistoryDetail(),
    })
  }

  async function openHistoryDetail(
    groupKey: string,
    overrides: HistoryDetailOverridesInput = {},
  ): Promise<void> {
    const group = getHistoryGroupByKey(groupKey)
    if (!group) {
      return
    }
    const floatingPanel = getFloatingPanel()
    if (!panelState.isPinned) {
      panelState.cancelEdgeHide?.({ show: true })
    }
    if (floatingPanel) {
      panelState.pointerInside = true
      floatingPanel.classList.add('is-hovering')
      floatingPanel.classList.remove('is-leaving')
    }
    void ensureHistoryDetailStyles().catch((error) => {
      chaosLogger.error('[Pan Transfer] Failed to load history detail styles:', error)
    })
    ensureHistoryDetailOverlayMounted()
    const fallback = buildHistoryDetailFallback(group, overrides)
    const overridePageUrl = typeof overrides.pageUrl === 'string' ? overrides.pageUrl.trim() : ''
    const pageUrl =
      overridePageUrl || (typeof fallback.pageUrl === 'string' ? fallback.pageUrl : '')
    state.historyDetail.isOpen = true
    state.historyDetail.groupKey = groupKey
    state.historyDetail.pageUrl = pageUrl
    state.historyDetail.error = ''
    state.historyDetail.fallback = fallback
    const cacheKey = pageUrl || ''
    const cached = cacheKey ? state.historyDetailCache.get(cacheKey) : null
    state.historyDetail.data = cached || fallback
    state.historyDetail.loading = !cached && Boolean(cacheKey)
    renderHistoryDetail()
    if (cached || !cacheKey) {
      if (!cacheKey && !cached) {
        state.historyDetail.loading = false
        renderHistoryDetail()
      }
      return
    }
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'chaospace:history-detail',
        payload: { pageUrl: cacheKey },
      })) as unknown
      if (!isHistoryDetailResponsePayload(response)) {
        throw new Error('加载详情失败')
      }
      if (!response.ok) {
        const message = typeof response.error === 'string' ? response.error : '加载详情失败'
        throw new Error(message)
      }
      const detailSource =
        response.detail && typeof response.detail === 'object'
          ? (response.detail as Record<string, unknown>)
          : {}
      const normalized = normalizeHistoryDetailResponse(detailSource, fallback)
      state.historyDetailCache.set(cacheKey, normalized)
      state.historyDetail.data = normalized
      state.historyDetail.loading = false
      renderHistoryDetail()
    } catch (error) {
      state.historyDetail.loading = false
      state.historyDetail.error = error instanceof Error ? error.message : '加载详情失败'
      renderHistoryDetail()
    }
  }

  function closeHistoryDetail(options: CloseHistoryDetailOptions = {}): void {
    const { hideDelay = EDGE_HIDE_DELAY } = options
    if (!state.historyDetail.isOpen) {
      return
    }
    state.historyDetail.isOpen = false
    state.historyDetail.loading = false
    state.historyDetail.error = ''
    state.historyDetail.groupKey = ''
    state.historyDetail.pageUrl = ''
    state.historyDetail.data = null
    state.historyDetail.fallback = null
    renderHistoryDetail()
    const floatingPanel = getFloatingPanel()
    if (floatingPanel && !panelState.isPinned) {
      const hovering = floatingPanel.matches(':hover')
      panelState.pointerInside = hovering
      if (!hovering) {
        floatingPanel.classList.remove('is-hovering')
        floatingPanel.classList.add('is-leaving')
        panelState.scheduleEdgeHide?.(Math.max(0, hideDelay))
      }
    }
  }

  function handleHistoryDetailKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return
    }
    if (!state.historyDetail.isOpen) {
      return
    }
    closeHistoryDetail()
    event.stopPropagation()
  }

  document.addEventListener('keydown', handleHistoryDetailKeydown, true)

  async function loadHistory(options: LoadHistoryOptions = {}): Promise<void> {
    const { silent = false } = options
    const snapshot = await fetchHistorySnapshot()
    state.historyRecords = snapshot.records
    state.historyGroups = snapshot.groups

    if (!silent) {
      applyHistoryToCurrentPage()
      renderHistoryCard()
      renderResourceList()
    }
  }

  async function triggerHistoryUpdate(
    pageUrl: string,
    button?: HTMLButtonElement | null,
    options: TriggerHistoryUpdateOptions = {},
  ): Promise<ExtendedHistoryUpdateResponse | null> {
    if (!pageUrl) {
      return null
    }
    const { silent = false, deferRender = false } = options
    let previousText = ''
    let shouldRestoreButton = true
    if (button) {
      previousText = button.textContent || ''
      button.disabled = true
      button.textContent = '检测中...'
    }
    try {
      const response = (await requestHistoryUpdate(pageUrl)) as ExtendedHistoryUpdateResponse
      if (!response || response.ok === false) {
        const errorValue = response?.error
        const errorMessage =
          typeof errorValue === 'string'
            ? errorValue
            : errorValue instanceof Error
              ? errorValue.message
              : '检测失败'
        if (!silent) {
          showToast('error', '检测失败', errorMessage)
        }
        return response
      }
      if (!response.hasUpdates) {
        const completionLabel = response?.completion?.label || response?.completionLabel || ''
        if (response.reason === 'completed') {
          shouldRestoreButton = false
          const message = completionLabel
            ? `${completionLabel} · 无需继续转存 ✅`
            : '该剧集已完结 · 不再检测更新'
          if (!silent) {
            showToast('success', '剧集已完结', message)
          }
        } else if (!silent) {
          showToast('success', '无需转存', '所有剧集都已同步 ✅')
        }
      } else {
        const transferred = Array.isArray(response.results)
          ? response.results.filter((item) => item.status === 'success').length
          : 0
        const skipped = Array.isArray(response.results)
          ? response.results.filter((item) => item.status === 'skipped').length
          : 0
        const failed = Array.isArray(response.results)
          ? response.results.filter((item) => item.status === 'failed').length
          : 0
        const summary = response.summary || `新增 ${response.newItems ?? 0} 项`
        const toastType = failed > 0 ? 'warning' : 'success'
        const stats = {
          success: transferred,
          skipped,
          failed,
        }
        if (!silent) {
          showToast(toastType, '检测完成', summary, stats)
        }
      }
      await loadHistory({ silent: deferRender })
      if (!deferRender) {
        applyHistoryToCurrentPage()
        renderHistoryCard()
        renderResourceList()
      }
      return response
    } catch (error) {
      chaosLogger.error('[Pan Transfer] Update check failed', error)
      if (!silent) {
        const message = error instanceof Error ? error.message : '无法检测更新'
        showToast('error', '检测失败', message)
      }
      return { ok: false, error } as ExtendedHistoryUpdateResponse
    } finally {
      if (button) {
        if (shouldRestoreButton) {
          button.disabled = false
          button.textContent = previousText || '检测更新'
        } else {
          button.disabled = true
          button.textContent = '已完结'
        }
      }
    }
  }

  async function triggerHistoryTransfer(
    record: ContentHistoryRecord | null | undefined,
    button?: HTMLButtonElement | null,
    options: TriggerHistoryTransferOptions = {},
  ): Promise<TransferResponsePayload | null> {
    if (!record) {
      return null
    }
    const pending = getHistoryPendingTransfer(record)
    if (!pending) {
      if (!options.silent) {
        showToast('info', '暂无待转存', '请先检测新篇')
      }
      return null
    }
    const { silent = false, deferRender = false } = options
    let previousText = ''
    let transferSucceeded = false
    if (button) {
      previousText = button.textContent || ''
      button.disabled = true
      button.textContent = '转存中...'
    }
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'chaospace:transfer',
        payload: pending.payload,
      })) as unknown
      if (!isTransferResponsePayload(response)) {
        throw new Error('未收到后台响应')
      }
      if (!response.ok) {
        const errorMessage =
          typeof response.error === 'string' && response.error ? response.error : '转存失败'
        throw new Error(errorMessage)
      }
      if (!silent) {
        const stats = summarizeTransferResults(response.results)
        const summary =
          typeof response.summary === 'string' && response.summary
            ? response.summary
            : pending.summary || '转存完成'
        const toastType = stats.failed > 0 ? 'warning' : 'success'
        const title = stats.failed > 0 ? '部分成功' : '转存成功'
        showToast(toastType, title, summary, stats)
      }
      if (!deferRender) {
        await loadHistory({ silent: true })
        applyHistoryToCurrentPage()
        renderHistoryCard()
        renderResourceList()
      }
      if (!deferRender) {
        transferSucceeded = true
      }
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法转存新篇'
      chaosLogger.error('[Pan Transfer] Pending transfer failed', {
        pageUrl: record.pageUrl,
        error,
      })
      if (!silent) {
        showToast('error', '转存失败', message)
      }
      return { ok: false, error: message }
    } finally {
      if (button) {
        if (transferSucceeded) {
          button.disabled = true
          button.textContent = '转存新篇'
        } else {
          button.disabled = false
          button.textContent = previousText || '转存新篇'
        }
      }
    }
  }

  async function handleHistoryBatchCheck(): Promise<void> {
    if (state.historyBatchRunning) {
      return
    }
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : []
    const selectedGroups = groups.filter((group) => state.historySelectedKeys.has(group.key))
    const candidates = selectedGroups.filter(canCheckHistoryGroup)
    if (!candidates.length) {
      showToast('info', '无可检测剧集', '仅支持检测未完结的剧集，请先勾选目标')
      return
    }
    state.historyBatchRunning = true
    state.historyBatchMode = 'check'
    setHistoryBatchProgressLabel('准备中...')
    renderHistoryCard()

    let updated = 0
    let completed = 0
    let noUpdate = 0
    let failed = 0

    for (let index = 0; index < candidates.length; index += 1) {
      const group = candidates[index]
      if (!group) {
        continue
      }
      if (index > 0) {
        await wait(state.historyRateLimitMs)
      }
      const progressLabel = `检测中 ${index + 1}/${candidates.length}`
      setHistoryBatchProgressLabel(progressLabel)
      const seasonRows = buildHistoryGroupSeasonRows(group)
      const targets = resolveHistoryCheckTargets({
        pageUrl: typeof group.main?.pageUrl === 'string' ? group.main.pageUrl : '',
        seasons: seasonRows.map((row) => ({
          url: row.url,
          seasonIndex: row.seasonIndex,
          recordTimestamp: row.recordTimestamp,
          disabled: !row.canCheck,
          hasItems: row.hasItems,
          loaded: row.loaded,
        })),
      })
      if (!targets.length) {
        noUpdate += 1
        continue
      }
      let outcome: 'pending' | 'updated' | 'completed' | 'failed' = 'pending'
      try {
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const targetUrl = targets[targetIndex]
          if (!targetUrl) {
            continue
          }
          const response = await triggerHistoryUpdate(targetUrl, null, {
            silent: true,
            deferRender: true,
          })
          if (!response || response.ok === false) {
            outcome = 'failed'
            break
          }
          if (
            response.reason === 'completed' ||
            (response.completion && response.completion.state === 'completed')
          ) {
            outcome = 'completed'
            break
          }
          if (response.hasUpdates) {
            outcome = 'updated'
            break
          }
        }
      } catch (error) {
        chaosLogger.error('[Pan Transfer] Batch update failed', error)
        outcome = 'failed'
      }

      switch (outcome) {
        case 'updated':
          updated += 1
          break
        case 'completed':
          completed += 1
          break
        case 'failed':
          failed += 1
          break
        default:
          noUpdate += 1
          break
      }
    }

    let refreshError: Error | null = null
    try {
      await loadHistory({ silent: true })
    } catch (error) {
      refreshError = error instanceof Error ? error : new Error(String(error))
      chaosLogger.error('[Pan Transfer] Failed to refresh history after batch check', error)
    } finally {
      state.historyBatchRunning = false
      state.historyBatchMode = null
      setHistoryBatchProgressLabel('')
    }
    applyHistoryToCurrentPage()
    renderHistoryCard()
    renderResourceList()

    const summaryParts: string[] = []
    if (updated) summaryParts.push(`检测到更新 ${updated} 条`)
    if (completed) summaryParts.push(`已完结 ${completed} 条`)
    if (noUpdate) summaryParts.push(`无更新 ${noUpdate} 条`)
    if (failed) summaryParts.push(`失败 ${failed} 条`)
    const detail = summaryParts.join(' · ') || '已完成批量检测'
    const toastType = failed ? (updated ? 'warning' : 'error') : 'success'
    const title = failed ? (updated ? '部分检测成功' : '检测失败') : '批量检测完成'
    if (refreshError) {
      showToast('error', '刷新历史失败', refreshError.message)
      return
    }
    const rateSeconds = Math.max(1, Math.round(state.historyRateLimitMs / 1000))
    showToast(toastType, title, `${detail}（速率 ${rateSeconds} 秒/条）`)
  }

  async function handleHistoryBatchTransfer(): Promise<void> {
    if (state.historyBatchRunning) {
      return
    }
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : []
    const selectedGroups = groups.filter((group) => state.historySelectedKeys.has(group.key))
    const pendingRecords: ContentHistoryRecord[] = []
    selectedGroups.forEach((group) => {
      group.records.forEach((record) => {
        if (getHistoryPendingTransfer(record)) {
          pendingRecords.push(record)
        }
      })
    })
    if (!pendingRecords.length) {
      showToast('info', '暂无可转存剧集', '请选择检测出新篇的剧集后再试')
      return
    }
    state.historyBatchRunning = true
    state.historyBatchMode = 'transfer'
    setHistoryBatchProgressLabel('准备转存...')
    renderHistoryCard()

    let success = 0
    let partial = 0
    let failed = 0
    for (let index = 0; index < pendingRecords.length; index += 1) {
      const record = pendingRecords[index]
      if (!record) {
        continue
      }
      const progressLabel = `转存中 ${index + 1}/${pendingRecords.length}`
      setHistoryBatchProgressLabel(progressLabel)
      try {
        const response = await triggerHistoryTransfer(record, null, {
          silent: true,
          deferRender: true,
        })
        if (!response || response.ok === false) {
          failed += 1
          continue
        }
        const stats = summarizeTransferResults(response.results)
        if (stats.failed > 0) {
          partial += 1
        } else {
          success += 1
        }
      } catch (error) {
        chaosLogger.error('[Pan Transfer] Batch transfer failed', {
          pageUrl: record.pageUrl,
          error,
        })
        failed += 1
      }
      if (index < pendingRecords.length - 1) {
        await wait(state.historyRateLimitMs)
      }
    }

    let refreshError: Error | null = null
    try {
      await loadHistory({ silent: true })
    } catch (error) {
      refreshError = error instanceof Error ? error : new Error(String(error))
      chaosLogger.error('[Pan Transfer] Failed to refresh history after batch transfer', error)
    } finally {
      state.historyBatchRunning = false
      state.historyBatchMode = null
      setHistoryBatchProgressLabel('')
    }
    applyHistoryToCurrentPage()
    renderHistoryCard()
    renderResourceList()

    if (refreshError) {
      showToast('error', '刷新历史失败', refreshError.message)
      return
    }

    const summaryParts: string[] = []
    if (success) summaryParts.push(`成功 ${success} 条`)
    if (partial) summaryParts.push(`部分成功 ${partial} 条`)
    if (failed) summaryParts.push(`失败 ${failed} 条`)
    const summary = summaryParts.join(' · ') || '已完成批量转存'
    const toastType = failed ? (success || partial ? 'warning' : 'error') : 'success'
    const title =
      toastType === 'success'
        ? '批量转存完成'
        : toastType === 'warning'
          ? '部分转存成功'
          : '批量转存失败'
    showToast(toastType, title, summary)
  }

  async function handleHistoryDeleteSelected(): Promise<void> {
    if (!state.historySelectedKeys.size) {
      showToast('info', '未选择记录', '请先勾选要删除的历史记录')
      return
    }
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : []
    const targetUrls = new Set<string>()
    state.historySelectedKeys.forEach((key) => {
      const group = groups.find((entry) => entry.key === key)
      if (group && Array.isArray(group.records)) {
        group.records.forEach((record) => {
          if (record && record.pageUrl) {
            targetUrls.add(record.pageUrl)
          }
        })
      }
    })
    if (!targetUrls.size) {
      showToast('info', '无可删除记录', '所选历史没有可删除的条目')
      return
    }
    try {
      const result = await deleteHistoryRecords(Array.from(targetUrls))
      const removed = typeof result?.removed === 'number' ? result.removed : targetUrls.size
      showToast('success', '已删除历史', `移除 ${removed} 条记录`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法删除选中的历史记录'
      showToast('error', '删除失败', message)
      return
    }
    state.historySelectedKeys = new Set()
    await loadHistory({ silent: true })
    applyHistoryToCurrentPage()
    renderHistoryCard()
    renderResourceList()
  }

  async function handleHistoryClear(): Promise<void> {
    if (!state.historyGroups.length) {
      showToast('info', '历史为空', '当前没有需要清理的历史记录')
      return
    }
    try {
      const result = await clearAllHistoryRecords()
      const cleared =
        typeof result?.removed === 'number' ? result.removed : state.historyGroups.length
      showToast('success', '已清空历史', `共清理 ${cleared} 条记录`)
    } catch (error) {
      showToast('error', '清理失败', error instanceof Error ? error.message : '无法清空转存历史')
      return
    }
    state.historySelectedKeys = new Set()
    await loadHistory({ silent: true })
    applyHistoryToCurrentPage()
    renderHistoryCard()
    renderResourceList()
  }

  function setHistorySelection(groupKey: string, selected: boolean): void {
    if (!groupKey) {
      return
    }
    const next = new Set(state.historySelectedKeys)
    if (selected) {
      next.add(groupKey)
    } else {
      next.delete(groupKey)
    }
    state.historySelectedKeys = next
  }

  function setHistorySelectAll(selected: boolean): void {
    const groups = getFilteredHistoryGroups()
    const next = new Set(state.historySelectedKeys)
    groups.forEach((group) => {
      if (selected) {
        next.add(group.key)
      } else {
        next.delete(group.key)
      }
    })
    state.historySelectedKeys = next
    renderHistoryCard()
  }

  function setHistoryFilter(filter: string): void {
    const normalized = normalizeHistoryFilter(filter)
    if (state.historyFilter === normalized) {
      return
    }
    state.historyFilter = normalized
    renderHistoryCard()
  }

  function setHistorySearchTerm(term: string): void {
    const next = typeof term === 'string' ? term.trim() : ''
    if (state.historySearchTerm === next) {
      return
    }
    state.historySearchTerm = next
    renderHistoryCard()
  }

  function setHistoryBatchProgressLabel(label: string): void {
    state.historyBatchProgressLabel = label
  }

  function setHistoryExpanded(expanded: boolean): void {
    const next = Boolean(expanded)
    if (state.historyExpanded === next) {
      return
    }
    state.historyExpanded = next
    if (next) {
      void primeHistorySearchTransliteration()
    }
    renderHistoryCard()
  }

  function toggleHistoryExpanded(): void {
    setHistoryExpanded(!state.historyExpanded)
  }

  function setHistorySeasonExpanded(groupKey: string, expanded: boolean): void {
    if (!groupKey) {
      return
    }
    const next = new Set(state.historySeasonExpanded || [])
    const before = next.has(groupKey)
    if (expanded) {
      next.add(groupKey)
    } else {
      next.delete(groupKey)
    }
    if (before === expanded) {
      return
    }
    state.historySeasonExpanded = next
    renderHistoryCard()
  }

  function toggleHistorySeasonExpanded(groupKey: string): void {
    if (!groupKey) {
      return
    }
    const isExpanded = state.historySeasonExpanded.has(groupKey)
    setHistorySeasonExpanded(groupKey, !isExpanded)
  }

  function selectNewItems(): void {
    if (!state.newItemIds.size) {
      showToast('info', '暂无新增', '没有检测到新的剧集')
      return
    }
    state.selectedIds = new Set(state.newItemIds)
    renderResourceList()
    showToast('success', '已选中新剧集', `共 ${state.newItemIds.size} 项`)
  }

  function updateHistoryRateLimit(rateMs: number): void {
    const clamped = Number.isFinite(rateMs)
      ? Math.max(500, Math.min(rateMs, HISTORY_BATCH_RATE_LIMIT_MS * 12))
      : HISTORY_BATCH_RATE_LIMIT_MS
    state.historyRateLimitMs = clamped
  }

  const historyController = {
    applyHistoryToCurrentPage,
    loadHistory,
    handleHistoryDeleteSelected,
    handleHistoryClear,
    handleHistoryBatchCheck,
    handleHistoryBatchTransfer,
    renderHistoryCard,
    setHistorySelection,
    setHistorySelectAll,
    setHistoryFilter,
    setHistorySearchTerm,
    setHistoryExpanded,
    toggleHistoryExpanded,
    setHistorySeasonExpanded,
    toggleHistorySeasonExpanded,
    openHistoryDetail,
    closeHistoryDetail,
    triggerHistoryUpdate,
    triggerHistoryTransfer,
    selectNewItems,
    getFilteredHistoryGroups,
    getHistoryGroupByKey,
    updateHistoryExpansion,
    updateHistoryRateLimit,
    renderHistoryDetail,
  }

  historyControllerRef = historyController

  return historyController
}
