import {
  DEFAULT_PRESETS,
  HISTORY_BATCH_RATE_LIMIT_MS
} from '../constants';
import type {
  ContentState,
  PanelDomRefs,
  DetailDomRefs
} from '../types';

type StateKey = keyof ContentState;

type StateValue<K extends StateKey> = ContentState[K];

const initialState: ContentState = {
  baseDir: '/',
  baseDirLocked: false,
  autoSuggestedDir: null,
  classification: 'unknown',
  classificationDetails: null,
  useTitleSubdir: true,
  useSeasonSubdir: false,
  hasSeasonSubdirPreference: false,
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
    fallback: null
  },
  historyDetailCache: new Map<string, unknown>(),
  seasonDirMap: {},
  seasonResolvedPaths: [],
  activeSeasonId: null,
  settingsPanel: {
    isOpen: false
  }
};

export const state: ContentState = initialState;

export const panelDom: PanelDomRefs = {} as PanelDomRefs;
export const detailDom: DetailDomRefs = {} as DetailDomRefs;

export function overwriteState(nextState: Partial<ContentState>): void {
  (Object.keys(state) as StateKey[]).forEach((key) => {
    if (!(key in nextState)) {
      return;
    }
    const value = nextState[key];
    if (value instanceof Set) {
      (state as Record<StateKey, unknown>)[key] = new Set(value);
      return;
    }
    if (value instanceof Map) {
      (state as Record<StateKey, unknown>)[key] = new Map(value);
      return;
    }
    (state as Record<StateKey, unknown>)[key] = value as StateValue<typeof key>;
  });
}

export function resetTransientState(): void {
  state.itemIdSet = new Set<string | number>();
  state.deferredSeasonInfos = [];
  state.seasonEntries = [];
  state.seasonCompletion = {};
  state.historyDetailCache = new Map<string, unknown>();
  state.selectedIds = new Set<string | number>();
  state.newItemIds = new Set<string | number>();
  state.transferredIds = new Set<string | number>();
  state.logs = [];
  state.lastResult = null;
  state.jobId = null;
}
