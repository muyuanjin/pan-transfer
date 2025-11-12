import { chaosLogger } from '@/shared/log'
import { HISTORY_VERSION, STORAGE_KEYS, MAX_HISTORY_RECORDS } from '../common/constants'
import { storageGet, storageSet } from './utils'
import {
  removeCompletedShares,
  clearCompletedShareCache,
  invalidateDirectoryCaches,
} from './cache-store'
import {
  mergeCompletionStatus,
  mergeSeasonCompletionMap,
  normalizeHistoryCompletion,
  normalizeSeasonCompletionMap,
  normalizeSeasonDirectoryMap,
  mergeSeasonDirectoryMap,
  normalizeSeasonEntries,
  type CompletionStatus,
  type CompletionStatusInput,
  type SeasonEntryInput,
} from '@/shared/utils/completion-status'
import { sanitizePosterInfo, type PosterInput } from '@/shared/utils/sanitizers'
import { normalizePath } from '../utils/path'
import { buildSurl } from '../utils/share'
import { canonicalizePageUrl } from '@/shared/utils/url'
import type {
  HistoryRecord,
  HistoryRecordItem,
  TransferItemPayload,
  TransferRequestPayload,
  TransferResponsePayload,
  TransferResultEntry,
  TransferJobMeta,
} from '@/shared/types/transfer'

const nowTs = (): number => Date.now()

interface HistoryState {
  version: number
  records: HistoryRecord[]
}

interface HistoryIndexEntry {
  index: number
  record: HistoryRecord
}

let historyState: HistoryState | null = null
let historyLoadPromise: Promise<void> | null = null
const historyIndexByUrl = new Map<string, HistoryIndexEntry>()
const HISTORY_URL_FALLBACK = 'https://www.chaospace.cc/'

const toHistoryIndexKey = (value: unknown, baseUrl?: string | null): string | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  return (
    canonicalizePageUrl(value, {
      baseUrl: resolveBaseForCanonicalization(baseUrl),
      allowFallback: false,
    }) ?? null
  )
}

function createDefaultHistoryRecord(pageUrl: string): HistoryRecord {
  return {
    pageUrl,
    pageTitle: '',
    pageType: 'unknown',
    origin: '',
    siteProviderId: null,
    siteProviderLabel: null,
    poster: null,
    targetDirectory: '/',
    baseDir: '/',
    useTitleSubdir: true,
    useSeasonSubdir: false,
    lastTransferredAt: 0,
    lastCheckedAt: 0,
    totalTransferred: 0,
    completion: null,
    seasonCompletion: {},
    seasonDirectory: {},
    seasonEntries: [],
    items: {},
    itemOrder: [],
    lastResult: null,
    pendingTransfer: null,
  }
}

function createDefaultHistoryState(): HistoryState {
  return {
    version: HISTORY_VERSION,
    records: [],
  }
}

function appendIndexEntry(
  record: HistoryRecord,
  candidateUrl: string | null | undefined,
  index: number,
  seen: Set<string>,
  baseUrl: string,
): void {
  const key = toHistoryIndexKey(candidateUrl, baseUrl)
  if (!key || seen.has(key)) {
    return
  }
  seen.add(key)
  historyIndexByUrl.set(key, { index, record })
}

function collectRecordAliasUrls(record: HistoryRecord): string[] {
  const urls: string[] = []
  if (Array.isArray(record.seasonEntries)) {
    record.seasonEntries.forEach((entry) => {
      if (entry?.url) {
        urls.push(entry.url)
      }
    })
  }
  return urls
}

function rebuildHistoryIndex(): void {
  historyIndexByUrl.clear()
  if (!historyState || !Array.isArray(historyState.records)) {
    return
  }
  const seen = new Set<string>()
  historyState.records.forEach((record, index) => {
    if (!record) {
      return
    }
    const baseUrl = resolveRecordBaseUrl(record)
    appendIndexEntry(record, record.pageUrl, index, seen, baseUrl)
    collectRecordAliasUrls(record).forEach((url) => {
      appendIndexEntry(record, url, index, seen, baseUrl)
    })
  })
}

