import type { ProviderRegistry } from '@/platform/registry/provider-registry'
import type { SiteProvider } from '@/platform/registry/types'
import {
  loadProviderPreferences,
  saveProviderPreferencesUpdate,
  subscribeToProviderPreferences,
  type ProviderPreferencesSnapshot,
} from '@/platform/settings'
import { createScopedLogger } from '@/shared/log'
import type { ContentStore } from '../state'

export interface SiteProviderOption {
  id: string
  label: string
  description?: string
  tags: string[]
  supportedHosts: string[]
  priority?: number
}

interface ProviderPreferencesControllerDeps {
  state: ContentStore
  registry: ProviderRegistry
}

export interface ProviderPreferencesController {
  loadPreferences: () => Promise<void>
  getSnapshot: () => ProviderPreferencesSnapshot
  getSiteProviderOptions: () => ReadonlyArray<SiteProviderOption>
  toggleSiteProvider: (providerId: string, enabled: boolean) => Promise<void>
  setPreferredSiteProvider: (providerId: string | null) => Promise<void>
}

export function createProviderPreferencesController({
  state,
  registry,
}: ProviderPreferencesControllerDeps): ProviderPreferencesController {
  const siteOptions = buildSiteProviderOptions(registry.listSiteProviders())
  const siteOptionMap = new Map(siteOptions.map((option) => [option.id, option]))
  const logger = createScopedLogger('ProviderPreferences')
  let snapshot: ProviderPreferencesSnapshot = {
    version: 1,
    disabledSiteProviderIds: [],
    preferredSiteProviderId: null,
  }

  const applySnapshot = (nextSnapshot: ProviderPreferencesSnapshot): void => {
    snapshot = nextSnapshot
    state.disabledSiteProviderIds = new Set(nextSnapshot.disabledSiteProviderIds)
    state.preferredSiteProviderId = nextSnapshot.preferredSiteProviderId
    if (
      state.manualSiteProviderId &&
      state.disabledSiteProviderIds.has(state.manualSiteProviderId)
    ) {
      state.manualSiteProviderId = null
    }
  }

  const loadPreferences = async (): Promise<void> => {
    const loaded = await loadProviderPreferences()
    applySnapshot(loaded)
  }

  subscribeToProviderPreferences((nextSnapshot) => {
    applySnapshot(nextSnapshot)
  })

  const toggleSiteProvider = async (providerId: string, enabled: boolean): Promise<void> => {
    if (!providerId) {
      return
    }
    const disabledSet = new Set(snapshot.disabledSiteProviderIds)
    if (enabled) {
      disabledSet.delete(providerId)
    } else {
      disabledSet.add(providerId)
    }
    const nextSnapshot = await saveProviderPreferencesUpdate({
      disabledSiteProviderIds: Array.from(disabledSet),
    })
    applySnapshot(nextSnapshot)
    logProviderToggle(providerId, enabled, nextSnapshot)
  }

  const setPreferredSiteProvider = async (providerId: string | null): Promise<void> => {
    const normalized = normalizePreferenceId(providerId)
    const nextSnapshot = await saveProviderPreferencesUpdate({
      preferredSiteProviderId: normalized,
    })
    applySnapshot(nextSnapshot)
    logPreferredProvider(normalized)
  }

  return {
    loadPreferences,
    getSnapshot: () => snapshot,
    getSiteProviderOptions: () => siteOptions,
    toggleSiteProvider,
    setPreferredSiteProvider,
  }

  function logProviderToggle(
    providerId: string,
    enabled: boolean,
    nextSnapshot: ProviderPreferencesSnapshot,
  ): void {
    const option = siteOptionMap.get(providerId) ?? null
    logger.info('provider-preference-toggle', {
      event: 'provider-preference-toggle',
      providerId,
      providerLabel: option?.label ?? providerId,
      enabled,
      disabledSiteProviderIds: [...nextSnapshot.disabledSiteProviderIds],
      supportedHosts: option?.supportedHosts ?? [],
      tags: option?.tags ?? [],
    })
  }

  function logPreferredProvider(providerId: string | null): void {
    const option = providerId ? (siteOptionMap.get(providerId) ?? null) : null
    logger.info('provider-preference-default', {
      event: 'provider-preference-default',
      providerId,
      providerLabel: option?.label ?? providerId,
    })
  }
}

function normalizePreferenceId(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function buildSiteProviderOptions(providers: ReadonlyArray<SiteProvider>): SiteProviderOption[] {
  return providers.map((provider) => {
    const option: SiteProviderOption = {
      id: provider.id,
      label: provider.metadata.displayName,
      tags: (provider.metadata.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      supportedHosts: (provider.metadata.supportedHosts ?? []).map((host) => host.trim()),
    }
    if (typeof provider.metadata.description === 'string' && provider.metadata.description) {
      option.description = provider.metadata.description
    }
    if (typeof provider.metadata.priority === 'number') {
      option.priority = provider.metadata.priority
    }
    return option
  })
}
