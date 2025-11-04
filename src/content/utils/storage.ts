const STORAGE_INVALIDATION_WARNING = '[Chaospace Transfer]'

let storageInvalidationWarned = false

export function isExtensionContextInvalidated(error: unknown): boolean {
  if (!error) {
    return false
  }
  const message = typeof error === 'string' ? error : (error as { message?: unknown })?.message
  if (!message) {
    return false
  }
  return String(message).toLowerCase().includes('context invalidated')
}

export function warnStorageInvalidation(operation = 'Storage operation'): void {
  if (storageInvalidationWarned) {
    return
  }
  console.warn(
    `${STORAGE_INVALIDATION_WARNING} ${operation} skipped · extension context invalidated. 请重新加载扩展或页面以继续。`,
  )
  storageInvalidationWarned = true
}

export function resetStorageInvalidationWarning(): void {
  storageInvalidationWarned = false
}

export async function safeStorageGet<T = Record<string, unknown>>(
  keys: string | string[] | Record<string, unknown>,
  contextLabel = 'storage',
): Promise<T & Record<string, unknown>> {
  try {
    const result = await chrome.storage.local.get(keys)
    return result as T & Record<string, unknown>
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage read')
      return {} as T & Record<string, unknown>
    }
    console.error('[Chaospace Transfer] Failed to read ' + contextLabel, error)
    return {} as T & Record<string, unknown>
  }
}

export async function safeStorageSet(
  entries: Record<string, unknown>,
  contextLabel = 'storage',
): Promise<void> {
  try {
    await chrome.storage.local.set(entries)
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage write')
      return
    }
    console.error('[Chaospace Transfer] Failed to persist ' + contextLabel, error)
  }
}

export async function safeStorageRemove(
  keys: string | string[],
  contextLabel = 'storage',
): Promise<void> {
  try {
    await chrome.storage.local.remove(keys)
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage delete')
      return
    }
    console.error('[Chaospace Transfer] Failed to remove ' + contextLabel, error)
  }
}
