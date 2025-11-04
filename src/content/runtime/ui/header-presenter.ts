import { state, panelDom } from '../../state'
import { disableElementDrag } from '../../utils/dom'
import { formatOriginLabel, sanitizeCssUrl } from '../../utils/format'

export interface HeaderPresenter {
  updateHeader: () => void
  updateTransferButton: () => void
}

export function createHeaderPresenter(): HeaderPresenter {
  const updateHeader = (): void => {
    const hasPoster = Boolean(state.poster?.src)

    if (panelDom.showTitle) {
      const title = state.pageTitle || state.poster?.alt || '等待选择剧集'
      panelDom.showTitle.textContent = title
    }

    if (panelDom.showSubtitle) {
      const label = formatOriginLabel(state.origin)
      const hasItemsArray = Array.isArray(state.items)
      const itemCount = hasItemsArray ? state.items.length : 0
      const infoParts: string[] = []
      if (label) {
        infoParts.push(`来源 ${label}`)
      }
      if (hasItemsArray) {
        infoParts.push(`解析到 ${itemCount} 项资源`)
      }
      if (state.completion?.label) {
        infoParts.push(state.completion.label)
      }
      panelDom.showSubtitle.textContent = infoParts.length
        ? infoParts.join(' · ')
        : '未检测到页面来源'
    }

    if (panelDom.header) {
      panelDom.header.classList.toggle('has-poster', hasPoster)
    }

    if (panelDom.headerArt) {
      if (hasPoster && state.poster?.src) {
        const safeUrl = sanitizeCssUrl(state.poster.src)
        panelDom.headerArt.style.backgroundImage = `url("${safeUrl}")`
        panelDom.headerArt.classList.remove('is-empty')
      } else {
        panelDom.headerArt.style.backgroundImage = ''
        panelDom.headerArt.classList.add('is-empty')
      }
    }

    if (panelDom.headerPoster) {
      disableElementDrag(panelDom.headerPoster)
      if (hasPoster && state.poster?.src) {
        panelDom.headerPoster.src = state.poster.src
        panelDom.headerPoster.alt = state.poster.alt || ''
        panelDom.headerPoster.style.display = 'block'
        panelDom.headerPoster.dataset['action'] = 'preview-poster'
        panelDom.headerPoster.dataset['src'] = state.poster.src
        panelDom.headerPoster.dataset['alt'] = state.poster.alt || state.pageTitle || ''
        panelDom.headerPoster.classList.add('is-clickable')
      } else {
        panelDom.headerPoster.removeAttribute('src')
        panelDom.headerPoster.alt = ''
        panelDom.headerPoster.style.display = 'none'
        delete panelDom.headerPoster.dataset['action']
        delete panelDom.headerPoster.dataset['src']
        delete panelDom.headerPoster.dataset['alt']
        panelDom.headerPoster.classList.remove('is-clickable')
      }
    }
  }

  const updateTransferButton = (): void => {
    if (!panelDom.transferBtn || !panelDom.transferLabel) {
      return
    }
    const count = state.selectedIds.size
    const isRunning = state.transferStatus === 'running'
    panelDom.transferBtn.disabled = isRunning || count === 0
    panelDom.transferBtn.classList.toggle('is-loading', isRunning)
    if (panelDom.transferSpinner) {
      panelDom.transferSpinner.classList.toggle('is-visible', isRunning)
    }
    panelDom.transferLabel.textContent = isRunning
      ? '正在转存...'
      : count > 0
        ? `转存选中 ${count} 项`
        : '请选择资源'
  }

  return {
    updateHeader,
    updateTransferButton,
  }
}
