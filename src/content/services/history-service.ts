import { chaosLogger } from '@/shared/log'
import { HISTORY_KEY, HISTORY_FILTERS, type HistoryFilter } from '../constants'
import { normalizePageUrl } from '@/providers/sites/chaospace/page-analyzer'
import type { CompletionStatus, SeasonEntry } from '@/shared/utils/completion-status'
import type { PosterInfo } from '@/shared/utils/sanitizers'
import type {
  ContentHistoryRecord,
  HistoryGroup,
  HistoryGroupSeasonRow,
  HistoryRecordsPayload,
} from '../types'
import { safeStorageGet } from '../utils/storage'

type TinyPinyinModule = typeof import('tiny-pinyin')

let tinyPinyinModule: TinyPinyinModule | null = null
let tinyPinyinLoadPromise: Promise<TinyPinyinModule | null> | null = null

async function loadTinyPinyin(): Promise<TinyPinyinModule | null> {
  if (tinyPinyinModule) {
    return tinyPinyinModule
  }
  if (!tinyPinyinLoadPromise) {
    tinyPinyinLoadPromise = import('tiny-pinyin')
      .then((mod) => {
        const resolved = ((mod as { default?: TinyPinyinModule }).default ??
          mod) as TinyPinyinModule
        tinyPinyinModule = resolved
        return resolved
      })
      .catch((error) => {
        chaosLogger.warn('Failed to load TinyPinyin module', error)
        return null
      })
      .finally(() => {
        tinyPinyinLoadPromise = null
      })
  }
  return tinyPinyinLoadPromise
}

function getTinyPinyin(): TinyPinyinModule | null {
  if (tinyPinyinModule) {
    return tinyPinyinModule
  }
  void loadTinyPinyin()
  return tinyPinyinModule
}

export function primeHistorySearchTransliteration(): Promise<TinyPinyinModule | null> {
  return loadTinyPinyin()
}

export async function ensureHistorySearchTransliterationReady(): Promise<void> {
  await loadTinyPinyin()
}

interface CompletionLike {
  label?: unknown
  state?: unknown
  source?: unknown
  updatedAt?: unknown
}

interface PosterLike {
  src?: unknown
  alt?: unknown
}

interface HistorySeasonEntryInput {
  seasonId?: unknown
  id?: unknown
  url?: unknown
  label?: unknown
  seasonIndex?: unknown
  completion?: unknown
  poster?: unknown
  loaded?: unknown
  hasItems?: unknown
}

interface StoredHistorySnapshot {
  records?: unknown
  [key: string]: unknown
}

const COMPLETION_STATES: ReadonlySet<CompletionStatus['state']> = new Set([
  'completed',
  'ongoing',
  'upcoming',
  'unknown',
])

function coerceCompletionState(state: unknown): CompletionStatus['state'] {
  if (typeof state !== 'string') {
    return 'unknown'
  }
  return COMPLETION_STATES.has(state as CompletionStatus['state'])
    ? (state as CompletionStatus['state'])
    : 'unknown'
}

export async function readHistoryFromStorage(): Promise<StoredHistorySnapshot | null> {
  try {
    const stored = await safeStorageGet<Record<string, unknown>>([HISTORY_KEY], 'history')
    const payload = stored?.[HISTORY_KEY]
    if (payload && typeof payload === 'object') {
      return payload as StoredHistorySnapshot
    }
    return null
  } catch (error) {
    chaosLogger.error('[Pan Transfer] Failed to read history from storage', error)
    return null
  }
}

export function normalizeHistoryCompletion(entry: unknown): CompletionStatus | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const raw = entry as CompletionLike
  const labelValue = raw.label
  const label = typeof labelValue === 'string' ? labelValue.trim() : ''
  if (!label) {
    return null
  }
  const state = coerceCompletionState(raw.state)
  const normalized: CompletionStatus = {
    label,
    state,
  }
  if (typeof raw.source === 'string' && raw.source.trim()) {
    normalized.source = raw.source.trim()
  }
  if (typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)) {
    normalized.updatedAt = raw.updatedAt
  }
  return normalized
}

export function normalizeSeasonCompletionMap(value: unknown): Record<string, CompletionStatus> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const result: Record<string, CompletionStatus> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    const normalized = normalizeHistoryCompletion(entry)
    if (normalized) {
      result[key] = normalized
    }
  })
  return result
}

