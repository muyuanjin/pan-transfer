import type {
  SiteProvider,
  SiteResourceCollection,
  SiteResourceItem,
  TransferContext,
} from '@/platform/registry'
import type { CompletionStatus } from '@/shared/utils/completion-status'
import { buildTransferPayloadFromSelection } from '../provider-utils'

export const GENERIC_FORUM_SITE_PROVIDER_ID = 'generic-forum'
const GENERIC_FORUM_PROVIDER_LABEL = 'Generic Forum'
const GENERIC_FORUM_MARKERS = [
  '[data-pan-provider="generic-forum"]',
  '[data-pan-provider-id="generic-forum"]',
]
const GENERIC_FORUM_RESOURCE_SELECTOR = '[data-pan-resource]'
const GENERIC_FORUM_THREAD_META_SELECTOR = 'meta[name="x-pan-transfer:thread"]'
const GENERIC_FORUM_HOST_PATTERN = /(?:genericforum\.dev|forum\.example|pan-transfer-forum\.test)$/i
const DEFAULT_CLASSIFICATION = 'forum-thread'

interface GenericForumThreadMeta {
  title?: string
  origin?: string
  tags?: string[] | string
  poster?: unknown
  classification?: string
  classificationDetail?: unknown
  deferredSeasons?: unknown
  seasonEntries?: unknown
  totalSeasons?: number
  loadedSeasons?: number
  completion?: CompletionStatus | null
  seasonCompletion?: Record<string, CompletionStatus | null>
}

interface GenericForumResourcePayload {
  id?: string
  title?: string
  linkUrl?: string
  passCode?: string
  tags?: string[] | string
  seasonId?: string
  seasonLabel?: string
  seasonIndex?: number
  sectionLabel?: string
}

export function createGenericForumSiteProvider(): SiteProvider {
  return {
    kind: 'site',
    id: GENERIC_FORUM_SITE_PROVIDER_ID,
    metadata: {
      id: GENERIC_FORUM_SITE_PROVIDER_ID,
      displayName: GENERIC_FORUM_PROVIDER_LABEL,
      description: 'Example provider that parses forum-style resources from custom data markers',
      supportedHosts: ['forum.example', 'genericforum.dev'],
      tags: ['example', 'forum', 'docs'],
      priority: 10,
    },
    capabilities: [
      {
        id: 'resource-collection',
        description: 'Collects resources described via data-pan-resource attributes',
      },
    ],
    async detect(context: TransferContext): Promise<boolean> {
      const url = resolveContextUrl(context)
      if (url && isGenericForumHost(url)) {
        return true
      }
      const documentRef = resolveContextDocument(context)
      if (!documentRef) {
        return false
      }
      return documentHasMarker(documentRef)
    },
    async collectResources(context: TransferContext): Promise<SiteResourceCollection> {
      const documentRef = resolveContextDocument(context)
      if (!documentRef) {
        throw new Error('Generic Forum provider 需要 document 环境才能采集资源')
      }
      const items = extractResourceItems(documentRef)
      const meta = buildCollectionMeta(documentRef, context)
      const collection: SiteResourceCollection = {
        items,
        meta,
      }
      if (!items.length) {
        collection.issues = ['未在泛论坛页面上找到任何 data-pan-resource 标记的资源']
      }
      return collection
    },
    buildTransferPayload(input) {
      return buildTransferPayloadFromSelection(input)
    },
  }
}

function resolveContextDocument(context: TransferContext): Document | null {
  if (context.document) {
    return context.document
  }
  if (typeof document !== 'undefined') {
    return document
  }
  return null
}

function resolveContextUrl(context: TransferContext): string | null {
  if (typeof context.url === 'string' && context.url.trim()) {
    return context.url.trim()
  }
  if (context.document && typeof context.document.URL === 'string') {
    return context.document.URL
  }
  if (typeof window !== 'undefined' && typeof window.location?.href === 'string') {
    return window.location.href
  }
  return null
}

function isGenericForumHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    return GENERIC_FORUM_HOST_PATTERN.test(parsed.hostname)
  } catch {
    return false
  }
}

function documentHasMarker(documentRef: Document): boolean {
  return GENERIC_FORUM_MARKERS.some((selector) => Boolean(documentRef.querySelector(selector)))
}

function extractResourceItems(documentRef: Document): SiteResourceItem[] {
  const elements = Array.from(
    documentRef.querySelectorAll<HTMLElement>(GENERIC_FORUM_RESOURCE_SELECTOR),
  )
  return elements
    .map((element, index) => normalizeResourceElement(element, index))
    .filter((item): item is SiteResourceItem => Boolean(item))
}

function normalizeResourceElement(element: HTMLElement, index: number): SiteResourceItem | null {
  const payload = readResourcePayload(element)
  const id = coerceString(payload.id) || `generic-forum-${index + 1}`
  const title =
    coerceString(payload.title) ||
    coerceString(element.getAttribute('data-pan-resource-title')) ||
    coerceString(element.textContent) ||
    `资源 ${index + 1}`
  const tags = normalizeTags(payload.tags ?? element.getAttribute('data-pan-resource-tags'))
  const resource: SiteResourceItem = {
    id,
    title,
  }
  if (payload.linkUrl && payload.linkUrl.trim()) {
    resource.linkUrl = payload.linkUrl.trim()
  }
  if (payload.passCode && payload.passCode.trim()) {
    resource.passCode = payload.passCode.trim()
  }
  if (tags.length) {
    resource.tags = tags
  }
  const meta: Record<string, unknown> = {}
  const seasonId = coerceString(payload.seasonId)
  if (seasonId) {
    meta['seasonId'] = seasonId
  }
  const seasonLabel = coerceString(payload.seasonLabel)
  if (seasonLabel) {
    meta['seasonLabel'] = seasonLabel
  }
  if (typeof payload.seasonIndex === 'number' && Number.isFinite(payload.seasonIndex)) {
    meta['seasonIndex'] = payload.seasonIndex
  }
  const sectionLabel = coerceString(payload.sectionLabel)
  if (sectionLabel) {
    meta['sectionLabel'] = sectionLabel
  }
  if (Object.keys(meta).length) {
    resource.meta = meta
  }
  return resource
}

