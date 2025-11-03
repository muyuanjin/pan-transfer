const STORAGE_INVALIDATION_WARNING = '[Chaospace Transfer]';

let storageInvalidationWarned = false;

export function isExtensionContextInvalidated(error) {
  if (!error) {
    return false;
  }
  const message = typeof error === 'string' ? error : error.message;
  if (!message) {
    return false;
  }
  return message.toLowerCase().includes('context invalidated');
}

export function warnStorageInvalidation(operation = 'Storage operation') {
  if (storageInvalidationWarned) {
    return;
  }
  console.warn(`${STORAGE_INVALIDATION_WARNING} ${operation} skipped · extension context invalidated. 请重新加载扩展或页面以继续。`);
  storageInvalidationWarned = true;
}

export function resetStorageInvalidationWarning() {
  storageInvalidationWarned = false;
}

export async function safeStorageGet(keys, contextLabel = 'storage') {
  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage read');
      return {};
    }
    console.error('[Chaospace Transfer] Failed to read ' + contextLabel, error);
    return {};
  }
}

export async function safeStorageSet(entries, contextLabel = 'storage') {
  try {
    await chrome.storage.local.set(entries);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage write');
      return;
    }
    console.error('[Chaospace Transfer] Failed to persist ' + contextLabel, error);
  }
}

export async function safeStorageRemove(keys, contextLabel = 'storage') {
  try {
    await chrome.storage.local.remove(keys);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      warnStorageInvalidation('Storage delete');
      return;
    }
    console.error('[Chaospace Transfer] Failed to remove ' + contextLabel, error);
  }
}