export function normalizeSeasonDirectory(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const result: Record<string, string> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, dir]) => {
    if (typeof dir !== 'string') {
      return
    }
    const trimmed = dir.trim()
    if (trimmed) {
      result[key] = trimmed
    }
  })
  return result
}

function normalizePosterInfo(entry: unknown): PosterInfo | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const raw = entry as PosterLike
  if (typeof raw.src !== 'string' || !raw.src.trim()) {
    return null
  }
  return {
    src: raw.src,
    alt: typeof raw.alt === 'string' ? raw.alt : '',
  }
}

export function normalizeHistorySeasonEntries(entries: unknown): SeasonEntry[] {
  if (!Array.isArray(entries)) {
    return []
  }
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const raw = entry as HistorySeasonEntryInput
      const seasonId =
        typeof raw.seasonId === 'string' && raw.seasonId
          ? raw.seasonId
          : typeof raw.id === 'string'
            ? raw.id
            : ''
      const url = typeof raw.url === 'string' ? raw.url : ''
      const label = typeof raw.label === 'string' ? raw.label : ''
      const seasonIndex = Number.isFinite(raw.seasonIndex) ? Number(raw.seasonIndex) : 0
      const completion = normalizeHistoryCompletion(raw.completion || null)
      const poster = normalizePosterInfo(raw.poster || null)
      return {
        seasonId,
        url,
        label,
        seasonIndex,
        completion,
        poster,
        loaded: Boolean(raw.loaded),
        hasItems: Boolean(raw.hasItems),
      } as SeasonEntry
    })
    .filter((entry): entry is SeasonEntry => Boolean(entry))
    .sort((a, b) => {
      if (a.seasonIndex === b.seasonIndex) {
        return a.seasonId.localeCompare(b.seasonId, 'zh-CN')
      }
      return a.seasonIndex - b.seasonIndex
    })
}

export function getHistoryRecordTimestamp(record: ContentHistoryRecord | null | undefined): number {
  if (!record || typeof record !== 'object') {
    return 0
  }
  const timestamps = [
    record.lastTransferredAt,
    record.lastCheckedAt,
    record.lastResult?.updatedAt,
  ].filter((value) => Number.isFinite(value) && Number(value) > 0)
  if (!timestamps.length) {
    return 0
  }
  return Math.max(...(timestamps as number[]))
}

export function deriveHistoryGroupKey(record: ContentHistoryRecord | null | undefined): string {
  if (!record || typeof record !== 'object') {
    return ''
  }
  let origin = typeof record.origin === 'string' ? record.origin : ''
  if (!origin) {
    try {
      const url = new URL(record.pageUrl)
      origin = `${url.protocol}//${url.host}`
    } catch {
      origin = ''
    }
  }
  const title =
    typeof record.pageTitle === 'string' && record.pageTitle.trim()
      ? record.pageTitle.trim()
      : '未命名资源'
  return `${origin}::${title}`
}

export function selectHistoryMainRecord(
  records: ContentHistoryRecord[],
): ContentHistoryRecord | null {
  if (!Array.isArray(records) || !records.length) {
    return null
  }
  const tvShowRecord = records.find((record) => /\/tvshows\/\d+\.html/.test(record.pageUrl))
  if (tvShowRecord) {
    return tvShowRecord
  }
  const aggregatedRecord = records.find(
    (record) => Array.isArray(record.seasonEntries) && record.seasonEntries.length > 0,
  )
  if (aggregatedRecord) {
    return aggregatedRecord
  }
  const nonSeasonRecord = records.find((record) => !/\/seasons\/\d+\.html/.test(record.pageUrl))
  if (nonSeasonRecord) {
    return nonSeasonRecord
  }
  return records[0]!
}

