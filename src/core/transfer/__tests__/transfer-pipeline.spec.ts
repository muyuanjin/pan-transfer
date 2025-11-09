import { describe, expect, it, vi } from 'vitest'
import { TransferPipeline } from '../transfer-pipeline'
import { ProviderRegistry } from '@/platform/registry/provider-registry'
import type { SiteProvider, StorageProvider } from '@/platform/registry/types'
import { createChaospaceSiteProvider } from '@/providers/sites/chaospace/chaospace-site-provider'
import { createMockStorageProvider } from '@/providers/storage/mock-storage-provider'
import type { PageAnalysisResult } from '@/providers/sites/chaospace/page-analyzer'

const createSiteProvider = (id: string, priority = 0): SiteProvider => ({
  kind: 'site',
  id,
  metadata: {
    id,
    displayName: id,
    priority,
  },
  detect: vi.fn().mockResolvedValue(false),
  collectResources: vi.fn().mockResolvedValue({ items: [] }),
})

const createStorageProvider = (id: string): StorageProvider => ({
  kind: 'storage',
  id,
  metadata: {
    id,
    displayName: id,
  },
  checkReadiness: vi.fn().mockResolvedValue({ ready: true }),
  dispatchTransfer: vi.fn().mockResolvedValue({ success: true }),
})

describe('TransferPipeline', () => {
  it('detects the first matching site provider', async () => {
    const primary = createSiteProvider('primary', 1)
    const fallback = createSiteProvider('fallback', 0)
    ;(primary.detect as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    ;(fallback.detect as ReturnType<typeof vi.fn>).mockResolvedValue(true)

    const registry = new ProviderRegistry({
      siteProviders: [fallback, primary],
      storageProviders: [createStorageProvider('baidu')],
    })

    const pipeline = new TransferPipeline({ registry })

    const handle = pipeline.enqueue({ context: { url: 'https://chaospace.cc/title/1' } })
    const result = await handle.result

    expect(result).toEqual({
      status: 'noop',
      siteProviderId: 'fallback',
      storageProviderId: 'baidu',
      context: { url: 'https://chaospace.cc/title/1' },
    })
    expect(primary.detect).toHaveBeenCalledTimes(1)
    expect(fallback.detect).toHaveBeenCalledTimes(1)
  })

  it('respects explicit provider overrides', async () => {
    const preferred = createSiteProvider('preferred')
    const registry = new ProviderRegistry({
      siteProviders: [preferred],
    })

    const pipeline = new TransferPipeline({ registry })

    const handle = pipeline.enqueue({
      siteProviderId: 'preferred',
      context: { url: 'https://example.com' },
    })
    const result = await handle.result

    expect(result).toMatchObject({
      status: 'noop',
      siteProviderId: 'preferred',
    })
    expect(preferred.detect).not.toHaveBeenCalled()
  })

  it('integrates with the Chaospace provider and mock storage', async () => {
    const analysis: PageAnalysisResult = {
      items: [],
      url: 'https://www.chaospace.cc/tvshows/999.html',
      origin: 'https://www.chaospace.cc',
      title: 'Mock Show',
      poster: null,
      completion: null,
      seasonCompletion: {},
      deferredSeasons: [],
      totalSeasons: 0,
      loadedSeasons: 0,
      seasonEntries: [],
      classification: 'tvshow',
      classificationDetail: null,
    }
    const chaospaceProvider = createChaospaceSiteProvider({
      analyzePage: vi.fn().mockResolvedValue(analysis),
    })
    const mockStorage = createMockStorageProvider()
    const registry = new ProviderRegistry({
      siteProviders: [chaospaceProvider],
      storageProviders: [mockStorage],
    })
    const pipeline = new TransferPipeline({ registry })

    const result = await pipeline.enqueue({ context: { url: analysis.url } }).result

    expect(result).toEqual({
      status: 'noop',
      siteProviderId: chaospaceProvider.id,
      storageProviderId: mockStorage.id,
      context: { url: analysis.url },
    })
  })
})
