import { createProviderRegistry, type ProviderRegistry } from '@/platform/registry'
import { createChaospaceSiteProvider } from '@/providers/sites/chaospace'
import { createGenericForumSiteProvider } from '@/providers/sites/generic-forum'

let registry: ProviderRegistry | null = null

export function getContentProviderRegistry(): ProviderRegistry {
  if (!registry) {
    registry = createProviderRegistry({
      siteProviders: [createChaospaceSiteProvider(), createGenericForumSiteProvider()],
    })
  }
  return registry
}