export function buildHistoryGroups(records: ContentHistoryRecord[]): HistoryGroup[] {
  if (!Array.isArray(records) || !records.length) {
    return []
  }
  const groupMap = new Map<string, ContentHistoryRecord[]>()
  records.forEach((record) => {
    const key = deriveHistoryGroupKey(record)
    if (!groupMap.has(key)) {
      groupMap.set(key, [])
    }
    groupMap.get(key)!.push(record)
  })
  const groups: HistoryGroup[] = []
  groupMap.forEach((groupRecords, key) => {
    const sortedRecords = groupRecords.slice().sort((a, b) => {
      const diff = getHistoryRecordTimestamp(b) - getHistoryRecordTimestamp(a)
      if (diff !== 0) {
        return diff
      }
      return (b.totalTransferred || 0) - (a.totalTransferred || 0)
    })
    const mainRecord = (selectHistoryMainRecord(sortedRecords) ?? sortedRecords[0])!
    const children = sortedRecords.filter((record) => record !== mainRecord)
    const urls = sortedRecords
      .map((record) => normalizePageUrl(record.pageUrl))
      .filter((value): value is string => Boolean(value))
    const updatedAt = sortedRecords.reduce(
      (maxTs, record) => Math.max(maxTs, getHistoryRecordTimestamp(record)),
      0,
    )
    const posterCandidate: PosterInfo | null =
      mainRecord.poster && mainRecord.poster.src
        ? mainRecord.poster
        : children.find((record) => record.poster && record.poster.src)?.poster || null
    groups.push({
      key,
      title: mainRecord.pageTitle || '未命名资源',
      origin: mainRecord.origin || '',
      poster: posterCandidate,
      updatedAt,
      records: sortedRecords,
      main: mainRecord,
      children,
      urls,
      seasonEntries: Array.isArray(mainRecord.seasonEntries) ? mainRecord.seasonEntries : [],
    })
  })
  groups.sort((a, b) => b.updatedAt - a.updatedAt)
  return groups
}

export function buildHistoryGroupSeasonRows(
  group: HistoryGroup | null | undefined,
): HistoryGroupSeasonRow[] {
  if (!group) {
    return []
  }
  const seasonEntries = Array.isArray(group.seasonEntries) ? group.seasonEntries : []
  const entryByUrl = new Map<string, SeasonEntry>()
  const entryById = new Map<string, SeasonEntry>()
  seasonEntries.forEach((entry, index) => {
    const normalizedUrl = normalizePageUrl(entry.url)
    const normalizedEntry: SeasonEntry = {
      seasonId: entry.seasonId || '',
      url: entry.url || '',
      label: entry.label || `季 ${index + 1}`,
      poster: entry.poster || null,
      completion: entry.completion || null,
      seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : index,
      loaded: Boolean(entry.loaded),
      hasItems: Boolean(entry.hasItems),
    }
    if (normalizedUrl) {
      entryByUrl.set(normalizedUrl, normalizedEntry)
    }
    if (normalizedEntry.seasonId) {
      entryById.set(normalizedEntry.seasonId, normalizedEntry)
    }
  })

  const rows: HistoryGroupSeasonRow[] = []
  const usedKeys = new Set<string>()
  const children = Array.isArray(group.children) ? group.children : []
  children.forEach((record, index) => {
    const normalizedUrl = normalizePageUrl(record.pageUrl)
    const seasonEntriesList = Array.isArray(record.seasonEntries) ? record.seasonEntries : []
    const entryFromUrl = normalizedUrl ? entryByUrl.get(normalizedUrl) : undefined
    const entryFromId =
      seasonEntriesList.length === 1
        ? entryById.get(seasonEntriesList[0]?.seasonId || '')
        : undefined
    const primaryEntry = entryFromUrl ?? entryFromId ?? null
    let label = primaryEntry?.label || ''
    if (!label && typeof record.pageUrl === 'string') {
      const seasonMatch = record.pageUrl.match(/\/seasons\/(\d+)\.html/)
      if (seasonMatch) {
        label = `第${seasonMatch[1]}季`
      }
    }
    if (!label) {
      label = record.pageTitle || `季 ${index + 1}`
    }
    const poster = record.poster || primaryEntry?.poster || null
    const completion = primaryEntry?.completion || record.completion || null
    let seasonId = primaryEntry?.seasonId || ''
    if (!seasonId && seasonEntriesList.length === 1) {
      seasonId = seasonEntriesList[0]?.seasonId || ''
    }
    let seasonIndex = Number.isFinite(primaryEntry?.seasonIndex)
      ? Number(primaryEntry?.seasonIndex)
      : Number.isFinite(index)
        ? index
        : 0
    if (!Number.isFinite(seasonIndex) && seasonEntriesList.length === 1) {
      const entry = seasonEntriesList[0]
      if (entry && Number.isFinite(entry.seasonIndex)) {
        seasonIndex = entry.seasonIndex
      }
    }
    if (!Number.isFinite(seasonIndex) && typeof record.pageUrl === 'string') {
      const seasonMatch = record.pageUrl.match(/\/seasons\/(\d+)\.html/)
      if (seasonMatch) {
        const parsed = parseInt(seasonMatch[1] || '', 10)
        if (Number.isFinite(parsed)) {
          seasonIndex = parsed
        }
      }
    }
    const key = normalizedUrl || seasonId || `${group.key}-child-${index}`
    usedKeys.add(key)
    rows.push({
      key,
      label,
      url: record.pageUrl,
      poster,
      completion,
      seasonId,
      seasonIndex: Number.isFinite(seasonIndex) ? Number(seasonIndex) : index,
      canCheck: true,
      record,
      recordTimestamp: getHistoryRecordTimestamp(record),
    })
  })

  seasonEntries.forEach((entry, index) => {
    const normalizedUrl = normalizePageUrl(entry.url)
    const key = normalizedUrl || entry.seasonId || `${group.key}-season-${index}`
    if (usedKeys.has(key)) {
      return
    }
    rows.push({
      key,
      label: entry.label || `季 ${index + 1}`,
      url: entry.url || '',
      poster: entry.poster || null,
      completion: entry.completion || null,
      seasonId: entry.seasonId || '',
      seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : index,
      canCheck: false,
      record: null,
      recordTimestamp: 0,
    })
  })

  rows.sort((a, b) => {
    if (a.seasonIndex === b.seasonIndex) {
      return a.label.localeCompare(b.label, 'zh-CN')
    }
    return a.seasonIndex - b.seasonIndex
  })
  return rows
}

