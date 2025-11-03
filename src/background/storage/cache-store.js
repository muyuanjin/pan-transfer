import {
  CACHE_VERSION,
  MAX_DIRECTORY_CACHE_ENTRIES,
  MAX_SHARE_CACHE_ENTRIES,
  STORAGE_KEYS
} from '../common/constants.js';
import { storageGet, storageSet } from './utils.js';

const ensuredDirectories = new Set(['/']);
const directoryFileCache = new Map();
const completedShareCache = new Map();
let persistentCacheState = null;
let cacheLoadPromise = null;

const nowTs = () => Date.now();

function createDefaultCacheState() {
  return {
    version: CACHE_VERSION,
    directories: {},
    ensured: { '/': nowTs() },
    completedShares: {}
  };
}

function pruneDirectoryCacheIfNeeded() {
  if (!persistentCacheState) {
    return;
  }
  const entries = Object.entries(persistentCacheState.directories || {});
  if (entries.length <= MAX_DIRECTORY_CACHE_ENTRIES) {
    return;
  }
  entries
    .sort((a, b) => {
      const tsA = a[1]?.updatedAt || 0;
      const tsB = b[1]?.updatedAt || 0;
      return tsA - tsB;
    })
    .slice(0, Math.max(0, entries.length - MAX_DIRECTORY_CACHE_ENTRIES))
    .forEach(([path]) => {
      delete persistentCacheState.directories[path];
      directoryFileCache.delete(path);
    });
}

function pruneCompletedShareCacheIfNeeded() {
  if (!persistentCacheState || !persistentCacheState.completedShares) {
    return;
  }
  const entries = Object.entries(persistentCacheState.completedShares);
  if (entries.length <= MAX_SHARE_CACHE_ENTRIES) {
    return;
  }
  entries
    .sort((a, b) => {
      const tsA = a[1] || 0;
      const tsB = b[1] || 0;
      return tsA - tsB;
    })
    .slice(0, Math.max(0, entries.length - MAX_SHARE_CACHE_ENTRIES))
    .forEach(([surl]) => {
      delete persistentCacheState.completedShares[surl];
      completedShareCache.delete(surl);
    });
}

export async function ensureCacheLoaded() {
  if (cacheLoadPromise) {
    await cacheLoadPromise;
    return;
  }
  cacheLoadPromise = (async () => {
    try {
      const stored = await storageGet([STORAGE_KEYS.cache]);
      const raw = stored[STORAGE_KEYS.cache];
      if (raw && raw.version === CACHE_VERSION && raw.directories && raw.ensured) {
        persistentCacheState = {
          version: CACHE_VERSION,
          directories: raw.directories || {},
          ensured: { ...raw.ensured },
          completedShares: raw.completedShares || {}
        };
      } else {
        persistentCacheState = createDefaultCacheState();
      }
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to load persistent cache', error);
      persistentCacheState = createDefaultCacheState();
    }

    ensuredDirectories.clear();
    ensuredDirectories.add('/');
    if (persistentCacheState && persistentCacheState.ensured) {
      Object.keys(persistentCacheState.ensured).forEach(path => {
        if (path) {
          ensuredDirectories.add(path);
        }
      });
    }

    directoryFileCache.clear();
    if (persistentCacheState && persistentCacheState.directories) {
      Object.entries(persistentCacheState.directories).forEach(([path, entry]) => {
        if (!path || !entry || !Array.isArray(entry.files)) {
          return;
        }
        directoryFileCache.set(path, new Set(entry.files));
      });
    }

    completedShareCache.clear();
    if (persistentCacheState && persistentCacheState.completedShares) {
      Object.entries(persistentCacheState.completedShares).forEach(([surl, ts]) => {
        if (surl) {
          completedShareCache.set(surl, ts || 0);
        }
      });
    }
  })();
  await cacheLoadPromise;
}

export async function persistCacheNow() {
  await ensureCacheLoaded();
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  try {
    await storageSet({
      [STORAGE_KEYS.cache]: {
        version: CACHE_VERSION,
        directories: persistentCacheState.directories,
        ensured: persistentCacheState.ensured,
        completedShares: persistentCacheState.completedShares || {}
      }
    });
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to persist directory cache', error);
  }
}

export function isDirectoryEnsured(path) {
  return ensuredDirectories.has(path);
}

export function markDirectoryEnsured(path) {
  if (!path) {
    return;
  }
  ensuredDirectories.add(path);
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  persistentCacheState.ensured[path] = nowTs();
}

export function getCachedDirectoryEntries(path) {
  return directoryFileCache.get(path) || null;
}

export function recordDirectoryCache(path, names) {
  if (!path) {
    return;
  }
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  const files = Array.from(names || []).filter(name => typeof name === 'string' && name);
  directoryFileCache.set(path, new Set(files));
  persistentCacheState.directories[path] = {
    files,
    updatedAt: nowTs()
  };
  pruneDirectoryCacheIfNeeded();
}

export function hasCompletedShare(surl) {
  if (!surl) {
    return false;
  }
  return completedShareCache.has(surl);
}

export function recordCompletedShare(surl) {
  if (!surl) {
    return;
  }
  const timestamp = nowTs();
  completedShareCache.set(surl, timestamp);
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  if (!persistentCacheState.completedShares) {
    persistentCacheState.completedShares = {};
  }
  persistentCacheState.completedShares[surl] = timestamp;
  pruneCompletedShareCacheIfNeeded();
}

export function clearDirectoryCacheEntry(path) {
  if (!path) {
    return;
  }
  directoryFileCache.delete(path);
  if (persistentCacheState?.directories) {
    delete persistentCacheState.directories[path];
  }
}
