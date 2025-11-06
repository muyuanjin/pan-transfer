import { buildPanDirectoryUrl } from '../../../services/page-analyzer'
import { closestElement } from '../../../utils/dom'
import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createHistoryController } from '../../../history/controller'
import type { Binder } from './types'

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
  const toggleSeasonGroup = (toggle: HTMLElement, groupKey: string): void => {
    const expanded = state.historySeasonExpanded.has(groupKey)
    if (expanded) {
      state.historySeasonExpanded.delete(groupKey)
    } else {
      state.historySeasonExpanded.add(groupKey)
    }
    const isExpanded = state.historySeasonExpanded.has(groupKey)
    toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false')
    toggle.textContent = isExpanded ? '收起季' : '展开季'
    const container = toggle.closest('.chaospace-history-item')
    const list = container?.querySelector('[data-role="history-season-list"]') as HTMLElement | null
    if (list) {
      list.hidden = !isExpanded
    }
    if (container) {
      container.classList.toggle('is-season-expanded', isExpanded)
    }
  }

  const handleHistoryAction = (button: HTMLButtonElement): void => {
    const action = button.dataset?.['action']
    if (action === 'preview-poster') {
      if (!button.disabled) {
        const src = button.dataset?.['src']
        if (src) {
          window.openZoomPreview?.({
            src,
            alt: button.dataset?.['alt'] || button.getAttribute('aria-label') || '',
          })
        }
      }
      return
    }

    if (button.disabled) {
      return
    }

    const url = button.dataset?.['url']
    if (action === 'open') {
      if (url) {
        window.open(url, '_blank', 'noopener')
      }
    } else if (action === 'open-pan') {
      const panUrl = url || buildPanDirectoryUrl('/')
      window.open(panUrl, '_blank', 'noopener')
    } else if (action === 'check') {
      if (url) {
        history.triggerHistoryUpdate(url, button)
      }
    }
  }

  return {
    bind(): () => void {
      if (!panelDom.historyList) {
        return () => {}
      }

      const abort = new AbortController()
      const { signal } = abort

      if (panelDom.historySummaryBody) {
        const toggleHistoryFromSummary = (): void => {
          if (!state.historyRecords.length) {
            return
          }
          history.toggleHistoryExpanded()
        }

        panelDom.historySummaryBody.addEventListener(
          'click',
          (event) => {
            const summaryEntry = closestElement<HTMLElement>(
              event.target,
              '[data-role="history-summary-entry"]',
            )
            if (!summaryEntry) {
              return
            }
            if (closestElement(event.target, '[data-role="history-toggle"]')) {
              return
            }
            toggleHistoryFromSummary()
          },
          { signal },
        )

        panelDom.historySummaryBody.addEventListener(
          'keydown',
          (event) => {
            if ((event as KeyboardEvent).key !== 'Enter' && (event as KeyboardEvent).key !== ' ') {
              return
            }
            const summaryEntry = closestElement<HTMLElement>(
              event.target,
              '[data-role="history-summary-entry"]',
            )
            if (!summaryEntry) {
              return
            }
            if (closestElement(event.target, '[data-role="history-toggle"]')) {
              return
            }
            event.preventDefault()
            toggleHistoryFromSummary()
          },
          { signal },
        )
      }

      panelDom.historyList.addEventListener(
        'click',
        (event) => {
          const target = event.target as HTMLElement | null
          if (!target) {
            return
          }

          const seasonToggle = closestElement<HTMLElement>(
            target,
            '[data-role="history-season-toggle"]',
          )
          if (seasonToggle) {
            const groupKey = seasonToggle.getAttribute('data-group-key')
            if (!groupKey) {
              return
            }
            toggleSeasonGroup(seasonToggle as HTMLElement, groupKey)
            event.preventDefault()
            return
          }

          const actionButton = closestElement<HTMLButtonElement>(target, 'button[data-action]')
          if (actionButton) {
            handleHistoryAction(actionButton as HTMLButtonElement)
            return
          }

          const seasonRow = closestElement<HTMLElement>(
            target,
            '.chaospace-history-season-item[data-detail-trigger="season"]',
          )
          if (
            seasonRow &&
            !target.closest('.chaospace-history-actions') &&
            !target.closest('button') &&
            !target.closest('input')
          ) {
            const groupKey = seasonRow.getAttribute('data-group-key')
            if (groupKey) {
              const pageUrl = seasonRow.getAttribute('data-page-url') || ''
              const title = seasonRow.getAttribute('data-title') || ''
              const posterSrc = seasonRow.getAttribute('data-poster-src') || ''
              const posterAlt = seasonRow.getAttribute('data-poster-alt') || title
              const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null
              event.preventDefault()
              history.openHistoryDetail(groupKey, {
                pageUrl,
                title,
                poster,
              })
            }
            return
          }

          const detailTrigger = closestElement<HTMLElement>(
            target,
            '[data-action="history-detail"]',
          )
          if (detailTrigger) {
            const groupKey = detailTrigger.dataset?.['groupKey']
            if (groupKey) {
              event.preventDefault()
              history.openHistoryDetail(groupKey)
            }
            return
          }

          const historyItem = closestElement<HTMLElement>(
            target,
            '.chaospace-history-item[data-detail-trigger="group"]',
          )
          if (
            historyItem &&
            !target.closest('.chaospace-history-selector') &&
            !target.closest('.chaospace-history-actions') &&
            !target.closest('button') &&
            !target.closest('input') &&
            !target.closest('[data-role="history-season-toggle"]')
          ) {
            const groupKey = historyItem.getAttribute('data-group-key')
            if (groupKey) {
              history.openHistoryDetail(groupKey)
            }
          }
        },
        { signal },
      )

      panelDom.historyList.addEventListener(
        'change',
        (event) => {
          const checkbox = closestElement<HTMLInputElement>(
            event.target,
            'input[type="checkbox"][data-role="history-select-item"]',
          )
          if (!checkbox) {
            return
          }
          const groupKey = checkbox.dataset?.['groupKey']
          if (!groupKey) {
            return
          }
          history.setHistorySelection(groupKey, checkbox.checked)
        },
        { signal },
      )

      panelDom.historyList.addEventListener(
        'keydown',
        (event) => {
          if ((event as KeyboardEvent).key !== 'Enter' && (event as KeyboardEvent).key !== ' ') {
            return
          }
          if (closestElement(event.target, 'button, input')) {
            return
          }
          const seasonRow = closestElement<HTMLElement>(
            event.target,
            '.chaospace-history-season-item[data-detail-trigger="season"]',
          )
          if (seasonRow) {
            const groupKey = seasonRow.getAttribute('data-group-key')
            if (groupKey) {
              const pageUrl = seasonRow.getAttribute('data-page-url') || ''
              const title = seasonRow.getAttribute('data-title') || ''
              const posterSrc = seasonRow.getAttribute('data-poster-src') || ''
              const posterAlt = seasonRow.getAttribute('data-poster-alt') || title
              const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null
              event.preventDefault()
              history.openHistoryDetail(groupKey, {
                pageUrl,
                title,
                poster,
              })
            }
            return
          }

          const detailTrigger = closestElement<HTMLElement>(
            event.target,
            '[data-action="history-detail"]',
          )
          if (detailTrigger) {
            const groupKey = detailTrigger.dataset?.['groupKey']
            if (groupKey) {
              event.preventDefault()
              history.openHistoryDetail(groupKey)
            }
            return
          }

          const historyItem = closestElement<HTMLElement>(
            event.target,
            '.chaospace-history-item[data-detail-trigger="group"]',
          )
          if (historyItem) {
            const groupKey = historyItem.getAttribute('data-group-key')
            if (!groupKey) {
              return
            }
            event.preventDefault()
            history.openHistoryDetail(groupKey)
          }
        },
        { signal },
      )

      return () => abort.abort()
    },
  }
}
