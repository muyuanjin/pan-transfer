import { createApp, reactive, type App } from 'vue'
import HistoryDetailOverlay from './HistoryDetailOverlay.vue'
import type { HistoryGroup, ContentHistoryRecord, HistoryDetailDomRefs } from '../types'
import type { ContentStore } from '../state'
import { pinia } from '../state'

export type { HistoryDetailDomRefs } from '../types'

export interface HistoryDetailPoster {
  src: string
  alt?: string
}

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

export interface HistoryDetailStill {
  full: string
  thumb: string
  alt: string
  url: string
}

export interface HistoryDetailData {
  title: string
  poster: HistoryDetailPoster | null
  releaseDate: string
  country: string
  runtime: string
  rating: HistoryDetailRating | null
  genres: string[]
  info: HistoryDetailInfoEntry[]
  synopsis: string
  stills: HistoryDetailStill[]
  pageUrl?: string
}

export type HistoryDetailFallback = HistoryDetailData

export interface HistoryDetailOverrides extends Partial<HistoryDetailData> {}

export interface HistoryDetailOverlayOptions {
  onClose?: () => void
}

export interface RenderHistoryDetailParams {
  state: ContentStore
  detailDom: HistoryDetailDomRefs
  getHistoryGroupByKey: ((key: string) => HistoryGroup | null | undefined) | undefined
  onClose: (() => void) | undefined
}

interface HistoryDetailOverlayState {
  visible: boolean
  loading: boolean
  error: string
  data: HistoryDetailData | null
  fallback: HistoryDetailData | null
}

const overlayState = reactive<HistoryDetailOverlayState>({
  visible: false,
  loading: false,
  error: '',
  data: null,
  fallback: null,
})

let overlayApp: App<Element> | null = null
let overlayHost: HTMLElement | null = null
let currentCloseHandler: (() => void) | undefined

export function buildHistoryDetailFallback(
  group: HistoryGroup | null,
  overrides: HistoryDetailOverrides = {},
): HistoryDetailFallback {
  if (!group) {
    return {
      title: typeof overrides.title === 'string' && overrides.title ? overrides.title : '转存记录',
      poster: overrides.poster && overrides.poster.src ? overrides.poster : null,
      releaseDate: typeof overrides.releaseDate === 'string' ? overrides.releaseDate : '',
      country: typeof overrides.country === 'string' ? overrides.country : '',
      runtime: typeof overrides.runtime === 'string' ? overrides.runtime : '',
      rating: null,
      genres: Array.isArray(overrides.genres) ? overrides.genres.slice(0, 12) : [],
      info: Array.isArray(overrides.info) ? overrides.info.slice(0, 12) : [],
      synopsis: typeof overrides.synopsis === 'string' ? overrides.synopsis : '',
      stills: Array.isArray(overrides.stills) ? overrides.stills.slice(0, 12) : [],
      pageUrl: typeof overrides.pageUrl === 'string' ? overrides.pageUrl : '',
    }
  }

  const mainRecord = (group.main ?? {}) as ContentHistoryRecord & Record<string, unknown>
  const posterCandidate =
    group.poster && group.poster.src
      ? group.poster
      : mainRecord.poster && typeof (mainRecord.poster as { src?: string }).src === 'string'
        ? (mainRecord.poster as HistoryDetailPoster)
        : null
  const title =
    group.title ||
    (typeof mainRecord.pageTitle === 'string' ? mainRecord.pageTitle : '') ||
    '转存记录'
  const pageUrl = typeof mainRecord.pageUrl === 'string' ? mainRecord.pageUrl : ''

  const fallback: HistoryDetailData = {
    title,
    poster: posterCandidate,
    releaseDate: '',
    country: '',
    runtime: '',
    rating: null,
    genres: [],
    info: [],
    synopsis: '',
    stills: [],
    pageUrl,
  }

  ;(Object.keys(overrides) as (keyof HistoryDetailOverrides)[]).forEach((key) => {
    const value = overrides[key]
    if (value === undefined || value === null) {
      return
    }
    if (key === 'poster' && value && (value as HistoryDetailPoster).src) {
      const posterOverride = value as HistoryDetailPoster
      fallback.poster = {
        src: posterOverride.src,
        alt: posterOverride.alt || fallback.title || '',
      }
      return
    }
    if (key === 'genres' && Array.isArray(value)) {
      fallback.genres = (value as string[]).slice(0, 12)
      return
    }
    if (key === 'info' && Array.isArray(value)) {
      fallback.info = (value as HistoryDetailInfoEntry[]).slice(0, 12)
      return
    }
    if (key === 'stills' && Array.isArray(value)) {
      fallback.stills = (value as HistoryDetailStill[]).slice(0, 12)
      return
    }
    if (key === 'rating' && value && typeof value === 'object') {
      fallback.rating = value as HistoryDetailRating
      return
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      switch (key) {
        case 'title':
          fallback.title = trimmed || fallback.title
          break
        case 'releaseDate':
          fallback.releaseDate = trimmed
          break
        case 'country':
          fallback.country = trimmed
          break
        case 'runtime':
          fallback.runtime = trimmed
          break
        case 'synopsis':
          fallback.synopsis = trimmed
          break
        case 'pageUrl':
          fallback.pageUrl = trimmed
          break
        default:
          break
      }
    }
  })

  return fallback
}

