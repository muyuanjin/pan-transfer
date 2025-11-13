import type { PanelHeaderDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createHistoryController } from '../../../history/controller'
import { closestElement } from '../../../utils/dom'
import type { Binder } from './types'
import { createAbortableBinder } from './abortable-binder'

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
      return createAbortableBinder((add) => {
        if (panelDom.headerPoster) {
          add(panelDom.headerPoster, 'click', () => {
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
          })
        }

        const panel = getFloatingPanel()
        if (panel) {
          add(panel, 'click', (event) => {
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
          })
        }
      })
    },
  }
}
