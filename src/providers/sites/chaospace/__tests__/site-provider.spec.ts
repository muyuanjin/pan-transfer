import { describe, expect, it, vi, afterEach } from 'vitest'
import { createChaospaceSiteProvider } from '../chaospace-site-provider'
import type { ChaospaceSiteProviderOptions } from '../chaospace-site-provider'
import type { SiteProvider } from '@/platform/registry'
import type { PageAnalysisResult } from '../page-analyzer'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HistoryRecord } from '@/shared/types/transfer'

const createProvider = (overrides?: ChaospaceSiteProviderOptions): SiteProvider =>
  createChaospaceSiteProvider(overrides)

const createAnalysisResult = (): PageAnalysisResult => ({
  items: [
    {
      id: 'link-1',
      title: 'Episode 1',
      order: 1,
      linkUrl: 'https://pan.baidu.com/s/abc123',
      passCode: 'abcd',
      quality: '1080p',
      subtitle: '国配',
      seasonId: 's1',
      seasonLabel: '第一季',
      seasonIndex: 0,
      seasonUrl: 'https://www.chaospace.cc/seasons/1.html',
    },
  ],
  url: 'https://www.chaospace.cc/tvshows/123.html',
  origin: 'https://www.chaospace.cc',
  title: 'Sample Show',
  poster: null,
  completion: null,
  seasonCompletion: {},
  deferredSeasons: [],
  totalSeasons: 1,
  loadedSeasons: 1,
  seasonEntries: [],
  classification: 'tvshow',
  classificationDetail: null,
})

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const HISTORY_FIXTURE = readFileSync(path.join(FIXTURE_DIR, 'chaospace-history-page.html'), 'utf8')
const HISTORY_PAGE_URL = 'https://www.chaospace.cc/tvshows/555555.html'
const HISTORY_RECORD_STUB: HistoryRecord = {
  pageUrl: HISTORY_PAGE_URL,
  pageTitle: '示例剧集',
  pageType: 'series',
  origin: 'https://www.chaospace.cc',
  siteProviderId: 'chaospace',
  siteProviderLabel: 'CHAOSPACE',
  poster: null,
  targetDirectory: '/示例',
  baseDir: '/示例',
  useTitleSubdir: true,
  useSeasonSubdir: false,
  lastTransferredAt: 0,
  lastCheckedAt: 0,
  totalTransferred: 1,
  completion: null,
  seasonCompletion: {},
  seasonDirectory: {},
  seasonEntries: [],
  items: {
    '101': {
      id: '101',
      title: '第1集',
      status: 'success',
      message: '',
      linkUrl: 'https://pan.baidu.com/s/sample-link',
      passCode: '1a2b',
    },
  },
  itemOrder: ['101'],
  lastResult: null,
  pendingTransfer: null,
}

