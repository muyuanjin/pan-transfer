import type { CompletionStatus, SeasonEntry } from '@/shared/utils/completion-status'
import type { PosterInfo } from '@/shared/utils/sanitizers'
import type { HistoryRecord as SharedHistoryRecord } from '@/shared/types/transfer'
import type { FileFilterEvaluationMode, FileFilterRule, FileRenameRule } from '@/shared/settings'
import type { HistoryFilter as HistoryFilterOption } from './constants'

export type LogLevel = 'info' | 'success' | 'warning' | 'error' | (string & {})

export interface LogEntry {
  id: string
  message: string
  detail?: string
  level: LogLevel
  stage?: string
}

export type TransferStatus = 'idle' | 'running' | 'success' | 'error'

export type HistoryFilter = HistoryFilterOption

export interface HistoryCompletion extends CompletionStatus {}

export interface HistoryPoster extends PosterInfo {}

export type ContentHistoryRecord = SharedHistoryRecord & {
  children?: ContentHistoryRecord[]
  urls?: string[]
  records?: ContentHistoryRecord[]
  seasonEntries?: SeasonEntry[]
  seasonCompletion?: Record<string, CompletionStatus>
  seasonDirectory?: Record<string, string>
  [key: string]: unknown
}

export interface HistoryGroup {
  key: string
  title: string
  origin: string
  poster: PosterInfo | null
  updatedAt: number
  records: ContentHistoryRecord[]
  main: ContentHistoryRecord
  children: ContentHistoryRecord[]
  urls: string[]
  seasonEntries: SeasonEntry[]
}

export interface HistoryGroupSeasonRow {
  key: string
  label: string
  url: string
  poster: PosterInfo | null
  completion: CompletionStatus | null
  seasonId: string
  seasonIndex: number
  canCheck: boolean
  record: ContentHistoryRecord | null
  recordTimestamp: number
}

export interface HistoryRecordsPayload {
  records: ContentHistoryRecord[]
  groups: HistoryGroup[]
}

export interface ResourceItem {
  id: string | number
  title: string
  order: number
  linkUrl?: string
  passCode?: string
  seasonId?: string
  seasonLabel?: string
  seasonIndex?: number
  seasonUrl?: string
  seasonCompletion?: CompletionStatus | null
  quality?: string
  subtitle?: string
  [key: string]: unknown
}

export interface DeferredSeasonInfo {
  seasonId: string
  label: string
  url: string
  index: number
  completion?: CompletionStatus | null
  poster?: PosterInfo | null
  [key: string]: unknown
}

export type PanelDockSide = 'left' | 'right'

export type SeasonPreferenceScope = 'default' | 'tab'

export interface PanelEdgeState {
  isHidden: boolean
  side: PanelDockSide
  peek: number
}

export interface PanelEdgeSnapshot {
  isHidden: boolean
  side: PanelDockSide
  peek?: number
}

