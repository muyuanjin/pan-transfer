import { createApp, type App } from 'vue'
import ResourceListView, {
  type ResourceListItemView,
  type ResourceBadgeView,
} from './ResourceListView.vue'
import type { ContentState, ResourceItem, PanelDomRefs } from '../types'

export type ResourceListPanelDom = Pick<
  PanelDomRefs,
  'resourceSummary' | 'resourceTitle' | 'itemsContainer'
> & {
  [key: string]: HTMLElement | null | undefined
}

export interface ResourceListRendererParams {
  state: ContentState & {
    items: Array<ResourceItem & { id: string | number } & Record<string, unknown>>
  }
  panelDom: ResourceListPanelDom
  renderSeasonTabs: () => { tabItems: unknown[]; activeId: string | null; activeTab?: any }
  filterItemsForActiveSeason: (items: ResourceItem[], activeId: string | null) => ResourceItem[]
  computeSeasonTabState: (options?: { syncState?: boolean }) => {
    tabItems: unknown[]
    activeId: string | null
    activeTab?: any
  }
  renderSeasonControls: () => void
  updateTransferButton: () => void
  updatePanelHeader: () => void
}

export interface ResourceSummaryContext {
  tabState?: ReturnType<ResourceListRendererParams['computeSeasonTabState']>
  visibleCount?: number
  visibleSelected?: number
}

export interface ResourceListRenderer {
  renderResourceList: () => void
  renderResourceSummary: (context?: ResourceSummaryContext) => void
}

export function createResourceListRenderer(
  params: ResourceListRendererParams,
): ResourceListRenderer {
  const {
    state,
    panelDom,
    renderSeasonTabs,
    filterItemsForActiveSeason,
    computeSeasonTabState,
    renderSeasonControls,
    updateTransferButton,
    updatePanelHeader,
  } = params

  let listApp: App<Element> | null = null

  function renderResourceSummary(context: ResourceSummaryContext = {}): void {
    if (!panelDom.resourceSummary) {
      return
    }
    const total = state.items.length
    const selected = state.selectedIds.size
    const tabState = context.tabState || computeSeasonTabState({ syncState: false })
    const hasTabs = Array.isArray(tabState.tabItems) && tabState.tabItems.length > 0

    let currentVisibleCount =
      typeof context.visibleCount === 'number' ? context.visibleCount : total
    let currentVisibleSelected =
      typeof context.visibleSelected === 'number' ? context.visibleSelected : selected

    if (hasTabs) {
      const filtered = filterItemsForActiveSeason(state.items, tabState.activeId)
      if (typeof context.visibleCount !== 'number') {
        currentVisibleCount = filtered.length
      }
      if (typeof context.visibleSelected !== 'number') {
        currentVisibleSelected = filtered.filter((item) => state.selectedIds.has(item.id)).length
      }
    }

    const parts = [`🧾 已选 ${selected} / ${total}`]
    if (hasTabs) {
      const activeTab = tabState.activeTab
      if (activeTab && activeTab.type === 'all') {
        parts.push(`显示全部 ${currentVisibleCount}`)
      } else if (activeTab) {
        parts.push(`${activeTab.name} ${currentVisibleSelected}/${activeTab.count}`)
      } else {
        parts.push(`当前显示 ${currentVisibleCount}`)
      }
    }

    if (state.newItemIds.size) {
      parts.push(`新增 ${state.newItemIds.size}`)
    }
    const seasonIds = new Set(state.items.map((item) => item.seasonId).filter(Boolean))
    if (seasonIds.size > 1) {
      parts.push(`涵盖 ${seasonIds.size} 季`)
    }
    if (state.isSeasonLoading && state.seasonLoadProgress.total > 0) {
      parts.push(`⏳ 加载 ${state.seasonLoadProgress.loaded}/${state.seasonLoadProgress.total}`)
    }
    if (state.completion && state.completion.label) {
      const stateEmoji =
        state.completion.state === 'completed'
          ? '✅'
          : state.completion.state === 'ongoing'
            ? '📡'
            : state.completion.state === 'upcoming'
              ? '🕒'
              : 'ℹ️'
      parts.push(`${stateEmoji} ${state.completion.label}`)
    }

    panelDom.resourceSummary.textContent = parts.join(' · ')
    if (panelDom.resourceTitle) {
      panelDom.resourceTitle.textContent = `🔍 找到 ${total} 个百度网盘资源`
    }
  }

  function renderResourceList(): void {
    const container = panelDom.itemsContainer
    if (!container) {
      return
    }

    const tabState = renderSeasonTabs()
    const hasAnyItems = state.items.length > 0
    const filteredItems =
      Array.isArray(tabState.tabItems) && tabState.tabItems.length > 0
        ? filterItemsForActiveSeason(state.items, tabState.activeId)
        : [...state.items]

    let visibleSelected = 0

    if (listApp) {
      listApp.unmount()
      listApp = null
    }
    container.innerHTML = ''

    if (!filteredItems.length) {
      const emptyMessage = buildEmptyMessage({ hasAnyItems, tabState, state })
      listApp = createApp(ResourceListView, {
        items: [],
        emptyMessage,
      })
      listApp.mount(container)
      renderResourceSummary({ tabState, visibleCount: filteredItems.length, visibleSelected })
      updateTransferButton()
      updatePanelHeader()
      renderSeasonControls()
      return
    }

    const sortedItems = sortItems(filteredItems, state.sortKey, state.sortOrder)
    const viewItems = sortedItems.map((item) => {
      const isSelected = state.selectedIds.has(item.id)
      const isTransferred = state.transferredIds.has(item.id)
      const isNew = Boolean(state.currentHistory && state.newItemIds.has(item.id))
      if (isSelected) {
        visibleSelected += 1
      }
      return toResourceListItemView(item, {
        isSelected,
        isTransferred,
        isNew,
        hasCurrentHistory: Boolean(state.currentHistory),
      })
    })

    listApp = createApp(ResourceListView, {
      items: viewItems,
      emptyMessage: '',
    })
    listApp.mount(container)

    renderResourceSummary({ tabState, visibleCount: sortedItems.length, visibleSelected })
    updateTransferButton()
    updatePanelHeader()
    renderSeasonControls()
  }

  return {
    renderResourceList,
    renderResourceSummary,
  }
}

