import { describe, expect, it } from 'vitest'

import { filterHistoryGroups } from './history-service'
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
  } = options
  const record = createHistoryRecord({
    pageUrl,
    pageTitle: pageTitle ?? title,
    pageType,
    targetDirectory,
    origin,
    completion,
    seasonEntries,
  })
  return {
    key,
    title,
    origin,
    poster: null,
    updatedAt: 1000,
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

  it('matches full Pinyin search input', () => {
    const groups: HistoryGroup[] = [
      createHistoryGroup({
        key: 'g1',
        title: '孤独摇滚',
        pageUrl: 'https://example.com/tvshows/1.html',
      }),
    ]

    const result = filterHistoryGroups(groups, 'all', { searchTerm: 'guduyaogun' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g1')
  })

  it('matches Pinyin initials search input', () => {
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

    const result = filterHistoryGroups(groups, 'all', { searchTerm: 'lldq' })

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('g2')
  })
})
