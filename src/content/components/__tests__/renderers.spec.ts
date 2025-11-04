import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createResourceListRenderer, type ResourceListRendererParams } from '../resource-list'
import type { ResourceListPanelDom } from '../resource-list'
import { renderHistoryCard, type HistoryCardRenderParams } from '../history-card'
import type { HistoryGroup } from '../../types'
import type { HistoryDetailDomRefs, RenderHistoryDetailParams } from '../history-detail'

describe('ResourceList renderer summary', () => {
  it('reflects selection counts and badges in summary text', () => {
    const summaryEl = document.createElement('div')
    const titleEl = document.createElement('div')
    const itemsContainer = document.createElement('div')

    const panelDom: ResourceListPanelDom = {
      resourceSummary: summaryEl,
      resourceTitle: titleEl,
      itemsContainer,
    }

    const state = {
      items: [
        { id: '1', title: '第一项', order: 1 },
        { id: '2', title: '第二项', order: 2 },
        { id: '3', title: '第三项', order: 3 },
      ],
      selectedIds: new Set<string | number>(['1', '2']),
      newItemIds: new Set<string | number>(['3']),
      transferredIds: new Set<string | number>(),
      sortKey: 'page' as const,
      sortOrder: 'asc' as const,
      currentHistory: null,
      seasonLoadProgress: { total: 0, loaded: 0 },
      isSeasonLoading: false,
      completion: { label: '连载中', state: 'ongoing' },
      seasonCompletion: {},
      seasonEntries: [],
      historyRateLimitMs: 500,
      baseDir: '/',
      baseDirLocked: false,
      autoSuggestedDir: null,
      classification: 'unknown',
      classificationDetails: null,
      useTitleSubdir: true,
      useSeasonSubdir: false,
      hasSeasonSubdirPreference: false,
      itemIdSet: new Set<string | number>(),
      deferredSeasonInfos: [],
      pageTitle: '',
      pageUrl: '',
      poster: null,
      origin: '',
      jobId: null,
      logs: [],
      transferStatus: 'idle',
      lastResult: null,
      statusMessage: '',
      theme: 'dark',
      historyRecords: [],
      historyGroups: [],
      historyExpanded: false,
      historySeasonExpanded: new Set<string>(),
      historyFilter: 'all',
      historySelectedKeys: new Set<string>(),
      historyBatchRunning: false,
      historyBatchProgressLabel: '',
      historyDetail: {
        isOpen: false,
        loading: false,
        groupKey: '',
        pageUrl: '',
        data: null,
        error: '',
        fallback: null,
      },
      historyDetailCache: new Map<string, unknown>(),
      seasonDirMap: {},
      seasonResolvedPaths: [],
      activeSeasonId: null,
      settingsPanel: { isOpen: false },
    } as unknown as ResourceListRendererParams['state']

    const renderer = createResourceListRenderer({
      state,
      panelDom,
      renderSeasonTabs: () => ({ tabItems: [], activeId: null, activeTab: null }),
      filterItemsForActiveSeason: (items) => items,
      computeSeasonTabState: () => ({ tabItems: [], activeId: null, activeTab: null }),
      renderSeasonControls: vi.fn(),
      updateTransferButton: vi.fn(),
      updatePanelHeader: vi.fn(),
    })

    renderer.renderResourceSummary()

    expect(summaryEl.textContent).toContain('已选 2 / 3')
    expect(summaryEl.textContent).toContain('新增 1')
    expect(summaryEl.textContent).toContain('📡 连载中')
    expect(titleEl.textContent).toBe('🔍 找到 3 个百度网盘资源')
  })
})