export function getHistoryGroupMain(
  group: HistoryGroup | null | undefined,
): ContentHistoryRecord | null {
  if (!group || typeof group !== 'object') {
    return null
  }
  return group.main ?? null
}

export function getHistoryGroupCompletion(
  group: HistoryGroup | null | undefined,
): CompletionStatus | null {
  const main = getHistoryGroupMain(group)
  return main && main.completion ? main.completion : null
}

export function getHistoryGroupCompletionState(
  group: HistoryGroup | null | undefined,
): CompletionStatus['state'] {
  const completion = getHistoryGroupCompletion(group)
  return completion && completion.state ? completion.state : 'unknown'
}

export function isHistoryGroupCompleted(group: HistoryGroup | null | undefined): boolean {
  return getHistoryGroupCompletionState(group) === 'completed'
}

export function isHistoryGroupSeries(group: HistoryGroup | null | undefined): boolean {
  const main = getHistoryGroupMain(group)
  return Boolean(main && main.pageType === 'series')
}

export function isHistoryGroupMovie(group: HistoryGroup | null | undefined): boolean {
  const main = getHistoryGroupMain(group)
  return Boolean(main && main.pageType === 'movie')
}

export function canCheckHistoryGroup(group: HistoryGroup | null | undefined): boolean {
  if (!group) {
    return false
  }
  if (!isHistoryGroupSeries(group)) {
    return false
  }
  return !isHistoryGroupCompleted(group)
}

export function normalizeHistoryFilter(filter: unknown): HistoryFilter {
  return HISTORY_FILTERS.includes(filter as HistoryFilter) ? (filter as HistoryFilter) : 'all'
}

export interface HistoryFilterOptions {
  searchTerm?: string
}

function appendSearchCandidates(target: string[], value: unknown): void {
  if (typeof value !== 'string') {
    return
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return
  }
  target.push(trimmed)
  buildPinyinVariants(trimmed).forEach((variant) => {
    if (variant) {
      target.push(variant)
    }
  })
}

