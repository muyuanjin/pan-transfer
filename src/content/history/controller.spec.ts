import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHistoryController } from './controller'
import { createPanelRuntimeState } from '../runtime/panel-state'
import { state, panelDom } from '../state'
import type { ContentHistoryRecord, HistoryGroup, ResourceItem } from '../types'
import { getPanelHistoryDom } from '../types'
import type { TabSeasonPreferenceController } from '../services/tab-season-preference'
import * as historyDetailComponents from '../components/history-detail'
import * as stylesLoader from '../styles.loader'
import type { HistoryRecordItem } from '@/shared/types/transfer'
import * as historyService from '../services/history-service'
import * as toast from '../components/toast'

function buildHistoryRecord(overrides: Partial<ContentHistoryRecord> = {}): ContentHistoryRecord {
  const now = Date.now()
  return {
    pageUrl: 'https://www.chaospace.cc/tvshows/123.html',
    pageTitle: '测试剧集',
    pageType: 'series',
    origin: 'chaospace',
    poster: null,
    targetDirectory: '/视频/番剧/测试剧集',
    baseDir: '/视频/番剧',
    useTitleSubdir: true,
    useSeasonSubdir: false,
    lastTransferredAt: now,
    lastCheckedAt: now,
    totalTransferred: 0,
    completion: null,
    seasonCompletion: {},
    seasonDirectory: {},
    seasonEntries: [],
    items: {},
    itemOrder: [],
    lastResult: null,
    pendingTransfer: null,
    ...overrides,
  }
}

const panelHistoryDom = getPanelHistoryDom(panelDom)

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createSeasonPreferenceStub(
  renderSeasonHint: () => void,
  renderPathPreview: () => void,
): TabSeasonPreferenceController {
  return {
    initialize: vi.fn(),
    applyUserSelection: vi.fn(),
    applyHistorySelection: vi.fn().mockImplementation(async (value: boolean) => {
      state.useSeasonSubdir = value
      state.seasonPreferenceScope = value === state.seasonSubdirDefault ? 'default' : 'history'
      const panelUseSeasonCheckbox = panelDom.get('useSeasonCheckbox')
      if (panelUseSeasonCheckbox) {
        panelUseSeasonCheckbox.checked = value
      }
      renderSeasonHint()
      renderPathPreview()
    }),
    handleGlobalDefaultChange: vi.fn(),
    syncCheckboxes: vi.fn(),
  }
}

