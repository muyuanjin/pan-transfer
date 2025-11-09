import { describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '../provider-registry'
import type { SiteProvider, StorageProvider } from '../types'

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

const createStorageProvider = (id: string, priority = 0): StorageProvider => ({
  kind: 'storage',
  id,
  metadata: {
    id,
    displayName: id,
    priority,
  },
  checkReadiness: vi.fn().mockResolvedValue({ ready: true }),
  dispatchTransfer: vi.fn().mockResolvedValue({ success: true }),
})

describe('ProviderRegistry', () => {
  it('registers providers and emits change events', () => {
    const registry = new ProviderRegistry()
    const siteListener = vi.fn()
    const storageListener = vi.fn()

    registry.subscribe('siteProvidersChanged', siteListener)
    registry.subscribe('storageProvidersChanged', storageListener)

    const site = createSiteProvider('chaospace')
    const storage = createStorageProvider('baidu')

    registry.registerSiteProvider(site)
    registry.registerStorageProvider(storage)

    expect(registry.listSiteProviders()).toHaveLength(1)
    expect(registry.listStorageProviders()).toHaveLength(1)
    expect(siteListener).toHaveBeenCalledTimes(1)
    expect(storageListener).toHaveBeenCalledTimes(1)

    registry.unregisterSiteProvider('chaospace')
    registry.unregisterStorageProvider('baidu')

    expect(siteListener).toHaveBeenCalledTimes(2)
    expect(storageListener).toHaveBeenCalledTimes(2)
  })

  it('sorts providers by priority and display name', async () => {
    const registry = new ProviderRegistry()
    registry.registerSiteProvider(createSiteProvider('gamma', 0))
    registry.registerSiteProvider(createSiteProvider('alpha', 1))
    registry.registerSiteProvider(createSiteProvider('beta', 1))

    const providers = registry.listSiteProviders()

    expect(providers.map((provider) => provider.id)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('returns defensive copies when listing providers', () => {
    const registry = new ProviderRegistry()
    registry.registerSiteProvider(createSiteProvider('alpha'))
    const first = registry.listSiteProviders()
    ;(first as SiteProvider[]).push(createSiteProvider('beta'))
    expect(first).toHaveLength(2)
    expect(registry.listSiteProviders()).toHaveLength(1)
  })
})
