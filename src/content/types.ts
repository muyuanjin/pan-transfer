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

export type HistoryCompletion = CompletionStatus

export type HistoryPoster = PosterInfo

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
  siteProviderId?: string | null
  siteProviderLabel?: string | null
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
  hasItems: boolean
  loaded: boolean
}

export interface HistoryRecordsPayload {
  records: ContentHistoryRecord[]
  groups: HistoryGroup[]
}

export type HistoryBatchMode = 'check' | 'transfer' | null

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
  tags?: string[]
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

export type SeasonPreferenceScope = 'default' | 'tab' | 'history'

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

export interface HistoryDetailDomRefs {
  hideTimer: number | null
  backdrop: HTMLElement | null
  modal: HTMLElement | null
  close: HTMLElement | null
  poster: HTMLElement | null
  title: HTMLElement | null
  date: HTMLElement | null
  country: HTMLElement | null
  runtime: HTMLElement | null
  rating: HTMLElement | null
  genres: HTMLElement | null
  info: HTMLElement | null
  synopsis: HTMLElement | null
  stills: HTMLElement | null
  body: HTMLElement | null
  loading: HTMLElement | null
  error: HTMLElement | null
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
  historyBatchMode: HistoryBatchMode
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
  activeSiteProviderId: string | null
  activeSiteProviderLabel: string | null
  disabledSiteProviderIds: Set<string>
  preferredSiteProviderId: string | null
  manualSiteProviderId: string | null
  providerSwitching: boolean
  availableSiteProviderIds: Set<string>
}

