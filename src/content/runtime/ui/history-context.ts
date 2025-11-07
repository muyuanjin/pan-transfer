import { inject, type InjectionKey } from 'vue'
import type { createHistoryController } from '../../history/controller'
import { buildPanDirectoryUrl } from '../../services/page-analyzer'
import type { HistoryDetailOverrides as HistoryDetailOverridesInput } from '../../components/history-detail'
import { useContentStore } from '../../state'

export type HistoryController = ReturnType<typeof createHistoryController>

export interface HistoryListActionHandlers {
  setHistorySelection: (groupKey: string, selected: boolean) => void
  setHistorySeasonExpanded: (groupKey: string, expanded: boolean) => void
  openHistoryDetail: (params: HistoryDetailActionParams) => void
  openHistoryUrl: (url: string | null | undefined) => void
  openHistoryPan: (params: { url?: string | null; path?: string | null }) => void
  triggerHistoryUpdate: (params: {
    pageUrl?: string | null
    button?: HTMLButtonElement | null
  }) => void
  previewHistoryPoster: (params: { src?: string | null; alt?: string | null }) => void
  toggleHistoryExpanded: () => void
}

export interface HistoryDetailActionParams {
  groupKey: string
  scope: 'group' | 'season'
  pageUrl?: string | null
  title?: string | null
  poster?: { src: string; alt?: string | null } | null
}

interface HistoryListActionDeps {
  getHistoryRecordCount?: () => number
  openWindow?: (url: string, target?: string, features?: string) => Window | null
  openZoomPreview?: (payload: { src: string; alt: string }) => void
  buildPanDirectoryUrl?: (path: string) => string
}

export const historyContextKey: InjectionKey<HistoryController> = Symbol('ChaospaceHistoryContext')

export function createHistoryListActionHandlers(
  history: HistoryController,
  deps: HistoryListActionDeps = {},
): HistoryListActionHandlers {
  const getHistoryRecordCount = deps.getHistoryRecordCount ?? (() => 0)
  const openWindow =
    deps.openWindow ??
    (typeof window !== 'undefined' && typeof window.open === 'function'
      ? window.open.bind(window)
      : undefined) ??
    (() => null)
  const openZoomPreview =
    deps.openZoomPreview ?? (typeof window !== 'undefined' ? window.openZoomPreview : undefined)
  const panDirectoryBuilder = deps.buildPanDirectoryUrl ?? buildPanDirectoryUrl

  const normalizeUrl = (input: string | null | undefined): string => {
    if (typeof input !== 'string') {
      return ''
    }
    return input.trim()
  }

  const ensurePoster = (
    poster: HistoryDetailActionParams['poster'],
    fallbackTitle?: string | null,
  ): HistoryDetailOverridesInput['poster'] => {
    if (!poster || !poster.src) {
      return null
    }
    return {
      src: poster.src,
      alt: poster.alt || fallbackTitle || '',
    }
  }

  const setHistorySelection = (groupKey: string, selected: boolean): void => {
    if (!groupKey) {
      return
    }
    history.setHistorySelection(groupKey, selected)
  }

  const setHistorySeasonExpanded = (groupKey: string, expanded: boolean): void => {
    if (!groupKey) {
      return
    }
    history.setHistorySeasonExpanded(groupKey, expanded)
  }

  const openHistoryDetail = (params: HistoryDetailActionParams): void => {
    if (!params.groupKey) {
      return
    }
    const overrides: HistoryDetailOverridesInput = {}
    const scopedPoster = ensurePoster(params.poster, params.title)
    const normalizedPageUrl = normalizeUrl(params.pageUrl ?? '')
    if (params.scope === 'season') {
      if (normalizedPageUrl) {
        overrides.pageUrl = normalizedPageUrl
      }
      if (typeof params.title === 'string' && params.title.trim()) {
        overrides.title = params.title.trim()
      }
      if (scopedPoster) {
        overrides.poster = scopedPoster
      } else if (overrides.title || overrides.pageUrl) {
        overrides.poster = null
      }
    } else {
      if (normalizedPageUrl) {
        overrides.pageUrl = normalizedPageUrl
      }
      if (scopedPoster) {
        overrides.poster = scopedPoster
      }
    }
    history.openHistoryDetail(params.groupKey, overrides)
  }

  const openHistoryUrl = (url: string | null | undefined): void => {
    const target = normalizeUrl(url)
    if (!target) {
      return
    }
    openWindow(target, '_blank', 'noopener')
  }

  const openHistoryPan = (params: { url?: string | null; path?: string | null }): void => {
    const normalizedUrl = normalizeUrl(params?.url ?? '')
    const normalizedPath = typeof params?.path === 'string' && params.path ? params.path : '/'
    const target = normalizedUrl || panDirectoryBuilder(normalizedPath)
    if (!target) {
      return
    }
    openWindow(target, '_blank', 'noopener')
  }

  const triggerHistoryUpdate = (params: {
    pageUrl?: string | null
    button?: HTMLButtonElement | null
  }): void => {
    const pageUrl = normalizeUrl(params.pageUrl ?? '')
    if (!pageUrl) {
      return
    }
    history.triggerHistoryUpdate(pageUrl, params.button ?? null)
  }

  const previewHistoryPoster = (params: { src?: string | null; alt?: string | null }): void => {
    const src = normalizeUrl(params.src ?? '')
    if (!src) {
      return
    }
    const alt = typeof params.alt === 'string' ? params.alt : ''
    openZoomPreview?.({ src, alt })
  }

  const toggleHistoryExpanded = (): void => {
    if (getHistoryRecordCount() <= 0) {
      return
    }
    history.toggleHistoryExpanded()
  }

  return {
    setHistorySelection,
    setHistorySeasonExpanded,
    openHistoryDetail,
    openHistoryUrl,
    openHistoryPan,
    triggerHistoryUpdate,
    previewHistoryPoster,
    toggleHistoryExpanded,
  }
}

export function useHistoryListActions(): HistoryListActionHandlers {
  const history = inject(historyContextKey)
  if (!history) {
    throw new Error('[Chaospace Transfer] History context is missing')
  }
  const store = useContentStore()
  return createHistoryListActionHandlers(history, {
    getHistoryRecordCount: () => store.historyRecords.length,
  })
}
