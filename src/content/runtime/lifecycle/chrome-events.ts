import { state } from '../../state'
import { HISTORY_KEY, STORAGE_KEY } from '../../constants'
import { prepareHistoryRecords } from '../../services/history-service'
import { clampHistoryRateLimit } from '../../components/settings-modal'
import type { createHistoryController } from '../../history/controller'

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
  setStatusProgress: (progress: unknown) => void
  getFloatingPanel: () => HTMLElement | null
  analyzePageForMessage: () => Promise<unknown>
}): () => void {
  const {
    history,
    applyTheme,
    rerenderSettingsIfOpen,
    renderResourceList,
    syncSeasonPreference,
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
      const nextTheme = settingsChange.newValue.theme
      if ((nextTheme === 'light' || nextTheme === 'dark') && nextTheme !== state.theme) {
        state.theme = nextTheme
        applyTheme()
      }
      if (typeof settingsChange.newValue.historyRateLimitMs === 'number') {
        const nextRate = clampHistoryRateLimit(settingsChange.newValue.historyRateLimitMs)
        if (nextRate !== state.historyRateLimitMs) {
          state.historyRateLimitMs = nextRate
          rerenderSettingsIfOpen()
        }
      }
      const nextSeasonPref = settingsChange.newValue.useSeasonSubdir
      const prevSeasonPref = settingsChange.oldValue?.useSeasonSubdir
      if (typeof nextSeasonPref === 'boolean') {
        syncSeasonPreference(nextSeasonPref)
      } else if (typeof prevSeasonPref === 'boolean' && typeof nextSeasonPref !== 'boolean') {
        syncSeasonPreference(null)
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
          console.error('[Chaospace Transfer] Message handler error:', error)
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
