import { chaosLogger } from '@/shared/log'
import {
  ensureHistoryLoaded,
  ensureHistoryRecordStructure,
  getHistoryIndexMap,
  normalizeHistoryPath,
  persistHistoryNow,
} from '../storage/history-store'
import type { SiteProvider } from '@/platform/registry'
import type { HistoryDetail, SiteHistorySnapshot } from '@/shared/types/history'
import {
  mergeCompletionStatus,
  mergeSeasonCompletionMap,
  normalizeSeasonEntries,
  type CompletionStatus,
} from '@/shared/utils/completion-status'
import { dispatchTransferPayload } from '../providers/pipeline'
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
  const entry = historyIndex.get(pageUrl)
  const record = entry?.record ? ensureHistoryRecordStructure(entry.record) : null
  const providerInfo = await resolveHistoryRecordProvider(record, pageUrl)
  const detail = await collectHistoryDetailForPage(pageUrl, providerInfo)
  return {
    ok: true,
    pageUrl,
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
  const entry = historyIndex.get(pageUrl)
  if (!entry || !entry.record) {
    throw new Error('未找到该页面的历史记录')
  }
  const record = ensureHistoryRecordStructure(entry.record)
  const knownIds = new Set(Object.keys(record.items || {}))
  const timestamp = nowTs()
  const providerInfo = await resolveHistoryRecordProvider(record, pageUrl)
  let snapshot: SiteHistorySnapshot
  try {
    snapshot = await collectHistorySnapshotForRecord(pageUrl, record, providerInfo)
  } catch (error) {
    chaosLogger.info('[Pan Transfer] Provider snapshot unavailable, skipping history update', {
      pageUrl,
      providerId: providerInfo.providerId,
      error,
    })
    record.lastCheckedAt = timestamp
    await persistHistoryNow()
    return {
      ok: true,
      hasUpdates: false,
      pageUrl,
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

  if (record.completion && record.completion.state === 'completed') {
    record.lastCheckedAt = timestamp
    await persistHistoryNow()
    return {
      ok: true,
      hasUpdates: false,
      pageUrl,
      pageTitle: snapshot.pageTitle || record.pageTitle || '',
      totalKnown: knownIds.size,
      latestCount: snapshot.items.length,
      reason: 'completed',
      completion: record.completion,
    }
  }

  if (!newItems.length) {
    record.lastCheckedAt = timestamp
    await persistHistoryNow()
    return {
      ok: true,
      hasUpdates: false,
      pageUrl,
      pageTitle: snapshot.pageTitle || record.pageTitle || '',
      totalKnown: knownIds.size,
      latestCount: snapshot.items.length,
      completion: record.completion,
    }
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

  const jobId = `update-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const meta: TransferJobMeta & { trigger: string; total: number } = {
    baseDir: normalizeHistoryPath(record.baseDir || targetDirectory),
    useTitleSubdir: false,
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
      targetPath: targetDirectory,
      linkUrl: item.linkUrl || '',
      passCode: item.passCode || '',
    })),
    targetDirectory,
    meta,
  }

  const { response: transferResult } = await dispatchTransferPayload(transferPayload)

  const updateResult: CheckUpdatesResult = {
    ok: true,
    hasUpdates: true,
    pageUrl,
    pageTitle: meta.pageTitle || '',
    newItems: newItems.length,
    summary: transferResult.summary,
    results: transferResult.results || [],
    completion: record.completion,
    totalKnown: knownIds.size,
    latestCount: snapshot.items.length,
  }
  if (transferResult.jobId) {
    updateResult.jobId = transferResult.jobId
  }
  return updateResult
}