function sanitizeHistoryItems(items: unknown): Record<string, HistoryRecordItem> {
  if (!items || typeof items !== 'object') {
    return {}
  }
  const result: Record<string, HistoryRecordItem> = {}
  Object.entries(items as Record<string, Partial<HistoryRecordItem>>).forEach(([key, value]) => {
    if (!value) {
      return
    }
    const itemId = typeof value.id === 'string' && value.id ? value.id : key
    if (!itemId) {
      return
    }
    const status =
      value.status === 'success' || value.status === 'failed' || value.status === 'skipped'
        ? value.status
        : 'failed'
    const item: HistoryRecordItem = {
      id: itemId,
      title: typeof value.title === 'string' ? value.title : '',
      status,
      message: typeof value.message === 'string' ? value.message : '',
      lastStatus:
        value.lastStatus === 'success' ||
        value.lastStatus === 'failed' ||
        value.lastStatus === 'skipped'
          ? value.lastStatus
          : status,
    }
    const errno = Number.isFinite(value.errno as number) ? Number(value.errno) : undefined
    if (typeof errno === 'number') {
      item.errno = errno
    }
    const files = Array.isArray(value.files)
      ? value.files.filter((name): name is string => typeof name === 'string')
      : []
    if (files.length) {
      item.files = files
    }
    const skipped = Array.isArray(value.skippedFiles)
      ? value.skippedFiles.filter((name): name is string => typeof name === 'string')
      : []
    if (skipped.length) {
      item.skippedFiles = skipped
    }
    const filteredFiles = Array.isArray(value.filteredFiles)
      ? value.filteredFiles.filter((name): name is string => typeof name === 'string')
      : []
    if (filteredFiles.length) {
      item.filteredFiles = filteredFiles
    }
    const renameResults = Array.isArray(value.renameResults)
      ? value.renameResults
          .map((entry) => {
            if (!entry || typeof entry !== 'object') {
              return null
            }
            const from =
              typeof (entry as { from?: string }).from === 'string'
                ? (entry as { from: string }).from
                : ''
            const to =
              typeof (entry as { to?: string }).to === 'string' ? (entry as { to: string }).to : ''
            const status =
              (entry as { status?: string }).status === 'success' ||
              (entry as { status?: string }).status === 'failed' ||
              (entry as { status?: string }).status === 'unchanged'
                ? ((entry as { status: 'success' | 'failed' | 'unchanged' }).status as
                    | 'success'
                    | 'failed'
                    | 'unchanged')
                : 'unchanged'
            const errnoValue = Number((entry as { errno?: number }).errno)
            const errno = Number.isFinite(errnoValue) ? errnoValue : undefined
            const message =
              typeof (entry as { message?: string }).message === 'string'
                ? (entry as { message: string }).message
                : undefined
            if (!from && !to) {
              return null
            }
            const rulesList: string[] = Array.isArray((entry as { rules?: unknown[] }).rules)
              ? ((entry as { rules?: unknown[] }).rules || []).filter(
                  (rule): rule is string => typeof rule === 'string' && rule.trim().length > 0,
                )
              : []
            const record: {
              from: string
              to: string
              status: 'success' | 'failed' | 'unchanged'
              errno?: number
              message?: string
              rules?: string[]
            } = {
              from,
              to,
              status,
            }
            if (typeof errno === 'number') {
              record.errno = errno
            }
            if (message) {
              record.message = message
            }
            if (rulesList.length) {
              record.rules = rulesList
            }
            return record
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : []
    if (renameResults.length) {
      item.renameResults = renameResults
    }
    if (typeof value.linkUrl === 'string') {
      item.linkUrl = value.linkUrl
    }
    if (typeof value.passCode === 'string') {
      item.passCode = value.passCode
    }
    const lastTransferredAt = Number.isFinite(value.lastTransferredAt as number)
      ? Number(value.lastTransferredAt)
      : undefined
    if (typeof lastTransferredAt === 'number') {
      item.lastTransferredAt = lastTransferredAt
    }
    const totalSuccess = Number.isFinite(value.totalSuccess as number)
      ? Number(value.totalSuccess)
      : undefined
    if (typeof totalSuccess === 'number') {
      item.totalSuccess = totalSuccess
    }
    result[itemId] = item
  })
  return result
}

export function ensureHistoryRecordStructure(
  record: Partial<HistoryRecord> | null | undefined,
): HistoryRecord {
  const pageUrl = typeof record?.pageUrl === 'string' && record.pageUrl ? record.pageUrl : ''
  const normalized = createDefaultHistoryRecord(pageUrl)

  normalized.pageTitle =
    typeof record?.pageTitle === 'string' ? record.pageTitle : normalized.pageTitle
  normalized.pageType =
    record?.pageType === 'series' || record?.pageType === 'movie' || record?.pageType === 'anime'
      ? record.pageType
      : 'unknown'
  normalized.origin = typeof record?.origin === 'string' ? record.origin : normalized.origin
  normalized.siteProviderId =
    typeof record?.siteProviderId === 'string' && record.siteProviderId
      ? record.siteProviderId
      : null
  normalized.siteProviderLabel =
    typeof record?.siteProviderLabel === 'string' && record.siteProviderLabel
      ? record.siteProviderLabel
      : null
  normalized.poster = record?.poster
    ? sanitizePosterInfo(record.poster as PosterInput) || null
    : null
  normalized.targetDirectory = normalizeHistoryPath(
    record?.targetDirectory,
    normalized.targetDirectory,
  )
  normalized.baseDir = normalizeHistoryPath(
    record?.baseDir || record?.targetDirectory,
    normalized.baseDir,
  )
  normalized.useTitleSubdir =
    typeof record?.useTitleSubdir === 'boolean' ? record.useTitleSubdir : normalized.useTitleSubdir
  normalized.useSeasonSubdir =
    typeof record?.useSeasonSubdir === 'boolean'
      ? record.useSeasonSubdir
      : normalized.useSeasonSubdir
  normalized.lastTransferredAt = Number.isFinite(record?.lastTransferredAt as number)
    ? Number(record?.lastTransferredAt)
    : 0
  normalized.lastCheckedAt = Number.isFinite(record?.lastCheckedAt as number)
    ? Number(record?.lastCheckedAt)
    : 0
  normalized.totalTransferred = Number.isFinite(record?.totalTransferred as number)
    ? Number(record?.totalTransferred)
    : 0
  normalized.completion =
    normalizeHistoryCompletion(record?.completion as CompletionStatusInput) || null
  normalized.seasonCompletion = normalizeSeasonCompletionMap(
    record?.seasonCompletion as Record<string, CompletionStatus>,
  )
  normalized.seasonDirectory = normalizeSeasonDirectoryMap(
    record?.seasonDirectory as Record<string, string>,
  )
  normalized.seasonEntries = normalizeSeasonEntries(record?.seasonEntries as SeasonEntryInput[])
  normalized.items = sanitizeHistoryItems(record?.items)

  const rawOrder = Array.isArray(record?.itemOrder)
    ? record.itemOrder.map((item) => String(item)).filter(Boolean)
    : Object.keys(normalized.items)
  normalized.itemOrder = rawOrder.filter((id) => Boolean(normalized.items[id]))

  if (record?.lastResult && typeof record.lastResult === 'object') {
    normalized.lastResult = {
      summary: typeof record.lastResult.summary === 'string' ? record.lastResult.summary : '',
      updatedAt: Number.isFinite(record.lastResult.updatedAt)
        ? Number(record.lastResult.updatedAt)
        : 0,
      success: Number.isFinite(record.lastResult.success) ? Number(record.lastResult.success) : 0,
      skipped: Number.isFinite(record.lastResult.skipped) ? Number(record.lastResult.skipped) : 0,
      failed: Number.isFinite(record.lastResult.failed) ? Number(record.lastResult.failed) : 0,
    }
  }

  const pending = record?.pendingTransfer
  if (pending && typeof pending === 'object') {
    const jobId = typeof pending.jobId === 'string' ? pending.jobId : ''
    const detectedAt = Number.isFinite((pending as { detectedAt?: unknown }).detectedAt as number)
      ? Number((pending as { detectedAt: number }).detectedAt)
      : 0
    const summary = typeof pending.summary === 'string' ? pending.summary : ''
    const newItemIds = Array.isArray(pending.newItemIds)
      ? pending.newItemIds.filter(
          (value): value is string | number =>
            typeof value === 'string' || typeof value === 'number',
        )
      : []
    const payload = pending.payload && typeof pending.payload === 'object' ? pending.payload : null
    if (jobId && detectedAt > 0 && payload) {
      const items = Array.isArray(payload.items)
        ? payload.items
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null
              }
              const idValue = (item as { id?: unknown }).id
              const titleValue = (item as { title?: unknown }).title
              const normalizedItemId =
                typeof idValue === 'string' || typeof idValue === 'number' ? idValue : null
              if (normalizedItemId === null) {
                return null
              }
              const normalizedItem: TransferItemPayload = {
                id: normalizedItemId,
                title: typeof titleValue === 'string' ? titleValue : '',
              }
              const targetPath = (item as { targetPath?: unknown }).targetPath
              if (typeof targetPath === 'string' && targetPath) {
                normalizedItem.targetPath = targetPath
              }
              const linkUrl = (item as { linkUrl?: unknown }).linkUrl
              if (typeof linkUrl === 'string' && linkUrl) {
                normalizedItem.linkUrl = linkUrl
              }
              const passCode = (item as { passCode?: unknown }).passCode
              if (typeof passCode === 'string' && passCode) {
                normalizedItem.passCode = passCode
              }
              return normalizedItem
            })
            .filter((value): value is TransferItemPayload => Boolean(value))
        : []

      const normalizedPayload: TransferRequestPayload = {
        jobId: typeof payload.jobId === 'string' && payload.jobId ? payload.jobId : jobId,
        items,
      }
      if (typeof payload.origin === 'string' && payload.origin) {
        normalizedPayload.origin = payload.origin
      }
      if (typeof payload.targetDirectory === 'string' && payload.targetDirectory) {
        normalizedPayload.targetDirectory = payload.targetDirectory
      }
      if (payload.meta && typeof payload.meta === 'object') {
        normalizedPayload.meta = { ...(payload.meta as TransferJobMeta) }
      }
      normalized.pendingTransfer = {
        jobId,
        detectedAt,
        summary,
        newItemIds,
        payload: normalizedPayload,
      }
    }
  }

  return normalized
}

