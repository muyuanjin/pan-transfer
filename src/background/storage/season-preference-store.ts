const SESSION_KEY_PREFIX = 'chaospace:season-pref:tab:'

function getSessionKey(tabId: number): string {
  return `${SESSION_KEY_PREFIX}${tabId}`
}

function hasSessionStorage(): boolean {
  return Boolean(chrome?.storage?.session)
}

export async function getTabSeasonPreference(tabId: number): Promise<boolean | null> {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return null
  }
  if (!hasSessionStorage()) {
    return null
  }
  const key = getSessionKey(tabId)
  try {
    const stored = await chrome.storage.session.get(key)
    const record = stored[key]
    if (
      record &&
      typeof record === 'object' &&
      typeof (record as { value?: unknown }).value === 'boolean'
    ) {
      return Boolean((record as { value: boolean }).value)
    }
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to read tab season preference', {
      tabId,
      error,
    })
  }
  return null
}

export async function setTabSeasonPreference(tabId: number, value: boolean): Promise<void> {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return
  }
  if (!hasSessionStorage()) {
    return
  }
  const key = getSessionKey(tabId)
  try {
    await chrome.storage.session.set({
      [key]: { value: Boolean(value), updatedAt: Date.now() },
    })
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to persist tab season preference', {
      tabId,
      error,
    })
  }
}

export async function clearTabSeasonPreference(tabId: number): Promise<void> {
  if (!Number.isInteger(tabId) || tabId < 0) {
    return
  }
  if (!hasSessionStorage()) {
    return
  }
  const key = getSessionKey(tabId)
  try {
    await chrome.storage.session.remove(key)
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to clear tab season preference', {
      tabId,
      error,
    })
  }
}
