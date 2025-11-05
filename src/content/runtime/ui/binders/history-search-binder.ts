import { ref, watch } from 'vue'
import { onKeyStroke, refDebounced, useEventListener } from '@vueuse/core'
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
      const disposeFns: Array<() => void> = []
      const initialValue = state.historySearchTerm || ''
      input.value = initialValue
      const searchTerm = ref(initialValue)
      const debouncedSearch = refDebounced(searchTerm, 250)

      const updateClearButtonState = (value: string): void => {
        if (!clearBtn) {
          return
        }
        const hasValue = Boolean(value)
        clearBtn.hidden = !hasValue
        clearBtn.disabled = !hasValue
      }

      updateClearButtonState(initialValue)

      const stopWatch = watch(
        debouncedSearch,
        (value) => {
          history.setHistorySearchTerm(value)
          updateClearButtonState(value)
        },
        { immediate: true },
      )
      disposeFns.push(stopWatch)

      disposeFns.push(
        useEventListener(input, 'input', () => {
          searchTerm.value = input.value
          updateClearButtonState(input.value)
        }),
      )

      disposeFns.push(
        onKeyStroke(
          'Escape',
          (event) => {
            if (!input.value) {
              return
            }
            event.preventDefault()
            searchTerm.value = ''
            input.value = ''
            history.setHistorySearchTerm('')
            updateClearButtonState('')
            input.focus()
          },
          { target: input },
        ),
      )

      if (clearBtn) {
        disposeFns.push(
          useEventListener(clearBtn, 'click', () => {
            if (!input.value && !state.historySearchTerm) {
              return
            }
            searchTerm.value = ''
            input.value = ''
            history.setHistorySearchTerm('')
            updateClearButtonState('')
            input.focus()
          }),
        )
      }

      return () => {
        disposeFns.forEach((stop) => stop())
      }
    },
  }
}
