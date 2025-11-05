import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createHistoryController } from '../../../history/controller'
import type { Binder } from './types'

type HistoryController = ReturnType<typeof createHistoryController>

interface HistorySearchBinderDeps {
  panelDom: PanelDomRefs
  state: ContentStore
  history: HistoryController
}

export function createHistorySearchBinder({
  panelDom,
  state,
  history,
}: HistorySearchBinderDeps): Binder {
  return {
    bind(): () => void {
      const input = panelDom.historySearch ?? null
      if (!input) {
        return () => {}
      }
      const clearBtn = panelDom.historySearchClear ?? null

      const abort = new AbortController()
      const { signal } = abort

      input.value = state.historySearchTerm || ''
      const handleInput = () => {
        history.setHistorySearchTerm(input.value)
        if (clearBtn) {
          clearBtn.hidden = !input.value
          clearBtn.disabled = !input.value
        }
      }
      const handleKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !input.value) {
          return
        }
        event.preventDefault()
        history.setHistorySearchTerm('')
        input.value = ''
        if (clearBtn) {
          clearBtn.hidden = true
          clearBtn.disabled = true
        }
        input.focus()
      }

      input.addEventListener('input', handleInput, { signal })
      input.addEventListener('keydown', handleKeydown, { signal })

      if (clearBtn) {
        clearBtn.hidden = !state.historySearchTerm
        clearBtn.disabled = !state.historySearchTerm
        const handleClear = () => {
          if (!input.value && !state.historySearchTerm) {
            return
          }
          history.setHistorySearchTerm('')
          input.value = ''
          clearBtn.hidden = true
          clearBtn.disabled = true
          input.focus()
        }
        clearBtn.addEventListener('click', handleClear, { signal })
      }

      return () => abort.abort()
    },
  }
}
