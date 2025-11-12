import { chaosLogger } from '@/shared/log'
import {
  ensureHistoryLoaded,
  ensureHistoryRecordStructure,
  getHistoryIndexMap,
  normalizeHistoryPath,
  persistHistoryNow,
} from '../storage/history-store'
import type { SiteProvider } from '@/platform/registry'
import type {
  HistoryDetail,
  HistorySnapshotItem,
  SiteHistorySnapshot,
} from '@/shared/types/history'
import {
  mergeCompletionStatus,
  mergeSeasonCompletionMap,
  normalizeSeasonEntries,
  type CompletionStatus,
} from '@/shared/utils/completion-status'
import { canonicalizePageUrl } from '@/shared/utils/url'
import { getBackgroundProviderRegistry } from '../providers/registry'
import { CHAOSPACE_SITE_PROVIDER_ID } from '@/providers/sites/chaospace/chaospace-site-provider'
import type {
  HistoryRecord,
  TransferRequestPayload,
  TransferResultEntry,
  TransferJobMeta,
} from '@/shared/types/transfer'

interface HistoryProviderDescriptor {
  providerId: string | null
  providerLabel: string | null
  provider?: SiteProvider | null
}

const nowTs = (): number => Date.now()
const SEASON_URL_PATTERN = /\/seasons\/(\d+)\.html/i

const coerceSeasonId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

const matchSeasonIdFromUrl = (url: string | null | undefined): string | null => {
  if (!url) {
    return null
  }
  const match = SEASON_URL_PATTERN.exec(url)
  return match?.[1] || null
}

const normalizeHistoryLookupKey = (url: string | null | undefined): string | null => {
  if (typeof url !== 'string') {
    return null
  }
  return canonicalizePageUrl(url, { allowFallback: false })
}

const buildSeasonIdHints = (record: HistoryRecord, snapshot: SiteHistorySnapshot): string[] => {
  const hints = new Set<string>()
  const add = (candidate: unknown): void => {
    const id = coerceSeasonId(candidate)
    if (id) {
      hints.add(id)
    }
  }
  add(matchSeasonIdFromUrl(snapshot.pageUrl || record.pageUrl))
  ;(snapshot.seasonEntries || []).forEach((entry) => add(entry?.seasonId))
  ;(record.seasonEntries || []).forEach((entry) => add(entry?.seasonId))
  Object.keys(record.seasonDirectory || {}).forEach((key) => add(key))
  return Array.from(hints)
}

const joinSeasonPath = (baseDir: string, segment: string): string => {
  const normalizedBase = normalizeHistoryPath(baseDir || '/', '/')
  const cleanedSegment = segment
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/g, '')
    .replace(/\/+$/g, '')
  if (!cleanedSegment) {
    return normalizedBase
  }
  return normalizedBase === '/' ? `/${cleanedSegment}` : `${normalizedBase}/${cleanedSegment}`
}

const resolveSeasonDirectoryPath = (
  record: HistoryRecord,
  seasonId: string,
  defaultTarget: string,
): string | null => {
  if (!record.seasonDirectory || !seasonId) {
    return null
  }
  const raw = record.seasonDirectory[seasonId]
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.startsWith('/')) {
    return normalizeHistoryPath(trimmed, defaultTarget || '/')
  }
  return joinSeasonPath(defaultTarget || '/', trimmed)
}

const computeHistoryItemTargetPath = (
  item: HistorySnapshotItem,
  record: HistoryRecord,
  defaultTarget: string,
  seasonHints: string[],
): string => {
  if (!record.useSeasonSubdir) {
    return defaultTarget
  }
  const candidates: string[] = []
  const seasonId = coerceSeasonId((item as { seasonId?: string }).seasonId)
  if (seasonId) {
    candidates.push(seasonId)
  }
  seasonHints.forEach((id) => {
    if (!seasonId || id !== seasonId) {
      candidates.push(id)
    }
  })
  for (const candidate of candidates) {
    const mapped = resolveSeasonDirectoryPath(record, candidate, defaultTarget)
    if (mapped) {
      return mapped
    }
  }
  return defaultTarget
}

interface HistoryDetailPayload {
  pageUrl?: string
}