export function normalizeHistoryDetailResponse(
  rawDetail: unknown,
  fallback?: HistoryDetailFallback,
): HistoryDetailData {
  const safeFallback = fallback || buildHistoryDetailFallback(null)
  const detail =
    rawDetail && typeof rawDetail === 'object' ? (rawDetail as Record<string, unknown>) : {}

  const normalizeString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : ''

  const posterInput = detail['poster']
  const normalizedPoster =
    posterInput && typeof posterInput === 'object' && (posterInput as { src?: string }).src
      ? (posterInput as HistoryDetailPoster)
      : safeFallback.poster

  const ratingInput = detail['rating']
  const normalizedRating =
    ratingInput && typeof ratingInput === 'object' && (ratingInput as { value?: unknown }).value
      ? {
          value: normalizeString((ratingInput as { value?: unknown }).value),
          votes: normalizeString((ratingInput as { votes?: unknown }).votes),
          label: normalizeString((ratingInput as { label?: unknown }).label),
          scale: Number.isFinite((ratingInput as { scale?: unknown }).scale)
            ? Number((ratingInput as { scale?: unknown }).scale)
            : 10,
        }
      : null

  const genres = Array.isArray(detail['genres'])
    ? Array.from(
        new Set((detail['genres'] as unknown[]).map(normalizeString).filter(Boolean)),
      ).slice(0, 12)
    : []

  const info = Array.isArray(detail['info'])
    ? (detail['info'] as unknown[])
        .map((entry) => {
          const item = entry && typeof entry === 'object' ? (entry as HistoryDetailInfoEntry) : null
          const label = normalizeString(item?.label)
          const value = normalizeString(item?.value)
          return label && value ? { label, value } : null
        })
        .filter((entry): entry is HistoryDetailInfoEntry => Boolean(entry))
        .slice(0, 12)
    : []

  const stills = Array.isArray(detail['stills'])
    ? (detail['stills'] as unknown[])
        .map((still) => {
          if (!still || typeof still !== 'object') {
            return null
          }
          const record = still as Record<string, unknown>
          const full = normalizeString(record['full'])
          const url = normalizeString(record['url'])
          const thumb = normalizeString(record['thumb'])
          const alt = normalizeString(record['alt']) || safeFallback.title
          const resolvedFull = full || url || thumb
          const resolvedThumb = thumb || url || full
          if (!resolvedFull && !resolvedThumb) {
            return null
          }
          return {
            full: resolvedFull || resolvedThumb,
            thumb: resolvedThumb || resolvedFull,
            alt,
            url: url || resolvedFull || resolvedThumb,
          }
        })
        .filter((entry): entry is HistoryDetailStill => Boolean(entry))
        .slice(0, 12)
    : []

  const normalized: HistoryDetailData = {
    title: normalizeString(detail['title']) || safeFallback.title,
    poster: normalizedPoster,
    releaseDate: normalizeString(detail['releaseDate']),
    country: normalizeString(detail['country']),
    runtime: normalizeString(detail['runtime']),
    rating: normalizedRating,
    genres,
    info,
    synopsis: normalizeString(detail['synopsis']),
    stills,
    pageUrl: normalizeString(detail['pageUrl']) || safeFallback.pageUrl || '',
  }

  if (!normalized.poster && safeFallback.poster?.src) {
    normalized.poster = safeFallback.poster
  }
  if (!normalized.releaseDate && safeFallback.releaseDate) {
    normalized.releaseDate = safeFallback.releaseDate
  }
  if (!normalized.country && safeFallback.country) {
    normalized.country = safeFallback.country
  }
  if (!normalized.runtime && safeFallback.runtime) {
    normalized.runtime = safeFallback.runtime
  }
  if (!normalized.synopsis && safeFallback.synopsis) {
    normalized.synopsis = safeFallback.synopsis
  }
  if (!normalized.genres.length && safeFallback.genres.length) {
    normalized.genres = safeFallback.genres.slice()
  }
  if (!normalized.info.length && safeFallback.info.length) {
    normalized.info = safeFallback.info.slice()
  }
  if (!normalized.stills.length && safeFallback.stills.length) {
    normalized.stills = safeFallback.stills.slice()
  }

  return normalized
}