function buildPinyinVariants(value: string): string[] {
  const variants: string[] = []
  if (!value) {
    return variants
  }
  try {
    const tiny = getTinyPinyin()
    if (typeof tiny?.convertToPinyin !== 'function') {
      return variants
    }
    const spaced = tiny.convertToPinyin(value, ' ', true)
    const compact = tiny.convertToPinyin(value, '', true)
    if (spaced && spaced !== value) {
      variants.push(spaced)
      const initials = spaced
        .split(/\s+/)
        .map((part) => part.charAt(0))
        .join('')
      if (initials) {
        variants.push(initials)
        const alphaInitials = initials.replace(/[^a-z]/g, '')
        if (alphaInitials && alphaInitials !== initials) {
          variants.push(alphaInitials)
        }
      }
    }
    if (compact && compact !== value) {
      variants.push(compact)
      const alphaCompact = compact.replace(/[^a-z]/g, '')
      if (alphaCompact && alphaCompact !== compact) {
        variants.push(alphaCompact)
      }
    }
  } catch {
    // Ignore conversion failures and fall back to original text only
  }
  return variants
}

function buildHistoryGroupSearchCandidates(group: HistoryGroup | null | undefined): string[] {
  if (!group || typeof group !== 'object') {
    return []
  }
  const candidates: string[] = []
  appendSearchCandidates(candidates, group.title)
  appendSearchCandidates(candidates, group.origin)
  const main = getHistoryGroupMain(group)
  if (main) {
    appendSearchCandidates(candidates, main.pageTitle)
    appendSearchCandidates(candidates, main.pageUrl)
    appendSearchCandidates(candidates, main.targetDirectory)
    appendSearchCandidates(candidates, main.baseDir)
    appendSearchCandidates(candidates, main.completion?.label)
  }
  if (Array.isArray(group.urls)) {
    group.urls.forEach((url) => {
      appendSearchCandidates(candidates, url)
    })
  }
  if (Array.isArray(group.seasonEntries)) {
    group.seasonEntries.forEach((entry) => {
      if (!entry) {
        return
      }
      appendSearchCandidates(candidates, entry.label)
    })
  }
  const unique = new Set(
    candidates
      .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
      .filter(Boolean),
  )
  return Array.from(unique)
}

function matchesHistoryGroupSearch(group: HistoryGroup, tokens: string[]): boolean {
  if (!tokens.length) {
    return true
  }
  const haystack = buildHistoryGroupSearchCandidates(group)
  if (!haystack.length) {
    return false
  }
  return tokens.every((token) => haystack.some((candidate) => candidate.includes(token)))
}

export function filterHistoryGroups(
  groups: HistoryGroup[],
  filter: unknown = 'all',
  options: HistoryFilterOptions = {},
): HistoryGroup[] {
  const normalized = normalizeHistoryFilter(filter)
  const list = Array.isArray(groups) ? groups : []
  const searchInput = typeof options?.searchTerm === 'string' ? options.searchTerm : ''
  const tokens = searchInput.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return list.filter((group) => {
    let matchesFilter = false
    switch (normalized) {
      case 'series':
        matchesFilter = isHistoryGroupSeries(group)
        break
      case 'movie':
        matchesFilter = isHistoryGroupMovie(group)
        break
      case 'ongoing':
        matchesFilter = canCheckHistoryGroup(group)
        break
      case 'completed':
        matchesFilter = isHistoryGroupCompleted(group)
        break
      case 'all':
      default:
        matchesFilter = true
        break
    }
    if (!matchesFilter) {
      return false
    }
    return matchesHistoryGroupSearch(group, tokens)
  })
}

function toContentHistoryRecord(record: unknown): ContentHistoryRecord {
  const base: ContentHistoryRecord & Record<string, unknown> = {
    pageUrl: '',
    pageTitle: '',
    pageType: 'unknown',
    origin: '',
    siteProviderId: null,
    siteProviderLabel: null,
    poster: null,
    targetDirectory: '/',
    baseDir: '/',
    useTitleSubdir: false,
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
    ...(record || {}),
  } as ContentHistoryRecord & Record<string, unknown>

  if (!base.items || typeof base.items !== 'object') {
    base.items = {}
  }
  base.siteProviderId =
    typeof base.siteProviderId === 'string' && base.siteProviderId ? base.siteProviderId : null
  base.siteProviderLabel =
    typeof base.siteProviderLabel === 'string' && base.siteProviderLabel
      ? base.siteProviderLabel
      : null
  base.completion = normalizeHistoryCompletion(base.completion || null)
  base.seasonCompletion = normalizeSeasonCompletionMap(base.seasonCompletion || null)
  base.seasonDirectory = normalizeSeasonDirectory(base.seasonDirectory || null)
  base.useSeasonSubdir = Boolean(base.useSeasonSubdir)
  base.seasonEntries = normalizeHistorySeasonEntries(base.seasonEntries || [])
  if (!Array.isArray(base.itemOrder)) {
    base.itemOrder = []
  }
  if (typeof base.targetDirectory !== 'string' || !base.targetDirectory) {
    base.targetDirectory = '/'
  }
  if (typeof base.baseDir !== 'string' || !base.baseDir) {
    base.baseDir = '/'
  }
  return base as ContentHistoryRecord
}