export async function handleHistoryDetail(payload: HistoryDetailPayload = {}): Promise<{
  ok: true
  pageUrl: string
  detail: HistoryDetail
}> {
  const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl : ''
  if (!pageUrl) {
    throw new Error('缺少页面地址')
  }
  await ensureHistoryLoaded()
  const historyIndex = getHistoryIndexMap()
  const lookupKey = normalizeHistoryLookupKey(pageUrl)
  const entry = lookupKey ? historyIndex.get(lookupKey) : undefined
  const record = entry?.record ? ensureHistoryRecordStructure(entry.record) : null
  const providerInfo = await resolveHistoryRecordProvider(record, pageUrl)
  const detail = await collectHistoryDetailForPage(pageUrl, providerInfo)
  return {
    ok: true,
    pageUrl: record?.pageUrl || pageUrl,
    detail,
  }
}

interface CheckUpdatesPayload extends HistoryDetailPayload {
  targetDirectory?: string
}

export interface CheckUpdatesResult {
  ok: true
  hasUpdates: boolean
  pageUrl: string
  pageTitle: string
  totalKnown: number
  latestCount: number
  reason?: string
  completion?: CompletionStatus | null
  newItems?: number
  summary?: string
  results?: TransferResultEntry[]
  jobId?: string
}

const normalizeProviderField = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

async function detectProviderForUrl(
  pageUrl: string,
  registry = getBackgroundProviderRegistry(),
): Promise<HistoryProviderDescriptor | null> {
  if (!pageUrl) {
    return null
  }
  for (const provider of registry.listSiteProviders()) {
    try {
      const detected = await provider.detect({ url: pageUrl })
      if (detected) {
        return {
          providerId: provider.id,
          providerLabel: provider.metadata.displayName || provider.id,
          provider,
        }
      }
    } catch (error) {
      chaosLogger.warn('[Pan Transfer] Site provider detection failed for history update', {
        providerId: provider.id,
        pageUrl,
        error,
      })
    }
  }
  return null
}

async function resolveHistoryRecordProvider(
  record: HistoryRecord | null,
  pageUrl: string,
): Promise<HistoryProviderDescriptor> {
  const declaredId = normalizeProviderField(record?.siteProviderId)
  const declaredLabel = normalizeProviderField(record?.siteProviderLabel)
  const registry = getBackgroundProviderRegistry()

  if (declaredId) {
    const provider = registry.getSiteProvider(declaredId)
    return {
      providerId: declaredId,
      providerLabel: declaredLabel || provider?.metadata.displayName || declaredId,
      provider,
    }
  }

  const detected = await detectProviderForUrl(pageUrl, registry)
  if (detected) {
    return detected
  }

  const chaosProvider = registry.getSiteProvider(CHAOSPACE_SITE_PROVIDER_ID)
  return {
    providerId: chaosProvider ? CHAOSPACE_SITE_PROVIDER_ID : null,
    providerLabel: chaosProvider?.metadata.displayName || declaredLabel,
    provider: chaosProvider,
  }
}

type SnapshotCollector = (
  pageUrl: string,
  record: HistoryRecord,
  providerInfo: HistoryProviderDescriptor,
) => Promise<SiteHistorySnapshot>

let snapshotCollectorOverride: SnapshotCollector | null = null

export const historyServiceTestHooks = {
  setSnapshotCollector(collector: SnapshotCollector | null): void {
    snapshotCollectorOverride = collector
  },
}

function getSnapshotCollector(): SnapshotCollector {
  return snapshotCollectorOverride ?? collectHistorySnapshotForRecord
}

async function collectHistorySnapshotForRecord(
  pageUrl: string,
  record: HistoryRecord,
  providerInfo: HistoryProviderDescriptor,
): Promise<SiteHistorySnapshot> {
  const provider = providerInfo.provider ?? resolveProviderInstance(providerInfo.providerId)
  if (provider?.collectHistorySnapshot) {
    return provider.collectHistorySnapshot({ pageUrl, historyRecord: record })
  }
  if (!providerInfo.providerId || providerInfo.providerId === CHAOSPACE_SITE_PROVIDER_ID) {
    const chaosProvider = resolveProviderInstance(CHAOSPACE_SITE_PROVIDER_ID)
    if (chaosProvider?.collectHistorySnapshot) {
      return chaosProvider.collectHistorySnapshot({ pageUrl, historyRecord: record })
    }
  }
  throw new Error('provider-snapshot-unavailable')
}

