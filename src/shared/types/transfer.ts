import type {
  CompletionStatus,
  CompletionStatusInput,
  SeasonEntry,
  SeasonEntryInput,
} from '../utils/completion-status'
import type { PosterInfo } from '../utils/sanitizers'

export type TransferStatus = 'success' | 'failed' | 'skipped'

export interface TransferJobMeta {
  total: number
  baseDir?: string
  useTitleSubdir?: boolean
  useSeasonSubdir?: boolean
  pageTitle?: string
  pageUrl?: string
  pageType?: 'series' | 'movie' | 'anime' | 'unknown'
  targetDirectory?: string
  seasonDirectory?: Record<string, string> | null
  completion?: CompletionStatusInput
  seasonCompletion?: Record<string, CompletionStatusInput>
  seasonEntries?: SeasonEntryInput[]
  poster?: PosterInfo | null
}

export interface TransferItemPayload {
  id: string | number
  title: string
  targetPath?: string
  linkUrl?: string
  passCode?: string
}

export interface TransferRequestPayload {
  jobId?: string
  origin?: string
  items: TransferItemPayload[]
  targetDirectory?: string
  meta?: TransferJobMeta
}

export interface TransferResultEntry {
  id: string | number
  title: string
  status: TransferStatus
  message: string
  errno?: number
  files?: string[]
  skippedFiles?: string[]
  linkUrl?: string
  passCode?: string
}

export interface TransferResponsePayload {
  jobId?: string
  results: TransferResultEntry[]
  summary: string
}

export interface HistoryRecordItem extends TransferResultEntry {
  lastStatus?: TransferStatus | 'unknown'
  lastTransferredAt?: number
  totalSuccess?: number
}

export interface HistoryRecord {
  pageUrl: string
  pageTitle: string
  pageType: 'series' | 'movie' | 'anime' | 'unknown'
  origin: string
  poster: PosterInfo | null
  targetDirectory: string
  baseDir: string
  useTitleSubdir: boolean
  useSeasonSubdir: boolean
  lastTransferredAt: number
  lastCheckedAt: number
  totalTransferred: number
  completion: CompletionStatus | null
  seasonCompletion: Record<string, CompletionStatus>
  seasonDirectory: Record<string, string>
  seasonEntries: SeasonEntry[]
  items: Record<string, HistoryRecordItem>
  itemOrder: string[]
  lastResult: {
    summary: string
    updatedAt: number
    success: number
    skipped: number
    failed: number
  } | null
}
