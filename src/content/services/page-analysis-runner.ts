import { chaosLogger } from '@/shared/log'
import type { TransferContext, SiteResourceCollection, SiteResourceItem } from '@/platform/registry'
import { TransferPipeline, type TransferPipelineOptions } from '@/core/transfer'
import { getContentProviderRegistry } from '@/content/providers/registry'
import {
  analyzePage as analyzeChaospacePage,
  type AnalyzePageOptions,
  type PageAnalysisResult,
} from '@/providers/sites/chaospace/page-analyzer'
import {
  ANALYSIS_SNAPSHOT_KEY,
  CHAOSPACE_SITE_PROVIDER_ID,
} from '@/providers/sites/chaospace/chaospace-site-provider'
import type { ResourceItem } from '@/content/types'
import type { PosterInfo } from '@/shared/utils/sanitizers'
import type { CompletionStatus } from '@/shared/utils/completion-status'

export interface PageAnalysisRunner {
  analyzePage: (options?: PageAnalysisRequestOptions) => Promise<PageAnalysisResult>
}

export interface PageAnalysisRunnerOptions {
  document: Document
  window: Window & typeof globalThis
  getProviderPreferences?: () => ProviderPreferenceSnapshot | null
  getManualSiteProviderId?: () => string | null
}

interface ProviderPreferenceSnapshot {
  disabledSiteProviderIds?: ReadonlyArray<string>
  preferredSiteProviderId?: string | null
  preferredStorageProviderId?: string | null
}

export interface PageAnalysisRequestOptions extends AnalyzePageOptions {
  siteProviderId?: string | null
}

export function createPageAnalysisRunner(options: PageAnalysisRunnerOptions): PageAnalysisRunner {
  const registry = getContentProviderRegistry()
  let pipeline: TransferPipeline | null = null

  const getPipeline = (): TransferPipeline => {
    if (!pipeline) {
      const pipelineOptions: TransferPipelineOptions = {
        registry,
      }
      if (typeof options.getProviderPreferences === 'function') {
        pipelineOptions.getProviderPreferences = options.getProviderPreferences
      }
      pipeline = new TransferPipeline(pipelineOptions)
    }
    return pipeline
  }

  const analyzeWithProviders = async (
    analysisOptions?: PageAnalysisRequestOptions,
  ): Promise<PageAnalysisResult> => {
    const { siteProviderId, ...legacyOptions } = analysisOptions ?? {}
    const context: TransferContext = {
      url: options.window.location?.href,
      document: options.document,
      timestamp: Date.now(),
    }
    if (legacyOptions && Object.keys(legacyOptions).length > 0) {
      context.extras = { analysisOptions: legacyOptions }
    }
    const forcedProviderId = resolveForcedProviderId(
      typeof siteProviderId === 'string' ? siteProviderId : null,
      options.getManualSiteProviderId,
    )
    if (forcedProviderId) {
      context.siteProviderId = forcedProviderId
      const forcedProvider = registry.getSiteProvider(forcedProviderId)
      if (forcedProvider) {
        try {
          const matched = await forcedProvider.detect(context)
          if (matched) {
            const collection = await forcedProvider.collectResources(context)
            const snapshot = extractAnalysisSnapshot(collection)
            if (snapshot) {
              return ensureProviderMetadata(snapshot)
            }
            return ensureProviderMetadata(convertCollectionToAnalysis(collection, options.window))
          }
        } catch (error) {
          const err = error as Error
          chaosLogger.warn('[Pan Transfer] 手动指定 Provider 解析失败，回退自动检测', {
            providerId: forcedProviderId,
            message: err?.message,
          })
        }
      }
    }

    try {
      const provider = await getPipeline().detectSiteProvider(context)
      if (!provider) {
        chaosLogger.debug('[Pan Transfer] 未匹配到站点 Provider，回退到 CHAOSPACE 解析', {
          url: context.url ?? options.window.location?.href,
        })
        return ensureProviderMetadata(await analyzeChaospacePage(legacyOptions))
      }
      const collection = await provider.collectResources(context)
      const snapshot = extractAnalysisSnapshot(collection)
      if (snapshot) {
        return ensureProviderMetadata(snapshot)
      }
      return ensureProviderMetadata(convertCollectionToAnalysis(collection, options.window))
    } catch (error) {
      const err = error as Error
      chaosLogger.warn('[Pan Transfer] Provider-backed analysis failed, using legacy analyzer', {
        message: err?.message,
      })
      return ensureProviderMetadata(await analyzeChaospacePage(legacyOptions))
    }
  }

  return {
    analyzePage: analyzeWithProviders,
  }
}

