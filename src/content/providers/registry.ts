import { createProviderRegistry, type ProviderRegistry } from '@/platform/registry'
import { createChaospaceSiteProvider } from '@/providers/sites/chaospace'
import { createGenericForumSiteProvider } from '@/providers/sites/generic-forum'
import { isGenericForumEnabled } from '@/shared/dev-toggles'

let registry: ProviderRegistry | null = null

export function getContentProviderRegistry(): ProviderRegistry {
  if (!registry) {
    const siteProviders = [createChaospaceSiteProvider()]
    if (isGenericForumEnabled()) {
      siteProviders.push(createGenericForumSiteProvider())
    }
    registry = createProviderRegistry({
      siteProviders,
    })
  }
  return registry
}
