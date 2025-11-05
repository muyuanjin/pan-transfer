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

  const scheduleInitialPanelCreation = (): void => {
    let attempts = 0
    const tryCreate = async () => {
      if (hasPanel() || isCreating()) {
        return
      }
      attempts += 1
      const created = await createPanel()
      if (created || hasPanel()) {
        return
      }
      if (attempts < PANEL_CREATION_MAX_ATTEMPTS) {
        window.setTimeout(tryCreate, PANEL_CREATION_RETRY_DELAY_MS)
      }
    }

    if (INITIAL_PANEL_DELAY_MS <= 0) {
      void tryCreate()
    } else {
      window.setTimeout(() => void tryCreate(), INITIAL_PANEL_DELAY_MS)
    }
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
          console.error('[Chaospace Transfer] Observer error:', error)
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
    mutationObserver?.disconnect()
    mutationObserver = null
    if (mutationObserverTimer) {
      window.clearTimeout(mutationObserverTimer)
      mutationObserverTimer = null
    }
  }

  return {
    scheduleInitialPanelCreation,
    observeDomChanges,
    disconnect,
  }
}