function buildEmptyMessage({
  hasAnyItems,
  tabState,
  state,
}: {
  hasAnyItems: boolean
  tabState: ReturnType<ResourceListRendererParams['renderSeasonTabs']>
  state: ResourceListRendererParams['state']
}): string {
  if (!hasAnyItems) {
    if (state.isSeasonLoading) {
      const { loaded, total } = state.seasonLoadProgress
      const progress = total > 0 ? ` (${loaded}/${total})` : ''
      return `⏳ 正在加载多季资源${progress}...`
    }
    return '😅 没有解析到百度网盘资源'
  }
  const activeTab = tabState.activeTab
  if (state.isSeasonLoading && activeTab && activeTab.type === 'season') {
    const { loaded, total } = state.seasonLoadProgress
    const progress = total > 0 ? ` (${loaded}/${total})` : ''
    return `⏳ ${activeTab.name} 正在加载${progress}...`
  }
  return activeTab && activeTab.name ? `😴 ${activeTab.name} 暂无资源` : '😴 当前标签暂无资源'
}

function sortItems(
  items: ResourceItem[],
  sortKey: ContentState['sortKey'],
  sortOrder: ContentState['sortOrder'],
): ResourceItem[] {
  const sorted = [...items]
  if (sortKey === 'title') {
    sorted.sort((a, b) => {
      const compare = String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
      return sortOrder === 'asc' ? compare : -compare
    })
  } else {
    sorted.sort((a, b) => {
      const aOrder = Number(a.order) || 0
      const bOrder = Number(b.order) || 0
      const compare = aOrder - bOrder
      return sortOrder === 'asc' ? compare : -compare
    })
  }
  return sorted
}

interface ResourceViewOptions {
  isSelected: boolean
  isTransferred: boolean
  isNew: boolean
  hasCurrentHistory: boolean
}

function toResourceListItemView(
  item: ResourceItem,
  options: ResourceViewOptions,
): ResourceListItemView {
  const displayTitle = item.seasonLabel
    ? `🔗 [${item.seasonLabel}] ${item.title}`
    : `🔗 ${item.title}`

  const badges: ResourceBadgeView[] = []
  if (options.isTransferred) {
    badges.push({ label: '已转存', className: 'chaospace-badge chaospace-badge-success' })
  }
  if (options.isNew) {
    badges.push({ label: '新增', className: 'chaospace-badge chaospace-badge-new' })
  }
  if (!options.isTransferred && !options.isNew && options.hasCurrentHistory) {
    badges.push({ label: '待转存', className: 'chaospace-badge chaospace-badge-pending' })
  }
  if (item.seasonLabel) {
    badges.push({ label: `季：${item.seasonLabel}`, className: 'chaospace-badge' })
  }
  if (item.seasonCompletion && item.seasonCompletion.label) {
    const badgeClass =
      item.seasonCompletion.state === 'completed'
        ? 'chaospace-badge chaospace-badge-success'
        : 'chaospace-badge'
    badges.push({ label: `状态：${item.seasonCompletion.label}`, className: badgeClass })
  }
  if (item.quality) {
    badges.push({ label: `画质：${item.quality}`, className: 'chaospace-badge' })
  }
  if (item.subtitle) {
    badges.push({ label: `字幕：${item.subtitle}`, className: 'chaospace-badge' })
  }

  return {
    id: item.id,
    displayTitle,
    isSelected: options.isSelected,
    isTransferred: options.isTransferred,
    isNew: options.isNew,
    badges,
  }
}
