import { chaosLogger } from '@/shared/log'
import type { PageAnalysisResult } from '@/providers/sites/chaospace/page-analyzer'
import { state } from '../../state'
import {
  EDGE_STATE_KEY,
  HISTORY_KEY,
  PIN_STATE_KEY,
  POSITION_KEY,
  SIZE_KEY,
  STORAGE_KEY,
} from '../../constants'
import { prepareHistoryRecords } from '../../services/history-service'
import {
  clampHistoryRateLimit,
  normalizePanelPositionSnapshot,
  normalizePanelSizeSnapshot,
} from '../../components/settings-modal'
import type { createHistoryController } from '../../history/controller'
import type { PanelEdgeSnapshot, PanelPositionSnapshot, PanelSizeSnapshot } from '../../types'
import { normalizePinState } from '../../utils/panel-pin'
import { normalizeEdgeState } from '../../utils/panel-edge'

type HistoryController = ReturnType<typeof createHistoryController>

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: chrome.storage.AreaName,
) => void

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void

export function registerChromeEvents(deps: {
  history: HistoryController
  applyTheme: () => void
  rerenderSettingsIfOpen: () => void
  renderResourceList: () => void
  syncSeasonPreference: (value: boolean | null) => void
  syncPanelSizeFromStorage: (snapshot: PanelSizeSnapshot | null) => void
  syncPanelPositionFromStorage: (snapshot: PanelPositionSnapshot | null) => void
  syncEdgeStateFromStorage: (snapshot: PanelEdgeSnapshot | null) => void
  syncPinStateFromStorage: (pinned: boolean) => void
  setStatusProgress: (progress: unknown) => void
  getFloatingPanel: () => HTMLElement | null
  analyzePageForMessage: () => Promise<PageAnalysisResult>
}): () => void {
  const {
    history,
    applyTheme,
    rerenderSettingsIfOpen,
    renderResourceList,
    syncSeasonPreference,
    syncPanelSizeFromStorage,
    syncPanelPositionFromStorage,
    syncEdgeStateFromStorage,
    syncPinStateFromStorage,
    setStatusProgress,
    getFloatingPanel,
    analyzePageForMessage,
  } = deps

  const handleStorageChange: StorageChangeListener = (changes, areaName) => {
    if (areaName !== 'local') {
      return
    }

    const settingsChange = changes[STORAGE_KEY]
    if (settingsChange?.newValue) {
      const nextSettings: unknown = settingsChange.newValue
      const prevSettings: unknown = settingsChange.oldValue
      if (nextSettings && typeof nextSettings === 'object') {
        const themeValue = (nextSettings as { theme?: unknown }).theme
        if ((themeValue === 'light' || themeValue === 'dark') && themeValue !== state.theme) {
          state.theme = themeValue
          applyTheme()
        }
        const rateLimitValue = (nextSettings as { historyRateLimitMs?: unknown }).historyRateLimitMs
        if (typeof rateLimitValue === 'number') {
          const nextRate = clampHistoryRateLimit(rateLimitValue)
          if (nextRate !== state.historyRateLimitMs) {
            state.historyRateLimitMs = nextRate
            rerenderSettingsIfOpen()
          }
        }
        const nextSeasonPref = (nextSettings as { useSeasonSubdir?: unknown }).useSeasonSubdir
        if (typeof nextSeasonPref === 'boolean') {
          syncSeasonPreference(nextSeasonPref)
        }
        const prevSeasonPref =
          prevSettings && typeof prevSettings === 'object'
            ? (prevSettings as { useSeasonSubdir?: unknown }).useSeasonSubdir
            : undefined
        if (typeof prevSeasonPref === 'boolean' && typeof nextSeasonPref !== 'boolean') {
          syncSeasonPreference(null)
        }
      }
    }

    const historyChange = changes[HISTORY_KEY]
    if (historyChange) {
      const prepared = prepareHistoryRecords(historyChange.newValue)
      state.historyRecords = prepared.records
      state.historyGroups = prepared.groups
      history.applyHistoryToCurrentPage()
      history.renderHistoryCard()
      if (getFloatingPanel()) {
        renderResourceList()
      }
    }

    const sizeChange = changes[SIZE_KEY]
    if (sizeChange) {
      if (typeof sizeChange.newValue === 'undefined') {
        syncPanelSizeFromStorage(null)
      } else {
        const nextSize = normalizePanelSizeSnapshot(sizeChange.newValue)
        if (nextSize) {
          syncPanelSizeFromStorage(nextSize)
        }
      }
    }

    const positionChange = changes[POSITION_KEY]
    if (positionChange) {
      if (typeof positionChange.newValue === 'undefined') {
        syncPanelPositionFromStorage(null)
      } else {
        const nextPosition = normalizePanelPositionSnapshot(positionChange.newValue)
        if (nextPosition) {
          syncPanelPositionFromStorage(nextPosition)
        }
      }
    }

    const pinChange = changes[PIN_STATE_KEY]
    if (pinChange) {
      if (typeof pinChange.newValue === 'undefined') {
        syncPinStateFromStorage(false)
      } else {
        const nextPinned = normalizePinState(pinChange.newValue)
        if (typeof nextPinned === 'boolean') {
          syncPinStateFromStorage(nextPinned)
        }
      }
    }

    const edgeChange = changes[EDGE_STATE_KEY]
    if (edgeChange) {
      if (typeof edgeChange.newValue === 'undefined') {
        syncEdgeStateFromStorage(null)
      } else {
        const nextEdge = normalizeEdgeState(edgeChange.newValue)
        if (nextEdge) {
          syncEdgeStateFromStorage(nextEdge)
        }
      }
    }
  }

  const handleRuntimeMessage: MessageListener = (message, _sender, sendResponse) => {
    const messageRecord =
      message && typeof message === 'object'
        ? (message as { type?: unknown; [key: string]: unknown })
        : null
    const messageType = messageRecord?.type

    if (messageType === 'chaospace:collect-links') {
      analyzePageForMessage()
        .then((result) => {
          sendResponse(result)
        })
        .catch((error) => {
          chaosLogger.error('[Pan Transfer] Message handler error:', error)
          sendResponse({ items: [], url: '', origin: '', title: '', poster: null })
        })
      return true
    }

    if (messageType === 'chaospace:transfer-progress') {
      setStatusProgress(message)
    }

    return false
  }

  chrome.storage.onChanged.addListener(handleStorageChange)
  chrome.runtime.onMessage.addListener(handleRuntimeMessage)

  return () => {
    chrome.storage.onChanged.removeListener(handleStorageChange)
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
  }
}
