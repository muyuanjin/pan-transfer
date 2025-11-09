import { describe, expect, it, vi } from 'vitest'
import { createChaospaceSiteProvider } from '../chaospace-site-provider'
import type { ChaospaceSiteProviderOptions } from '../chaospace-site-provider'
import type { SiteProvider } from '@/platform/registry'
import type { PageAnalysisResult } from '../page-analyzer'

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

describe('createChaospaceSiteProvider', () => {
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
})