export interface PanelBounds {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

export interface PanelSizeSnapshot {
  width: number
  height: number
}

export interface PanelPositionSnapshot {
  left: number
  top: number
}

export interface PanelRuntimeState {
  edgeState: PanelEdgeState
  pointerInside: boolean
  lastPointerPosition: { x: number; y: number }
  isPinned: boolean
  hideTimer: number | null
  edgeAnimationTimer: number | null
  edgeTransitionUnbind: (() => void) | null
  documentPointerDownBound: boolean
  scheduleEdgeHide: ((delay?: number) => void) | null
  cancelEdgeHide: ((options?: { show?: boolean }) => void) | null
  applyEdgeHiddenPosition: (() => void) | null
  hidePanelToEdge: (() => void) | null
  showPanelFromEdge: (() => void) | null
  beginEdgeAnimation: (() => void) | null
  applyPanelSize: ((width?: number, height?: number) => PanelSizeSnapshot | null) | null
  applyPanelPosition: ((left?: number, top?: number) => PanelPositionSnapshot) | null
  lastKnownSize: PanelSizeSnapshot | null
  lastKnownPosition: PanelPositionSnapshot | null
  getPanelBounds: (() => PanelBounds) | null
  detachWindowResize: (() => void) | null
  edgeStateChange: ((snapshot: PanelEdgeSnapshot) => void) | null
  [key: string]: unknown
}

export interface HistoryDetailState {
  isOpen: boolean
  loading: boolean
  groupKey: string
  pageUrl: string
  data: unknown
  error: string
  fallback: unknown
}

export interface SeasonResolvedPath {
  id: string
  label: string
  path: string
}

export interface ContentState {
  baseDir: string
  baseDirLocked: boolean
  autoSuggestedDir: string | null
  classification: string
  classificationDetails: unknown
  useTitleSubdir: boolean
  useSeasonSubdir: boolean
  seasonSubdirDefault: boolean
  seasonPreferenceScope: SeasonPreferenceScope
  seasonPreferenceTabId: number | null
  presets: string[]
  items: ResourceItem[]
  itemIdSet: Set<string | number>
  isSeasonLoading: boolean
  seasonLoadProgress: { total: number; loaded: number }
  deferredSeasonInfos: DeferredSeasonInfo[]
  sortKey: 'page' | 'title'
  sortOrder: 'asc' | 'desc'
  selectedIds: Set<string | number>
  pageTitle: string
  pageUrl: string
  poster: PosterInfo | null
  origin: string
  jobId: string | null
  logs: LogEntry[]
  transferStatus: TransferStatus
  lastResult: unknown
  statusMessage: string
  theme: string
  toolbarDisabled: boolean
  presetsDisabled: boolean
  completion: CompletionStatus | null
  seasonCompletion: Record<string, CompletionStatus>
  seasonEntries: SeasonEntry[]
  historyRecords: ContentHistoryRecord[]
  historyGroups: HistoryGroup[]
  currentHistory: ContentHistoryRecord | null
  transferredIds: Set<string | number>
  newItemIds: Set<string | number>
  historyExpanded: boolean
  historySeasonExpanded: Set<string>
  historyFilter: HistoryFilter
  historySearchTerm: string
  historySelectedKeys: Set<string>
  historyBatchRunning: boolean
  historyBatchProgressLabel: string
  historyRateLimitMs: number
  historyDetail: HistoryDetailState
  historyDetailCache: Map<string, unknown>
  seasonDirMap: Record<string, string>
  seasonResolvedPaths: SeasonResolvedPath[]
  activeSeasonId: string | null
  settingsPanel: { isOpen: boolean }
  fileFilterMode: FileFilterEvaluationMode
  fileFilters: FileFilterRule[]
  fileRenameRules: FileRenameRule[]
}

const PANEL_DOM_KEYS = [
  'container',
  'header',
  'headerArt',
  'headerPoster',
  'showTitle',
  'showSubtitle',
  'baseDirInput',
  'useTitleCheckbox',
  'useSeasonCheckbox',
  'seasonRow',
  'seasonPathHint',
  'pathPreview',
  'addPresetButton',
  'themeToggle',
  'settingsToggle',
  'settingsOverlay',
  'settingsForm',
  'settingsClose',
  'settingsCancel',
  'settingsBaseDir',
  'settingsUseTitle',
  'settingsUseSeason',
  'settingsThemeGroup',
  'settingsPresets',
  'settingsHistoryRate',
  'settingsFilterMode',
  'settingsFilterEditor',
  'settingsRenameEditor',
  'settingsExportConfig',
  'settingsExportData',
  'settingsImportConfigTrigger',
  'settingsImportDataTrigger',
  'settingsImportConfigInput',
  'settingsImportDataInput',
  'settingsResetLayout',
  'pinBtn',
  'logContainer',
  'logList',
  'resultSummary',
  'itemsContainer',
  'historyOverlay',
  'historyList',
  'historyEmpty',
  'historySummary',
  'historySummaryBody',
  'resourceSummary',
  'resourceTitle',
  'seasonTabs',
  'transferBtn',
  'transferLabel',
  'transferSpinner',
  'resizeHandle',
  'statusText',
  'openSettingsPanel',
  'closeSettingsPanel',
] as const

export type PanelDomKey = (typeof PANEL_DOM_KEYS)[number]

export interface PanelDomDefinition {
  container: HTMLElement
  header: HTMLElement
  headerArt: HTMLElement
  headerPoster: HTMLImageElement
  showTitle: HTMLElement
  showSubtitle: HTMLElement
  baseDirInput: HTMLInputElement
  useTitleCheckbox: HTMLInputElement
  useSeasonCheckbox: HTMLInputElement
  seasonRow: HTMLElement
  seasonPathHint: HTMLElement
  pathPreview: HTMLElement
  addPresetButton: HTMLButtonElement
  themeToggle: HTMLButtonElement
  settingsToggle: HTMLButtonElement
  settingsOverlay: HTMLElement
  settingsForm: HTMLFormElement
  settingsClose: HTMLButtonElement
  settingsCancel: HTMLButtonElement
  settingsBaseDir: HTMLInputElement
  settingsUseTitle: HTMLInputElement
  settingsUseSeason: HTMLInputElement
  settingsThemeGroup: HTMLElement
  settingsPresets: HTMLTextAreaElement
  settingsHistoryRate: HTMLInputElement
  settingsFilterMode: HTMLSelectElement
  settingsFilterEditor: HTMLElement
  settingsRenameEditor: HTMLElement
  settingsExportConfig: HTMLButtonElement
  settingsExportData: HTMLButtonElement
  settingsImportConfigTrigger: HTMLButtonElement
  settingsImportDataTrigger: HTMLButtonElement
  settingsImportConfigInput: HTMLInputElement
  settingsImportDataInput: HTMLInputElement
  settingsResetLayout: HTMLButtonElement
  pinBtn: HTMLButtonElement
  logContainer: HTMLElement
  logList: HTMLUListElement
  resultSummary: HTMLElement
  itemsContainer: HTMLElement
  historyOverlay: HTMLElement
  historyList: HTMLElement
  historyEmpty: HTMLElement
  historySummary: HTMLElement
  historySummaryBody: HTMLElement
  resourceSummary: HTMLElement
  resourceTitle: HTMLElement
  seasonTabs: HTMLElement
  transferBtn: HTMLButtonElement
  transferLabel: HTMLElement
  transferSpinner: HTMLElement
  resizeHandle: HTMLElement
  statusText: HTMLElement
  openSettingsPanel: () => void
  closeSettingsPanel: (options?: { restoreFocus?: boolean }) => void
}

type PanelDomStore = {
  [K in PanelDomKey]: PanelDomDefinition[K] | null
}

type PanelDomAccessors = {
  get<K extends PanelDomKey>(key: K): PanelDomDefinition[K] | null
  set<K extends PanelDomKey>(key: K, value: PanelDomDefinition[K] | null): void
  ensure<K extends PanelDomKey>(key: K, message?: string): PanelDomDefinition[K]
  assignAll(values: Partial<PanelDomStore>): void
  clear(): void
}

export type PanelDomRefs = PanelDomAccessors & PanelDomStore

export function createPanelDomRefs(): PanelDomRefs {
  const store = new Map<PanelDomKey, PanelDomDefinition[PanelDomKey] | null>()
  const refs = {} as PanelDomStore

  for (const key of PANEL_DOM_KEYS) {
    store.set(key, null)
    Object.defineProperty(refs, key, {
      get() {
        return (store.get(key) ?? null) as PanelDomDefinition[typeof key] | null
      },
      set(value: PanelDomDefinition[typeof key] | null) {
        store.set(key, value ?? null)
      },
      enumerable: true,
    })
  }

  const assertKnownKey = (key: PanelDomKey): void => {
    if (!store.has(key)) {
      throw new Error(`[Chaospace Transfer] Unknown panel DOM ref "${key}"`)
    }
  }

  const accessors: PanelDomAccessors = {
    get<K extends PanelDomKey>(key: K) {
      assertKnownKey(key)
      return (store.get(key) ?? null) as PanelDomDefinition[K] | null
    },
    set<K extends PanelDomKey>(key: K, value: PanelDomDefinition[K] | null) {
      assertKnownKey(key)
      store.set(key, value ?? null)
    },
    ensure<K extends PanelDomKey>(key: K, message?: string) {
      assertKnownKey(key)
      const value = store.get(key)
      if (!value) {
        throw new Error(message ?? `Missing panel DOM ref "${key}"`)
      }
      return value as PanelDomDefinition[K]
    },
    assignAll(values: Partial<PanelDomStore>) {
      for (const key of PANEL_DOM_KEYS) {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          const next = values[key]
          store.set(key, (next ?? null) as PanelDomDefinition[typeof key] | null)
        }
      }
    },
    clear(): void {
      for (const key of PANEL_DOM_KEYS) {
        store.set(key, null)
      }
    },
  }

