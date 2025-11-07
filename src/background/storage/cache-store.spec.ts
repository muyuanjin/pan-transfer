import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest'

import { CACHE_VERSION, STORAGE_KEYS } from '../common/constants'

vi.mock('./utils', () => {
  return {
    storageGet: vi.fn(),
    storageSet: vi.fn(),
  }
})

import { storageGet } from './utils'
import {
  ensureCacheLoaded,
  hasCompletedShare,
  recordCompletedShare,
  reloadCacheFromStorage,
} from './cache-store'

describe('cache-store reloads', () => {
  const storageGetMock = storageGet as MockedFunction<typeof storageGet>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const withSnapshot = (snapshot: unknown) => {
    storageGetMock.mockResolvedValueOnce({
      [STORAGE_KEYS.cache]: snapshot,
    })
  }

  const buildSnapshot = (completedShares?: Record<string, number>) => ({
    version: CACHE_VERSION,
    directories: {},
    ensured: {},
    completedShares: completedShares || {},
  })

  it('hydrates completed share cache when reloading after import', async () => {
    withSnapshot(null)
    await ensureCacheLoaded()
    expect(hasCompletedShare('surl1')).toBe(false)

    withSnapshot(buildSnapshot({ surl1: Date.now() }))
    await reloadCacheFromStorage()

    expect(hasCompletedShare('surl1')).toBe(true)
  })

  it('overwrites in-memory cache with imported snapshot', async () => {
    withSnapshot(buildSnapshot())
    await reloadCacheFromStorage()

    recordCompletedShare('legacy-surl')
    expect(hasCompletedShare('legacy-surl')).toBe(true)

    withSnapshot(buildSnapshot())
    await reloadCacheFromStorage()

    expect(hasCompletedShare('legacy-surl')).toBe(false)
  })
})
