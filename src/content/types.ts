import type { CompletionStatus, SeasonEntry } from '@/shared/utils/completion-status'
import type { PosterInfo } from '@/shared/utils/sanitizers'
import type { HistoryRecord as SharedHistoryRecord } from '@/shared/types/transfer'
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

export interface PanelEdgeState {
  isHidden: boolean
  side: PanelDockSide
  peek: number
}

export interface PanelBounds {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
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
  lastKnownSize: { width: number; height: number } | null
  lastKnownPosition: { left: number; top: number } | null
  getPanelBounds: (() => PanelBounds) | null
  detachWindowResize: (() => void) | null
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
  hasSeasonSubdirPreference: boolean
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
}

export interface PanelDomRefs {
  container?: HTMLElement | null
  header?: HTMLElement | null
  headerArt?: HTMLElement | null
  headerPoster?: HTMLImageElement | null
  showTitle?: HTMLElement | null
  showSubtitle?: HTMLElement | null
  baseDirInput?: HTMLInputElement | null
  useTitleCheckbox?: HTMLInputElement | null
  useSeasonCheckbox?: HTMLInputElement | null
  seasonRow?: HTMLElement | null
  seasonPathHint?: HTMLElement | null
  pathPreview?: HTMLElement | null
  presetList?: HTMLElement | null
  addPresetButton?: HTMLButtonElement | null
  themeToggle?: HTMLButtonElement | null
  settingsToggle?: HTMLButtonElement | null
  settingsOverlay?: HTMLElement | null
  settingsForm?: HTMLFormElement | null
  settingsClose?: HTMLButtonElement | null
  settingsCancel?: HTMLButtonElement | null
  settingsBaseDir?: HTMLInputElement | null
  settingsUseTitle?: HTMLInputElement | null
  settingsUseSeason?: HTMLInputElement | null
  settingsTheme?: HTMLSelectElement | null
  settingsPresets?: HTMLTextAreaElement | null
  settingsHistoryRate?: HTMLInputElement | null
  settingsExportConfig?: HTMLButtonElement | null
  settingsExportData?: HTMLButtonElement | null
  settingsImportConfigTrigger?: HTMLButtonElement | null
  settingsImportDataTrigger?: HTMLButtonElement | null
  settingsImportConfigInput?: HTMLInputElement | null
  settingsImportDataInput?: HTMLInputElement | null
  settingsResetLayout?: HTMLButtonElement | null
  pinBtn?: HTMLButtonElement | null
  logContainer?: HTMLElement | null
  logList?: HTMLUListElement | null
  resultSummary?: HTMLElement | null
  itemsContainer?: HTMLElement | null
  sortKeySelect?: HTMLSelectElement | null
  sortOrderButton?: HTMLButtonElement | null
  historyOverlay?: HTMLElement | null
  historyList?: HTMLElement | null
  historyEmpty?: HTMLElement | null
  historySummary?: HTMLElement | null
  historySummaryBody?: HTMLElement | null
  historyControls?: HTMLElement | null
  historyTabs?: HTMLElement | null
  historySelectAll?: HTMLInputElement | null
  historySelectionCount?: HTMLElement | null
  historyBatchCheck?: HTMLButtonElement | null
  historyDeleteSelected?: HTMLButtonElement | null
  historyClear?: HTMLButtonElement | null
  historyToolbar?: HTMLElement | null
  historyToggleButtons?: HTMLButtonElement[]
  resourceSummary?: HTMLElement | null
  resourceTitle?: HTMLElement | null
  seasonTabs?: HTMLElement | null
  transferBtn?: HTMLButtonElement | null
  transferLabel?: HTMLElement | null
  transferSpinner?: HTMLElement | null
  resizeHandle?: HTMLElement | null
  statusText?: HTMLElement | null
  openSettingsPanel?: () => void
  closeSettingsPanel?: (options?: { restoreFocus?: boolean }) => void
  [key: string]: unknown
}
export type DetailDomRefs = Record<string, HTMLElement | null>
