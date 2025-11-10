import { createPinia, defineStore, setActivePinia } from 'pinia'
import { DEFAULT_PRESETS, HISTORY_BATCH_RATE_LIMIT_MS } from '../constants'
import { DEFAULT_FILE_FILTER_MODE } from '@/shared/settings'
import type { ContentState, PanelDomRefs, DetailDomRefs } from '../types'
import { createPanelDomRefs } from '../types'

const pinia = createPinia()
setActivePinia(pinia)

function createInitialState(): ContentState {
  return {
    baseDir: '/',
    baseDirLocked: false,
    autoSuggestedDir: null,
    classification: 'unknown',
    classificationDetails: null,
    useTitleSubdir: true,
    useSeasonSubdir: false,
    seasonSubdirDefault: false,
    seasonPreferenceScope: 'default',
    seasonPreferenceTabId: null,
    presets: [...DEFAULT_PRESETS],
    items: [],
    itemIdSet: new Set<string | number>(),
    isSeasonLoading: false,
    seasonLoadProgress: { total: 0, loaded: 0 },
    deferredSeasonInfos: [],
    sortKey: 'page',
    sortOrder: 'asc',
    selectedIds: new Set<string | number>(),
    pageTitle: '',
    pageUrl: '',
    poster: null,
    origin: '',
    jobId: null,
    logs: [],
    transferStatus: 'idle',
    lastResult: null,
    statusMessage: '准备就绪 ✨',
    theme: 'dark',
    toolbarDisabled: false,
    presetsDisabled: false,
    completion: null,
    seasonCompletion: {},
    seasonEntries: [],
    historyRecords: [],
    historyGroups: [],
    currentHistory: null,
    transferredIds: new Set<string | number>(),
    newItemIds: new Set<string | number>(),
    historyExpanded: false,
    historySeasonExpanded: new Set<string>(),
    historyFilter: 'all',
    historySearchTerm: '',
    historySelectedKeys: new Set<string>(),
    historyBatchRunning: false,
    historyBatchProgressLabel: '',
    historyRateLimitMs: HISTORY_BATCH_RATE_LIMIT_MS,
    historyDetail: {
      isOpen: false,
      loading: false,
      groupKey: '',
      pageUrl: '',
      data: null,
      error: '',
      fallback: null,
    },
    historyDetailCache: new Map<string, unknown>(),
    seasonDirMap: {},
    seasonResolvedPaths: [],
    activeSeasonId: null,
    settingsPanel: {
      isOpen: false,
    },
    fileFilterMode: DEFAULT_FILE_FILTER_MODE,
    fileFilters: [],
    fileRenameRules: [],
    activeSiteProviderId: null,
    activeSiteProviderLabel: null,
    disabledSiteProviderIds: new Set<string>(),
    preferredSiteProviderId: null,
    manualSiteProviderId: null,
    providerSwitching: false,
    availableSiteProviderIds: new Set<string>(),
  }
}

export const useContentStore = defineStore('content', {
  state: createInitialState,
})

export type ContentStore = ReturnType<typeof useContentStore>

export const contentStore = useContentStore(pinia)

export const state: ContentStore = contentStore

export const panelDom: PanelDomRefs = createPanelDomRefs()
export const detailDom: DetailDomRefs = {
  hideTimer: null,
  backdrop: null,
  modal: null,
  close: null,
  poster: null,
  title: null,
  date: null,
  country: null,
  runtime: null,
  rating: null,
  genres: null,
  info: null,
  synopsis: null,
  stills: null,
  body: null,
  loading: null,
  error: null,
}

export function overwriteState(nextState: Partial<ContentState>): void {
  contentStore.$patch((draft) => {
    for (const key of Object.keys(nextState) as Array<keyof ContentState>) {
      if (!(key in draft)) {
        continue
      }
      const value = nextState[key]
      if (value instanceof Set) {
        ;(draft as Record<keyof ContentState, unknown>)[key] = new Set(value)
        continue
      }
      if (value instanceof Map) {
        ;(draft as Record<keyof ContentState, unknown>)[key] = new Map(value)
        continue
      }
      ;(draft as Record<keyof ContentState, unknown>)[key] = value as unknown
    }
  })
}

export function resetTransientState(): void {
  contentStore.$patch((draft) => {
    draft.itemIdSet = new Set<string | number>()
    draft.deferredSeasonInfos = []
    draft.seasonEntries = []
    draft.seasonCompletion = {}
    draft.historyDetailCache = new Map<string, unknown>()
    draft.selectedIds = new Set<string | number>()
    draft.newItemIds = new Set<string | number>()
    draft.transferredIds = new Set<string | number>()
    draft.logs = []
    draft.lastResult = null
    draft.jobId = null
    draft.toolbarDisabled = false
    draft.manualSiteProviderId = null
    draft.availableSiteProviderIds = new Set<string>()
    draft.providerSwitching = false
  })
}

export { pinia }
