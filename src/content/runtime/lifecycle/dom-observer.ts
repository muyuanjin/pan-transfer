import { chaosLogger } from '@/shared/log'
import {
  INITIAL_PANEL_DELAY_MS,
  PANEL_CREATION_MAX_ATTEMPTS,
  PANEL_CREATION_RETRY_DELAY_MS,
} from '../../constants'

interface DomLifecycleDeps {
  createPanel: () => Promise<boolean>
  hasPanel: () => boolean
  isCreating: () => boolean
  analyzePage: () => Promise<{ items?: unknown[] }>
}

export interface DomLifecycleController {
  scheduleInitialPanelCreation: () => void
  cancelInitialPanelCreation: () => void
  observeDomChanges: () => void
  disconnect: () => void
}

export function createDomLifecycle({
  createPanel,
  hasPanel,
  isCreating,
  analyzePage,
}: DomLifecycleDeps): DomLifecycleController {
  let mutationObserver: MutationObserver | null = null
  let mutationObserverTimer: number | null = null
  let initialCreationTimer: number | null = null
  let retryTimer: number | null = null
  let attempts = 0

  const clearInitialCreationTimer = (): void => {
    if (initialCreationTimer) {
      window.clearTimeout(initialCreationTimer)
      initialCreationTimer = null
    }
  }

  const clearRetryTimer = (): void => {
    if (retryTimer) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  const cancelInitialPanelCreation = (): void => {
    attempts = 0
    clearInitialCreationTimer()
    clearRetryTimer()
  }

  const tryCreate = async (): Promise<void> => {
    if (hasPanel() || isCreating()) {
      return
    }
    attempts += 1
    const created = await createPanel()
    if (created || hasPanel()) {
      cancelInitialPanelCreation()
      return
    }
    if (attempts < PANEL_CREATION_MAX_ATTEMPTS) {
      clearRetryTimer()
      retryTimer = window.setTimeout(() => {
        void tryCreate()
      }, PANEL_CREATION_RETRY_DELAY_MS)
    }
  }

  const scheduleInitialPanelCreation = (): void => {
    cancelInitialPanelCreation()
    if (INITIAL_PANEL_DELAY_MS <= 0) {
      void tryCreate()
      return
    }
    initialCreationTimer = window.setTimeout(() => {
      void tryCreate()
    }, INITIAL_PANEL_DELAY_MS)
  }

  const observeDomChanges = (): void => {
    if (mutationObserver) {
      return
    }
    const observer = new MutationObserver(() => {
      if (mutationObserverTimer) {
        window.clearTimeout(mutationObserverTimer)
      }
      mutationObserverTimer = window.setTimeout(async () => {
        try {
          if (!hasPanel() && !isCreating()) {
            const data = await analyzePage()
            if (Array.isArray(data.items) && data.items.length > 0) {
              await createPanel()
            }
          }
        } catch (error) {
          chaosLogger.error('[Pan Transfer] Observer error:', error)
        }
      }, 1000)
    })

    const targetNode = document.body
    if (targetNode) {
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
      })
      mutationObserver = observer
    }
  }

  const disconnect = (): void => {
    cancelInitialPanelCreation()
    mutationObserver?.disconnect()
    mutationObserver = null
    if (mutationObserverTimer) {
      window.clearTimeout(mutationObserverTimer)
      mutationObserverTimer = null
    }
  }

  return {
    scheduleInitialPanelCreation,
    cancelInitialPanelCreation,
    observeDomChanges,
    disconnect,
  }
}
