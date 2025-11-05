import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import { closestElement } from '../../../utils/dom'
import type { Binder } from './types'

interface SeasonTabsBinderDeps {
  panelDom: PanelDomRefs
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

      const abort = new AbortController()
      const { signal } = abort

      tabs.addEventListener(
        'click',
        (event) => {
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
        },
        { signal },
      )

      return () => abort.abort()
    },
  }
}
