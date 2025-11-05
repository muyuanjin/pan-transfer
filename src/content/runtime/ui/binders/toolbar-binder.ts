import { closestElement } from '../../../utils/dom'
import type { createSelectionController } from '../selection-controller'
import type { createHistoryController } from '../../../history/controller'
import type { Binder } from './types'

type SelectionController = ReturnType<typeof createSelectionController>
type HistoryController = ReturnType<typeof createHistoryController>

interface ToolbarBinderDeps {
  getFloatingPanel: () => HTMLElement | null
  selection: SelectionController
  history: HistoryController
}

export function createToolbarBinder({
  getFloatingPanel,
  selection,
  history,
}: ToolbarBinderDeps): Binder {
  return {
    bind(): () => void {
      const panel = getFloatingPanel()
      const toolbar = panel?.querySelector('.chaospace-select-group') ?? null
      if (!toolbar) {
        return () => {}
      }

      const abort = new AbortController()
      const { signal } = abort

      toolbar.addEventListener(
        'click',
        (event) => {
          const button = closestElement<HTMLButtonElement>(event.target, 'button[data-action]')
          if (!button) {
            return
          }
          const action = button.dataset?.['action']
          if (action === 'select-all') {
            selection.selectAll(true)
          } else if (action === 'select-invert') {
            selection.invert()
          } else if (action === 'select-new') {
            history.selectNewItems()
          }
        },
        { signal },
      )

      return () => abort.abort()
    },
  }
}
