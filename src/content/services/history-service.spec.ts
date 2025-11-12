import { describe, expect, it } from 'vitest'

import {
  ensureHistorySearchTransliterationReady,
  filterHistoryGroups,
  buildHistoryGroupSeasonRows,
  prepareHistoryRecords,
  getHistoryPendingTransfer,
} from './history-service'
import type { HistoryGroup, ContentHistoryRecord } from '../types'
import type { CompletionStatus, SeasonEntry } from '@/shared/utils/completion-status'

function createHistoryRecord(overrides: Partial<ContentHistoryRecord> = {}): ContentHistoryRecord {
  const record: ContentHistoryRecord = {
    pageUrl: 'https://example.com/resource/default',
    pageTitle: '默认资源',
    pageType: 'series',
    origin: 'https://example.com',
    poster: null,
    targetDirectory: '/视频/番剧',
    baseDir: '/',
    useTitleSubdir: false,
    useSeasonSubdir: false,
    lastTransferredAt: 0,
    lastCheckedAt: 0,
    totalTransferred: 0,
    completion: {
      label: '连载中',
      state: 'ongoing',
    },
    seasonCompletion: {},
    seasonDirectory: {},
    seasonEntries: [],
    items: {},
    itemOrder: [],
    lastResult: null,
    pendingTransfer: null,
    ...overrides,
  }
  return record
}

interface CreateHistoryGroupOptions {
  key: string
  title: string
  pageUrl: string
  pageTitle?: string
  pageType?: 'series' | 'movie'
  targetDirectory?: string
  origin?: string
  completion?: CompletionStatus | null
  seasonEntries?: SeasonEntry[]
  siteProviderId?: string | null
  siteProviderLabel?: string | null
}

function createHistoryGroup(options: CreateHistoryGroupOptions): HistoryGroup {
  const {
    key,
    title,
    pageUrl,
    pageTitle,
    pageType = 'series',
    targetDirectory = '/视频/番剧',
    origin = 'https://example.com',
    completion = {
      label: '连载中',
      state: 'ongoing',
    },
    seasonEntries = [],
    siteProviderId = null,
    siteProviderLabel = null,
  } = options
  const record = createHistoryRecord({
    pageUrl,
    pageTitle: pageTitle ?? title,
    pageType,
    targetDirectory,
    origin,
    completion,
    seasonEntries,
    siteProviderId: siteProviderId ?? null,
    siteProviderLabel: siteProviderLabel ?? null,
  })
  return {
    key,
    title,
    origin,
    poster: null,
    updatedAt: 1000,
    siteProviderId,
    siteProviderLabel,
    records: [record],
    main: record,
    children: [],
    urls: [pageUrl],
    seasonEntries,
  }
}