export function normalizeHistoryPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback
  }
  return normalizePath(value)
}

function collectRecordSurls(records: Iterable<HistoryRecord>): string[] {
  const surls = new Set<string>()
  for (const record of records) {
    if (!record || !record.items) {
      continue
    }
    Object.values(record.items).forEach((item) => {
      if (!item || typeof item.linkUrl !== 'string') {
        return
      }
      const surl = buildSurl(item.linkUrl)
      if (surl) {
        surls.add(surl)
      }
    })
  }
  return Array.from(surls)
}

function applyResultToHistoryRecord(
  record: HistoryRecord,
  result: TransferResultEntry,
  timestamp: number,
): void {
  if (typeof result.id === 'undefined') {
    return
  }
  const itemId = String(result.id)
  if (!itemId) {
    return
  }
  const existing =
    record.items[itemId] ||
    ({
      id: itemId,
      title: result.title || '',
      status: 'failed',
      message: result.message || '',
    } as HistoryRecordItem)
  const next: HistoryRecordItem = {
    id: itemId,
    title: result.title || existing.title || '',
    status: result.status,
    message: result.message || existing.message || '',
    lastStatus: result.status,
    lastTransferredAt:
      result.status === 'success'
        ? timestamp
        : typeof existing.lastTransferredAt === 'number'
          ? existing.lastTransferredAt
          : timestamp,
    totalSuccess:
      result.status === 'success'
        ? typeof existing.totalSuccess === 'number'
          ? existing.totalSuccess + 1
          : 1
        : typeof existing.totalSuccess === 'number'
          ? existing.totalSuccess
          : 0,
  }
  const linkUrl = result.linkUrl || existing.linkUrl
  if (linkUrl) {
    next.linkUrl = linkUrl
  }
  const passCode = result.passCode || existing.passCode
  if (passCode) {
    next.passCode = passCode
  }

  const errnoValue = typeof result.errno === 'number' ? result.errno : existing.errno
  if (typeof errnoValue === 'number') {
    next.errno = errnoValue
  }
  const files = result.files ? result.files.slice() : existing.files ? existing.files.slice() : []
  if (files.length) {
    next.files = files
  }
  const skipped = result.skippedFiles
    ? result.skippedFiles.slice()
    : existing.skippedFiles
      ? existing.skippedFiles.slice()
      : []
  if (skipped.length) {
    next.skippedFiles = skipped
  }
  if (result.status === 'skipped' && !existing.lastTransferredAt) {
    next.lastTransferredAt = timestamp
  }
  record.items[itemId] = next
  if (!record.itemOrder.includes(itemId)) {
    record.itemOrder.push(itemId)
  }
}

