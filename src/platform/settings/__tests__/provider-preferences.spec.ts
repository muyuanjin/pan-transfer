import { describe, expect, it } from 'vitest'
import { normalizeProviderPreferences } from '../provider-preferences'

describe('provider-preferences normalization', () => {
  it('returns defaults for invalid input', () => {
    const snapshot = normalizeProviderPreferences(null)
    expect(snapshot.disabledSiteProviderIds).toEqual([])
    expect(snapshot.preferredSiteProviderId).toBeNull()
    expect(snapshot.preferredStorageProviderId).toBeNull()
  })

  it('deduplicates and trims disabled provider ids', () => {
    const snapshot = normalizeProviderPreferences({
      disabledSiteProviderIds: [' foo ', 'bar', 'FOO', '', null],
    })
    expect(snapshot.disabledSiteProviderIds).toEqual(['foo', 'bar', 'FOO'])
  })

  it('normalizes preferred provider ids', () => {
    const snapshot = normalizeProviderPreferences({
      preferredSiteProviderId: ' chaospace ',
      preferredStorageProviderId: ' baidu-netdisk ',
    })
    expect(snapshot.preferredSiteProviderId).toBe('chaospace')
    expect(snapshot.preferredStorageProviderId).toBe('baidu-netdisk')
  })
})
