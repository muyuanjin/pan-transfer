import { createProviderRegistry, type ProviderRegistry } from '@/platform/registry'
import { createChaospaceSiteProvider } from '@/providers/sites/chaospace'
import { createGenericForumSiteProvider } from '@/providers/sites/generic-forum'
import { createMockStorageProvider } from '@/providers/storage'
import { createBaiduNetdiskProvider } from '@/providers/storage/baidu-netdisk'
import {
  resolveStorageProviderMode,
  type StorageProviderMode as ResolvedStorageProviderMode,
} from '@/shared/dev-toggles'

const registryCache: Partial<Record<ResolvedStorageProviderMode, ProviderRegistry>> = {}

export type StorageProviderMode = 'auto' | ResolvedStorageProviderMode

export function getBackgroundProviderRegistry(
  mode: StorageProviderMode = 'auto',
): ProviderRegistry {
  const storageMode = resolveStorageProviderMode(mode === 'auto' ? undefined : mode)
  const cached = registryCache[storageMode]
  if (cached) {
    return cached
  }
  const nextRegistry = createProviderRegistry({
    siteProviders: [createChaospaceSiteProvider(), createGenericForumSiteProvider()],
  })
  nextRegistry.registerStorageProvider(createBaiduNetdiskProvider())
  nextRegistry.registerStorageProvider(createMockStorageProvider())
  registryCache[storageMode] = nextRegistry
  return nextRegistry
}