const PANEL_DOM_KEYS = [
  'container',
  'header',
  'headerArt',
  'headerPoster',
  'showTitle',
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
  'settingsSiteProviderList',
  'settingsExportData',
  'settingsImportDataTrigger',
  'settingsImportDataInput',
  'settingsResetLayout',
  'pinBtn',
  'logContainer',
  'logList',
  'resultSummary',
  'itemsContainer',
  'historyOverlay',
  'historyScroll',
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
  settingsSiteProviderList: HTMLElement
  settingsExportData: HTMLButtonElement
  settingsImportDataTrigger: HTMLButtonElement
  settingsImportDataInput: HTMLInputElement
  settingsResetLayout: HTMLButtonElement
  pinBtn: HTMLButtonElement
  logContainer: HTMLElement
  logList: HTMLUListElement
  resultSummary: HTMLElement
  itemsContainer: HTMLElement
  historyOverlay: HTMLElement
  historyScroll: HTMLElement
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

type PanelDomAccessors = {
  get<K extends PanelDomKey>(key: K): PanelDomDefinition[K] | null
  set<K extends PanelDomKey>(key: K, value: PanelDomDefinition[K] | null): void
  ensure<K extends PanelDomKey>(key: K, message?: string): PanelDomDefinition[K]
  assignAll(values: Partial<PanelDomStore>): void
  clear(): void
}

type PanelDomStore = {
  [K in PanelDomKey]: PanelDomDefinition[K] | null
}

export type PanelDomRefs = PanelDomAccessors

export function createPanelDomRefs(): PanelDomRefs {
  const store = new Map<PanelDomKey, PanelDomDefinition[PanelDomKey] | null>()

  for (const key of PANEL_DOM_KEYS) {
    store.set(key, null)
  }

  const assertKnownKey = (key: PanelDomKey): void => {
    if (!store.has(key)) {
      throw new Error(`[Pan Transfer] Unknown panel DOM ref "${key}"`)
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

  return accessors
}

export type DetailDomRefs = HistoryDetailDomRefs

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

export interface PanelHeaderDomRefs {
  readonly header: HTMLElement | null
  readonly headerArt: HTMLElement | null
  readonly headerPoster: HTMLImageElement | null
  readonly showTitle: HTMLElement | null
}

export function getPanelHeaderDom(panelDom: PanelDomRefs): PanelHeaderDomRefs {
  return {
    get header() {
      return panelDom.get('header')
    },
    get headerArt() {
      return panelDom.get('headerArt')
    },
    get headerPoster() {
      return panelDom.get('headerPoster')
    },
    get showTitle() {
      return panelDom.get('showTitle')
    },
  }
}

export interface PanelLoggingDomRefs {
  readonly logContainer: HTMLElement
  readonly logList: HTMLUListElement
  readonly statusText: HTMLElement | null
  readonly resultSummary: HTMLElement
}

export function getPanelLoggingDom(panelDom: PanelDomRefs): PanelLoggingDomRefs {
  return {
    get logContainer() {
      return panelDom.ensure('logContainer', 'Missing log container binding')
    },
    get logList() {
      return panelDom.ensure('logList', 'Missing log list binding')
    },
    get statusText() {
      return panelDom.get('statusText')
    },
    get resultSummary() {
      return panelDom.ensure('resultSummary', 'Missing log summary binding')
    },
  }
}

export interface PanelHistoryDomRefs {
  readonly historyOverlay: HTMLElement | null
  readonly historyScroll: HTMLElement | null
  readonly historyList: HTMLElement | null
  readonly historyEmpty: HTMLElement | null
  readonly historySummary: HTMLElement | null
  readonly historySummaryBody: HTMLElement | null
}

export function getPanelHistoryDom(panelDom: PanelDomRefs): PanelHistoryDomRefs {
  return {
    get historyOverlay() {
      return panelDom.get('historyOverlay')
    },
    get historyScroll() {
      return panelDom.get('historyScroll')
    },
    get historyList() {
      return panelDom.get('historyList')
    },
    get historyEmpty() {
      return panelDom.get('historyEmpty')
    },
    get historySummary() {
      return panelDom.get('historySummary')
    },
    get historySummaryBody() {
      return panelDom.get('historySummaryBody')
    },
  }
}

export interface PanelResourceDomRefs {
  readonly itemsContainer: HTMLElement | null
  readonly resourceSummary: HTMLElement | null
  readonly resourceTitle: HTMLElement | null
  readonly seasonTabs: HTMLElement | null
}

export function getPanelResourceDom(panelDom: PanelDomRefs): PanelResourceDomRefs {
  return {
    get itemsContainer() {
      return panelDom.get('itemsContainer')
    },
    get resourceSummary() {
      return panelDom.get('resourceSummary')
    },
    get resourceTitle() {
      return panelDom.get('resourceTitle')
    },
    get seasonTabs() {
      return panelDom.get('seasonTabs')
    },
  }
}

export interface PanelSeasonDomRefs {
  readonly seasonRow: HTMLElement | null
  readonly seasonPathHint: HTMLElement | null
}

export function getPanelSeasonDom(panelDom: PanelDomRefs): PanelSeasonDomRefs {
  return {
    get seasonRow() {
      return panelDom.get('seasonRow')
    },
    get seasonPathHint() {
      return panelDom.get('seasonPathHint')
    },
  }
}

export interface PanelSettingsDomRefs {
  readonly overlay: HTMLElement
  readonly form: HTMLFormElement
  readonly closeBtn: HTMLButtonElement
  readonly cancelBtn: HTMLButtonElement
  readonly baseDirInput: HTMLInputElement
  readonly useTitleCheckbox: HTMLInputElement
  readonly useSeasonCheckbox: HTMLInputElement
  readonly themeSegment: HTMLElement
  readonly presetsTextarea: HTMLTextAreaElement
  readonly historyRateInput: HTMLInputElement
  readonly filterModeSelect: HTMLSelectElement
  readonly filterEditorRoot: HTMLElement
  readonly renameEditorRoot: HTMLElement
  readonly siteProviderList: HTMLElement
  readonly exportDataBtn: HTMLButtonElement
  readonly importDataTrigger: HTMLButtonElement
  readonly importDataInput: HTMLInputElement
  readonly resetLayoutBtn: HTMLButtonElement
  readonly toggleBtn: HTMLButtonElement
}

export function getPanelSettingsDom(panelDom: PanelDomRefs): PanelSettingsDomRefs {
  return {
    get overlay() {
      return panelDom.ensure('settingsOverlay', 'Missing settings overlay binding')
    },
    get form() {
      return panelDom.ensure('settingsForm', 'Missing settings form binding')
    },
    get closeBtn() {
      return panelDom.ensure('settingsClose', 'Missing settings close button binding')
    },
    get cancelBtn() {
      return panelDom.ensure('settingsCancel', 'Missing settings cancel button binding')
    },
    get baseDirInput() {
      return panelDom.ensure('settingsBaseDir', 'Missing settings base dir input binding')
    },
    get useTitleCheckbox() {
      return panelDom.ensure('settingsUseTitle', 'Missing settings title checkbox binding')
    },
    get useSeasonCheckbox() {
      return panelDom.ensure('settingsUseSeason', 'Missing settings season checkbox binding')
    },
    get themeSegment() {
      return panelDom.ensure('settingsThemeGroup', 'Missing settings theme segment binding')
    },
    get presetsTextarea() {
      return panelDom.ensure('settingsPresets', 'Missing settings presets textarea binding')
    },
    get historyRateInput() {
      return panelDom.ensure('settingsHistoryRate', 'Missing settings history rate input binding')
    },
    get filterModeSelect() {
      return panelDom.ensure('settingsFilterMode', 'Missing settings filter mode binding')
    },
    get filterEditorRoot() {
      return panelDom.ensure('settingsFilterEditor', 'Missing settings filter editor binding')
    },
    get renameEditorRoot() {
      return panelDom.ensure('settingsRenameEditor', 'Missing settings rename editor binding')
    },
    get siteProviderList() {
      return panelDom.ensure(
        'settingsSiteProviderList',
        'Missing settings site provider list binding',
      )
    },
    get exportDataBtn() {
      return panelDom.ensure('settingsExportData', 'Missing settings export data binding')
    },
    get importDataTrigger() {
      return panelDom.ensure(
        'settingsImportDataTrigger',
        'Missing settings import data trigger binding',
      )
    },
    get importDataInput() {
      return panelDom.ensure(
        'settingsImportDataInput',
        'Missing settings import data input binding',
      )
    },
    get resetLayoutBtn() {
      return panelDom.ensure('settingsResetLayout', 'Missing settings reset layout binding')
    },
    get toggleBtn() {
      return panelDom.ensure('settingsToggle', 'Missing settings toggle binding')
    },
  }
}
