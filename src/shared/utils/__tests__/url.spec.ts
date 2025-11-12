import { describe, expect, it } from 'vitest'
import { canonicalizePageUrl, getDefaultChaospaceBaseUrl } from '../url'

describe('canonicalizePageUrl', () => {
  it('strips querystring and hash by default', () => {
    const input = 'https://www.chaospace.cc/tvshows/1.html?pwd=abcd#episodes'
    expect(canonicalizePageUrl(input)).toBe('https://www.chaospace.cc/tvshows/1.html')
  })

  it('preserves search when stripSearch is false', () => {
    const input = 'https://www.chaospace.cc/movies/detail?id=42&ref=panel'
    expect(canonicalizePageUrl(input, { stripSearch: false })).toBe(input)
  })

  it('returns null when value is empty and fallback disabled', () => {
    expect(canonicalizePageUrl('', { allowFallback: false })).toBeNull()
  })

  it('falls back to default origin when allowed', () => {
    expect(canonicalizePageUrl('', { allowFallback: true })).toBe(getDefaultChaospaceBaseUrl())
  })

  it('resolves relative URLs against provided base', () => {
    const result = canonicalizePageUrl('/tvshows/9.html?pwd=1234', {
      baseUrl: 'https://example.com/series/list',
    })
    expect(result).toBe('https://example.com/tvshows/9.html')
  })

  it('accepts non-Chaospace origins when resolving relative paths', () => {
    const input = '../season/extra.html#anchor'
    const result = canonicalizePageUrl(input, {
      baseUrl: 'https://forum.example/thread/98',
    })
    expect(result).toBe('https://forum.example/season/extra.html')
  })
})
