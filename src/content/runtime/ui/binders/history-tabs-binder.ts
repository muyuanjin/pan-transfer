import { closestElement } from '../../../utils/dom'
import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createHistoryController } from '../../../history/controller'
import type { Binder } from './types'

type HistoryController = ReturnType<typeof createHistoryController>

interface HistoryTabsBinderDeps {
  panelDom: PanelDomRefs
  state: ContentStore
  history: HistoryController
}

export function createHistoryTabsBinder({
  panelDom,
  state,
  history,
}: HistoryTabsBinderDeps): Binder {
  return {
    bind(): () => void {
      const tabs = panelDom.historyTabs
      if (!tabs) {
        return () => {}
      }

      const updateSelectedTab = (): void => {
        tabs.querySelectorAll<HTMLElement>('[data-filter]').forEach((button) => {
          const value = button.dataset?.['filter'] || 'all'
          button.classList.toggle('is-active', value === state.historyFilter)
          button.setAttribute('aria-pressed', value === state.historyFilter ? 'true' : 'false')
        })
      }

      updateSelectedTab()

      const handleClick = (event: Event): void => {
        const tab = closestElement<HTMLButtonElement>(event.target, '[data-filter]')
        if (!tab || tab.classList.contains('is-active')) {
          return
        }
        const filter = tab.dataset?.['filter'] || 'all'
        history.setHistoryFilter(filter)
        updateSelectedTab()
      }

      tabs.addEventListener('click', handleClick)

      return () => {
        tabs.removeEventListener('click', handleClick)
      }
    },
  }
}
