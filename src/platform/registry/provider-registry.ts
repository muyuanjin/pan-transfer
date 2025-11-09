import { chaosLogger } from '@/shared/log'
import type {
  ProviderRegistryEvent,
  ProviderRegistryEventMap,
  ProviderRegistrySnapshot,
  SiteProvider,
  StorageProvider,
} from './types'

export interface ProviderRegistryInitOptions {
  siteProviders?: ReadonlyArray<SiteProvider>
  storageProviders?: ReadonlyArray<StorageProvider>
}

export type ProviderRegistrySubscriber<T extends ProviderRegistryEvent> = (
  payload: ProviderRegistryEventMap[T],
) => void

export class ProviderRegistry {
  private readonly siteProviders = new Map<string, SiteProvider>()

  private readonly storageProviders = new Map<string, StorageProvider>()

  private siteProvidersDirty = true

  private storageProvidersDirty = true

  private cachedSiteProviders: SiteProvider[] | null = null

  private cachedStorageProviders: StorageProvider[] | null = null

  private readonly listeners = new Map<
    ProviderRegistryEvent,
    Set<ProviderRegistrySubscriber<ProviderRegistryEvent>>
  >()

  constructor(options: ProviderRegistryInitOptions = {}) {
    options.siteProviders?.forEach((provider) => this.registerSiteProvider(provider))
    options.storageProviders?.forEach((provider) => this.registerStorageProvider(provider))
  }

  registerSiteProvider(provider: SiteProvider): SiteProvider {
    const normalized = this.normalizeSiteProvider(provider)
    const existing = this.siteProviders.get(normalized.id)
    if (existing) {
      chaosLogger.debug('[Pan Transfer] Site provider override detected', {
        id: normalized.id,
        previousName: existing.metadata.displayName,
        nextName: normalized.metadata.displayName,
      })
    }
    this.siteProviders.set(normalized.id, normalized)
    this.siteProvidersDirty = true
    this.emit('siteProvidersChanged', this.listSiteProviders())
    return normalized
  }

  registerStorageProvider(provider: StorageProvider): StorageProvider {
    const normalized = this.normalizeStorageProvider(provider)
    const existing = this.storageProviders.get(normalized.id)
    if (existing) {
      chaosLogger.debug('[Pan Transfer] Storage provider override detected', {
        id: normalized.id,
        previousName: existing.metadata.displayName,
        nextName: normalized.metadata.displayName,
      })
    }
    this.storageProviders.set(normalized.id, normalized)
    this.storageProvidersDirty = true
    this.emit('storageProvidersChanged', this.listStorageProviders())
    return normalized
  }

  unregisterSiteProvider(id: string): boolean {
    const removed = this.siteProviders.delete(id)
    if (removed) {
      this.siteProvidersDirty = true
      this.emit('siteProvidersChanged', this.listSiteProviders())
    }
    return removed
  }

  unregisterStorageProvider(id: string): boolean {
    const removed = this.storageProviders.delete(id)
    if (removed) {
      this.storageProvidersDirty = true
      this.emit('storageProvidersChanged', this.listStorageProviders())
    }
    return removed
  }

  getSiteProvider(id: string): SiteProvider | null {
    return this.siteProviders.get(id) ?? null
  }

  getStorageProvider(id: string): StorageProvider | null {
    return this.storageProviders.get(id) ?? null
  }

  listSiteProviders(): ReadonlyArray<SiteProvider> {
    if (this.siteProvidersDirty || !this.cachedSiteProviders) {
      this.cachedSiteProviders = sortProviders(this.siteProviders.values())
      this.siteProvidersDirty = false
    }
    return [...this.cachedSiteProviders]
  }

  listStorageProviders(): ReadonlyArray<StorageProvider> {
    if (this.storageProvidersDirty || !this.cachedStorageProviders) {
      this.cachedStorageProviders = sortProviders(this.storageProviders.values())
      this.storageProvidersDirty = false
    }
    return [...this.cachedStorageProviders]
  }

  getSnapshot(): ProviderRegistrySnapshot {
    return {
      siteProviders: this.listSiteProviders(),
      storageProviders: this.listStorageProviders(),
    }
  }

  subscribe<T extends ProviderRegistryEvent>(
    event: T,
    listener: ProviderRegistrySubscriber<T>,
  ): () => void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener as ProviderRegistrySubscriber<ProviderRegistryEvent>)
    this.listeners.set(event, listeners)
    return () => {
      listeners.delete(listener as ProviderRegistrySubscriber<ProviderRegistryEvent>)
      if (!listeners.size) {
        this.listeners.delete(event)
      }
    }
  }

  private emit<T extends ProviderRegistryEvent>(
    event: T,
    payload: ProviderRegistryEventMap[T],
  ): void {
    const listeners = this.listeners.get(event)
    if (!listeners || !listeners.size) {
      return
    }
    listeners.forEach((listener) => {
      try {
        listener(payload)
      } catch (error) {
        const err = error as Error
        chaosLogger.warn('[Pan Transfer] Provider registry listener failed', {
          event,
          message: err?.message,
        })
      }
    })
  }

  private normalizeSiteProvider(provider: SiteProvider): SiteProvider {
    const id = this.requireProviderId(provider.id, 'site')
    if (provider.id === id && provider.metadata.id === id) {
      return provider
    }
    return {
      ...provider,
      id,
      metadata: {
        ...provider.metadata,
        id,
      },
    }
  }

  private normalizeStorageProvider(provider: StorageProvider): StorageProvider {
    const id = this.requireProviderId(provider.id, 'storage')
    if (provider.id === id && provider.metadata.id === id) {
      return provider
    }
    return {
      ...provider,
      id,
      metadata: {
        ...provider.metadata,
        id,
      },
    }
  }

  private requireProviderId(id: string, kind: 'site' | 'storage'): string {
    const normalized = typeof id === 'string' ? id.trim() : ''
    if (!normalized) {
      throw new Error(`[Pan Transfer] ${kind} provider id is required`)
    }
    return normalized
  }
}

const DEFAULT_PRIORITY = 0

type ProviderWithMetadata<T> = T & {
  metadata: {
    priority?: number
    displayName: string
  }
}

function sortProviders<T extends ProviderWithMetadata<SiteProvider | StorageProvider>>(
  providers: Iterable<T>,
): T[] {
  return Array.from(providers).sort((a, b) => {
    const priorityDiff =
      (b.metadata.priority ?? DEFAULT_PRIORITY) - (a.metadata.priority ?? DEFAULT_PRIORITY)
    if (priorityDiff !== 0) {
      return priorityDiff
    }
    return a.metadata.displayName.localeCompare(b.metadata.displayName)
  })
}

export function createProviderRegistry(options?: ProviderRegistryInitOptions): ProviderRegistry {
  return new ProviderRegistry(options)
}
