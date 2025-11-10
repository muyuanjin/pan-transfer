import { chaosLogger } from '@/shared/log'

export interface ProviderPreferencesSnapshot {
  version: number
  disabledSiteProviderIds: string[]
  preferredSiteProviderId: string | null
}

export type ProviderPreferencesUpdate = Partial<Omit<ProviderPreferencesSnapshot, 'version'>>

export type ProviderPreferencesListener = (snapshot: ProviderPreferencesSnapshot) => void

export const PROVIDER_PREFERENCES_STORAGE_KEY = 'pan-transfer-provider-preferences'

export const PROVIDER_PREFERENCES_VERSION = 1

const defaultSnapshot: ProviderPreferencesSnapshot = {
  version: PROVIDER_PREFERENCES_VERSION,
  disabledSiteProviderIds: [],
  preferredSiteProviderId: null,
}

let cachedSnapshot: ProviderPreferencesSnapshot = cloneSnapshot(defaultSnapshot)
let hasLoadedSnapshot = false
let loadPromise: Promise<ProviderPreferencesSnapshot> | null = null
const listeners = new Set<ProviderPreferencesListener>()
let storageListenerAttached = false

const storageUnavailableWarning = '[Pan Transfer] Provider preferences storage unavailable'

function cloneSnapshot(snapshot: ProviderPreferencesSnapshot): ProviderPreferencesSnapshot {
  return {
    version: snapshot.version,
    disabledSiteProviderIds: [...snapshot.disabledSiteProviderIds],
    preferredSiteProviderId: snapshot.preferredSiteProviderId,
  }
}

function getStorageArea(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null
  }
  return chrome.storage.local
}

function ensureStorageListener(): void {
  if (storageListenerAttached) {
    return
  }
  if (!chrome?.storage?.onChanged) {
    return
  }
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'local') {
      return
    }
    const change = changes[PROVIDER_PREFERENCES_STORAGE_KEY]
    if (!change) {
      return
    }
    const nextSnapshot = normalizeProviderPreferences(change.newValue)
    cachedSnapshot = nextSnapshot
    notifyListeners(nextSnapshot)
  }
  chrome.storage.onChanged.addListener(handler)
  storageListenerAttached = true
}

function notifyListeners(snapshot: ProviderPreferencesSnapshot): void {
  if (!listeners.size) {
    return
  }
  listeners.forEach((listener) => {
    try {
      listener(cloneSnapshot(snapshot))
    } catch (error) {
      const err = error as Error
      chaosLogger.warn('[Pan Transfer] Provider preferences listener failed', {
        message: err?.message,
      })
    }
  })
}

async function readSnapshotFromStorage(): Promise<ProviderPreferencesSnapshot> {
  const storage = getStorageArea()
  if (!storage) {
    chaosLogger.warn(storageUnavailableWarning)
    return cloneSnapshot(defaultSnapshot)
  }
  return new Promise<ProviderPreferencesSnapshot>((resolve) => {
    storage.get(PROVIDER_PREFERENCES_STORAGE_KEY, (result: Record<string, unknown>) => {
      const error = chrome.runtime?.lastError
      if (error) {
        chaosLogger.warn('[Pan Transfer] Failed to read provider preferences', error)
        resolve(cloneSnapshot(defaultSnapshot))
        return
      }
      const payload = result?.[PROVIDER_PREFERENCES_STORAGE_KEY]
      resolve(normalizeProviderPreferences(payload))
    })
  })
}

async function writeSnapshotToStorage(snapshot: ProviderPreferencesSnapshot): Promise<void> {
  const storage = getStorageArea()
  if (!storage) {
    chaosLogger.warn(storageUnavailableWarning)
    return
  }
  await new Promise<void>((resolve) => {
    storage.set({ [PROVIDER_PREFERENCES_STORAGE_KEY]: snapshot }, () => {
      const error = chrome.runtime?.lastError
      if (error) {
        chaosLogger.warn('[Pan Transfer] Failed to persist provider preferences', error)
      }
      resolve()
    })
  })
}

async function ensureSnapshotLoaded(): Promise<ProviderPreferencesSnapshot> {
  if (hasLoadedSnapshot) {
    return cachedSnapshot
  }
  if (loadPromise) {
    return loadPromise
  }
  loadPromise = readSnapshotFromStorage()
    .then((snapshot) => {
      cachedSnapshot = snapshot
      hasLoadedSnapshot = true
      return snapshot
    })
    .finally(() => {
      loadPromise = null
    })
  return loadPromise
}

export function normalizeProviderPreferences(input: unknown): ProviderPreferencesSnapshot {
  if (!input || typeof input !== 'object') {
    return cloneSnapshot(defaultSnapshot)
  }
  const record = input as Record<string, unknown>
  const disabledRaw = Array.isArray(record['disabledSiteProviderIds'])
    ? (record['disabledSiteProviderIds'] as unknown[])
    : []
  const disabledSet = new Set<string>(
    disabledRaw
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => Boolean(value)),
  )

  const baseSnapshot: ProviderPreferencesSnapshot = {
    version: PROVIDER_PREFERENCES_VERSION,
    disabledSiteProviderIds: Array.from(disabledSet),
    preferredSiteProviderId: normalizeProviderId(record['preferredSiteProviderId']),
  }

  return baseSnapshot
}

function normalizeProviderId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export async function loadProviderPreferences(): Promise<ProviderPreferencesSnapshot> {
  const snapshot = await ensureSnapshotLoaded()
  return cloneSnapshot(snapshot)
}

export async function saveProviderPreferencesUpdate(
  update: ProviderPreferencesUpdate,
): Promise<ProviderPreferencesSnapshot> {
  const previous = await ensureSnapshotLoaded()
  const nextSnapshot = normalizeProviderPreferences({
    ...previous,
    ...update,
    version: PROVIDER_PREFERENCES_VERSION,
  })
  cachedSnapshot = nextSnapshot
  hasLoadedSnapshot = true
  await writeSnapshotToStorage(nextSnapshot)
  notifyListeners(nextSnapshot)
  return cloneSnapshot(nextSnapshot)
}

export function getCachedProviderPreferences(): ProviderPreferencesSnapshot {
  return cloneSnapshot(cachedSnapshot)
}

export function subscribeToProviderPreferences(listener: ProviderPreferencesListener): () => void {
  listeners.add(listener)
  ensureStorageListener()
  return () => {
    listeners.delete(listener)
  }
}

export function isSiteProviderEnabled(
  snapshot: ProviderPreferencesSnapshot,
  providerId: string,
): boolean {
  if (!providerId) {
    return false
  }
  const normalizedId = providerId.trim()
  if (!normalizedId) {
    return false
  }
  const disabledSet = new Set(snapshot.disabledSiteProviderIds)
  return !disabledSet.has(normalizedId)
}

export function withProviderPreferences<T>(
  snapshot: ProviderPreferencesSnapshot,
  callback: (params: {
    disabledSiteProviderIds: Set<string>
    preferredSiteProviderId: string | null
  }) => T,
): T {
  const disabled = new Set(snapshot.disabledSiteProviderIds)
  return callback({
    disabledSiteProviderIds: disabled,
    preferredSiteProviderId: snapshot.preferredSiteProviderId,
  })
}

export function resetProviderPreferencesCache(): void {
  cachedSnapshot = cloneSnapshot(defaultSnapshot)
  hasLoadedSnapshot = false
  loadPromise = null
}