describe('filterHistoryGroups', () => {
  it('filters history groups by search term across title and metadata', () => {
    const groups: HistoryGroup[] = [
      createHistoryGroup({
        key: 'g1',
        title: '孤独摇滚',
        pageUrl: 'https://example.com/tvshows/1.html',
        targetDirectory: '/视频/番剧/孤独摇滚',
      }),
      createHistoryGroup({
        key: 'g2',
        title: '流浪地球2',
        pageUrl: 'https://example.com/movies/2.html',
        pageType: 'movie',
        targetDirectory: '/视频/电影/流浪地球',
        completion: {
          label: '已完结',
          state: 'completed',
        },
      }),
    ]

    const result = filterHistoryGroups(groups, 'all', { searchTerm: '流浪' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g2')
  })

  it('matches provider label search tokens', () => {
    const groups: HistoryGroup[] = [
      createHistoryGroup({
        key: 'g-provider',
        title: '示例剧集',
        pageUrl: 'https://example.com/tvshows/42.html',
        siteProviderId: 'chaospace',
        siteProviderLabel: 'CHAOSPACE',
      }),
    ]

    const result = filterHistoryGroups(groups, 'all', { searchTerm: 'chaospace' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g-provider')
  })

  it('combines search filtering with category filters', () => {
    const groups: HistoryGroup[] = [
      createHistoryGroup({
        key: 'g1',
        title: '孤独摇滚',
        pageUrl: 'https://example.com/tvshows/1.html',
      }),
      createHistoryGroup({
        key: 'g2',
        title: '孤独摇滚剧场版',
        pageUrl: 'https://example.com/movies/3.html',
        pageType: 'movie',
        completion: {
          label: '已完结',
          state: 'completed',
        },
      }),
    ]

    const result = filterHistoryGroups(groups, 'movie', { searchTerm: '孤独' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g2')
  })

  it('matches multi-token searches across season labels and directories', () => {
    const groups: HistoryGroup[] = [
      createHistoryGroup({
        key: 'g1',
        title: '影之忍者',
        pageUrl: 'https://example.com/tvshows/4.html',
        targetDirectory: '/视频/番剧/影之忍者',
        seasonEntries: [
          {
            seasonId: 's02',
            seasonIndex: 2,
            label: 'S02 忍者对决',
            url: 'https://example.com/seasons/4-2.html',
            completion: null,
            poster: null,
            loaded: false,
            hasItems: false,
          },
        ],
      }),
      createHistoryGroup({
        key: 'g2',
        title: '影之忍者 外传',
        pageUrl: 'https://example.com/tvshows/5.html',
        targetDirectory: '/视频/番剧/影之忍者外传',
      }),
    ]

    const result = filterHistoryGroups(groups, 'all', { searchTerm: '忍者 s02' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g1')
  })

  it('matches full Pinyin search input', async () => {
    const groups: HistoryGroup[] = [
      createHistoryGroup({
        key: 'g1',
        title: '孤独摇滚',
        pageUrl: 'https://example.com/tvshows/1.html',
      }),
    ]

    await ensureHistorySearchTransliterationReady()
    const result = filterHistoryGroups(groups, 'all', { searchTerm: 'guduyaogun' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g1')
  })

  it('matches Pinyin initials search input', async () => {
    const groups: HistoryGroup[] = [
      createHistoryGroup({
        key: 'g1',
        title: '孤独摇滚',
        pageUrl: 'https://example.com/tvshows/1.html',
      }),
      createHistoryGroup({
        key: 'g2',
        title: '流浪地球2',
        pageUrl: 'https://example.com/movies/2.html',
        pageType: 'movie',
        completion: {
          label: '已完结',
          state: 'completed',
        },
      }),
    ]

    await ensureHistorySearchTransliterationReady()
    const result = filterHistoryGroups(groups, 'all', { searchTerm: 'lldq' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g2')
  })
})

describe('prepareHistoryRecords', () => {
  it('preserves pending transfer payloads so the UI can trigger transfers without reloading', () => {
    const pending = {
      jobId: 'job-123',
      detectedAt: 1710000000000,
      summary: '检测到 1 项待转存',
      newItemIds: ['ep-1'],
      payload: {
        jobId: 'job-123',
        origin: 'https://example.com',
        targetDirectory: '/视频/番剧/示例剧',
        items: [
          {
            id: 'ep-1',
            title: '第1集',
            targetPath: '/视频/番剧/示例剧/第1集',
            linkUrl: 'https://pan.baidu.com/s/abcdef',
            passCode: '1234',
          },
        ],
      },
    }
    const snapshot = JSON.parse(
      JSON.stringify({
        records: [
          {
            ...createHistoryRecord(),
            pendingTransfer: pending,
          },
        ],
      }),
    ) as { records: ContentHistoryRecord[] }
    const { records } = prepareHistoryRecords(snapshot)
    const revived = records[0]?.pendingTransfer
    expect(revived?.jobId).toBe('job-123')
    expect(revived?.detectedAt).toBe(pending.detectedAt)
    expect(revived?.payload.items).toHaveLength(1)
    expect(revived?.payload.items[0]).toMatchObject({ id: 'ep-1', title: '第1集' })
  })

  it('revives pending transfer payloads stored as object maps instead of arrays', () => {
    const pending = {
      jobId: 'job-map',
      detectedAt: 1720000000000,
      summary: '检测到 2 项待转存',
      newItemIds: ['ep-10', 'ep-11'],
      payload: {
        jobId: 'job-map',
        items: {
          first: {
            id: 'ep-10',
            title: '第10集',
            targetPath: '/视频/番剧/示例剧/第10集',
            linkUrl: 'https://pan.baidu.com/s/ep10',
            passCode: 'a10b',
          },
          second: {
            id: 'ep-11',
            title: '第11集',
            targetPath: '/视频/番剧/示例剧/第11集',
            linkUrl: 'https://pan.baidu.com/s/ep11',
            passCode: 'a11b',
          },
        },
      },
    }
    const snapshot = JSON.parse(
      JSON.stringify({
        records: [
          {
            ...createHistoryRecord(),
            pendingTransfer: pending,
          },
        ],
      }),
    ) as { records: ContentHistoryRecord[] }
    const { records } = prepareHistoryRecords(snapshot)
    const revived = records[0]?.pendingTransfer
    expect(revived?.payload.items).toHaveLength(2)
    expect(revived?.payload.items[0]).toMatchObject({ id: 'ep-10', title: '第10集' })
  })
})

describe('buildHistoryGroupSeasonRows', () => {
  it('includes main record rows when grouped record is a season page', () => {
    const seasonRecord = createHistoryRecord({
      pageUrl: 'https://example.com/seasons/101.html',
      pageTitle: 'S01',
      seasonEntries: [
        {
          seasonId: 's01',
          seasonIndex: 1,
          label: '第一季',
          url: 'https://example.com/seasons/101.html',
          completion: null,
          poster: null,
          loaded: true,
          hasItems: true,
        },
      ] satisfies SeasonEntry[],
    })
    const group: HistoryGroup = {
      key: 'season-group',
      title: '测试剧集',
      origin: 'https://example.com',
      poster: null,
      updatedAt: Date.now(),
      siteProviderId: null,
      siteProviderLabel: null,
      records: [seasonRecord],
      main: seasonRecord,
      children: [],
      urls: [seasonRecord.pageUrl],
      seasonEntries: seasonRecord.seasonEntries ?? [],
    }

    const rows = buildHistoryGroupSeasonRows(group)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.canCheck).toBe(true)
    expect(rows[0]?.record).toBe(seasonRecord)
  })
})

describe('getHistoryPendingTransfer', () => {
  it('returns null when record missing pending items', () => {
    const record = createHistoryRecord()
    expect(getHistoryPendingTransfer(record)).toBeNull()
  })

  it('returns pending payload when items are present', () => {
    const record = createHistoryRecord({
      pendingTransfer: {
        jobId: 'pending-history-e2e',
        detectedAt: Date.now(),
        summary: '检测到 1 个新资源',
        newItemIds: ['forum-resource-1'],
        payload: {
          jobId: 'pending-history-e2e',
          origin: 'https://forum.example',
          targetDirectory: '/论坛/讨论区',
          items: [
            {
              id: 'forum-resource-1',
              title: '论坛资源 1',
              linkUrl: 'https://pan.baidu.com/s/mock-gf-1',
              passCode: 'abcd',
            },
          ],
          meta: {
            total: 1,
            pageUrl: 'https://forum.example/thread/demo',
            siteProviderId: 'generic-forum',
            siteProviderLabel: 'Generic Forum',
          },
        },
      },
    })
    const pending = getHistoryPendingTransfer(record)
    expect(pending).not.toBeNull()
    expect(pending?.payload.items).toHaveLength(1)
    expect(pending?.payload.items[0]?.id).toBe('forum-resource-1')
  })
})