function upsertHistoryRecord(pageUrl: string): { record: HistoryRecord; index: number } {
  if (!historyState) {
    historyState = createDefaultHistoryState()
  }
  const key = toHistoryIndexKey(pageUrl)
  if (key) {
    const existing = historyIndexByUrl.get(key)
    if (existing) {
      const stored = historyState.records[existing.index]
      if (stored) {
        return { record: stored, index: existing.index }
      }
      const normalized = ensureHistoryRecordStructure(existing.record)
      historyState.records[existing.index] = normalized
      historyIndexByUrl.set(key, { index: existing.index, record: normalized })
      return { record: normalized, index: existing.index }
    }
  }
  const record = ensureHistoryRecordStructure(createDefaultHistoryRecord(pageUrl))
  historyState.records.push(record)
  const index = historyState.records.length - 1
  if (key) {
    historyIndexByUrl.set(key, { index, record })
  } else {
    rebuildHistoryIndex()
  }
  return { record, index }
}

export async function ensureHistoryLoaded(): Promise<void> {
  if (historyLoadPromise) {
    await historyLoadPromise
    return
  }
  historyLoadPromise = (async () => {
    try {
      const stored = await storageGet<{ [STORAGE_KEYS.history]: HistoryState | undefined }>([
        STORAGE_KEYS.history,
      ])
      const raw = stored[STORAGE_KEYS.history]
      if (raw && raw.version === HISTORY_VERSION && Array.isArray(raw.records)) {
        historyState = {
          version: HISTORY_VERSION,
          records: raw.records.map((record) => ensureHistoryRecordStructure(record)),
        }
      } else {
        historyState = createDefaultHistoryState()
      }
    } catch (error) {
      chaosLogger.warn('[Pan Transfer] Failed to load transfer history', error)
      historyState = createDefaultHistoryState()
    }
    rebuildHistoryIndex()
  })()
  await historyLoadPromise
}

