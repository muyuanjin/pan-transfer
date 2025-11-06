import { buildPanDirectoryUrl } from '../../../services/page-analyzer'
import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createHistoryController } from '../../../history/controller'
import type { Binder } from './types'
import {
  HISTORY_LIST_ACTION_EVENT,
  HISTORY_SUMMARY_TOGGLE_EVENT,
  type HistoryListAction,
} from '../../../components/history/history-events'
import type { HistoryDetailOverrides as HistoryDetailOverridesInput } from '../../../components/history-detail'

type HistoryController = ReturnType<typeof createHistoryController>

interface HistoryListBinderDeps {
  panelDom: PanelDomRefs
  state: ContentStore
  history: HistoryController
}

export function createHistoryListBinder({
  panelDom,
  state,
  history,
}: HistoryListBinderDeps): Binder {
  const handleListAction = (event: Event): void => {
    const customEvent = event as CustomEvent<HistoryListAction | null | undefined>
    const action = customEvent.detail
    if (!action) {
      return
    }
    switch (action.type) {
      case 'select': {
        history.setHistorySelection(action.groupKey, action.selected)
        break
      }
      case 'toggle-season': {
        history.setHistorySeasonExpanded(action.groupKey, action.expanded)
        break
      }
      case 'open-detail': {
        const overrides: HistoryDetailOverridesInput = {}
        if (action.scope === 'season') {
          if (action.pageUrl) {
            overrides.pageUrl = action.pageUrl
          }
          if (action.title) {
            overrides.title = action.title
          }
          if (action.poster) {
            overrides.poster = {
              src: action.poster.src,
              alt: action.poster.alt || action.title || '',
            }
          } else if (typeof overrides.title === 'string' || typeof overrides.pageUrl === 'string') {
            overrides.poster = null
          }
        }
        history.openHistoryDetail(action.groupKey, overrides)
        break
      }
      case 'open-url': {
        if (!action.url) {
          break
        }
        window.open(action.url, '_blank', 'noopener')
        break
      }
      case 'open-pan': {
        const targetUrl = action.url || buildPanDirectoryUrl(action.path || '/')
        window.open(targetUrl, '_blank', 'noopener')
        break
      }
      case 'trigger-update': {
        if (!action.pageUrl) {
          break
        }
        history.triggerHistoryUpdate(action.pageUrl, action.button ?? undefined)
        break
      }
      case 'preview-poster': {
        if (!action.src) {
          break
        }
        window.openZoomPreview?.({
          src: action.src,
          alt: action.alt || '',
        })
        break
      }
      default:
        break
    }
  }

  const handleSummaryToggle = (): void => {
    if (!state.historyRecords.length) {
      return
    }
    history.toggleHistoryExpanded()
  }

  return {
    bind(): () => void {
      const historyList = panelDom.get('historyList')
      const historySummaryBody = panelDom.get('historySummaryBody')

      if (!historyList) {
        return () => {}
      }

      const abort = new AbortController()
      const { signal } = abort

      historyList.addEventListener(HISTORY_LIST_ACTION_EVENT, handleListAction as EventListener, {
        signal,
      })

      if (historySummaryBody) {
        historySummaryBody.addEventListener(
          HISTORY_SUMMARY_TOGGLE_EVENT,
          handleSummaryToggle as EventListener,
          { signal },
        )
      }

      return () => abort.abort()
    },
  }
}
