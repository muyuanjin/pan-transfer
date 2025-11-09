import type { PosterInfo } from '@/shared/utils/sanitizers'
import type { CompletionStatus } from '@/shared/utils/completion-status'

export interface HistoryDetailRating {
  value: string
  votes: string
  label: string
  scale: number
}

export interface HistoryDetailInfoEntry {
  label: string
  value: string
}

export interface HistoryDetailStillEntry {
  url: string
  full: string
  thumb: string
  alt: string
}

export interface HistoryDetail {
  pageUrl: string
  title: string
  poster: PosterInfo | null
  releaseDate: string
  country: string
  runtime: string
  rating: HistoryDetailRating | null
  genres: string[]
  info: HistoryDetailInfoEntry[]
  synopsis: string
  stills: HistoryDetailStillEntry[]
  completion: CompletionStatus | null
}

export interface HistorySeasonEntrySummary {
  seasonId: string
  url: string
  label: string
  seasonIndex: number
  poster: PosterInfo | null
  completion?: CompletionStatus | null
}

export interface HistorySnapshotItem {
  id: string
  title: string
  linkUrl?: string
  passCode?: string
}

export interface SiteHistorySnapshot {
  pageUrl: string
  pageTitle: string
  pageType: 'series' | 'movie' | 'anime' | 'unknown'
  total: number
  items: HistorySnapshotItem[]
  completion: CompletionStatus | null
  seasonCompletion: Record<string, CompletionStatus>
  seasonEntries: HistorySeasonEntrySummary[]
  providerId?: string
  providerLabel?: string
}