async function collectHistoryDetailForPage(
  pageUrl: string,
  providerInfo: HistoryProviderDescriptor,
): Promise<HistoryDetail> {
  const provider = providerInfo.provider ?? resolveProviderInstance(providerInfo.providerId)
  if (provider?.collectHistoryDetail) {
    return provider.collectHistoryDetail({ pageUrl })
  }
  if (!providerInfo.providerId || providerInfo.providerId === CHAOSPACE_SITE_PROVIDER_ID) {
    const chaosProvider = resolveProviderInstance(CHAOSPACE_SITE_PROVIDER_ID)
    if (chaosProvider?.collectHistoryDetail) {
      return chaosProvider.collectHistoryDetail({ pageUrl })
    }
  }
  throw new Error('provider-detail-unavailable')
}

function resolveProviderInstance(
  providerId: string | null,
  registry = getBackgroundProviderRegistry(),
): SiteProvider | null {
  if (!providerId) {
    return null
  }
  return registry.getSiteProvider(providerId)
}

export async function handleCheckUpdates(
  payload: CheckUpdatesPayload = {},
): Promise<CheckUpdatesResult> {
  const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl : ''
  if (!pageUrl) {
    throw new Error('缺少页面地址')
  }
  await ensureHistoryLoaded()
  const historyIndex = getHistoryIndexMap()
  const lookupKey = normalizeHistoryLookupKey(pageUrl)
  const entry = lookupKey ? historyIndex.get(lookupKey) : undefined
  if (!entry || !entry.record) {
    throw new Error('未找到该页面的历史记录')
  }
  const record = entry.record
  const knownIds = new Set(Object.keys(record.items || {}))
  const timestamp = nowTs()
  const providerInfo = await resolveHistoryRecordProvider(record, pageUrl)
  chaosLogger.info('[Pan Transfer] Detection started', {
    pageUrl: record.pageUrl || pageUrl,
    providerId: providerInfo.providerId,
    knownItems: knownIds.size,
  })
  let snapshot: SiteHistorySnapshot
  try {
    snapshot = await getSnapshotCollector()(pageUrl, record, providerInfo)
  } catch (error) {
    chaosLogger.info('[Pan Transfer] Provider snapshot unavailable, skipping history update', {
      pageUrl: record.pageUrl || pageUrl,
      providerId: providerInfo.providerId,
      error,
    })
    record.lastCheckedAt = timestamp
    await persistHistoryNow()
    return {
      ok: true,
      hasUpdates: false,
      pageUrl: record.pageUrl || pageUrl,
      pageTitle: record.pageTitle || '',
      totalKnown: knownIds.size,
      latestCount: knownIds.size,
      reason: 'unsupported-provider',
      completion: record.completion,
    }
  }
  const normalizedProviderId =
    snapshot.providerId || providerInfo.providerId || CHAOSPACE_SITE_PROVIDER_ID
  const normalizedProviderLabel =
    snapshot.providerLabel ||
    providerInfo.providerLabel ||
    (normalizedProviderId === CHAOSPACE_SITE_PROVIDER_ID ? 'CHAOSPACE' : null)

  if (!record.siteProviderId && normalizedProviderId) {
    record.siteProviderId = normalizedProviderId
  }
  if (!record.siteProviderLabel && normalizedProviderLabel) {
    record.siteProviderLabel = normalizedProviderLabel
  }

  if (snapshot.completion) {
    record.completion = mergeCompletionStatus(
      record.completion,
      snapshot.completion,
      timestamp,
      snapshot.completion.source || 'snapshot',
    )
  }
  if (snapshot.seasonCompletion && typeof snapshot.seasonCompletion === 'object') {
    record.seasonCompletion = mergeSeasonCompletionMap(
      record.seasonCompletion,
      snapshot.seasonCompletion,
      timestamp,
      'snapshot',
    )
  }
  if (Array.isArray(snapshot.seasonEntries) && snapshot.seasonEntries.length) {
    const normalizedEntries = normalizeSeasonEntries(snapshot.seasonEntries)
    if (normalizedEntries.length) {
      record.seasonEntries = normalizedEntries
    }
  }

  const newItems = snapshot.items.filter((item) => !knownIds.has(String(item.id)))
  const hasNewItems = newItems.length > 0

  if (!hasNewItems) {
    record.lastCheckedAt = timestamp
    await persistHistoryNow()
    chaosLogger.info('[Pan Transfer] Detection finished with no updates', {
      pageUrl: record.pageUrl || pageUrl,
      providerId: normalizedProviderId,
      knownItems: knownIds.size,
      latestCount: snapshot.items.length,
    })
    const result: CheckUpdatesResult = {
      ok: true,
      hasUpdates: false,
      pageUrl,
      pageTitle: snapshot.pageTitle || record.pageTitle || '',
      totalKnown: knownIds.size,
      latestCount: snapshot.items.length,
      completion: record.completion,
    }
    if (record.completion && record.completion.state === 'completed') {
      result.reason = 'completed'
    }
    return result
  }

  const targetDirectory = normalizeHistoryPath(
    record.targetDirectory || payload.targetDirectory || '/',
  )
  let origin = record.origin
  if (!origin) {
    try {
      const url = new URL(pageUrl)
      origin = `${url.protocol}//${url.host}`
    } catch {
      origin = record.origin || ''
    }
  }

  const seasonHints = buildSeasonIdHints(record, snapshot)
  const jobId = `update-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const meta: TransferJobMeta & { trigger: string; total: number } = {
    baseDir: normalizeHistoryPath(record.baseDir || targetDirectory),
    useTitleSubdir: Boolean(record.useTitleSubdir),
    useSeasonSubdir: Boolean(record.useSeasonSubdir),
    pageTitle: snapshot.pageTitle || record.pageTitle || '',
    pageUrl,
    pageType: record.pageType || snapshot.pageType || 'series',
    targetDirectory,
    completion: snapshot.completion || record.completion || null,
    seasonCompletion: snapshot.seasonCompletion || record.seasonCompletion || {},
    poster: record.poster || null,
    trigger: 'history-update',
    total: newItems.length,
  }
  if (
    record.useSeasonSubdir &&
    record.seasonDirectory &&
    Object.keys(record.seasonDirectory).length
  ) {
    meta.seasonDirectory = { ...record.seasonDirectory }
  }
  const snapshotSeasonEntries = Array.isArray(snapshot.seasonEntries) ? snapshot.seasonEntries : []
  if (snapshotSeasonEntries.length) {
    meta.seasonEntries = snapshotSeasonEntries.slice()
  } else if (Array.isArray(record.seasonEntries) && record.seasonEntries.length) {
    meta.seasonEntries = record.seasonEntries.slice()
  }
  const providerIdForMeta = snapshot.providerId || normalizedProviderId
  const providerLabelForMeta = snapshot.providerLabel || normalizedProviderLabel
  if (providerIdForMeta) {
    meta.siteProviderId = providerIdForMeta
  }
  if (providerLabelForMeta) {
    meta.siteProviderLabel = providerLabelForMeta
  }

  const transferPayload: TransferRequestPayload = {
    jobId,
    origin: origin || '',
    items: newItems.map((item) => ({
      id: item.id,
      title: item.title,
      targetPath: computeHistoryItemTargetPath(item, record, targetDirectory, seasonHints),
      linkUrl: item.linkUrl || '',
      passCode: item.passCode || '',
    })),
    targetDirectory,
    meta,
  }

  record.lastCheckedAt = timestamp
  record.pendingTransfer = {
    jobId,
    detectedAt: timestamp,
    summary: `检测到 ${newItems.length} 项待转存`,
    newItemIds: newItems.map((item) => item.id),
    payload: transferPayload,
  }
  await persistHistoryNow()

  chaosLogger.info('[Pan Transfer] Detection staged new items (no transfer enqueued)', {
    pageUrl: record.pageUrl || pageUrl,
    providerId: normalizedProviderId,
    jobId,
    stagedItems: newItems.length,
    targetDirectory,
  })

  const updateResult: CheckUpdatesResult = {
    ok: true,
    hasUpdates: true,
    pageUrl: record.pageUrl || pageUrl,
    pageTitle: meta.pageTitle || '',
    newItems: newItems.length,
    summary: `检测到 ${newItems.length} 项，等待转存`,
    completion: record.completion,
    totalKnown: knownIds.size,
    latestCount: snapshot.items.length,
    jobId,
  }
  return updateResult
}
