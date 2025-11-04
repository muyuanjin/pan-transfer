export function storageGet<T extends Record<string, unknown> = Record<string, unknown>>(
  keys?: string | string[] | Record<string, unknown> | null,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys ?? null, (result) => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve((result as T) || ({} as T))
    })
  })
}

export function storageSet(entries: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(entries, () => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve()
    })
  })
}
