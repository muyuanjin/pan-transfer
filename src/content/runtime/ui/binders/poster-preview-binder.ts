import type { PanelHeaderDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createHistoryController } from '../../../history/controller'
import { closestElement } from '../../../utils/dom'
import type { Binder } from './types'

type HistoryController = ReturnType<typeof createHistoryController>

interface PosterPreviewBinderDeps {
  panelDom: PanelHeaderDomRefs
  state: ContentStore
  history: HistoryController
  getFloatingPanel: () => HTMLElement | null
}

export function createPosterPreviewBinder({
  panelDom,
  state,
  history,
  getFloatingPanel,
}: PosterPreviewBinderDeps): Binder {
  return {
    bind(): () => void {
      const abort = new AbortController()
      const { signal } = abort

      if (panelDom.headerPoster) {
        panelDom.headerPoster.addEventListener(
          'click',
          () => {
            const src = panelDom.headerPoster?.dataset?.['src']
            if (!src) {
              return
            }
            window.openZoomPreview?.({
              src,
              alt:
                panelDom.headerPoster?.dataset?.['alt'] ||
                panelDom.headerPoster?.alt ||
                state.pageTitle ||
                '',
            })
          },
          { signal },
        )
      }

      const panel = getFloatingPanel()
      if (panel) {
        panel.addEventListener(
          'click',
          (event) => {
            const toggleBtn = closestElement<HTMLElement>(
              event.target,
              '[data-role="history-toggle"]',
            )
            if (!toggleBtn || !panel.contains(toggleBtn)) {
              return
            }
            if (!state.historyGroups.length) {
              return
            }
            history.toggleHistoryExpanded()
          },
          { signal },
        )
      }

      return () => abort.abort()
    },
  }
}
