import { createApp, type App, reactive } from 'vue'
import HistorySummaryView from './history/HistorySummaryView.vue'
import {
  formatHistoryTimestamp,
  resolveHistoryGroupProviderLabel,
} from './history/history-card.helpers'
import type { HistoryGroup, PanelHistoryDomRefs } from '../types'
import type { ContentStore } from '../state'
import { pinia } from '../state'
import { normalizePageUrl } from '@/providers/sites/chaospace/page-analyzer'
import { HISTORY_DISPLAY_LIMIT } from '../constants'
import { historyContextKey, type HistoryController } from '../runtime/ui/history-context'
import { createHistoryListHost, type HistoryListBindings } from './history/history-list-host'
import { consumeHistoryScrollAnchor } from './history/history-scroll-anchor'

export interface HistoryCardRenderParams {
  state: ContentStore & {
    historyGroups: HistoryGroup[]
    historyDetail: ContentStore['historyDetail']
  }
  panelDom: PanelHistoryDomRefs
  floatingPanel: HTMLElement | null | undefined
  pruneHistorySelection: (() => void) | undefined
  getHistoryGroupByKey: ((key: string) => HistoryGroup | null | undefined) | undefined
  closeHistoryDetail: (() => void) | undefined
  getFilteredHistoryGroups: (() => HistoryGroup[]) | undefined
  updateHistoryExpansion: (() => void) | undefined
  isHistoryGroupCompleted: ((group: HistoryGroup) => boolean) | undefined
  historyController?: HistoryController | null
}

let historyListApp: App<Element> | null = null
let historyListMountTarget: HTMLElement | null = null
let historySummaryApp: App<Element> | null = null

const HISTORY_SCROLL_ANIMATION_DURATION = 700
const HISTORY_SCROLL_ANIMATION_DELAY = 60
const HISTORY_ITEM_ANIMATION_DURATION = 760
const HISTORY_ITEM_DRIFT_RATIO = 0.42
const HISTORY_ITEM_DRIFT_MAX = 220
const HISTORY_SCROLL_EPSILON = 0.4
const HISTORY_SCROLL_FORCE_ANIMATION = true
const HISTORY_ANCHOR_HOVER_LINGER_MS = 160

let activeScrollAnimationFrame: number | null = null
const historyItemAnimations = new WeakMap<HTMLElement, Animation | null>()
let activeAnchorHoverCleanup: number | null = null

const historyListBindings = reactive<HistoryListBindings>({
  entries: [],
  currentUrl: '',
  selectedKeys: [],
  seasonExpandedKeys: [],
  historyBatchRunning: false,
  isHistoryGroupCompleted: undefined,
})

const HistoryListHost = createHistoryListHost(historyListBindings)

