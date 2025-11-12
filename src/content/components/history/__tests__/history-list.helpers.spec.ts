import { describe, expect, it } from 'vitest'
import { resolveHistoryCheckTargets } from '@/content/history/history-check.helpers'
import type { HistoryCheckSeasonInput } from '@/content/history/history-check.helpers'
import { chaosLogger } from '@/shared/log'

const buildSeason = (overrides: {
  url?: string
  seasonIndex?: number
  recordTimestamp?: number
  disabled?: boolean
  hasItems?: boolean
  loaded?: boolean
}) => {
  const season: HistoryCheckSeasonInput = {
    url: overrides.url ?? '',
    seasonIndex: overrides.seasonIndex ?? 0,
    recordTimestamp: overrides.recordTimestamp ?? 0,
    disabled: overrides.disabled ?? false,
  }
  if (overrides.hasItems !== undefined) {
    Object.assign(season, { hasItems: overrides.hasItems })
  }
  if (overrides.loaded !== undefined) {
    Object.assign(season, { loaded: overrides.loaded })
  }
  return season
}

describe('resolveHistoryCheckTarget', () => {
  it('returns the primary url when the entry is not a tvshow page', () => {
    const target = resolveHistoryCheckTargets({
      pageUrl: 'https://www.chaospace.cc/movies/123.html',
      seasons: [buildSeason({ url: 'https://www.chaospace.cc/seasons/1.html' })],
    })
    expect(target).toEqual(['https://www.chaospace.cc/movies/123.html'])
  })

  it('orders season targets by season index and recency for tvshow pages', () => {
    const target = resolveHistoryCheckTargets({
      pageUrl: 'https://www.chaospace.cc/tvshows/999.html',
      seasons: [
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/1.html',
          seasonIndex: 1,
          recordTimestamp: 1000,
        }),
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/2.html',
          seasonIndex: 2,
          recordTimestamp: 500,
        }),
      ],
    })
    expect(target).toEqual([
      'https://www.chaospace.cc/seasons/2.html',
      'https://www.chaospace.cc/seasons/1.html',
      'https://www.chaospace.cc/tvshows/999.html',
    ])
  })

  it('ignores disabled or missing season urls', () => {
    const target = resolveHistoryCheckTargets({
      pageUrl: 'https://www.chaospace.cc/tvshows/555.html',
      seasons: [
        buildSeason({
          url: '',
          seasonIndex: 3,
        }),
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/active.html',
          seasonIndex: 2,
          disabled: false,
          recordTimestamp: 2000,
        }),
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/old.html',
          seasonIndex: 2,
          recordTimestamp: 1000,
          disabled: true,
        }),
      ],
    })
    expect(target).toEqual([
      'https://www.chaospace.cc/seasons/active.html',
      'https://www.chaospace.cc/tvshows/555.html',
    ])
  })

  it('targets CHAOSPACE season pages for https://www.chaospace.cc/tvshows/429494.html', () => {
    const target = resolveHistoryCheckTargets({
      pageUrl: 'https://www.chaospace.cc/tvshows/429494.html',
      seasons: [
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/429496.html',
          seasonIndex: 0,
          disabled: true,
          hasItems: true,
        }),
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/429497.html',
          seasonIndex: 1,
          disabled: true,
          hasItems: true,
        }),
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/429498.html',
          seasonIndex: 2,
          disabled: true,
          hasItems: true,
        }),
        buildSeason({
          url: 'https://www.chaospace.cc/seasons/old.html',
          seasonIndex: 1,
          disabled: true,
          hasItems: false,
        }),
      ],
    })
    // Logging to help debug flaky detection reports for this title.
    chaosLogger.log('[HistoryCheckTest] targets for 429494:', target)
    expect(target).toEqual([
      'https://www.chaospace.cc/seasons/429498.html',
      'https://www.chaospace.cc/seasons/429497.html',
      'https://www.chaospace.cc/tvshows/429494.html',
    ])
  })
})