export async function reloadHistoryFromStorage(): Promise<void> {
  historyState = null
  historyLoadPromise = null
  historyIndexByUrl.clear()
  await ensureHistoryLoaded()
}

export async function persistHistoryNow(): Promise<void> {
  await ensureHistoryLoaded()
  if (!historyState) {
    historyState = createDefaultHistoryState()
  }
  try {
    await storageSet({
      [STORAGE_KEYS.history]: historyState,
    })
  } catch (error) {
    chaosLogger.warn('[Pan Transfer] Failed to persist history', error)
  }
}

export function getHistoryRecord(pageUrl: string): HistoryRecord | null {
  const key = toHistoryIndexKey(pageUrl)
  if (!key) {
    return null
  }
  const entry = historyIndexByUrl.get(key)
  return entry ? ensureHistoryRecordStructure(entry.record) : null
}

function resolveRecordBaseUrl(record: HistoryRecord | null | undefined): string {
  return (
    coerceAbsoluteUrl(record?.origin) ?? coerceAbsoluteUrl(record?.pageUrl) ?? HISTORY_URL_FALLBACK
  )
}

function coerceAbsoluteUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  try {
    new URL(trimmed)
    return trimmed
  } catch {
    return null
  }
}

function resolveBaseForCanonicalization(candidate: string | null | undefined): string {
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate
  }
  return HISTORY_URL_FALLBACK
}

