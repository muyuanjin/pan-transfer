import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHistoryController } from './controller'
import { createPanelRuntimeState } from '../runtime/panel-state'
import { state, panelDom } from '../state'
import type { ContentHistoryRecord } from '../types'
import type { TabSeasonPreferenceController } from '../services/tab-season-preference'

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

describe('history controller', () => {
  beforeEach(() => {
    state.$reset()
    panelDom.useSeasonCheckbox = document.createElement('input')
    panelDom.settingsUseSeason = document.createElement('input')
  })

  it('persists restored season preference derived from history', () => {
    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()
    const renderSeasonHint = vi.fn()

    const seasonPreference: TabSeasonPreferenceController = {
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

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      seasonPreference,
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
})