export function renderHistoryCard(params: HistoryCardRenderParams): void {
  const {
    state,
    panelDom,
    floatingPanel: _floatingPanel,
    pruneHistorySelection,
    getHistoryGroupByKey,
    closeHistoryDetail,
    getFilteredHistoryGroups,
    updateHistoryExpansion,
    isHistoryGroupCompleted,
    historyController,
  } = params

  const historyList = panelDom?.historyList ?? null
  const historyEmpty = panelDom?.historyEmpty ?? null
  const historySummaryBody = panelDom?.historySummaryBody ?? null
  const historySummary = panelDom?.historySummary ?? null

  const scrollContainer = panelDom?.historyScroll ?? null
  const scrollAnchor = consumeHistoryScrollAnchor()
  const shouldRestoreScroll = Boolean(scrollContainer && state.historyExpanded && !scrollAnchor)
  const previousScrollTop =
    shouldRestoreScroll && scrollContainer ? scrollContainer.scrollTop : null

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

  const shouldRenderHistoryList = Boolean(historyController)
  if (!shouldRenderHistoryList) {
    if (historyListApp) {
      historyListApp.unmount()
      historyListApp = null
    }
    historyList.innerHTML = ''
    historyListMountTarget = null
  } else {
    if (historyListMountTarget && historyListMountTarget !== historyList && historyListApp) {
      historyListApp.unmount()
      historyListApp = null
      historyListMountTarget = null
    }
    if (!historyListApp) {
      historyList.innerHTML = ''
      historyListApp = createApp(HistoryListHost)
      historyListApp.use(pinia)
      historyListApp.provide(historyContextKey, historyController!)
      historyListApp.mount(historyList)
      historyListMountTarget = historyList
    }
    historyListBindings.entries = entries
    historyListBindings.currentUrl = currentUrl
    historyListBindings.selectedKeys = Array.from(state.historySelectedKeys || [])
    historyListBindings.seasonExpandedKeys = Array.from(state.historySeasonExpanded || [])
    historyListBindings.historyBatchRunning = Boolean(state.historyBatchRunning)
    historyListBindings.isHistoryGroupCompleted =
      typeof isHistoryGroupCompleted === 'function' ? isHistoryGroupCompleted : undefined
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
  historySummaryApp.use(pinia)
  if (historyController) {
    historySummaryApp.provide(historyContextKey, historyController)
  }
  historySummaryApp.mount(historySummaryBody)

  if (historySummary instanceof HTMLElement) {
    historySummary.classList.toggle('is-empty', !summaryData)
  }

  if (typeof updateHistoryExpansion === 'function') {
    updateHistoryExpansion()
  }

  if (scrollContainer) {
    scheduleScrollAdjustment(() => {
      if (scrollAnchor) {
        applyScrollAnchor(scrollContainer, scrollAnchor)
        return
      }
      if (
        shouldRestoreScroll &&
        typeof previousScrollTop === 'number' &&
        scrollContainer.scrollTop !== previousScrollTop
      ) {
        scrollContainer.scrollTop = previousScrollTop
      }
    })
  }
}

function buildSummaryData(group: HistoryGroup): { title: string; metaParts: string[] } {
  const mainRecord = (group.main ?? {}) as HistoryGroup['main'] & Record<string, unknown>
  const titleCandidate = typeof mainRecord.pageTitle === 'string' ? mainRecord.pageTitle : ''
  const title = group.title || titleCandidate || '未命名资源'
  const metaParts: string[] = []
  const providerLabel = resolveHistoryGroupProviderLabel(group)
  if (providerLabel) {
    metaParts.push(providerLabel)
  }
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

interface ScrollAnchorPayload {
  groupKey: string
  scrollTop: number
  relativeTop: number
}

function scheduleScrollAdjustment(task: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => task())
  } else {
    setTimeout(task, 0)
  }
}

function applyScrollAnchor(container: HTMLElement, anchor: ScrollAnchorPayload): void {
  if (!anchor.groupKey) {
    return
  }
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>('.chaospace-history-item[data-group-key]'),
  )
  const target = candidates.find((element) => element.dataset['groupKey'] === anchor.groupKey)
  if (!target) {
    return
  }
  const containerRect = container.getBoundingClientRect()
  const itemRect = target.getBoundingClientRect()
  const newRelativeTop = itemRect.top - containerRect.top
  if (!Number.isFinite(newRelativeTop) || !Number.isFinite(anchor.relativeTop)) {
    return
  }
  const delta = newRelativeTop - anchor.relativeTop
  const nextScrollTop = anchor.scrollTop + delta
  if (!Number.isFinite(nextScrollTop)) {
    return
  }
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const startScrollTop = clampScrollTop(anchor.scrollTop, maxScrollTop)
  const targetScrollTop = clampScrollTop(nextScrollTop, maxScrollTop)
  const movementDelta = anchor.relativeTop - newRelativeTop
  const shouldAnimate =
    shouldAnimateHistoryAnchor() && Math.abs(movementDelta) > HISTORY_SCROLL_EPSILON

  if (!shouldAnimate) {
    container.scrollTop = targetScrollTop
    return
  }

  if (activeAnchorHoverCleanup !== null) {
    clearTimeout(activeAnchorHoverCleanup)
    activeAnchorHoverCleanup = null
  }

  const historyList = container.querySelector('.chaospace-history-list')
  if (historyList) {
    historyList.classList.add('is-anchoring')
  }

  target.classList.add('is-anchor-hover')
  container.scrollTop = startScrollTop
  animateHistoryScrollFollow(container, startScrollTop, targetScrollTop, movementDelta)
  accentHistoryItemDrift(target, movementDelta, () => {
    activeAnchorHoverCleanup = window.setTimeout(() => {
      target.classList.remove('is-anchor-hover')
      if (historyList) {
        historyList.classList.remove('is-anchoring')
      }
      activeAnchorHoverCleanup = null
    }, HISTORY_ANCHOR_HOVER_LINGER_MS)
  })
}

