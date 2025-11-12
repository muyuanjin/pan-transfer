import {
  loadProviderPreferences,
  saveProviderPreferencesUpdate,
  subscribeToProviderPreferences,
  type ProviderPreferencesSnapshot,
} from '@/platform/settings'
import { getBackgroundProviderRegistry } from '@/background/providers/registry'

const SITE_PROVIDER_IDS = new Set(
  getBackgroundProviderRegistry()
    .listSiteProviders()
    .map((provider) => provider.id),
)

let cachedSnapshot: ProviderPreferencesSnapshot | null = null
let loadPromise: Promise<ProviderPreferencesSnapshot> | null = null

export function initProviderPreferences(): Promise<ProviderPreferencesSnapshot> {
  if (!loadPromise) {
    loadPromise = loadProviderPreferences()
      .then((snapshot) => {
        cachedSnapshot = snapshot
        subscribeToProviderPreferences((nextSnapshot) => {
          cachedSnapshot = nextSnapshot
          updateActionBadge(nextSnapshot)
        })
        updateActionBadge(snapshot)
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

export function areAllSiteProvidersDisabled(snapshot: ProviderPreferencesSnapshot | null): boolean {
  if (!snapshot) {
    return false
  }
  if (!SITE_PROVIDER_IDS.size) {
    return false
  }
  const disabled = snapshot.disabledSiteProviderIds.filter((id) => SITE_PROVIDER_IDS.has(id))
  return disabled.length >= SITE_PROVIDER_IDS.size
}

export async function restoreAllSiteProviders(): Promise<ProviderPreferencesSnapshot> {
  const nextSnapshot = await saveProviderPreferencesUpdate({
    disabledSiteProviderIds: [],
  })
  cachedSnapshot = nextSnapshot
  updateActionBadge(nextSnapshot)
  return nextSnapshot
}

function updateActionBadge(snapshot: ProviderPreferencesSnapshot | null): void {
  if (!chrome?.action?.setBadgeText) {
    return
  }
  if (areAllSiteProvidersDisabled(snapshot)) {
    chrome.action.setBadgeText({ text: '停用' })
    chrome.action.setBadgeBackgroundColor?.({ color: '#c62828' })
    chrome.action.setTitle?.({
      title: 'Pan Transfer 已停用 · 点击图标恢复默认站点解析器',
    })
  } else {
    chrome.action.setBadgeText({ text: '' })
    chrome.action.setTitle?.({ title: 'Pan Transfer' })
  }
}
