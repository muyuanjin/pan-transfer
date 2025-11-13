import { createProviderRegistry, type ProviderRegistry } from '@/platform/registry'
import { createChaospaceSiteProvider } from '@/providers/sites/chaospace'

let registry: ProviderRegistry | null = null

export function getContentProviderRegistry(): ProviderRegistry {
  if (!registry) {
    const siteProviders = [createChaospaceSiteProvider()]
    registry = createProviderRegistry({
      siteProviders,
    })
  }
  return registry
}