function resolveForcedProviderId(
  requestedId: string | null,
  getManualSiteProviderId?: () => string | null,
): string | null {
  if (requestedId && requestedId.trim()) {
    return requestedId.trim()
  }
  const manualId = typeof getManualSiteProviderId === 'function' ? getManualSiteProviderId() : null
  if (manualId && manualId.trim()) {
    return manualId.trim()
  }
  return null
}

function extractAnalysisSnapshot(collection: SiteResourceCollection): PageAnalysisResult | null {
  const meta = collection.meta
  if (!meta || typeof meta !== 'object') {
    return null
  }
  const snapshot = (meta as Record<string, unknown>)[ANALYSIS_SNAPSHOT_KEY]
  return snapshot && typeof snapshot === 'object' ? (snapshot as PageAnalysisResult) : null
}

function convertCollectionToAnalysis(
  collection: SiteResourceCollection,
  windowRef: Window & typeof globalThis,
): PageAnalysisResult {
  const meta = collection.meta ?? {}
  const coerceString = (value: unknown, fallback = ''): string =>
    typeof value === 'string' && value.trim() ? value : fallback
  const coercePoster = (value: unknown): PosterInfo | null => (value as PosterInfo | null) ?? null
  const coerceCompletion = (value: unknown): CompletionStatus | null =>
    (value as CompletionStatus | null) ?? null
  const classify = (meta['classification'] as PageAnalysisResult['classification']) ?? 'unknown'
  const classificationDetail =
    (meta['classificationDetail'] as PageAnalysisResult['classificationDetail']) ?? null
  const providerId =
    typeof meta['siteProviderId'] === 'string'
      ? (meta['siteProviderId'] as string)
      : CHAOSPACE_SITE_PROVIDER_ID
  const providerLabel =
    typeof meta['siteProviderLabel'] === 'string'
      ? (meta['siteProviderLabel'] as string)
      : 'CHAOSPACE'

  return {
    items: collection.items.map(mapSiteResourceToContentResource),
    url: coerceString(meta['pageUrl'], windowRef.location?.href || ''),
    origin: coerceString(meta['origin'], windowRef.location?.origin || ''),
    title: coerceString(meta['pageTitle']),
    poster: coercePoster(meta['poster']),
    completion: coerceCompletion(meta['completion']),
    seasonCompletion: (meta['seasonCompletion'] as Record<string, CompletionStatus>) ?? {},
    deferredSeasons: (meta['deferredSeasons'] as PageAnalysisResult['deferredSeasons']) ?? [],
    totalSeasons: Number(meta['totalSeasons']) || 0,
    loadedSeasons: Number(meta['loadedSeasons']) || 0,
    seasonEntries: (meta['seasonEntries'] as PageAnalysisResult['seasonEntries']) ?? [],
    classification: classify,
    classificationDetail,
    providerId,
    providerLabel,
  }
}

function mapSiteResourceToContentResource(item: SiteResourceItem): ResourceItem {
  const meta = (item.meta ?? {}) as Record<string, unknown>
  const coerceNumber = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  const coerceString = (value: unknown): string | null =>
    typeof value === 'string' && value ? value : null
  const resource: ResourceItem = {
    id: item.id,
    title: item.title,
    order: coerceNumber(meta['order']),
  }
  const seasonId = coerceString(meta['seasonId'])
  if (seasonId) {
    resource.seasonId = seasonId
  }
  const seasonLabel = coerceString(meta['seasonLabel'])
  if (seasonLabel) {
    resource.seasonLabel = seasonLabel
  }
  if (typeof meta['seasonIndex'] === 'number') {
    resource.seasonIndex = meta['seasonIndex'] as number
  }
  const seasonUrl = coerceString(meta['seasonUrl'])
  if (seasonUrl) {
    resource.seasonUrl = seasonUrl
  }
  if (meta['seasonCompletion'] !== undefined) {
    resource.seasonCompletion = (meta['seasonCompletion'] as CompletionStatus | null) ?? null
  }
  if (typeof item.linkUrl === 'string' && item.linkUrl) {
    resource.linkUrl = item.linkUrl
  }
  if (typeof item.passCode === 'string' && item.passCode) {
    resource.passCode = item.passCode
  }
  if (Array.isArray(item.tags)) {
    const tags = item.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)
    if (tags.length) {
      resource.tags = Array.from(new Set(tags))
    }
  }
  return resource
}

function ensureProviderMetadata(result: PageAnalysisResult): PageAnalysisResult {
  if (!result.providerId) {
    result.providerId = CHAOSPACE_SITE_PROVIDER_ID
  }
  if (!result.providerLabel) {
    result.providerLabel = 'CHAOSPACE'
  }
  return result
}
