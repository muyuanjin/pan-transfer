import type { InjectionKey } from 'vue'
import type { SiteProviderOption } from '@/content/controllers/provider-preferences'

export interface ProviderPanelContext {
  siteProviderOptions: ReadonlyArray<SiteProviderOption>
  switchSiteProvider: (providerId: string | null) => Promise<void>
}

export const providerPanelContextKey: InjectionKey<ProviderPanelContext> =
  Symbol('ProviderPanelContext')