export function prepareHistoryRecords(raw: unknown): HistoryRecordsPayload {
  if (!raw || typeof raw !== 'object') {
    return { records: [], groups: [] }
  }
  const candidate = raw as StoredHistorySnapshot
  const rawRecords = Array.isArray(candidate.records) ? candidate.records : []
  const records = rawRecords
    .map((item) => toContentHistoryRecord(item))
    .sort((a, b) => {
      const tsA = a.lastTransferredAt || a.lastCheckedAt || 0
      const tsB = b.lastTransferredAt || b.lastCheckedAt || 0
      return tsB - tsA
    })
  const groups = buildHistoryGroups(records)
  return { records, groups }
}

export interface HistoryMutationResponse {
  ok: boolean
  removed?: number
  total?: number
  error?: string
  [key: string]: unknown
}

function isHistoryMutationResponse(value: unknown): value is HistoryMutationResponse {
  if (!value || typeof value !== 'object') {
    return false
  }
  return 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean'
}

export async function deleteHistoryRecords(urls: string[] = []): Promise<HistoryMutationResponse> {
  if (!Array.isArray(urls) || urls.length === 0) {
    return { ok: true, removed: 0 }
  }
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'chaospace:history-delete',
      payload: { urls },
    })) as unknown
    if (!isHistoryMutationResponse(response) || !response.ok) {
      const message =
        isHistoryMutationResponse(response) && typeof response.error === 'string'
          ? response.error
          : '删除历史记录失败'
      throw new Error(message)
    }
    return response
  } catch (error) {
    chaosLogger.error('[Pan Transfer] Failed to delete history records', error)
    throw error
  }
}

export async function clearAllHistoryRecords(): Promise<HistoryMutationResponse> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'chaospace:history-clear',
    })) as unknown
    if (!isHistoryMutationResponse(response) || !response.ok) {
      const message =
        isHistoryMutationResponse(response) && typeof response.error === 'string'
          ? response.error
          : '清空历史记录失败'
      throw new Error(message)
    }
    return response
  } catch (error) {
    chaosLogger.error('[Pan Transfer] Failed to clear history', error)
    throw error
  }
}

export interface HistoryUpdateResponse {
  ok: boolean
  error?: Error | string
  [key: string]: unknown
}

function isHistoryUpdateResponsePayload(value: unknown): value is HistoryUpdateResponse {
  if (!value || typeof value !== 'object') {
    return false
  }
  return 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean'
}

export async function requestHistoryUpdate(pageUrl: string): Promise<HistoryUpdateResponse> {
  if (!pageUrl) {
    return { ok: false, error: new Error('缺少页面地址') }
  }
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'chaospace:check-updates',
      payload: { pageUrl },
    })) as unknown
    if (!isHistoryUpdateResponsePayload(response)) {
      return { ok: false, error: new Error('检测失败') }
    }
    if (!response.ok) {
      const errorValue = response.error
      const errorMessage =
        typeof errorValue === 'string'
          ? errorValue
          : errorValue instanceof Error
            ? errorValue.message
            : '检测失败'
      return { ok: false, error: new Error(errorMessage) }
    }
    return response
  } catch (error) {
    chaosLogger.error('[Pan Transfer] Failed to request history update', error)
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

export async function fetchHistorySnapshot(): Promise<HistoryRecordsPayload> {
  try {
    const rawHistory = await readHistoryFromStorage()
    return prepareHistoryRecords(rawHistory)
  } catch (error) {
    chaosLogger.error('[Pan Transfer] Failed to load history', error)
    return { records: [], groups: [] }
  }
}
