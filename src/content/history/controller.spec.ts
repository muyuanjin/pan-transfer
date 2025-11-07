import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHistoryController } from './controller'
import { createPanelRuntimeState } from '../runtime/panel-state'
import { state, panelDom } from '../state'
import type { ContentHistoryRecord, HistoryGroup } from '../types'
import { getPanelHistoryDom } from '../types'
import type { TabSeasonPreferenceController } from '../services/tab-season-preference'
import * as historyDetailComponents from '../components/history-detail'
import * as stylesLoader from '../styles.loader'

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
      state.seasonPreferenceScope = value === state.seasonSubdirDefault ? 'default' : 'tab'
      if (panelDom.useSeasonCheckbox) {
        panelDom.useSeasonCheckbox.checked = value
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
    panelDom.useSeasonCheckbox = document.createElement('input')
    panelDom.settingsUseSeason = document.createElement('input')
    panelDom.historyList = document.createElement('div')
    panelDom.historyEmpty = document.createElement('div')
    panelDom.historySummary = document.createElement('div')
    panelDom.historySummaryBody = document.createElement('div')
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
    expect(panelDom.useSeasonCheckbox?.checked).toBe(true)
    expect(panelDom.settingsUseSeason?.checked).toBe(false)
    expect(renderPathPreview).toHaveBeenCalled()
    expect(renderSeasonHint).toHaveBeenCalled()
    expect(seasonPreference.applyHistorySelection).toHaveBeenCalledWith(true)
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
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (globalThis as { chrome?: typeof chrome }).chrome
    }
  })
})
