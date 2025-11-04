import { state } from '../../state'
import { HISTORY_KEY, STORAGE_KEY } from '../../constants'
import { prepareHistoryRecords } from '../../services/history-service'
import { clampHistoryRateLimit } from '../../components/settings-modal'
import type { createHistoryController } from '../../history/controller'

type HistoryController = ReturnType<typeof createHistoryController>

export function registerChromeEvents(deps: {
  history: HistoryController
  applyTheme: () => void
  rerenderSettingsIfOpen: () => void
  renderResourceList: () => void
  setStatusProgress: (progress: unknown) => void
  getFloatingPanel: () => HTMLElement | null
  analyzePageForMessage: () => Promise<unknown>
}): void {
  const {
    history,
    applyTheme,
    rerenderSettingsIfOpen,
    renderResourceList,
    setStatusProgress,
    getFloatingPanel,
    analyzePageForMessage,
  } = deps

  chrome.storage.onChanged.addListener((changes, areaName) => {
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
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'chaospace:collect-links') {
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

    if (message?.type === 'chaospace:transfer-progress') {
      setStatusProgress(message)
    }

    return false
  })
}