  return Object.assign(refs, accessors)
}

export type DetailDomRefs = Record<string, HTMLElement | null>

export interface PanelEdgeDomRefs {
  readonly pinButton: HTMLButtonElement | null
}

export function getPanelEdgeDom(panelDom: PanelDomRefs): PanelEdgeDomRefs {
  return {
    get pinButton() {
      return panelDom.get('pinBtn')
    },
  }
}

export interface PanelTransferDomRefs {
  readonly transferButton: HTMLButtonElement | null
  readonly transferLabel: HTMLElement | null
  readonly transferSpinner: HTMLElement | null
}

export function getPanelTransferDom(panelDom: PanelDomRefs): PanelTransferDomRefs {
  return {
    get transferButton() {
      return panelDom.get('transferBtn')
    },
    get transferLabel() {
      return panelDom.get('transferLabel')
    },
    get transferSpinner() {
      return panelDom.get('transferSpinner')
    },
  }
}

export interface PanelBaseDirDomRefs {
  readonly baseDirInput: HTMLInputElement | null
  readonly useTitleCheckbox: HTMLInputElement | null
  readonly useSeasonCheckbox: HTMLInputElement | null
  readonly addPresetButton: HTMLButtonElement | null
  readonly themeToggle: HTMLButtonElement | null
  readonly pathPreview: HTMLElement | null
  readonly settingsUseSeason: HTMLInputElement | null
}

export function getPanelBaseDirDom(panelDom: PanelDomRefs): PanelBaseDirDomRefs {
  return {
    get baseDirInput() {
      return panelDom.get('baseDirInput')
    },
    get useTitleCheckbox() {
      return panelDom.get('useTitleCheckbox')
    },
    get useSeasonCheckbox() {
      return panelDom.get('useSeasonCheckbox')
    },
    get addPresetButton() {
      return panelDom.get('addPresetButton')
    },
    get themeToggle() {
      return panelDom.get('themeToggle')
    },
    get pathPreview() {
      return panelDom.get('pathPreview')
    },
    get settingsUseSeason() {
      return panelDom.get('settingsUseSeason')
    },
  }
}
