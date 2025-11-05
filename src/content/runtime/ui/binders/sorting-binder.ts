import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { Binder } from './types'

interface SortingBinderDeps {
  panelDom: PanelDomRefs
  state: ContentStore
  renderResourceList: () => void
}

export function createSortingBinder({
  panelDom,
  state,
  renderResourceList,
}: SortingBinderDeps): Binder {
  return {
    bind(): () => void {
      const abort = new AbortController()
      const { signal } = abort

      if (panelDom.sortKeySelect) {
        panelDom.sortKeySelect.value = state.sortKey
        panelDom.sortKeySelect.addEventListener(
          'change',
          () => {
            if (!panelDom.sortKeySelect) {
              return
            }
            state.sortKey = panelDom.sortKeySelect.value as 'page' | 'title'
            renderResourceList()
          },
          { signal },
        )
      }

      if (panelDom.sortOrderButton) {
        const refreshOrderButton = () => {
          if (!panelDom.sortOrderButton) {
            return
          }
          panelDom.sortOrderButton.textContent = state.sortOrder === 'asc' ? '正序' : '倒序'
        }
        refreshOrderButton()
        panelDom.sortOrderButton.addEventListener(
          'click',
          () => {
            state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
            refreshOrderButton()
            renderResourceList()
          },
          { signal },
        )
      }

      return () => abort.abort()
    },
  }
}