function animateHistoryScrollFollow(
  container: HTMLElement,
  startScrollTop: number,
  targetScrollTop: number,
  movementDelta: number,
): void {
  if (activeScrollAnimationFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(activeScrollAnimationFrame)
    activeScrollAnimationFrame = null
  }

  const distance = targetScrollTop - startScrollTop
  if (Math.abs(distance) <= HISTORY_SCROLL_EPSILON) {
    container.scrollTop = targetScrollTop
    return
  }

  const distanceMagnitude = Math.abs(distance)
  const dynamicDuration = Math.min(
    HISTORY_SCROLL_ANIMATION_DURATION + distanceMagnitude * 0.35,
    720,
  )
  const duration = Math.max(HISTORY_SCROLL_ANIMATION_DURATION * 0.8, dynamicDuration)
  const delay = Math.min(HISTORY_SCROLL_ANIMATION_DELAY + Math.abs(movementDelta) * 0.08, 120)
  let playheadStart: number | null = null

  const step = (timestamp: number) => {
    if (playheadStart === null) {
      playheadStart = timestamp + delay
    }
    if (timestamp < playheadStart) {
      activeScrollAnimationFrame = requestAnimationFrame(step)
      return
    }
    const elapsed = timestamp - playheadStart
    const progress = Math.min(elapsed / duration, 1)
    const easedProgress = easeOutBack(progress)
    container.scrollTop = startScrollTop + distance * easedProgress
    if (progress < 1) {
      activeScrollAnimationFrame = requestAnimationFrame(step)
    } else {
      container.scrollTop = targetScrollTop
      activeScrollAnimationFrame = null
    }
  }

  activeScrollAnimationFrame = requestAnimationFrame(step)
}

function accentHistoryItemDrift(target: HTMLElement, delta: number, onComplete?: () => void): void {
  if (!target || Math.abs(delta) <= HISTORY_SCROLL_EPSILON) {
    onComplete?.()
    return
  }
  const drift = clampValue(
    delta * HISTORY_ITEM_DRIFT_RATIO,
    -HISTORY_ITEM_DRIFT_MAX,
    HISTORY_ITEM_DRIFT_MAX,
  )

  if (!Number.isFinite(drift) || Math.abs(drift) <= HISTORY_SCROLL_EPSILON) {
    onComplete?.()
    return
  }

  if (typeof target.animate === 'function') {
    const previous = historyItemAnimations.get(target)
    previous?.cancel()
    const animation = target.animate(
      [
        {
          transform: `translateY(${drift}px) scale(0.995)`,
          offset: 0,
          easing: 'cubic-bezier(0.12, 0.83, 0.31, 1)',
        },
        {
          transform: `translateY(${drift * 0.45}px) scale(0.998)`,
          offset: 0.4,
          easing: 'cubic-bezier(0.12, 0.83, 0.31, 1)',
        },
        {
          transform: 'translateY(0) scale(1)',
          offset: 1,
          easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        },
      ],
      {
        duration: HISTORY_ITEM_ANIMATION_DURATION,
        fill: 'both',
      },
    )
    historyItemAnimations.set(target, animation)
    const cleanup = () => {
      historyItemAnimations.delete(target)
      onComplete?.()
    }
    animation.addEventListener('finish', cleanup, { once: true })
    animation.addEventListener('cancel', cleanup, { once: true })
    return
  }

  const transition = `transform ${HISTORY_ITEM_ANIMATION_DURATION}ms cubic-bezier(0.34, 1.56, 0.64, 1)`
  target.style.transition = transition
  target.style.transform = `translateY(${drift}px) scale(0.995)`
  requestAnimationFrame(() => {
    target.style.transform = 'translateY(0) scale(1)'
  })
  const handleEnd = () => {
    target.style.transition = ''
    target.style.transform = ''
    target.removeEventListener('transitionend', handleEnd)
    onComplete?.()
  }
  target.addEventListener('transitionend', handleEnd)
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const x = t - 1
  return 1 + c3 * x * x * x + c1 * x * x
}

function clampScrollTop(value: number, maxScrollTop: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0) {
    return Math.max(0, value)
  }
  return Math.min(Math.max(0, value), maxScrollTop)
}

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (min > max) {
    return value
  }
  return Math.min(Math.max(value, min), max)
}

function shouldAnimateHistoryAnchor(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false
  }
  if (HISTORY_SCROLL_FORCE_ANIMATION) {
    return true
  }
  if (typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false
      }
    } catch {
      // ignore query errors
    }
  }
  return true
}
