import { createProviderRegistry, type ProviderRegistry } from '@/platform/registry'
import { createChaospaceSiteProvider } from '@/providers/sites/chaospace'
import { createGenericForumSiteProvider } from '@/providers/sites/generic-forum'
import { createMockStorageProvider } from '@/providers/storage'
import { createBaiduNetdiskProvider } from '@/providers/storage/baidu-netdisk'
import {
  resolveEffectiveStorageMode,
  type ResolvedStorageProviderMode,
  type StorageProviderMode,
} from './storage-mode'

let registryCache: Partial<Record<ResolvedStorageProviderMode, ProviderRegistry>> = {}

export { type StorageProviderMode } from './storage-mode'

export function getBackgroundProviderRegistry(
  mode: StorageProviderMode = 'auto',
): ProviderRegistry {
  const storageMode = resolveEffectiveStorageMode(mode)
  const cached = registryCache[storageMode]
  if (cached) {
    return cached
  }
  const nextRegistry = createProviderRegistry({
    siteProviders: [createChaospaceSiteProvider(), createGenericForumSiteProvider()],
  })
  if (storageMode === 'mock') {
    nextRegistry.registerStorageProvider(createMockStorageProvider())
  } else {
    nextRegistry.registerStorageProvider(createBaiduNetdiskProvider())
  }
  registryCache[storageMode] = nextRegistry
  return nextRegistry
}

export function resetBackgroundProviderRegistryCache(): void {
  registryCache = {}
}
