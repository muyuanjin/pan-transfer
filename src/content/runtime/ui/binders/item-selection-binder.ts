import type { PanelResourceDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import { closestElement } from '../../../utils/dom'
import type { Binder } from './types'
import { createAbortableBinder } from './abortable-binder'

interface ItemSelectionBinderDeps {
  panelDom: PanelResourceDomRefs
  state: ContentStore
  renderResourceSummary: () => void
  updateTransferButton: () => void
}

export function createItemSelectionBinder({
  panelDom,
  state,
  renderResourceSummary,
  updateTransferButton,
}: ItemSelectionBinderDeps): Binder {
  return {
    bind(): () => void {
      const container = panelDom.itemsContainer
      if (!container) {
        throw new Error('[Pan Transfer] Missing resource items container binding')
      }

      return createAbortableBinder((add) => {
        add(container, 'change', (event) => {
          const checkbox = closestElement<HTMLInputElement>(
            event.target,
            '.chaospace-item-checkbox',
          )
          if (!checkbox) {
            return
          }
          const row = checkbox.closest<HTMLElement>('.chaospace-item')
          const id = row?.dataset?.['id']
          if (!id) {
            return
          }
          if (checkbox.checked) {
            state.selectedIds.add(id)
          } else {
            state.selectedIds.delete(id)
          }
          if (row) {
            row.classList.toggle('is-muted', !checkbox.checked)
          }
          renderResourceSummary()
          updateTransferButton()
        })
      })
    },
  }
}
