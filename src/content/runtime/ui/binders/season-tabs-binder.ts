import type { PanelResourceDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import { closestElement } from '../../../utils/dom'
import type { Binder } from './types'
import { createAbortableBinder } from './abortable-binder'

interface SeasonTabsBinderDeps {
  panelDom: PanelResourceDomRefs
  state: ContentStore
  renderResourceList: () => void
}

export function createSeasonTabsBinder({
  panelDom,
  state,
  renderResourceList,
}: SeasonTabsBinderDeps): Binder {
  return {
    bind(): () => void {
      const tabs = panelDom.seasonTabs ?? null
      if (!tabs) {
        return () => {}
      }

      return createAbortableBinder((add) => {
        add(tabs, 'click', (event) => {
          const button = closestElement<HTMLButtonElement>(event.target, 'button[data-season-id]')
          if (!button || button.disabled) {
            return
          }
          const nextId = button.dataset?.['seasonId']
          if (!nextId || nextId === state.activeSeasonId) {
            return
          }
          state.activeSeasonId = nextId
          renderResourceList()
          if (panelDom.itemsContainer) {
            panelDom.itemsContainer.scrollTop = 0
          }
        })
      })
    },
  }
}
