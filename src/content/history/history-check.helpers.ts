const TVSHOW_PAGE_PATTERN = /\/tvshows\/\d+\.html/i

export interface HistoryCheckSeasonInput {
  url?: string | null
  seasonIndex?: number | null
  recordTimestamp?: number | null
  disabled?: boolean
  hasItems?: boolean
  loaded?: boolean
}

export interface HistoryCheckEntryInput {
  pageUrl?: string | null
  seasons?: HistoryCheckSeasonInput[]
}

interface SeasonCandidate {
  url: string
  seasonIndex: number
  recordTimestamp: number
}

const normalizeUrl = (value: unknown): string => {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  return trimmed
}

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>()
  const ordered: string[] = []
  values.forEach((value) => {
    if (!value || seen.has(value)) {
      return
    }
    seen.add(value)
    ordered.push(value)
  })
  return ordered
}

const FALLBACK_SEASON_LIMIT = 2

export function resolveHistoryCheckTargets(entry: HistoryCheckEntryInput): string[] {
  const primaryUrl = normalizeUrl(entry?.pageUrl)
  if (!primaryUrl) {
    return []
  }

  if (!TVSHOW_PAGE_PATTERN.test(primaryUrl)) {
    return [primaryUrl]
  }

  const seasons = Array.isArray(entry?.seasons) ? entry!.seasons : []
  const candidates: SeasonCandidate[] = []

  seasons.forEach((season) => {
    if (!season || season.disabled) {
      return
    }
    const url = normalizeUrl(season.url)
    if (!url) {
      return
    }
    const seasonIndex = normalizeNumber(season.seasonIndex)
    const recordTimestamp = normalizeNumber(season.recordTimestamp)
    candidates.push({
      url,
      seasonIndex: seasonIndex ?? Number.NEGATIVE_INFINITY,
      recordTimestamp: recordTimestamp ?? 0,
    })
  })

  candidates.sort((a, b) => {
    if (a.seasonIndex === b.seasonIndex) {
      return b.recordTimestamp - a.recordTimestamp
    }
    return b.seasonIndex - a.seasonIndex
  })

  let orderedSeasonUrls = candidates.map((candidate) => candidate.url)
  if (!orderedSeasonUrls.length) {
    const fallbackCandidates: SeasonCandidate[] = []
    seasons.forEach((season) => {
      if (!season) {
        return
      }
      const url = normalizeUrl(season.url)
      if (!url) {
        return
      }
      if (!season.disabled) {
        return
      }
      const hasSignal = Boolean(season.loaded) || Boolean(season.hasItems)
      if (!hasSignal) {
        return
      }
      const seasonIndex = normalizeNumber(season.seasonIndex)
      const recordTimestamp = normalizeNumber(season.recordTimestamp)
      fallbackCandidates.push({
        url,
        seasonIndex: seasonIndex ?? Number.NEGATIVE_INFINITY,
        recordTimestamp: recordTimestamp ?? 0,
      })
    })
    fallbackCandidates.sort((a, b) => {
      if (a.seasonIndex === b.seasonIndex) {
        return b.recordTimestamp - a.recordTimestamp
      }
      return b.seasonIndex - a.seasonIndex
    })
    orderedSeasonUrls = fallbackCandidates
      .slice(0, FALLBACK_SEASON_LIMIT)
      .map((candidate) => candidate.url)
  }
  if (!orderedSeasonUrls.length) {
    return [primaryUrl]
  }
  const ordered = dedupe([...orderedSeasonUrls, primaryUrl])
  return ordered.length ? ordered : [primaryUrl]
}