describe('createChaospaceSiteProvider', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch
    }
    vi.restoreAllMocks()
  })

  it('detects supported Chaospace urls', async () => {
    const provider = createProvider()
    await expect(provider.detect({ url: 'https://www.chaospace.cc/tvshows/1.html' })).resolves.toBe(
      true,
    )
    await expect(provider.detect({ url: 'https://example.com/movies/1.html' })).resolves.toBe(false)
  })

  it('collects resources using the analyzer', async () => {
    type AnalyzePageFn = NonNullable<ChaospaceSiteProviderOptions['analyzePage']>
    const analyzePage = vi.fn<AnalyzePageFn>(async () => createAnalysisResult())
    const provider = createProvider({ analyzePage })

    const result = await provider.collectResources({
      url: 'https://www.chaospace.cc/tvshows/1.html',
    })

    expect(analyzePage).toHaveBeenCalledTimes(1)
    expect(result.items).toHaveLength(1)
    const [first] = result.items
    expect(first).toBeDefined()
    if (!first) {
      throw new Error('Expected at least one resource item')
    }
    expect(first).toMatchObject({
      id: 'link-1',
      title: 'Episode 1',
      linkUrl: 'https://pan.baidu.com/s/abc123',
    })
    expect(first.tags).toEqual(expect.arrayContaining(['1080p', '国配', '第一季']))
    expect(result.meta).toMatchObject({
      pageTitle: 'Sample Show',
      classification: 'tvshow',
      totalSeasons: 1,
    })
  })

  it('hydrates share links when building transfer payloads', async () => {
    const provider = createProvider()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<button data-clipboard-text="https://pan.baidu.com/s/1abcDEF?pwd=2333">copy</button>',
    }) as typeof fetch

    if (!provider.buildTransferPayload) {
      throw new Error('Chaospace provider is missing buildTransferPayload')
    }
    const payload = await provider.buildTransferPayload({
      context: { url: 'https://www.chaospace.cc/tvshows/1.html' },
      selection: [
        {
          id: '101',
          title: '示例链接',
          linkUrl: 'https://www.chaospace.cc/links/101.html',
        },
      ],
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://www.chaospace.cc/links/101.html',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(payload.items[0]).toMatchObject({
      linkUrl: 'https://pan.baidu.com/s/1abcDEF?pwd=2333',
      passCode: '2333',
    })
  })

  it('keeps existing Baidu share links without rehydrating', async () => {
    const provider = createProvider()
    globalThis.fetch = vi.fn() as typeof fetch

    if (!provider.buildTransferPayload) {
      throw new Error('Chaospace provider is missing buildTransferPayload')
    }
    const payload = await provider.buildTransferPayload({
      context: { url: 'https://www.chaospace.cc/tvshows/1.html' },
      selection: [
        {
          id: '101',
          title: '示例链接',
          linkUrl: 'https://pan.baidu.com/s/existing-share?pwd=7788',
          passCode: '7788',
        },
      ],
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(payload.items[0]).toMatchObject({
      linkUrl: 'https://pan.baidu.com/s/existing-share?pwd=7788',
      passCode: '7788',
    })
  })

  it('falls back to the original link if hydration fails', async () => {
    const provider = createProvider()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    }) as typeof fetch

    if (!provider.buildTransferPayload) {
      throw new Error('Chaospace provider is missing buildTransferPayload')
    }
    const payload = await provider.buildTransferPayload({
      context: { url: 'https://www.chaospace.cc/tvshows/1.html' },
      selection: [
        {
          id: '101',
          title: '示例链接',
          linkUrl: 'https://www.chaospace.cc/links/101.html',
        },
      ],
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(payload.items[0]).toMatchObject({
      linkUrl: 'https://www.chaospace.cc/links/101.html',
    })
  })

  it('collects history snapshots from Chaospace detail pages', async () => {
    const provider = createProvider()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => HISTORY_FIXTURE,
    }) as typeof fetch

    if (!provider.collectHistorySnapshot) {
      throw new Error('Chaospace provider is missing collectHistorySnapshot')
    }
    const snapshot = await provider.collectHistorySnapshot({
      pageUrl: HISTORY_PAGE_URL,
      historyRecord: HISTORY_RECORD_STUB,
    })

    expect(snapshot.providerId).toBe('chaospace')
    expect(snapshot.providerLabel).toBe('CHAOSPACE')
    expect(snapshot.items).toHaveLength(2)
    expect(snapshot.items[0]).toMatchObject({
      id: '101',
      title: '示例链接 101',
      linkUrl: 'https://pan.baidu.com/s/sample-link',
      passCode: '1a2b',
    })
    expect(snapshot.seasonEntries[0]).toMatchObject({
      seasonId: '2001',
    })
    expect(snapshot.seasonEntries[0]?.label).toContain('第一季')
    expect(snapshot.completion?.label).toBe('连载中')
    expect(snapshot.seasonCompletion['2001']?.label).toBe('已完结')
    expect(snapshot.seasonCompletion['2002']?.label).toBe('连载中')
  })

  it('parses history detail payloads using provider hooks', async () => {
    const provider = createProvider()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => HISTORY_FIXTURE,
    }) as typeof fetch

    if (!provider.collectHistoryDetail) {
      throw new Error('Chaospace provider is missing collectHistoryDetail')
    }
    const detail = await provider.collectHistoryDetail({ pageUrl: HISTORY_PAGE_URL })

    expect(detail.title).toBe('示例剧集')
    expect(detail.poster?.src).toContain('sample-poster')
    expect(detail.info).toEqual(
      expect.arrayContaining([
        { label: '导演', value: '李导演' },
        { label: '主演', value: '张三、李四' },
      ]),
    )
    expect(detail.stills[0]).toMatchObject({
      thumb: 'https://www.chaospace.cc/images/still-thumb.jpg',
      full: 'https://www.chaospace.cc/images/still-full.jpg',
    })
    expect(detail.genres).toEqual(expect.arrayContaining(['科幻', '冒险']))
    expect(detail.completion?.label).toBe('已完结')
  })
})
