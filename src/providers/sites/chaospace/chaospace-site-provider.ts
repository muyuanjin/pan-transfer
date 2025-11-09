import type {
  SiteProvider,
  SiteResourceCollection,
  SiteResourceItem,
  TransferContext,
} from '@/platform/registry'
import type { TransferRequestPayload } from '@/shared/types/transfer'
import {
  analyzePage as analyzeChaospacePage,
  normalizePageUrl,
  isSeasonUrl,
  isTvShowUrl,
  type AnalyzePageOptions,
  type PageAnalysisResult,
} from './page-analyzer'
import type { ResourceItem } from '@/content/types'

export const CHAOSPACE_SITE_PROVIDER_ID = 'chaospace'
export const ANALYSIS_SNAPSHOT_KEY = 'analysisSnapshot'

const CHAOSPACE_HOST_PATTERN = /(?:^|\.)chaospace\.(?:cc|xyz)$/i

export interface ChaospaceSiteProviderOptions {
  analyzePage?: typeof analyzeChaospacePage
}

export function createChaospaceSiteProvider(
  options: ChaospaceSiteProviderOptions = {},
): SiteProvider {
  const analyzePage = options.analyzePage ?? analyzeChaospacePage

  return {
    kind: 'site',
    id: CHAOSPACE_SITE_PROVIDER_ID,
    metadata: {
      id: CHAOSPACE_SITE_PROVIDER_ID,
      displayName: 'CHAOSPACE',
      description: 'Parses Chaospace detail pages (tvshows/movies/seasons)',
      supportedHosts: ['chaospace.cc', 'chaospace.xyz'],
      tags: ['chaospace', 'tv', 'movie'],
      priority: 100,
    },
    capabilities: [
      {
        id: 'resource-collection',
        description: 'Collects Chaospace resource links and metadata',
      },
    ],
    async detect(context: TransferContext): Promise<boolean> {
      const candidateUrl = resolveContextUrl(context)
      if (!candidateUrl) {
        return false
      }
      return isChaospaceDetailUrl(candidateUrl)
    },
    async collectResources(context: TransferContext): Promise<SiteResourceCollection> {
      const result = await analyzePage(extractAnalysisOptions(context))
      const collection = mapAnalysisToCollection(result)
      const issues = [...(collection.issues ?? [])]
      if (!collection.items.length) {
        issues.push('未在 CHAOSPACE 页面上找到可用资源')
      }
      if (issues.length) {
        collection.issues = issues
      }
      return collection
    },
    buildTransferPayload(input) {
      return buildTransferPayloadFromSelection(input)
    },
  }
}

function extractAnalysisOptions(context: TransferContext): AnalyzePageOptions | undefined {
  const extras = context.extras
  if (!extras || typeof extras !== 'object') {
    return undefined
  }
  const candidate = (extras as Record<string, unknown>)['analysisOptions']
  return candidate && typeof candidate === 'object' ? (candidate as AnalyzePageOptions) : undefined
}

function resolveContextUrl(context: TransferContext): string | null {
  if (context.url && typeof context.url === 'string') {
    return context.url
  }
  if (context.document && typeof context.document.URL === 'string') {
    return context.document.URL
  }
  if (typeof window !== 'undefined' && typeof window.location?.href === 'string') {
    return window.location.href
  }
  return null
}

function isChaospaceDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!CHAOSPACE_HOST_PATTERN.test(parsed.hostname)) {
      return false
    }
    const normalizedHref = `${parsed.origin}${parsed.pathname}`.toLowerCase()
    return (
      isTvShowUrl(normalizedHref) ||
      isSeasonUrl(normalizedHref) ||
      normalizedHref.includes('/movies/')
    )
  } catch {
    return false
  }
}

function mapAnalysisToCollection(result: PageAnalysisResult): SiteResourceCollection {
  return {
    items: result.items.map(mapResourceItem),
    meta: {
      pageTitle: result.title,
      pageUrl: normalizePageUrl(result.url),
      origin: result.origin,
      classification: result.classification,
      completion: result.completion,
      seasonCompletion: result.seasonCompletion,
      deferredSeasons: result.deferredSeasons,
      totalSeasons: result.totalSeasons,
      loadedSeasons: result.loadedSeasons,
      seasonEntries: result.seasonEntries,
      poster: result.poster,
      classificationDetail: result.classificationDetail,
      siteProviderId: result.providerId || CHAOSPACE_SITE_PROVIDER_ID,
      siteProviderLabel: result.providerLabel || 'CHAOSPACE',
      [ANALYSIS_SNAPSHOT_KEY]: result,
    },
  }
}

function mapResourceItem(item: ResourceItem): SiteResourceItem {
  const normalizedId =
    typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : undefined
  const fallbackTitle =
    typeof item.order === 'number' && Number.isFinite(item.order)
      ? `资源 ${item.order}`
      : '未命名资源'
  const title =
    typeof item.title === 'string' && item.title.trim() ? item.title.trim() : fallbackTitle
  const tags = new Set<string>()
  if (item.quality) {
    tags.add(item.quality)
  }
  if (item.subtitle) {
    tags.add(item.subtitle)
  }
  if (item.seasonLabel) {
    tags.add(item.seasonLabel)
  }
  const resource: SiteResourceItem = {
    id: normalizedId || `${item.seasonId ?? 'chaospace'}-${item.order ?? Date.now()}`,
    title,
    tags: Array.from(tags).filter(Boolean),
    meta: {
      order: item.order,
      seasonId: item.seasonId,
      seasonLabel: item.seasonLabel,
      seasonIndex: item.seasonIndex,
      seasonUrl: item.seasonUrl,
      seasonCompletion: item.seasonCompletion,
    },
  }
  if (typeof item.linkUrl === 'string' && item.linkUrl.trim()) {
    resource.linkUrl = item.linkUrl
  }
  if (typeof item.passCode === 'string' && item.passCode.trim()) {
    resource.passCode = item.passCode
  }
  return resource
}

function buildTransferPayloadFromSelection(input: {
  context: TransferContext
  selection: SiteResourceItem[]
}): TransferRequestPayload {
  const fallbackUrl =
    typeof window !== 'undefined' && typeof window.location?.href === 'string'
      ? window.location.href
      : ''
  const pageUrl = normalizePageUrl(input.context.url || fallbackUrl)
  const items = input.selection.map((item) => {
    const payload: TransferRequestPayload['items'][number] = {
      id: item.id,
      title: item.title,
    }
    if (typeof item.linkUrl === 'string' && item.linkUrl.trim()) {
      payload.linkUrl = item.linkUrl
    }
    if (typeof item.passCode === 'string' && item.passCode.trim()) {
      payload.passCode = item.passCode
    }
    return payload
  })
  const extras = input.context.extras ?? {}
  const resolvedPageTitle =
    typeof extras['pageTitle'] === 'string' ? (extras['pageTitle'] as string) : undefined
  const resolvedOrigin =
    typeof extras['origin'] === 'string' ? (extras['origin'] as string) : undefined
  const meta: TransferRequestPayload['meta'] = {
    total: items.length,
  }
  if (pageUrl) {
    meta.pageUrl = pageUrl
  }
  if (resolvedPageTitle) {
    meta.pageTitle = resolvedPageTitle
  }
  const payload: TransferRequestPayload = {
    items,
    meta,
  }
  if (resolvedOrigin) {
    payload.origin = resolvedOrigin
  }
  return payload
}