export function getHistoryRecords(): HistoryRecord[] {
  return historyState?.records || []
}

export async function recordTransferHistory(
  payload: TransferRequestPayload,
  outcome: TransferResponsePayload,
): Promise<void> {
  if (!payload || !payload.meta) {
    return
  }
  await ensureHistoryLoaded()
  const { meta } = payload
  const pageUrl = typeof meta.pageUrl === 'string' && meta.pageUrl ? meta.pageUrl : ''
  if (!pageUrl) {
    return
  }

  const timestamp = nowTs()
  const { record } = upsertHistoryRecord(pageUrl)
  const origin = payload.origin || record.origin || ''
  record.pageTitle =
    typeof meta.pageTitle === 'string' && meta.pageTitle ? meta.pageTitle : record.pageTitle || ''
  record.origin = origin
  const providerId =
    typeof meta.siteProviderId === 'string' && meta.siteProviderId ? meta.siteProviderId : null
  const providerLabel =
    typeof meta.siteProviderLabel === 'string' && meta.siteProviderLabel
      ? meta.siteProviderLabel
      : null
  if (providerId) {
    record.siteProviderId = providerId
  }
  if (providerLabel) {
    record.siteProviderLabel = providerLabel
  } else if (providerId && !record.siteProviderLabel) {
    record.siteProviderLabel = providerId
  }
  record.pageType =
    typeof meta.pageType === 'string' && meta.pageType
      ? meta.pageType
      : record.pageType || 'unknown'
  record.poster = sanitizePosterInfo(meta.poster as PosterInput) || record.poster || null
  record.targetDirectory = normalizeHistoryPath(
    meta.targetDirectory || payload.targetDirectory || record.targetDirectory,
    record.targetDirectory || '/',
  )
  record.baseDir = normalizeHistoryPath(
    meta.baseDir || record.baseDir || record.targetDirectory,
    record.baseDir || '/',
  )
  record.useTitleSubdir =
    typeof meta.useTitleSubdir === 'boolean' ? meta.useTitleSubdir : Boolean(record.useTitleSubdir)
  record.useSeasonSubdir =
    typeof meta.useSeasonSubdir === 'boolean'
      ? meta.useSeasonSubdir
      : Boolean(record.useSeasonSubdir)
  if (meta.seasonDirectory && typeof meta.seasonDirectory === 'object') {
    record.seasonDirectory = mergeSeasonDirectoryMap(record.seasonDirectory, meta.seasonDirectory)
  }
  if (Array.isArray(meta.seasonEntries)) {
    const normalizedEntries = normalizeSeasonEntries(meta.seasonEntries)
    if (normalizedEntries.length) {
      record.seasonEntries = normalizedEntries
    }
  }
  record.lastCheckedAt = timestamp
  if (meta.completion) {
    record.completion = mergeCompletionStatus(
      record.completion,
      meta.completion,
      timestamp,
      meta.completion?.source || 'transfer-meta',
    )
  }
  if (meta.seasonCompletion && typeof meta.seasonCompletion === 'object') {
    record.seasonCompletion = mergeSeasonCompletionMap(
      record.seasonCompletion,
      meta.seasonCompletion,
      timestamp,
      'transfer-meta',
    )
  }

  const results = Array.isArray(outcome?.results) ? outcome.results : []
  let successCount = 0
  let skippedCount = 0
  let failedCount = 0
  for (const res of results) {
    if (!res || typeof res.id === 'undefined') {
      continue
    }
    if (res.status === 'failed') {
      failedCount += 1
      continue
    }
    applyResultToHistoryRecord(record, res, timestamp)
    if (res.status === 'success') {
      successCount += 1
    } else if (res.status === 'skipped') {
      skippedCount += 1
    }
  }

  record.totalTransferred = Object.keys(record.items).length
  if (successCount > 0) {
    record.lastTransferredAt = timestamp
  }
  const summary = typeof outcome?.summary === 'string' ? outcome.summary : ''
  record.lastResult = {
    summary,
    updatedAt: timestamp,
    success: successCount,
    skipped: skippedCount,
    failed: failedCount,
  }
  record.pendingTransfer = null

  historyState!.records.sort((a, b) => {
    const tsA = a.lastTransferredAt || a.lastCheckedAt || 0
    const tsB = b.lastTransferredAt || b.lastCheckedAt || 0
    return tsB - tsA
  })

  if (historyState!.records.length > MAX_HISTORY_RECORDS) {
    historyState!.records = historyState!.records.slice(0, MAX_HISTORY_RECORDS)
  }

  rebuildHistoryIndex()
  await persistHistoryNow()
}

