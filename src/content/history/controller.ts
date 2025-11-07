import { state, detailDom } from '../state'
import {
  deleteHistoryRecords,
  clearAllHistoryRecords,
  requestHistoryUpdate,
  fetchHistorySnapshot,
  normalizeSeasonDirectory,
  filterHistoryGroups,
  canCheckHistoryGroup,
  isHistoryGroupCompleted,
  normalizeHistoryFilter,
} from '../services/history-service'
import type { HistoryUpdateResponse } from '../services/history-service'
import { dedupeSeasonDirMap, updateSeasonExampleDir } from '../services/season-manager'
import { normalizePageUrl } from '../services/page-analyzer'
import {
  ensureHistoryDetailOverlay,
  renderHistoryDetail as renderHistoryDetailComponent,
  buildHistoryDetailFallback,
  normalizeHistoryDetailResponse,
} from '../components/history-detail'
import type { HistoryDetailOverrides as HistoryDetailOverridesInput } from '../components/history-detail'
import { renderHistoryCard as renderHistoryCardComponent } from '../components/history-card'
import { showToast } from '../components/toast'
import type { PanelRuntimeState, HistoryGroup, PanelHistoryDomRefs } from '../types'
import { HISTORY_BATCH_RATE_LIMIT_MS, EDGE_HIDE_DELAY } from '../constants'
import historyDetailCssHref from '../styles/overlays/history-detail.css?url'
import { loadCss } from '../styles.loader'
import type { TabSeasonPreferenceController } from '../services/tab-season-preference'

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

interface TriggerHistoryUpdateOptions {
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
      const seasonMap = normalizeSeasonDirectory(matched.seasonDirectory)
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
          console.warn('[Chaospace Transfer] Failed to apply history season preference', error)
        },
      )
    }
    state.transferredIds = new Set<string | number>(knownIds)
    state.items.forEach((item) => {
      if (!item) {
        return
      }
      const key = String(item.id)
      if (!knownIds.has(key)) {
        state.newItemIds.add(item.id)
      }
    })
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
    const overlayExists = Boolean(detailDom['backdrop'])
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
      console.error('[Chaospace Transfer] Failed to load history detail styles:', error)
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
      const response = await chrome.runtime.sendMessage({
        type: 'chaospace:history-detail',
        payload: { pageUrl: cacheKey },
      })
      if (!response || response.ok === false) {
        throw new Error(response?.error || '加载详情失败')
      }
      const normalized = normalizeHistoryDetailResponse(response.detail || {}, fallback)
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
      console.error('[Chaospace Transfer] Update check failed', error)
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
      try {
        const targetUrl = group.main?.pageUrl ?? ''
        if (!targetUrl) {
          noUpdate += 1
          continue
        }
        const response = await triggerHistoryUpdate(targetUrl, null, {
          silent: true,
          deferRender: true,
        })
        if (!response || response.ok === false) {
          failed += 1
          continue
        }
        if (
          response.reason === 'completed' ||
          (response.completion && response.completion.state === 'completed')
        ) {
          completed += 1
        } else if (response.hasUpdates) {
          updated += 1
        } else {
          noUpdate += 1
        }
      } catch (error) {
        console.error('[Chaospace Transfer] Batch update failed', error)
        failed += 1
      }
    }

    state.historyBatchRunning = false
    setHistoryBatchProgressLabel('')
    await loadHistory({ silent: true })
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
    const rateSeconds = Math.max(1, Math.round(state.historyRateLimitMs / 1000))
    showToast(toastType, title, `${detail}（速率 ${rateSeconds} 秒/条）`)
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
