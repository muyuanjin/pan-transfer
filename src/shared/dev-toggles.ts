export type StorageProviderMode = 'baidu' | 'mock'

const GLOBAL_STORAGE_KEY = 'PAN_TRANSFER_STORAGE_PROVIDER'
type DevToggleHost = typeof globalThis & {
  [GLOBAL_STORAGE_KEY]?: string
}

const isStorageMode = (value: unknown): value is StorageProviderMode =>
  value === 'baidu' || value === 'mock'

const readGlobalStorageMode = (): StorageProviderMode | null => {
  try {
    const host = globalThis as DevToggleHost
    const raw = host[GLOBAL_STORAGE_KEY]
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase()
      if (isStorageMode(normalized)) {
        return normalized
      }
    }
  } catch {
    /* noop */
  }
  return null
}

const readEnvStorageMode = (): StorageProviderMode | null => {
  try {
    const metaEnv = (import.meta as ImportMeta)?.env
    const envValue =
      typeof metaEnv?.['VITE_PAN_STORAGE_PROVIDER'] === 'string'
        ? (metaEnv['VITE_PAN_STORAGE_PROVIDER'] as string)
        : null
    if (envValue) {
      const normalized = envValue.trim().toLowerCase()
      if (isStorageMode(normalized)) {
        return normalized
      }
    }
  } catch {
    /* noop */
  }
  return null
}

export function resolveStorageProviderMode(
  override?: StorageProviderMode | undefined,
): StorageProviderMode {
  if (override && isStorageMode(override)) {
    return override
  }
  return readGlobalStorageMode() ?? readEnvStorageMode() ?? 'baidu'
}
