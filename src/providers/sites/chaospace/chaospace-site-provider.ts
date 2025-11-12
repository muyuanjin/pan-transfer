import type {
  SiteHistoryDetailInput,
  SiteHistorySnapshotInput,
  SiteProvider,
  SiteResourceCollection,
  SiteResourceItem,
  TransferContext,
} from '@/platform/registry'
import { summarizeSeasonCompletion, type CompletionStatus } from '@/shared/utils/completion-status'
import type { HistoryDetail, SiteHistorySnapshot } from '@/shared/types/history'
import { chaosLogger } from '@/shared/log'
import {
  analyzePage as analyzeChaospacePage,
  normalizePageUrl,
  isSeasonUrl,
  isTvShowUrl,
  type AnalyzePageOptions,
  type PageAnalysisResult,
} from './page-analyzer'
import {
  parseItemsFromHtml,
  parsePageTitleFromHtml,
  parseTvShowSeasonCompletionFromHtml,
  parseCompletionFromHtml,
  parseTvShowSeasonEntriesFromHtml,
  parseHistoryDetailFromHtml,
  parseLinkPage,
  type LinkParseResult,
} from './parser-service'
import type { ResourceItem } from '@/content/types'
import { buildTransferPayloadFromSelection } from '../provider-utils'

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
    async buildTransferPayload(input) {
      const payload = buildTransferPayloadFromSelection(input, {
        resolvePageUrl: (context, fallbackUrl) => normalizePageUrl(context.url || fallbackUrl),
      })
      const hydratedDetails = await hydrateShareDetailsForSelection(input.selection, input.context)
      if (!hydratedDetails.size) {
        return payload
      }
      payload.items = payload.items.map((item) => {
        const normalizedId = normalizeResourceId(item.id)
        if (!normalizedId) {
          return item
        }
        const detail = hydratedDetails.get(normalizedId)
        if (!detail) {
          return item
        }
        const next = { ...item }
        if (detail.linkUrl) {
          next.linkUrl = detail.linkUrl
        }
        if (detail.passCode) {
          next.passCode = detail.passCode
        }
        return next
      })
      return payload
    },
    async collectHistorySnapshot(input: SiteHistorySnapshotInput) {
      const normalizedUrl = normalizeBackgroundPageUrl(input.pageUrl)
      if (!normalizedUrl) {
        throw new Error('缺少页面地址')
      }
      if (!isChaospaceDetailUrl(normalizedUrl)) {
        throw new Error('页面不属于 CHAOSPACE，无法刷新历史记录')
      }
      return collectChaospaceHistorySnapshot(normalizedUrl, input.historyRecord ?? null)
    },
    async collectHistoryDetail(input: SiteHistoryDetailInput) {
      const normalizedUrl = normalizeBackgroundPageUrl(input.pageUrl)
      if (!normalizedUrl) {
        throw new Error('缺少页面地址')
      }
      if (!isChaospaceDetailUrl(normalizedUrl)) {
        throw new Error('页面不属于 CHAOSPACE，无法解析详情')
      }
      return collectChaospaceHistoryDetail(normalizedUrl)
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

interface HydratedShareDetail {
  linkUrl?: string
  passCode?: string
}

const BAIDU_SHARE_HOST_PATTERN = /pan\.baidu\.com/i

async function hydrateShareDetailsForSelection(
  selection: SiteResourceItem[],
  context: TransferContext,
): Promise<Map<string, HydratedShareDetail>> {
  const hydrated = new Map<string, HydratedShareDetail>()
  for (const item of selection) {
    const normalizedId = normalizeResourceId(item.id)
    if (!normalizedId) {
      continue
    }
    const linkUrl = typeof item.linkUrl === 'string' ? item.linkUrl.trim() : ''
    const passCode = typeof item.passCode === 'string' ? item.passCode.trim() : ''
    if (isBaiduShareLink(linkUrl)) {
      hydrated.set(normalizedId, { linkUrl, passCode })
      continue
    }
    if (!linkUrl) {
      continue
    }
    const detailUrl = resolveDetailUrl(linkUrl, context)
    if (!detailUrl || !detailUrl.includes('/links/')) {
      continue
    }
    const detail = await fetchShareDetail(detailUrl)
    if (!detail) {
      continue
    }
    hydrated.set(normalizedId, {
      linkUrl: detail.linkUrl,
      passCode: detail.passCode || passCode,
    })
  }
  return hydrated
}

function isBaiduShareLink(linkUrl: string | null | undefined): boolean {
  if (!linkUrl) {
    return false
  }
  return BAIDU_SHARE_HOST_PATTERN.test(linkUrl)
}

function normalizeResourceId(id: unknown): string | null {
  if (typeof id === 'string' && id.trim()) {
    return id.trim()
  }
  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id)
  }
  return null
}

function resolveDetailUrl(linkUrl: string, context: TransferContext): string | null {
  const baseUrl =
    (typeof context.url === 'string' && context.url) ||
    (typeof window !== 'undefined' && typeof window.location?.href === 'string'
      ? window.location.href
      : '')
  try {
    const resolved = baseUrl ? new URL(linkUrl, baseUrl) : new URL(linkUrl)
    resolved.hash = ''
    return resolved.toString()
  } catch {
    return linkUrl || null
  }
}

