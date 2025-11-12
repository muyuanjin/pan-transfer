export type StorageProviderMode = 'baidu' | 'mock'

const GLOBAL_STORAGE_KEY = 'PAN_TRANSFER_STORAGE_PROVIDER'
const GLOBAL_GENERIC_FORUM_KEY = 'PAN_TRANSFER_ENABLE_GENERIC_FORUM'

type DevToggleHost = typeof globalThis & {
  [GLOBAL_STORAGE_KEY]?: string
  [GLOBAL_GENERIC_FORUM_KEY]?: unknown
}

const truthyFlags = new Set(['1', 'true', 'yes', 'on', 'enable'])
const falsyFlags = new Set(['0', 'false', 'no', 'off', 'disable'])

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

const parseBooleanFlag = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) {
      return null
    }
    if (truthyFlags.has(normalized)) {
      return true
    }
    if (falsyFlags.has(normalized)) {
      return false
    }
  }
  return null
}

const readGlobalGenericForumFlag = (): boolean | null => {
  try {
    const host = globalThis as DevToggleHost
    const raw = host[GLOBAL_GENERIC_FORUM_KEY]
    const parsed = parseBooleanFlag(raw)
    return parsed
  } catch {
    /* noop */
  }
  return null
}

const readEnvGenericForumFlag = (): boolean | null => {
  try {
    const metaEnv = (import.meta as ImportMeta)?.env
    const envValue =
      typeof metaEnv?.['VITE_ENABLE_GENERIC_FORUM'] === 'string'
        ? (metaEnv['VITE_ENABLE_GENERIC_FORUM'] as string)
        : null
    if (envValue) {
      const parsed = parseBooleanFlag(envValue)
      if (parsed !== null) {
        return parsed
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

export function isGenericForumEnabled(): boolean {
  const globalFlag = readGlobalGenericForumFlag()
  if (typeof globalFlag === 'boolean') {
    return globalFlag
  }
  const envFlag = readEnvGenericForumFlag()
  if (typeof envFlag === 'boolean') {
    return envFlag
  }
  return false
}
