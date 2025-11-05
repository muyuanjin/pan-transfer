import { createApp, type App } from 'vue'
import HistoryListView from './history/HistoryListView.vue'
import HistorySummaryView from './history/HistorySummaryView.vue'
import { formatHistoryTimestamp } from './history/history-card.helpers'
import type { HistoryGroup, ContentState } from '../types'
import { normalizePageUrl } from '../services/page-analyzer'
import { HISTORY_DISPLAY_LIMIT } from '../constants'

export interface HistoryCardPanelDom {
  historyList?: HTMLElement | null
  historyEmpty?: HTMLElement | null
  historySummaryBody?: HTMLElement | null
  historySummary?: HTMLElement | null
  historyOverlay?: HTMLElement | null
  historyToggleButtons?: HTMLButtonElement[] | null
  [key: string]: unknown
}

export interface HistoryCardRenderParams {
  state: ContentState & {
    historyGroups: HistoryGroup[]
    historyDetail: ContentState['historyDetail']
  }
  panelDom: HistoryCardPanelDom
  floatingPanel: HTMLElement | null | undefined
  pruneHistorySelection: (() => void) | undefined
  getHistoryGroupByKey: ((key: string) => HistoryGroup | null | undefined) | undefined
  closeHistoryDetail: (() => void) | undefined
  getFilteredHistoryGroups: (() => HistoryGroup[]) | undefined
  updateHistorySelectionSummary: ((groups: HistoryGroup[]) => void) | undefined
  updateHistoryBatchControls: ((groups: HistoryGroup[]) => void) | undefined
  updateHistoryExpansion: (() => void) | undefined
  isHistoryGroupCompleted: ((group: HistoryGroup) => boolean) | undefined
}

let historyListApp: App<Element> | null = null
let historySummaryApp: App<Element> | null = null