export function ensureHistoryDetailOverlay(
  detailDom: HistoryDetailDomRefs,
  options: HistoryDetailOverlayOptions = {},
): void {
  currentCloseHandler = options.onClose

  if (overlayApp) {
    return
  }

  const host = document.createElement('div')
  host.className = 'chaospace-history-detail-host'
  document.body.appendChild(host)
  overlayHost = host

  const handleClose = () => {
    if (typeof currentCloseHandler === 'function') {
      currentCloseHandler()
    }
  }

  overlayApp = createApp(HistoryDetailOverlay, {
    state: overlayState,
    onClose: handleClose,
  })
  overlayApp.use(pinia)
  overlayApp.mount(host)

  assignDetailDomRefs(detailDom)
}

export function renderHistoryDetail(params: RenderHistoryDetailParams): void {
  const { state, detailDom, getHistoryGroupByKey, onClose } = params
  const overlayOptions: HistoryDetailOverlayOptions = {}
  if (onClose) {
    overlayOptions.onClose = onClose
  }
  const detailState = state.historyDetail
  const overlayExists = Boolean(detailDom.backdrop)
  if (!detailState.isOpen && !overlayExists) {
    document.body.classList.remove('chaospace-history-detail-active')
    return
  }
  ensureHistoryDetailOverlay(detailDom, overlayOptions)

  const overlay = detailDom.backdrop
  if (!overlay) {
    return
  }

  if (detailDom.hideTimer) {
    clearTimeout(detailDom.hideTimer)
    detailDom.hideTimer = null
  }

  if (!detailState.isOpen) {
    overlayState.visible = false
    overlayState.loading = false
    overlayState.error = ''
    if (!overlay.hasAttribute('hidden')) {
      detailDom.hideTimer = window.setTimeout(() => {
        if (!state.historyDetail.isOpen && overlay) {
          overlay.setAttribute('hidden', 'true')
        }
        detailDom.hideTimer = null
      }, 200)
    } else {
      overlay.setAttribute('hidden', 'true')
    }
    document.body.classList.remove('chaospace-history-detail-active')
    return
  }

  overlay.removeAttribute('hidden')
  overlayState.visible = true
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      overlayState.visible = true
    })
  }
  document.body.classList.add('chaospace-history-detail-active')

  const group =
    typeof getHistoryGroupByKey === 'function' ? getHistoryGroupByKey(detailState.groupKey) : null
  const fallback = detailState.fallback
    ? (detailState.fallback as HistoryDetailData)
    : buildHistoryDetailFallback(group ?? null)

  overlayState.loading = Boolean(detailState.loading)
  overlayState.error = detailState.error || ''
  overlayState.data = detailState.data ? (detailState.data as HistoryDetailData) : null
  overlayState.fallback = fallback

  assignDetailDomRefs(detailDom)
}

function assignDetailDomRefs(detailDom: HistoryDetailDomRefs): void {
  if (!overlayHost) {
    return
  }
  const backdrop = overlayHost.querySelector('[data-role="history-detail-backdrop"]')
  detailDom.backdrop = backdrop as HTMLElement | null
  detailDom.modal = overlayHost.querySelector(
    '[data-role="history-detail-modal"]',
  ) as HTMLElement | null
  detailDom.close = overlayHost.querySelector(
    '[data-role="history-detail-close"]',
  ) as HTMLElement | null
  detailDom.poster = overlayHost.querySelector(
    '[data-role="history-detail-poster"]',
  ) as HTMLElement | null
  detailDom.title = overlayHost.querySelector(
    '[data-role="history-detail-title"]',
  ) as HTMLElement | null
  detailDom.date = overlayHost.querySelector(
    '[data-role="history-detail-date"]',
  ) as HTMLElement | null
  detailDom.country = overlayHost.querySelector(
    '[data-role="history-detail-country"]',
  ) as HTMLElement | null
  detailDom.runtime = overlayHost.querySelector(
    '[data-role="history-detail-runtime"]',
  ) as HTMLElement | null
  detailDom.rating = overlayHost.querySelector(
    '[data-role="history-detail-rating"]',
  ) as HTMLElement | null
  detailDom.genres = overlayHost.querySelector(
    '[data-role="history-detail-genres"]',
  ) as HTMLElement | null
  detailDom.info = overlayHost.querySelector(
    '[data-role="history-detail-info"]',
  ) as HTMLElement | null
  detailDom.synopsis = overlayHost.querySelector(
    '[data-role="history-detail-synopsis"]',
  ) as HTMLElement | null
  detailDom.stills = overlayHost.querySelector(
    '[data-role="history-detail-stills"]',
  ) as HTMLElement | null
  detailDom.body = overlayHost.querySelector(
    '[data-role="history-detail-body"]',
  ) as HTMLElement | null
  detailDom.loading = overlayHost.querySelector(
    '[data-role="history-detail-loading"]',
  ) as HTMLElement | null
  detailDom.error = overlayHost.querySelector(
    '[data-role="history-detail-error"]',
  ) as HTMLElement | null
}
