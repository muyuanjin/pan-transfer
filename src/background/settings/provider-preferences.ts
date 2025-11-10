import {
  loadProviderPreferences,
  subscribeToProviderPreferences,
  type ProviderPreferencesSnapshot,
} from '@/platform/settings'

let cachedSnapshot: ProviderPreferencesSnapshot | null = null
let loadPromise: Promise<ProviderPreferencesSnapshot> | null = null

export function initProviderPreferences(): Promise<ProviderPreferencesSnapshot> {
  if (!loadPromise) {
    loadPromise = loadProviderPreferences()
      .then((snapshot) => {
        cachedSnapshot = snapshot
        subscribeToProviderPreferences((nextSnapshot) => {
          cachedSnapshot = nextSnapshot
        })
        return snapshot
      })
      .finally(() => {
        loadPromise = null
      })
  }
  return loadPromise
}

export function getProviderPreferencesSnapshot(): ProviderPreferencesSnapshot | null {
  return cachedSnapshot
}
