import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHistoryController } from './controller'
import { createPanelRuntimeState } from '../runtime/panel-state'
import { state, panelDom } from '../state'
import type { ContentHistoryRecord } from '../types'

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
    const saveSettings = vi.fn()

    const history = createHistoryController({
      getFloatingPanel: () => document.createElement('div'),
      panelState: createPanelRuntimeState(),
      renderResourceList,
      renderPathPreview,
      renderSeasonHint,
      saveSettings,
    })

    const targetUrl = 'https://www.chaospace.cc/tvshows/123.html'
    state.pageUrl = targetUrl
    state.historyRecords = [buildHistoryRecord({ pageUrl: targetUrl, useSeasonSubdir: true })]

    expect(state.hasSeasonSubdirPreference).toBe(false)
    expect(state.useSeasonSubdir).toBe(false)

    history.applyHistoryToCurrentPage()

    expect(state.useSeasonSubdir).toBe(true)
    expect(state.hasSeasonSubdirPreference).toBe(true)
    expect(panelDom.useSeasonCheckbox?.checked).toBe(true)
    expect(panelDom.settingsUseSeason?.checked).toBe(true)
    expect(renderPathPreview).toHaveBeenCalled()
    expect(renderSeasonHint).toHaveBeenCalled()
    expect(saveSettings).toHaveBeenCalled()
  })
})
