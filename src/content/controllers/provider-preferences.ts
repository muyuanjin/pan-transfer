import type { ProviderRegistry } from '@/platform/registry/provider-registry'
import type { SiteProvider, StorageProvider } from '@/platform/registry/types'
import {
  loadProviderPreferences,
  saveProviderPreferencesUpdate,
  subscribeToProviderPreferences,
  type ProviderPreferencesSnapshot,
} from '@/platform/settings'
import type { ContentStore } from '../state'

export interface SiteProviderOption {
  id: string
  label: string
  description?: string
  tags: string[]
  supportedHosts: string[]
  priority?: number
}

export interface StorageProviderOption {
  id: string
  label: string
  description?: string
  tags: string[]
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
  getStorageProviderOptions: () => ReadonlyArray<StorageProviderOption>
  toggleSiteProvider: (providerId: string, enabled: boolean) => Promise<void>
  setPreferredSiteProvider: (providerId: string | null) => Promise<void>
  setPreferredStorageProvider: (providerId: string | null) => Promise<void>
}

export function createProviderPreferencesController({
  state,
  registry,
}: ProviderPreferencesControllerDeps): ProviderPreferencesController {
  const siteOptions = buildSiteProviderOptions(registry.listSiteProviders())
  const storageOptions = buildStorageProviderOptions(registry.listStorageProviders())
  let snapshot: ProviderPreferencesSnapshot = {
    version: 1,
    disabledSiteProviderIds: [],
    preferredSiteProviderId: null,
    preferredStorageProviderId: null,
  }

  const applySnapshot = (nextSnapshot: ProviderPreferencesSnapshot): void => {
    snapshot = nextSnapshot
    state.disabledSiteProviderIds = new Set(nextSnapshot.disabledSiteProviderIds)
    state.preferredSiteProviderId = nextSnapshot.preferredSiteProviderId
    state.preferredStorageProviderId = nextSnapshot.preferredStorageProviderId
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
  }

  const setPreferredSiteProvider = async (providerId: string | null): Promise<void> => {
    const normalized = normalizePreferenceId(providerId)
    const nextSnapshot = await saveProviderPreferencesUpdate({
      preferredSiteProviderId: normalized,
    })
    applySnapshot(nextSnapshot)
  }

  const setPreferredStorageProvider = async (providerId: string | null): Promise<void> => {
    const normalized = normalizePreferenceId(providerId)
    const nextSnapshot = await saveProviderPreferencesUpdate({
      preferredStorageProviderId: normalized,
    })
    applySnapshot(nextSnapshot)
  }

  return {
    loadPreferences,
    getSnapshot: () => snapshot,
    getSiteProviderOptions: () => siteOptions,
    getStorageProviderOptions: () => storageOptions,
    toggleSiteProvider,
    setPreferredSiteProvider,
    setPreferredStorageProvider,
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

function buildStorageProviderOptions(
  providers: ReadonlyArray<StorageProvider>,
): StorageProviderOption[] {
  return providers.map((provider) => {
    const option: StorageProviderOption = {
      id: provider.id,
      label: provider.metadata.displayName,
      tags: (provider.metadata.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
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