export async function deleteHistoryRecords(
  urls: string[] = [],
): Promise<{ ok: boolean; removed: number; total: number }> {
  await ensureHistoryLoaded()
  if (!historyState) {
    historyState = createDefaultHistoryState()
  }
  if (!Array.isArray(urls) || !urls.length) {
    return { ok: true, removed: 0, total: historyState.records.length }
  }
  const targets = new Set(urls.filter((url) => typeof url === 'string' && url))
  if (!targets.size) {
    return { ok: true, removed: 0, total: historyState.records.length }
  }
  const beforeCount = historyState.records.length
  const removedRecords: HistoryRecord[] = []
  const directoriesToInvalidate = new Set<string>()

  const collectDirectory = (value: unknown): void => {
    if (typeof value !== 'string') {
      return
    }
    const normalized = normalizeHistoryPath(value, '/')
    if (normalized && normalized !== '/') {
      directoriesToInvalidate.add(normalized)
    }
  }

  historyState.records = historyState.records.filter((record) => {
    if (targets.has(record.pageUrl)) {
      removedRecords.push(record)
      collectDirectory(record.targetDirectory)
      collectDirectory(record.baseDir)
      return false
    }
    return true
  })
  const removed = beforeCount - historyState.records.length
  if (!removed) {
    return { ok: true, removed: 0, total: historyState.records.length }
  }
  if (removedRecords.length) {
    const surls = collectRecordSurls(removedRecords)
    if (surls.length) {
      await removeCompletedShares(surls)
    }
  }
  if (directoriesToInvalidate.size) {
    await invalidateDirectoryCaches(directoriesToInvalidate)
  }
  rebuildHistoryIndex()
  await persistHistoryNow()
  return { ok: true, removed, total: historyState.records.length }
}

export async function clearHistoryRecords(): Promise<{
  ok: boolean
  removed: number
  total: number
  cleared?: boolean
}> {
  await ensureHistoryLoaded()
  if (!historyState) {
    historyState = createDefaultHistoryState()
  }
  const removed = historyState.records.length
  if (!removed) {
    return { ok: true, removed: 0, total: 0 }
  }
  const directoriesToInvalidate = new Set<string>()
  historyState.records.forEach((record) => {
    if (!record) {
      return
    }
    if (typeof record.targetDirectory === 'string') {
      const normalized = normalizeHistoryPath(record.targetDirectory, '/')
      if (normalized && normalized !== '/') {
        directoriesToInvalidate.add(normalized)
      }
    }
    if (typeof record.baseDir === 'string') {
      const normalized = normalizeHistoryPath(record.baseDir, '/')
      if (normalized && normalized !== '/') {
        directoriesToInvalidate.add(normalized)
      }
    }
  })
  historyState = createDefaultHistoryState()
  await clearCompletedShareCache()
  if (directoriesToInvalidate.size) {
    await invalidateDirectoryCaches(directoriesToInvalidate)
  }
  rebuildHistoryIndex()
  await persistHistoryNow()
  return { ok: true, removed, total: 0, cleared: true }
}

export function getHistoryIndexMap(): Map<string, HistoryIndexEntry> {
  return historyIndexByUrl
}