describe('history controller', () => {
  beforeEach(() => {
    state.$reset()
    panelDom.set('useSeasonCheckbox', document.createElement('input'))
    panelDom.set('settingsUseSeason', document.createElement('input'))
    panelDom.set('historyList', document.createElement('div'))
    panelDom.set('historyEmpty', document.createElement('div'))
    panelDom.set('historySummary', document.createElement('div'))
    panelDom.set('historySummaryBody', document.createElement('div'))
  })

  it('persists restored season preference derived from history', () => {
    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()
    const renderSeasonHint = vi.fn()

    const seasonPreference = createSeasonPreferenceStub(renderSeasonHint, renderPathPreview)

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      seasonPreference,
      panelDom: panelHistoryDom,
    })

    const targetUrl = 'https://www.chaospace.cc/tvshows/123.html'
    state.pageUrl = targetUrl
    state.historyRecords = [buildHistoryRecord({ pageUrl: targetUrl, useSeasonSubdir: true })]

    expect(state.useSeasonSubdir).toBe(false)
    expect(state.seasonPreferenceScope).toBe('default')

    history.applyHistoryToCurrentPage()

    expect(state.useSeasonSubdir).toBe(true)
    expect(panelDom.get('useSeasonCheckbox')?.checked).toBe(true)
    expect(panelDom.get('settingsUseSeason')?.checked).toBe(false)
    expect(renderPathPreview).toHaveBeenCalled()
    expect(renderSeasonHint).toHaveBeenCalled()
    expect(seasonPreference.applyHistorySelection).toHaveBeenCalledWith(true)
  })

  it('auto-selects only newly detected items when history has updates', () => {
    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()
    const renderSeasonHint = vi.fn()
    const seasonPreference = createSeasonPreferenceStub(renderSeasonHint, renderPathPreview)

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      seasonPreference,
      panelDom: panelHistoryDom,
    })

    const targetUrl = 'https://www.chaospace.cc/tvshows/new-episodes.html'
    const items: ResourceItem[] = [
      { id: 'ep-1', title: 'Episode 1', order: 0 },
      { id: 'ep-2', title: 'Episode 2', order: 1 },
      { id: 'ep-3', title: 'Episode 3', order: 2 },
    ]
    state.pageUrl = targetUrl
    state.items = items
    state.itemIdSet = new Set(items.map((item) => item.id))
    state.selectedIds = new Set(items.map((item) => item.id))

    const historyItems = {
      'ep-1': { id: 'ep-1', title: 'Episode 1', status: 'success', message: 'done' },
      'ep-2': { id: 'ep-2', title: 'Episode 2', status: 'success', message: 'done' },
    } satisfies Record<string, HistoryRecordItem>

    state.historyRecords = [
      buildHistoryRecord({
        pageUrl: targetUrl,
        items: historyItems,
        itemOrder: Object.keys(historyItems),
      }),
    ]

    history.applyHistoryToCurrentPage()

    expect(Array.from(state.newItemIds)).toEqual(['ep-3'])
    expect(state.selectedIds.size).toBe(1)
    expect(state.selectedIds.has('ep-3')).toBe(true)
  })

  it('opens history detail immediately even if styles are still loading', async () => {
    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()
    const renderSeasonHint = vi.fn()
    const seasonPreference = createSeasonPreferenceStub(renderSeasonHint, renderPathPreview)

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      seasonPreference,
      panelDom: panelHistoryDom,
    })

    const record = buildHistoryRecord()
    const historyGroup: HistoryGroup = {
      key: 'group-1',
      title: '测试剧集',
      origin: 'chaospace',
      poster: null,
      updatedAt: Date.now(),
      records: [record],
      main: record,
      children: [],
      urls: [record.pageUrl || ''],
      seasonEntries: [],
    }

    state.historyGroups = [historyGroup]
    state.historyRecords = []

    const ensureOverlaySpy = vi
      .spyOn(historyDetailComponents, 'ensureHistoryDetailOverlay')
      .mockImplementation(() => {})
    const renderDetailSpy = vi
      .spyOn(historyDetailComponents, 'renderHistoryDetail')
      .mockImplementation(() => {})

    const cssDeferred = createDeferred<void>()
    const loadCssSpy = vi.spyOn(stylesLoader, 'loadCss').mockReturnValue(cssDeferred.promise)

    const originalChrome = globalThis.chrome
    const sendMessageMock = vi.fn().mockResolvedValue({ ok: true, detail: {} })
    ;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: sendMessageMock,
      },
    } as unknown as typeof chrome

    const openPromise = history.openHistoryDetail('group-1')
    await Promise.resolve()

    expect(state.historyDetail.isOpen).toBe(true)
    expect(ensureOverlaySpy).toHaveBeenCalled()

    cssDeferred.resolve()
    await openPromise

    loadCssSpy.mockRestore()
    ensureOverlaySpy.mockRestore()
    renderDetailSpy.mockRestore()
    if (originalChrome) {
      globalThis.chrome = originalChrome
    } else {
      delete (globalThis as { chrome?: typeof chrome }).chrome
    }
  })

  it('dispatches pending transfer payloads for history records', async () => {
    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()
    const renderSeasonHint = vi.fn()
    const seasonPreference = createSeasonPreferenceStub(renderSeasonHint, renderPathPreview)

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      seasonPreference,
      panelDom: panelHistoryDom,
    })

    const pendingRecord = buildHistoryRecord({
      pageUrl: 'https://www.chaospace.cc/tvshows/pending.html',
      pendingTransfer: {
        jobId: 'job-transfer',
        detectedAt: Date.now(),
        summary: '检测到 1 项待转存',
        newItemIds: ['ep-1'],
        payload: {
          jobId: 'job-transfer',
          items: [{ id: 'ep-1', title: 'EP1' }],
        },
      },
    })

    state.historyGroups = [
      {
        key: 'pending',
        title: '待转存',
        origin: 'chaospace',
        poster: null,
        updatedAt: Date.now(),
        records: [pendingRecord],
        main: pendingRecord,
        children: [],
        urls: [pendingRecord.pageUrl || ''],
        seasonEntries: [],
      },
    ]

    const originalChrome = globalThis.chrome
    const sendMessageMock = vi.fn().mockResolvedValue({
      ok: true,
      results: [{ status: 'success' }],
      summary: '新篇已转存',
    })
    ;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: sendMessageMock,
      },
    } as unknown as typeof chrome
    const toastSpy = vi.spyOn(toast, 'showToast').mockImplementation(() => {})

    await history.triggerHistoryTransfer(pendingRecord, null, { deferRender: true })

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'chaospace:transfer',
      payload: pendingRecord.pendingTransfer?.payload,
    })
    expect(toastSpy).toHaveBeenCalledWith(
      'success',
      '转存成功',
      '新篇已转存',
      expect.objectContaining({ success: 1 }),
    )

    toastSpy.mockRestore()
    if (originalChrome) {
      globalThis.chrome = originalChrome
    } else {
      delete (globalThis as { chrome?: typeof chrome }).chrome
    }
  })

  it('processes batch transfers for selected pending groups', async () => {
    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()
    const renderSeasonHint = vi.fn()
    const seasonPreference = createSeasonPreferenceStub(renderSeasonHint, renderPathPreview)

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      seasonPreference,
      panelDom: panelHistoryDom,
    })

    const pendingRecord = buildHistoryRecord({
      pageUrl: 'https://www.chaospace.cc/tvshows/batch.html',
      pendingTransfer: {
        jobId: 'job-batch',
        detectedAt: Date.now(),
        summary: '待转存 1 项',
        newItemIds: ['ep-1'],
        payload: {
          jobId: 'job-batch',
          items: [{ id: 'ep-1', title: 'EP1' }],
        },
      },
    })

    const group: HistoryGroup = {
      key: 'batch',
      title: '批量剧集',
      origin: 'chaospace',
      poster: null,
      updatedAt: Date.now(),
      records: [pendingRecord],
      main: pendingRecord,
      children: [],
      urls: [pendingRecord.pageUrl || ''],
      seasonEntries: [],
    }

    state.historyGroups = [group]
    state.historyRecords = [pendingRecord]
    state.historySelectedKeys = new Set([group.key])
    state.historyRateLimitMs = 0

    const originalChrome = globalThis.chrome
    const sendMessageMock = vi.fn().mockResolvedValue({
      ok: true,
      results: [{ status: 'success' }],
      summary: '批量转存成功',
    })
    ;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: sendMessageMock,
      },
    } as unknown as typeof chrome
    const toastSpy = vi.spyOn(toast, 'showToast').mockImplementation(() => {})
    const fetchSnapshotSpy = vi
      .spyOn(historyService, 'fetchHistorySnapshot')
      .mockResolvedValue({ records: state.historyRecords, groups: state.historyGroups })

    await history.handleHistoryBatchTransfer()

    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(fetchSnapshotSpy).toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalledWith(
      'success',
      '批量转存完成',
      expect.stringContaining('成功 1 条'),
    )
    expect(state.historyBatchRunning).toBe(false)
    expect(state.historyBatchMode).toBe(null)

    fetchSnapshotSpy.mockRestore()
    toastSpy.mockRestore()
    if (originalChrome) {
      globalThis.chrome = originalChrome
    } else {
      delete (globalThis as { chrome?: typeof chrome }).chrome
    }
  })

  it('checks season urls when running batch detection on tv shows', async () => {
    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()
    const renderSeasonHint = vi.fn()
    const seasonPreference = createSeasonPreferenceStub(renderSeasonHint, renderPathPreview)

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      seasonPreference,
      panelDom: panelHistoryDom,
    })

    const tvUrl = 'https://www.chaospace.cc/tvshows/100.html'
    const seasonUrl = 'https://www.chaospace.cc/seasons/500.html'
    const tvRecord = buildHistoryRecord({
      pageUrl: tvUrl,
      seasonEntries: [
        {
          seasonId: 's1',
          seasonIndex: 0,
          label: 'S01',
          url: seasonUrl,
          completion: null,
          poster: null,
          loaded: true,
          hasItems: true,
        },
      ],
    })
    const seasonRecord = buildHistoryRecord({
      pageUrl: seasonUrl,
    })

    const group: HistoryGroup = {
      key: 'tv',
      title: '示例剧集',
      origin: 'chaospace',
      poster: null,
      updatedAt: Date.now(),
      records: [tvRecord, seasonRecord],
      main: tvRecord,
      children: [seasonRecord],
      urls: [tvUrl],
      seasonEntries: tvRecord.seasonEntries ?? [],
    }

    state.historyGroups = [group]
    state.historyRecords = [tvRecord, seasonRecord]
    state.historySelectedKeys = new Set([group.key])
    state.historyRateLimitMs = 0

    const requestSpy = vi
      .spyOn(historyService, 'requestHistoryUpdate')
      .mockImplementation(async (pageUrl: string) => {
        if (pageUrl === tvUrl) {
          return { ok: true, hasUpdates: false }
        }
        return { ok: true, hasUpdates: true }
      })
    const fetchSnapshotSpy = vi
      .spyOn(historyService, 'fetchHistorySnapshot')
      .mockResolvedValue({ records: state.historyRecords, groups: state.historyGroups })
    const toastSpy = vi.spyOn(toast, 'showToast').mockImplementation(() => {})

    await history.handleHistoryBatchCheck()

    expect(requestSpy).toHaveBeenCalledWith(seasonUrl)
    expect(requestSpy).toHaveBeenCalledTimes(1)
    expect(fetchSnapshotSpy).toHaveBeenCalled()
    expect(toastSpy).toHaveBeenCalled()

    requestSpy.mockRestore()
    fetchSnapshotSpy.mockRestore()
    toastSpy.mockRestore()
  })
})