export function renderHistoryCard(params: HistoryCardRenderParams): void {
  const {
    state,
    panelDom,
    floatingPanel,
    pruneHistorySelection,
    getHistoryGroupByKey,
    closeHistoryDetail,
    getFilteredHistoryGroups,
    updateHistorySelectionSummary,
    updateHistoryBatchControls,
    updateHistoryExpansion,
    isHistoryGroupCompleted,
  } = params

  const historyList = panelDom?.historyList ?? null
  const historyEmpty = panelDom?.historyEmpty ?? null
  const historySummaryBody = panelDom?.historySummaryBody ?? null
  const historySummary = panelDom?.historySummary ?? null

  if (
    !(historyList instanceof HTMLElement) ||
    !(historyEmpty instanceof HTMLElement) ||
    !(historySummaryBody instanceof HTMLElement)
  ) {
    return
  }

  if (typeof pruneHistorySelection === 'function') {
    pruneHistorySelection()
  }

  if (state.historyDetail?.isOpen) {
    const activeGroup =
      typeof getHistoryGroupByKey === 'function'
        ? getHistoryGroupByKey(state.historyDetail.groupKey)
        : null
    if (!activeGroup && typeof closeHistoryDetail === 'function') {
      closeHistoryDetail()
    }
  }

  const allGroups = Array.isArray(state.historyGroups) ? state.historyGroups : []
  const validKeys = new Set(allGroups.map((group) => group.key))
  state.historySeasonExpanded = new Set(
    Array.from(state.historySeasonExpanded || []).filter((key) => validKeys.has(key)),
  )

  const filteredGroups =
    typeof getFilteredHistoryGroups === 'function' ? getFilteredHistoryGroups() : allGroups

  const limit = state.historyExpanded
    ? filteredGroups.length
    : Math.min(filteredGroups.length, HISTORY_DISPLAY_LIMIT)
  const entries = filteredGroups.slice(0, limit)

  const currentUrl = normalizePageUrl(state.pageUrl || window.location.href)
  const hasEntries = entries.length > 0

  const totalGroups = allGroups.length
  const hasSearch = Boolean((state.historySearchTerm || '').length)
  const emptyMessage = totalGroups
    ? hasSearch
      ? '没有匹配当前搜索条件的记录'
      : '当前筛选没有记录'
    : '还没有转存记录'

  if (!hasEntries) {
    historyEmpty.textContent = emptyMessage
    historyEmpty.classList.remove('is-hidden')
  } else {
    historyEmpty.textContent = '还没有转存记录'
    historyEmpty.classList.add('is-hidden')
  }

  if (historyListApp) {
    historyListApp.unmount()
    historyListApp = null
  }
  historyList.innerHTML = ''

  if (hasEntries) {
    const selectedKeys = Array.from(state.historySelectedKeys || [])
    const seasonExpandedKeys = Array.from(state.historySeasonExpanded || [])
    historyListApp = createApp(HistoryListView, {
      entries,
      currentUrl,
      selectedKeys,
      seasonExpandedKeys,
      historyBatchRunning: Boolean(state.historyBatchRunning),
      isHistoryGroupCompleted:
        typeof isHistoryGroupCompleted === 'function' ? isHistoryGroupCompleted : undefined,
    })
    historyListApp.mount(historyList)
  }

  const summaryEntry = entries[0] || null

  const summaryData = summaryEntry ? buildSummaryData(summaryEntry) : null

  if (historySummaryApp) {
    historySummaryApp.unmount()
    historySummaryApp = null
  }
  historySummaryBody.innerHTML = ''

  historySummaryApp = createApp(HistorySummaryView, {
    summary: summaryData,
    historyExpanded: Boolean(state.historyExpanded),
    emptyMessage: summaryEntry ? undefined : hasEntries ? '暂无其他转存记录' : emptyMessage,
  })
  historySummaryApp.mount(historySummaryBody)

  if (historySummary instanceof HTMLElement) {
    historySummary.classList.toggle('is-empty', !summaryData)
  }

  refreshToggleCache(panelDom, floatingPanel)
  if (Array.isArray(panelDom.historyToggleButtons)) {
    panelDom.historyToggleButtons.forEach((button: HTMLButtonElement) => {
      button.disabled = false
    })
  }

  if (typeof updateHistorySelectionSummary === 'function') {
    updateHistorySelectionSummary(filteredGroups)
  }
  if (typeof updateHistoryBatchControls === 'function') {
    updateHistoryBatchControls(filteredGroups)
  }
  if (typeof updateHistoryExpansion === 'function') {
    updateHistoryExpansion()
  }
}

function refreshToggleCache(
  panelDom: HistoryCardPanelDom,
  floatingPanel: HTMLElement | null | undefined,
): void {
  const scope = floatingPanel || (panelDom?.historyOverlay ?? null)
  if (!scope) {
    panelDom.historyToggleButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-role="history-toggle"]'),
    )
    return
  }
  panelDom.historyToggleButtons = Array.from(
    scope.querySelectorAll<HTMLButtonElement>('[data-role="history-toggle"]'),
  )
}

function buildSummaryData(group: HistoryGroup): { title: string; metaParts: string[] } {
  const mainRecord = (group.main ?? {}) as HistoryGroup['main'] & Record<string, unknown>
  const titleCandidate = typeof mainRecord.pageTitle === 'string' ? mainRecord.pageTitle : ''
  const title = group.title || titleCandidate || '未命名资源'
  const metaParts: string[] = []
  const completion = mainRecord.completion as { label?: string } | null | undefined
  if (completion?.label) {
    metaParts.push(completion.label)
  }
  const summaryTime = formatHistoryTimestamp(
    group.updatedAt || Number(mainRecord.lastTransferredAt) || Number(mainRecord.lastCheckedAt),
  )
  if (summaryTime) {
    metaParts.push(summaryTime)
  }
  if (Array.isArray(group.seasonEntries) && group.seasonEntries.length) {
    metaParts.push(`涵盖 ${group.seasonEntries.length} 季`)
  }
  const targetDirectory =
    typeof mainRecord.targetDirectory === 'string' ? mainRecord.targetDirectory : ''
  if (targetDirectory) {
    metaParts.push(targetDirectory)
  }
  return {
    title,
    metaParts,
  }
}
