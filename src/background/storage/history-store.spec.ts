import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest'

vi.mock('./utils', () => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}))

import { storageGet, storageSet } from './utils'
import { HISTORY_VERSION, STORAGE_KEYS } from '../common/constants'
import {
  getHistoryIndexMap,
  recordTransferHistory,
  reloadHistoryFromStorage,
} from './history-store'
import type { TransferRequestPayload, TransferResponsePayload } from '@/shared/types/transfer'

describe('history-store recordTransferHistory', () => {
  const storageGetMock = storageGet as MockedFunction<typeof storageGet>
  const storageSetMock = storageSet as MockedFunction<typeof storageSet>

  beforeEach(async () => {
    vi.clearAllMocks()
    storageGetMock.mockResolvedValue({
      [STORAGE_KEYS.history]: { version: HISTORY_VERSION, records: [] },
    })
    await reloadHistoryFromStorage()
    storageSetMock.mockClear()
  })

  it('mutates the persisted record instead of a detached clone', async () => {
    const buildPayload = (id: string, title: string): TransferRequestPayload => ({
      items: [{ id, title }],
      meta: {
        pageUrl: 'https://www.chaospace.cc/tvshows/100.html',
        pageTitle: '示例剧集',
        total: 1,
      },
    })
    const basePayload = buildPayload('ep-1', '第1集')
    const firstResponse: TransferResponsePayload = {
      summary: '首次转存',
      results: [
        {
          id: 'ep-1',
          title: '第1集',
          status: 'success',
          message: 'ok',
        },
      ],
    }

    await recordTransferHistory(basePayload, firstResponse)

    const secondPayload = buildPayload('ep-2', '第2集')
    const secondResponse: TransferResponsePayload = {
      summary: '新增一集',
      results: [
        {
          id: 'ep-2',
          title: '第2集',
          status: 'success',
          message: 'ok',
        },
      ],
    }

    await recordTransferHistory(secondPayload, secondResponse)

    const latestSnapshot = storageSetMock.mock.calls.at(-1)?.[0]?.[STORAGE_KEYS.history] as {
      records: Array<{
        items: Record<string, unknown>
        itemOrder: string[]
      }>
    }

    expect(latestSnapshot?.records).toHaveLength(1)
    const [record] = latestSnapshot.records ?? []
    expect(record).toBeDefined()
    if (record) {
      expect(Object.keys(record.items)).toEqual(['ep-1', 'ep-2'])
      expect(record.itemOrder).toEqual(['ep-1', 'ep-2'])
    }
  })
})

describe('history-store index map', () => {
  const storageGetMock = storageGet as MockedFunction<typeof storageGet>

  it('indexes CHAOSPACE season entry urls for update checks', async () => {
    storageGetMock.mockResolvedValue({
      [STORAGE_KEYS.history]: {
        version: HISTORY_VERSION,
        records: [
          {
            pageUrl: 'https://www.chaospace.cc/tvshows/429494.html',
            pageTitle: '野生的大魔王出现了！',
            pageType: 'series',
            origin: 'https://www.chaospace.cc',
            siteProviderId: 'chaospace',
            siteProviderLabel: 'CHAOSPACE',
            poster: null,
            targetDirectory: '/视频/番剧/野生的大魔王出现了！',
            baseDir: '/视频/番剧',
            useTitleSubdir: true,
            useSeasonSubdir: false,
            lastTransferredAt: 0,
            lastCheckedAt: 0,
            totalTransferred: 6,
            completion: {
              label: '连载中',
              state: 'ongoing',
              source: 'transfer-meta',
              updatedAt: 1762282215628,
            },
            seasonCompletion: {},
            seasonDirectory: {},
            seasonEntries: [
              {
                seasonId: '429496',
                url: 'https://www.chaospace.cc/seasons/429496.html',
                label: '第1季',
                seasonIndex: 0,
                completion: null,
                loaded: true,
                hasItems: true,
                poster: null,
              },
            ],
            items: {},
            itemOrder: [],
            lastResult: null,
          },
        ],
      },
    })
    await reloadHistoryFromStorage()
    const index = getHistoryIndexMap()
    const baseKey = 'https://www.chaospace.cc/tvshows/429494.html'
    const seasonKey = 'https://www.chaospace.cc/seasons/429496.html'
    expect(index.get(baseKey)).toBeDefined()
    const seasonEntry = index.get(seasonKey)
    expect(seasonEntry).toBeDefined()
    expect(seasonEntry?.record.pageUrl).toBe(baseKey)
  })
})
