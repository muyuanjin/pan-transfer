import { chaosLogger } from '@/shared/log'

const STORAGE_INVALIDATION_WARNING = '[Pan Transfer]'
const STORAGE_UNAVAILABLE_WARNING = '[Pan Transfer]'

let storageInvalidationWarned = false
let storageUnavailableWarned = false

const getChromeStorage = (): chrome.storage.LocalStorageArea | null => {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return null
  }
  return chrome.storage.local
}

export function isExtensionContextInvalidated(error: unknown): boolean {
  if (!error) {
    return false
  }
  const message =
    typeof error === 'string'
      ? error
      : typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : ''
  if (!message) {
    return false
  }
  return message.toLowerCase().includes('context invalidated')
}

export function warnStorageInvalidation(
  operation = 'Storage operation',
  contextLabel?: string,
): void {
  if (storageInvalidationWarned) {
    return
  }
  const contextSuffix = contextLabel ? `（${contextLabel}）` : ''
  chaosLogger.warn(
    `${STORAGE_INVALIDATION_WARNING} ${operation} skipped${contextSuffix} · extension context invalidated. 请重新加载扩展或页面以继续。`,
  )
  storageInvalidationWarned = true
}

const warnStorageUnavailable = (operation = 'Storage operation', contextLabel?: string): void => {
  if (storageUnavailableWarned) {
    return
  }
  const contextSuffix = contextLabel ? `（${contextLabel}）` : ''
  chaosLogger.warn(
    `${STORAGE_UNAVAILABLE_WARNING} ${operation} skipped${contextSuffix} · chrome.storage.local unavailable.`,
  )
  storageUnavailableWarned = true
}

export function resetStorageInvalidationWarning(): void {
  storageInvalidationWarned = false
}

export async function safeStorageGet<T = Record<string, unknown>>(
  keys: string | string[] | Record<string, unknown>,
  contextLabel = 'storage',
): Promise<T & Record<string, unknown>> {
  const storage = getChromeStorage()
  if (!storage) {
    warnStorageUnavailable('Storage read', contextLabel)
    return {} as T & Record<string, unknown>
  }
  try {
    const result = await storage.get(keys)
    return result as T & Record<string, unknown>
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage read', contextLabel)
      return {} as T & Record<string, unknown>
    }
    chaosLogger.error('[Pan Transfer] Failed to read ' + contextLabel, error)
    return {} as T & Record<string, unknown>
  }
}

export async function safeStorageSet(
  entries: Record<string, unknown>,
  contextLabel = 'storage',
): Promise<void> {
  const storage = getChromeStorage()
  if (!storage) {
    warnStorageUnavailable('Storage write', contextLabel)
    return
  }
  try {
    await storage.set(entries)
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage write', contextLabel)
      return
    }
    chaosLogger.error('[Pan Transfer] Failed to persist ' + contextLabel, error)
  }
}

export async function safeStorageRemove(
  keys: string | string[],
  contextLabel = 'storage',
): Promise<void> {
  const storage = getChromeStorage()
  if (!storage) {
    warnStorageUnavailable('Storage delete', contextLabel)
    return
  }
  try {
    await storage.remove(keys)
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage delete', contextLabel)
      return
    }
    chaosLogger.error('[Pan Transfer] Failed to remove ' + contextLabel, error)
  }
}
