import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { handleCheckUpdates, historyServiceTestHooks } from './history-service'
import type { HistoryRecord } from '@/shared/types/transfer'
import type { SiteHistorySnapshot } from '@/shared/types/history'

const persistHistoryNowMock = vi.hoisted(() => vi.fn())
const ensureHistoryLoadedMock = vi.hoisted(() => vi.fn())
const historyIndex = new Map<string, { record: HistoryRecord; index: number }>()
const registryMock = {
  listSiteProviders: () => [
    {
      id: 'chaospace',
      metadata: { displayName: 'CHAOSPACE' },
      detect: vi.fn().mockResolvedValue(false),
    },
  ],
  getSiteProvider: () => null,
}

vi.mock('../storage/history-store', () => ({
  ensureHistoryLoaded: ensureHistoryLoadedMock,
  getHistoryIndexMap: () => historyIndex,
  ensureHistoryRecordStructure: (record: HistoryRecord) => record,
  normalizeHistoryPath: (value: string) => value,
  persistHistoryNow: persistHistoryNowMock,
}))

vi.mock('../providers/registry', () => ({
  getBackgroundProviderRegistry: () => registryMock,
  resetBackgroundProviderRegistryCache: vi.fn(),
}))

vi.mock('../providers/pipeline', () => ({
  dispatchTransferPayload: vi.fn(),
  getBackgroundTransferPipeline: vi.fn(),
  resetBackgroundTransferPipelineCache: vi.fn(),
}))

function createHistoryRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  const base: HistoryRecord = {
    pageUrl: 'https://www.chaospace.cc/tvshows/100.html',
    pageTitle: '测试剧集',
    pageType: 'series',
    origin: 'https://www.chaospace.cc',
    siteProviderId: 'chaospace',
    siteProviderLabel: 'CHAOSPACE',
    poster: null,
    targetDirectory: '/视频/番剧/测试剧集',
    baseDir: '/视频/番剧',
    useTitleSubdir: true,
    useSeasonSubdir: false,
    lastTransferredAt: 0,
    lastCheckedAt: 0,
    totalTransferred: 0,
    completion: null,
    seasonCompletion: {},
    seasonDirectory: {},
    seasonEntries: [],
    items: {},
    itemOrder: [],
    lastResult: null,
    pendingTransfer: null,
  }
  return { ...base, ...overrides }
}

function stubSnapshot(
  items: SiteHistorySnapshot['items'],
  overrides: Partial<SiteHistorySnapshot> = {},
): SiteHistorySnapshot {
  return {
    pageUrl: overrides.pageUrl ?? 'https://www.chaospace.cc/tvshows/100.html',
    pageTitle: overrides.pageTitle ?? '测试剧集',
    pageType: overrides.pageType ?? 'series',
    total: items.length,
    items,
    completion: overrides.completion ?? null,
    seasonCompletion: overrides.seasonCompletion ?? {},
    seasonEntries: overrides.seasonEntries ?? [],
    providerId: overrides.providerId ?? 'chaospace',
    providerLabel: overrides.providerLabel ?? 'CHAOSPACE',
  }
}

describe('handleCheckUpdates detection staging', () => {
  beforeEach(() => {
    historyIndex.clear()
    persistHistoryNowMock.mockClear()
    ensureHistoryLoadedMock.mockClear()
    historyServiceTestHooks.setSnapshotCollector(null)
  })

  afterEach(() => {
    historyServiceTestHooks.setSnapshotCollector(null)
  })

  it('stages pending transfer without dispatching when new items exist', async () => {
    const pageUrl = 'https://www.chaospace.cc/seasons/429496.html'
    const record = createHistoryRecord({
      pageUrl,
      items: {
        'ep-1': {
          id: 'ep-1',
          title: '第1集',
          status: 'success',
          message: 'ok',
        },
      },
      itemOrder: ['ep-1'],
    })
    historyIndex.set(pageUrl, { record, index: 0 })

    const snapshot = stubSnapshot(
      [
        { id: 'ep-1', title: '第1集', linkUrl: 'https://pan.baidu.com/s/old', passCode: '1111' },
        { id: 'ep-2', title: '第2集', linkUrl: 'https://pan.baidu.com/s/new', passCode: '2222' },
      ],
      { pageUrl },
    )
    historyServiceTestHooks.setSnapshotCollector(async () => snapshot)

    const response = await handleCheckUpdates({ pageUrl })

    expect(response.hasUpdates).toBe(true)
    expect(response.summary).toContain('等待转存')
    expect(record.items).toHaveProperty('ep-1')
    expect(record.items).not.toHaveProperty('ep-2')
    expect(record.pendingTransfer).not.toBeNull()
    expect(record.pendingTransfer?.payload.items).toHaveLength(1)
    expect(record.pendingTransfer?.payload.items[0]?.id).toBe('ep-2')
    expect(persistHistoryNowMock).toHaveBeenCalled()
  })

  it('covers chaospace tvshow 429494 detection-only flow without transfer enqueue', async () => {
    const pageUrl = 'https://www.chaospace.cc/tvshows/429494.html'
    const record = createHistoryRecord({ pageUrl })
    historyIndex.set(pageUrl, { record, index: 0 })

    const snapshot = stubSnapshot(
      [
        {
          id: 'ep-101',
          title: '第7集',
          linkUrl: 'https://pan.baidu.com/s/chaospace-ep7',
          passCode: '3344',
        },
      ],
      { pageUrl },
    )
    historyServiceTestHooks.setSnapshotCollector(async () => snapshot)

    const response = await handleCheckUpdates({ pageUrl })

    expect(response.hasUpdates).toBe(true)
    expect(response.pageUrl).toBe(pageUrl)
    expect(record.pendingTransfer?.payload.items[0]?.id).toBe('ep-101')
  })
})
