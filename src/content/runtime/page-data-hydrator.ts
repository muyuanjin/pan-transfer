import { state } from '../state'
import type { DeferredSeasonInfo, ResourceItem } from '../types'
import {
  normalizePageUrl,
  sanitizeSeasonDirSegment,
  suggestDirectoryFromClassification,
} from '@/providers/sites/chaospace/page-analyzer'
import { rebuildSeasonDirMap, updateSeasonExampleDir } from '../services/season-manager'
import {
  normalizeHistoryCompletion,
  normalizeSeasonCompletionMap,
  normalizeSeasonEntries,
  summarizeSeasonCompletion,
  type CompletionStatusInput,
  type SeasonEntryInput,
} from '@/shared/utils/completion-status'
import { sanitizePosterInfo, type PosterInput } from '@/shared/utils/sanitizers'

interface PageAnalysisMeta {
  title?: string
  url?: string
  origin?: string
  poster?: PosterInput
  completion?: CompletionStatusInput
  seasonCompletion?: Record<string, CompletionStatusInput> | null
  seasonEntries?: SeasonEntryInput[] | null
  classification?: string
  classificationDetail?: unknown
  totalSeasons?: number
  loadedSeasons?: number
  providerId?: string
  providerLabel?: string
}

export interface PageDataHydrator {
  normalizeDeferredSeasons: (input: unknown) => DeferredSeasonInfo[]
  hydrate: (
    items: ResourceItem[],
    deferredSeasons: DeferredSeasonInfo[],
    meta: PageAnalysisMeta,
  ) => void
}

export function createPageDataHydrator(): PageDataHydrator {
  const normalizeDeferredSeasons = (input: unknown): DeferredSeasonInfo[] => {
    if (!Array.isArray(input)) {
      return []
    }
    return input
      .map((info) => {
        if (!info || typeof info !== 'object') {
          return null
        }
        const record = info as DeferredSeasonInfo
        const normalizedLabel =
          sanitizeSeasonDirSegment(record.label || '') ||
          (typeof record.label === 'string' && record.label.trim()) ||
          (Number.isFinite(record.index) ? `第${Number(record.index) + 1}季` : '')
        return {
          ...record,
          label: normalizedLabel,
        }
      })
      .filter(Boolean) as DeferredSeasonInfo[]
  }

  const hydrate = (
    items: ResourceItem[],
    deferredSeasons: DeferredSeasonInfo[],
    meta: PageAnalysisMeta,
  ): void => {
    state.pageTitle = meta.title || ''
    state.pageUrl = normalizePageUrl(meta.url || window.location.href)
    state.origin = meta.origin || window.location.origin
    state.activeSiteProviderId = typeof meta.providerId === 'string' ? meta.providerId : null
    state.activeSiteProviderLabel =
      typeof meta.providerLabel === 'string' ? meta.providerLabel : null

    const normalizedPoster = sanitizePosterInfo(meta.poster)
    state.poster = normalizedPoster

    state.completion = normalizeHistoryCompletion(meta.completion) || null
    state.seasonCompletion = normalizeSeasonCompletionMap(meta.seasonCompletion ?? null)
    const normalizedEntries = normalizeSeasonEntries(meta.seasonEntries ?? [])
    state.seasonEntries = normalizedEntries.map((entry, index) => {
      const normalizedLabel =
        sanitizeSeasonDirSegment(entry.label) ||
        (Number.isFinite(entry.seasonIndex) ? `第${entry.seasonIndex + 1}季` : `第${index + 1}季`)
      return {
        ...entry,
        label: normalizedLabel,
      }
    })

    state.classification = meta.classification || 'unknown'
    state.classificationDetails = meta.classificationDetail || null
    state.autoSuggestedDir = suggestDirectoryFromClassification(
      state.classificationDetails || state.classification,
    )

    state.items = items.map((item, index) => {
      const normalizedLabel =
        sanitizeSeasonDirSegment(item.seasonLabel || '') ||
        (Number.isFinite(item.seasonIndex) ? `第${Number(item.seasonIndex) + 1}季` : '')
      const nextItem = {
        ...item,
        order: typeof item.order === 'number' ? item.order : index,
      }
      if (normalizedLabel) {
        nextItem.seasonLabel = normalizedLabel
      } else if ('seasonLabel' in nextItem) {
        delete (nextItem as { seasonLabel?: string }).seasonLabel
      }
      return nextItem
    })

    state.itemIdSet = new Set(state.items.map((item) => item.id))
    state.selectedIds = new Set(state.items.map((item) => item.id))

    rebuildSeasonDirMap({ preserveExisting: false })
    updateSeasonExampleDir()

    state.deferredSeasonInfos = deferredSeasons

    const totalInput = typeof meta.totalSeasons === 'number' ? meta.totalSeasons : NaN
    const loadedInput = typeof meta.loadedSeasons === 'number' ? meta.loadedSeasons : NaN
    const declaredTotal = Number.isFinite(totalInput) ? Math.max(0, totalInput) : 0
    const declaredLoaded = Number.isFinite(loadedInput) ? Math.max(0, loadedInput) : 0

    let totalSeasons = declaredTotal
    if (!totalSeasons && (declaredLoaded || deferredSeasons.length)) {
      totalSeasons = declaredLoaded + deferredSeasons.length
    }
    let loadedSeasons = declaredLoaded
    if (!loadedSeasons && totalSeasons) {
      loadedSeasons = Math.max(0, totalSeasons - deferredSeasons.length)
    }
    if (loadedSeasons > totalSeasons) {
      loadedSeasons = totalSeasons
    }

    state.seasonLoadProgress = {
      total: totalSeasons,
      loaded: loadedSeasons,
    }
    state.isSeasonLoading = state.deferredSeasonInfos.length > 0
    state.lastResult = null
    state.transferStatus = 'idle'
    state.statusMessage = '准备就绪 ✨'
    state.activeSeasonId = null

    const completionEntries = Object.values(state.seasonCompletion || {}).filter(Boolean)
    if (completionEntries.length) {
      state.completion = summarizeSeasonCompletion(completionEntries)
    }
  }

  return {
    normalizeDeferredSeasons,
    hydrate,
  }
}
