import {
  CACHE_VERSION,
  MAX_DIRECTORY_CACHE_ENTRIES,
  MAX_SHARE_CACHE_ENTRIES,
  STORAGE_KEYS,
} from '../common/constants'
import { storageGet, storageSet } from './utils'
import { normalizePath } from '../utils/path'

interface DirectoryCacheEntry {
  files: string[]
  updatedAt: number
}

interface CacheState {
  version: number
  directories: Record<string, DirectoryCacheEntry>
  ensured: Record<string, number>
  completedShares: Record<string, number>
}

const ensuredDirectories = new Set<string>(['/'])
const directoryFileCache = new Map<string, Set<string>>()
const completedShareCache = new Map<string, number>()
let persistentCacheState: CacheState | null = null
let cacheLoadPromise: Promise<void> | null = null

const nowTs = (): number => Date.now()

function createDefaultCacheState(): CacheState {
  return {
    version: CACHE_VERSION,
    directories: {},
    ensured: { '/': nowTs() },
    completedShares: {},
  }
}

function pruneDirectoryCacheIfNeeded(): void {
  if (!persistentCacheState) {
    return
  }
  const entries = Object.entries(persistentCacheState.directories || {})
  if (entries.length <= MAX_DIRECTORY_CACHE_ENTRIES) {
    return
  }
  entries
    .sort((a, b) => {
      const tsA = a[1]?.updatedAt || 0
      const tsB = b[1]?.updatedAt || 0
      return tsA - tsB
    })
    .slice(0, Math.max(0, entries.length - MAX_DIRECTORY_CACHE_ENTRIES))
    .forEach(([path]) => {
      delete persistentCacheState!.directories[path]
      directoryFileCache.delete(path)
    })
}

function pruneCompletedShareCacheIfNeeded(): void {
  if (!persistentCacheState || !persistentCacheState.completedShares) {
    return
  }
  const entries = Object.entries(persistentCacheState.completedShares)
  if (entries.length <= MAX_SHARE_CACHE_ENTRIES) {
    return
  }
  entries
    .sort((a, b) => {
      const tsA = a[1] || 0
      const tsB = b[1] || 0
      return tsA - tsB
    })
    .slice(0, Math.max(0, entries.length - MAX_SHARE_CACHE_ENTRIES))
    .forEach(([surl]) => {
      delete persistentCacheState!.completedShares[surl]
      completedShareCache.delete(surl)
    })
}

export async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoadPromise) {
    await cacheLoadPromise
    return
  }
  cacheLoadPromise = (async () => {
    try {
      const stored = await storageGet<{ [STORAGE_KEYS.cache]: CacheState | undefined }>([
        STORAGE_KEYS.cache,
      ])
      const raw = stored[STORAGE_KEYS.cache]
      if (raw && raw.version === CACHE_VERSION && raw.directories && raw.ensured) {
        persistentCacheState = {
          version: CACHE_VERSION,
          directories: raw.directories || {},
          ensured: { ...raw.ensured },
          completedShares: raw.completedShares || {},
        }
      } else {
        persistentCacheState = createDefaultCacheState()
      }
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to load persistent cache', error)
      persistentCacheState = createDefaultCacheState()
    }

    ensuredDirectories.clear()
    ensuredDirectories.add('/')
    if (persistentCacheState && persistentCacheState.ensured) {
      Object.keys(persistentCacheState.ensured).forEach((path) => {
        if (path) {
          ensuredDirectories.add(path)
        }
      })
    }

    directoryFileCache.clear()
    if (persistentCacheState && persistentCacheState.directories) {
      Object.entries(persistentCacheState.directories).forEach(([path, entry]) => {
        if (!path || !entry || !Array.isArray(entry.files)) {
          return
        }
        directoryFileCache.set(path, new Set(entry.files))
      })
    }

    completedShareCache.clear()
    if (persistentCacheState && persistentCacheState.completedShares) {
      Object.entries(persistentCacheState.completedShares).forEach(([surl, ts]) => {
        if (surl) {
          completedShareCache.set(surl, ts || 0)
        }
      })
    }
  })()
  await cacheLoadPromise
}

export async function persistCacheNow(): Promise<void> {
  await ensureCacheLoaded()
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState()
  }
  try {
    await storageSet({
      [STORAGE_KEYS.cache]: {
        version: CACHE_VERSION,
        directories: persistentCacheState.directories,
        ensured: persistentCacheState.ensured,
        completedShares: persistentCacheState.completedShares || {},
      },
    })
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to persist directory cache', error)
  }
}