async function fetchShareDetail(detailUrl: string): Promise<LinkParseResult | null> {
  try {
    const response = await fetch(detailUrl, { credentials: 'include' })
    if (!response.ok) {
      chaosLogger.warn('[Pan Transfer] Chaospace detail request failed', {
        detailUrl,
        status: response.status,
      })
      return null
    }
    const html = await response.text()
    const parsed = parseLinkPage(html)
    if (!parsed || !parsed.linkUrl) {
      chaosLogger.warn('[Pan Transfer] Chaospace detail missing Baidu share link', { detailUrl })
      return null
    }
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    chaosLogger.warn('[Pan Transfer] Failed to hydrate Chaospace share link', {
      detailUrl,
      message,
    })
    return null
  }
}

async function collectChaospaceHistorySnapshot(
  pageUrl: string,
  historyRecord: SiteHistorySnapshotInput['historyRecord'],
): Promise<SiteHistorySnapshot> {
  const html = await fetchChaospacePageHtml(pageUrl)
  const historyItems = buildHistoryItemLookup(historyRecord)
  const items = parseItemsFromHtml(html, historyItems)
  const pageTitle = parsePageTitleFromHtml(html)
  const pageType: SiteHistorySnapshot['pageType'] = items.length > 1 ? 'series' : 'movie'
  const seasonCompletion: Record<string, CompletionStatus> = isTvShowUrl(pageUrl)
    ? parseTvShowSeasonCompletionFromHtml(html)
    : {}
  let completion: CompletionStatus | null = null
  if (isSeasonUrl(pageUrl)) {
    completion = parseCompletionFromHtml(html, 'season-meta')
    if (completion) {
      const seasonIdMatch = pageUrl.match(/\/seasons\/(\d+)\.html/)
      const seasonId = seasonIdMatch?.[1]
      if (seasonId) {
        seasonCompletion[seasonId] = completion
      }
    }
  } else if (isTvShowUrl(pageUrl)) {
    completion = summarizeSeasonCompletion(Object.values(seasonCompletion))
  } else {
    completion = parseCompletionFromHtml(html, 'detail-meta')
  }
  if (!completion && Object.keys(seasonCompletion).length) {
    completion = summarizeSeasonCompletion(Object.values(seasonCompletion))
  }

  const seasonEntries: SiteHistorySnapshot['seasonEntries'] = isTvShowUrl(pageUrl)
    ? parseTvShowSeasonEntriesFromHtml(html, pageUrl).map((entry, idx) => ({
        seasonId: entry.seasonId,
        url: entry.url,
        label: entry.label,
        seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : idx,
        poster: entry.poster || null,
        completion: seasonCompletion[entry.seasonId] || entry.completion || null,
      }))
    : []

  return {
    pageUrl,
    pageTitle,
    pageType,
    total: items.length,
    items,
    completion,
    seasonCompletion,
    seasonEntries,
    providerId: CHAOSPACE_SITE_PROVIDER_ID,
    providerLabel: 'CHAOSPACE',
  }
}

async function collectChaospaceHistoryDetail(pageUrl: string): Promise<HistoryDetail> {
  const html = await fetchChaospacePageHtml(pageUrl)
  return parseHistoryDetailFromHtml(html, pageUrl)
}

async function fetchChaospacePageHtml(pageUrl: string): Promise<string> {
  const response = await fetch(pageUrl, { credentials: 'include' })
  if (!response.ok) {
    throw new Error(`获取页面失败：${response.status}`)
  }
  return response.text()
}

function buildHistoryItemLookup(
  historyRecord: SiteHistorySnapshotInput['historyRecord'],
): Record<string, { linkUrl?: string; passCode?: string }> {
  if (!historyRecord || !historyRecord.items) {
    return {}
  }
  const result: Record<string, { linkUrl?: string; passCode?: string }> = {}
  Object.entries(historyRecord.items).forEach(([itemId, item]) => {
    if (!itemId || !item) {
      return
    }
    const linkUrl = typeof item.linkUrl === 'string' ? item.linkUrl : null
    const passCode = typeof item.passCode === 'string' ? item.passCode : null
    const entry: { linkUrl?: string; passCode?: string } = {}
    if (linkUrl) {
      entry.linkUrl = linkUrl
    }
    if (passCode) {
      entry.passCode = passCode
    }
    if (entry.linkUrl || entry.passCode) {
      result[itemId] = entry
    }
  })
  return result
}

function normalizeBackgroundPageUrl(url: string | null | undefined): string {
  const candidate = typeof url === 'string' ? url.trim() : ''
  if (!candidate) {
    return ''
  }
  try {
    const normalized = new URL(
      candidate,
      candidate.startsWith('http') ? undefined : 'https://chaospace.cc',
    )
    normalized.hash = ''
    return normalized.toString()
  } catch {
    return candidate
  }
}
