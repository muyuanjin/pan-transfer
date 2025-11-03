import {
  DEFAULT_PRESETS,
  HISTORY_BATCH_RATE_LIMIT_MS
} from '../constants.js';

export const state = {
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
  itemIdSet: new Set(),
  isSeasonLoading: false,
  seasonLoadProgress: { total: 0, loaded: 0 },
  deferredSeasonInfos: [],
  sortKey: 'page',
  sortOrder: 'asc',
  selectedIds: new Set(),
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
  transferredIds: new Set(),
  newItemIds: new Set(),
  historyExpanded: false,
  historySeasonExpanded: new Set(),
  historyFilter: 'all',
  historySelectedKeys: new Set(),
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
  historyDetailCache: new Map(),
  seasonDirMap: {},
  seasonResolvedPaths: [],
  activeSeasonId: null,
  settingsPanel: {
    isOpen: false
  }
};

export const panelDom = {};
export const detailDom = {};

export function overwriteState(nextState) {
  Object.keys(state).forEach(key => {
    const value = nextState[key];
    if (value instanceof Set) {
      state[key] = new Set(value);
      return;
    }
    if (value instanceof Map) {
      state[key] = new Map(value);
      return;
    }
    state[key] = value;
  });
}

export function resetTransientState() {
  state.itemIdSet = new Set();
  state.deferredSeasonInfos = [];
  state.seasonEntries = [];
  state.seasonCompletion = {};
  state.historyDetailCache = new Map();
  state.selectedIds = new Set();
  state.newItemIds = new Set();
  state.transferredIds = new Set();
  state.logs = [];
  state.lastResult = null;
  state.jobId = null;
}