function readResourcePayload(element: HTMLElement): GenericForumResourcePayload {
  const payload: GenericForumResourcePayload = {}
  const dataset = element.dataset ?? {}
  if (dataset['panResourceId']) {
    payload.id = dataset['panResourceId']
  }
  if (dataset['panResourceTitle']) {
    payload.title = dataset['panResourceTitle']
  }
  if (dataset['panResourceLink']) {
    payload.linkUrl = dataset['panResourceLink']
  }
  if (dataset['panResourcePasscode']) {
    payload.passCode = dataset['panResourcePasscode']
  }
  if (dataset['panResourceTags']) {
    payload.tags = dataset['panResourceTags']
  }
  if (dataset['panResourceSeasonId']) {
    payload.seasonId = dataset['panResourceSeasonId']
  }
  if (dataset['panResourceSeasonLabel']) {
    payload.seasonLabel = dataset['panResourceSeasonLabel']
  }
  if (
    dataset['panResourceSeasonIndex'] &&
    Number.isFinite(Number(dataset['panResourceSeasonIndex']))
  ) {
    payload.seasonIndex = Number(dataset['panResourceSeasonIndex'])
  }
  if (dataset['panResourceSection']) {
    payload.sectionLabel = dataset['panResourceSection']
  }
  const jsonPayload = element.getAttribute('data-pan-resource-json')
  if (jsonPayload) {
    const parsed = safeJsonParse(jsonPayload)
    if (parsed && typeof parsed === 'object') {
      Object.assign(payload, parsed as GenericForumResourcePayload)
    }
  }
  return payload
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => coerceString(entry))
      .filter((entry): entry is string => Boolean(entry))
  }
  const text = coerceString(value)
  if (!text) {
    return []
  }
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function buildCollectionMeta(
  documentRef: Document,
  context: TransferContext,
): Record<string, unknown> {
  const threadMeta = parseThreadMeta(documentRef)
  const resolvedUrl = normalizeThreadUrl(resolveContextUrl(context) ?? documentRef.URL ?? '')
  const pageTitle = threadMeta.title || documentRef.title || 'Generic Forum Thread'
  const origin = threadMeta.origin || resolveOrigin(resolvedUrl)
  const tags = normalizeTags(threadMeta.tags)
  const meta: Record<string, unknown> = {
    pageTitle,
    pageUrl: resolvedUrl,
    origin,
    classification: threadMeta.classification || DEFAULT_CLASSIFICATION,
    siteProviderId: GENERIC_FORUM_SITE_PROVIDER_ID,
    siteProviderLabel: GENERIC_FORUM_PROVIDER_LABEL,
  }
  if (threadMeta.classificationDetail !== undefined) {
    meta['classificationDetail'] = threadMeta.classificationDetail
  }
  if (threadMeta.poster) {
    meta['poster'] = threadMeta.poster
  }
  if (tags.length) {
    meta['tags'] = tags
  }
  if (threadMeta.deferredSeasons) {
    meta['deferredSeasons'] = threadMeta.deferredSeasons
  }
  if (threadMeta.seasonEntries) {
    meta['seasonEntries'] = threadMeta.seasonEntries
  }
  if (typeof threadMeta.totalSeasons === 'number' && Number.isFinite(threadMeta.totalSeasons)) {
    meta['totalSeasons'] = Math.max(0, threadMeta.totalSeasons)
  }
  if (typeof threadMeta.loadedSeasons === 'number' && Number.isFinite(threadMeta.loadedSeasons)) {
    meta['loadedSeasons'] = Math.max(0, threadMeta.loadedSeasons)
  }
  if (threadMeta.completion !== undefined) {
    meta['completion'] = threadMeta.completion
  }
  if (threadMeta.seasonCompletion) {
    meta['seasonCompletion'] = threadMeta.seasonCompletion
  }
  return meta
}

function parseThreadMeta(documentRef: Document): GenericForumThreadMeta {
  const metaTag = documentRef.head?.querySelector<HTMLMetaElement>(
    GENERIC_FORUM_THREAD_META_SELECTOR,
  )
  if (!metaTag) {
    return {}
  }
  const payload = metaTag.getAttribute('content')
  if (!payload) {
    return {}
  }
  const parsed = safeJsonParse(payload)
  if (!parsed || typeof parsed !== 'object') {
    return {}
  }
  return parsed as GenericForumThreadMeta
}

function normalizeThreadUrl(url: string | null | undefined): string {
  const candidate = typeof url === 'string' ? url.trim() : ''
  if (!candidate) {
    return ''
  }
  try {
    const parsed = new URL(
      candidate,
      candidate.startsWith('http') ? undefined : 'https://forum.example',
    )
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return candidate
  }
}

function resolveOrigin(url: string): string {
  if (!url) {
    return ''
  }
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

function safeJsonParse(payload: string): unknown {
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