export function isDirectoryEnsured(path: string): boolean {
  return ensuredDirectories.has(path)
}

export function markDirectoryEnsured(path: string): void {
  if (!path) {
    return
  }
  ensuredDirectories.add(path)
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState()
  }
  persistentCacheState.ensured[path] = nowTs()
}

export function getCachedDirectoryEntries(path: string): Set<string> | null {
  return directoryFileCache.get(path) || null
}

export function recordDirectoryCache(
  path: string,
  names: Iterable<string> | null | undefined,
): void {
  if (!path) {
    return
  }
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState()
  }
  const files = Array.from(names || []).filter((name) => typeof name === 'string' && name)
  directoryFileCache.set(path, new Set(files))
  persistentCacheState.directories[path] = {
    files,
    updatedAt: nowTs(),
  }
  pruneDirectoryCacheIfNeeded()
}

export function hasCompletedShare(surl: string | null | undefined): boolean {
  if (!surl) {
    return false
  }
  return completedShareCache.has(surl)
}

export function recordCompletedShare(surl: string | null | undefined): void {
  if (!surl) {
    return
  }
  const timestamp = nowTs()
  completedShareCache.set(surl, timestamp)
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState()
  }
  if (!persistentCacheState.completedShares) {
    persistentCacheState.completedShares = {}
  }
  persistentCacheState.completedShares[surl] = timestamp
  pruneCompletedShareCacheIfNeeded()
}

export async function removeCompletedShares(
  surls: Iterable<string | null | undefined>,
): Promise<number> {
  await ensureCacheLoaded()
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState()
  }
  let removed = 0
  for (const surl of surls) {
    const normalized = typeof surl === 'string' ? surl.trim() : ''
    if (!normalized) {
      continue
    }
    const deletedFromMemory = completedShareCache.delete(normalized)
    const hasPersistent = Boolean(persistentCacheState.completedShares?.[normalized])
    if (hasPersistent) {
      delete persistentCacheState.completedShares[normalized]
    }
    if (deletedFromMemory || hasPersistent) {
      removed += 1
    }
  }
  if (removed) {
    await persistCacheNow()
  }
  return removed
}

export async function clearCompletedShareCache(): Promise<void> {
  await ensureCacheLoaded()
  completedShareCache.clear()
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState()
  }
  persistentCacheState.completedShares = {}
  await persistCacheNow()
}

function collectNormalizedPaths(paths: Iterable<string | null | undefined>): string[] {
  const unique = new Set<string>()
  for (const value of paths) {
    if (typeof value !== 'string') {
      continue
    }
    try {
      const normalized = normalizePath(value)
      if (normalized && normalized !== '/') {
        unique.add(normalized)
      }
    } catch (_error) {
      /* ignore invalid paths */
    }
  }
  return Array.from(unique)
}

function shouldDropCacheKey(key: string, targets: string[]): boolean {
  if (!key || key === '/') {
    return false
  }
  return targets.some((target) => {
    if (target === key) {
      return true
    }
    if (target.startsWith(`${key}/`)) {
      return true
    }
    if (key.startsWith(`${target}/`)) {
      return true
    }
    return false
  })
}

export async function invalidateDirectoryCaches(
  paths: Iterable<string | null | undefined>,
): Promise<number> {
  const targets = collectNormalizedPaths(paths)
  if (!targets.length) {
    return 0
  }
  await ensureCacheLoaded()
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState()
  }

  let removed = 0
  const dropKey = (key: string): boolean => shouldDropCacheKey(key, targets)

  for (const key of Array.from(ensuredDirectories)) {
    if (dropKey(key)) {
      ensuredDirectories.delete(key)
      if (persistentCacheState.ensured && persistentCacheState.ensured[key]) {
        delete persistentCacheState.ensured[key]
      }
      removed += 1
    }
  }

  Object.keys(persistentCacheState.ensured || {}).forEach((key) => {
    if (dropKey(key)) {
      delete persistentCacheState!.ensured[key]
    }
  })

  for (const key of Array.from(directoryFileCache.keys())) {
    if (dropKey(key)) {
      directoryFileCache.delete(key)
      if (persistentCacheState.directories && persistentCacheState.directories[key]) {
        delete persistentCacheState.directories[key]
      }
      removed += 1
    }
  }

  Object.keys(persistentCacheState.directories || {}).forEach((key) => {
    if (dropKey(key)) {
      delete persistentCacheState!.directories[key]
    }
  })

  if (removed) {
    await persistCacheNow()
  }
  return removed
}