describe('HistoryCard renderer toggles', () => {
  it('enables toggle buttons after rendering groups', () => {
    const historyList = document.createElement('div')
    const historyEmpty = document.createElement('div')
    const historySummaryBody = document.createElement('div')
    const historySummary = document.createElement('div')
    const overlay = document.createElement('div')
    const toggleButton = document.createElement('button')
    toggleButton.dataset['role'] = 'history-toggle'
    overlay.appendChild(toggleButton)

    const panelDom = {
      historyList,
      historyEmpty,
      historySummaryBody,
      historySummary,
      historyOverlay: overlay,
    } as HistoryCardRenderParams['panelDom']

    const historyGroup = {
      key: 'group-1',
      title: '示例记录',
      origin: 'chaospace',
      poster: null,
      updatedAt: Date.now(),
      records: [],
      main: {
        id: 'record-1',
        pageTitle: '示例记录',
        completion: { state: 'ongoing', label: '连载中' },
        targetDirectory: '/示例',
        urls: ['https://example.com'],
      },
      children: [],
      urls: ['https://example.com'],
      seasonEntries: [],
    } as unknown as HistoryGroup

    const state = {
      historyGroups: [historyGroup],
      historyDetail: {
        isOpen: false,
        loading: false,
        groupKey: '',
        pageUrl: '',
        data: null,
        error: '',
        fallback: null,
      },
      historySelectedKeys: new Set<string>(),
      historySeasonExpanded: new Set<string>(),
      historyBatchRunning: false,
      historyExpanded: false,
      pageUrl: 'https://example.com',
      baseDir: '/',
      baseDirLocked: false,
      autoSuggestedDir: null,
      classification: 'unknown',
      classificationDetails: null,
      useTitleSubdir: true,
      useSeasonSubdir: false,
      hasSeasonSubdirPreference: false,
      presets: [],
      items: [],
      itemIdSet: new Set<string>(),
      isSeasonLoading: false,
      seasonLoadProgress: { total: 0, loaded: 0 },
      deferredSeasonInfos: [],
      sortKey: 'page' as const,
      sortOrder: 'asc' as const,
      selectedIds: new Set<string>(),
      newItemIds: new Set<string>(),
      transferredIds: new Set<string>(),
      seasonCompletion: {},
      seasonEntries: [],
      completion: null,
      historyRecords: [],
      historyFilter: 'all',
      historyBatchProgressLabel: '',
      historyDetailCache: new Map<string, unknown>(),
      logs: [],
      transferStatus: 'idle',
      lastResult: null,
      statusMessage: '',
      theme: 'dark',
      jobId: null,
      origin: '',
      poster: null,
      pageTitle: '',
      seasonDirMap: {},
      seasonResolvedPaths: [],
      activeSeasonId: null,
      settingsPanel: { isOpen: false },
    } as unknown as HistoryCardRenderParams['state']

    renderHistoryCard({
      state,
      panelDom,
      floatingPanel: overlay,
      pruneHistorySelection: undefined,
      getHistoryGroupByKey: undefined,
      closeHistoryDetail: undefined,
      getFilteredHistoryGroups: undefined,
      updateHistorySelectionSummary: undefined,
      updateHistoryBatchControls: undefined,
      updateHistoryExpansion: undefined,
      isHistoryGroupCompleted: undefined,
    })

    expect(historyEmpty.classList.contains('is-hidden')).toBe(true)
    expect(historyList.innerHTML).not.toBe('')
    expect(panelDom.historyToggleButtons).toBeDefined()
    expect(panelDom.historyToggleButtons?.length).toBeGreaterThan(0)
    panelDom.historyToggleButtons?.forEach((button) => {
      expect(button.disabled).toBe(false)
    })
  })
})

describe('History detail transitions', () => {
  let renderHistoryDetail: typeof import('../history-detail').renderHistoryDetail

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    ;({ renderHistoryDetail } = await import('../history-detail'))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('toggles overlay visibility when history detail opens and closes', () => {
    const detailDom: HistoryDetailDomRefs = {}
    const state = {
      historyDetail: {
        isOpen: true,
        loading: true,
        groupKey: 'group-1',
        pageUrl: 'https://example.com',
        data: null,
        error: '',
        fallback: null,
      },
    } as unknown as RenderHistoryDetailParams['state']

    renderHistoryDetail({
      state,
      detailDom,
      getHistoryGroupByKey: () => null,
      onClose: undefined,
    })

    expect(document.body.classList.contains('chaospace-history-detail-active')).toBe(true)
    expect(detailDom.backdrop).toBeInstanceOf(HTMLElement)
    expect(detailDom.backdrop?.hasAttribute('hidden')).toBe(false)

    state.historyDetail.isOpen = false
    state.historyDetail.loading = false

    renderHistoryDetail({
      state,
      detailDom,
      getHistoryGroupByKey: () => null,
      onClose: undefined,
    })

    vi.runAllTimers()

    expect(document.body.classList.contains('chaospace-history-detail-active')).toBe(false)
    expect(detailDom.backdrop?.hasAttribute('hidden')).toBe(true)
  })
})
