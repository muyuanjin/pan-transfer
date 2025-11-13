import { state } from '../../state'
import { disableElementDrag } from '../../utils/dom'
import { sanitizeCssUrl } from '../../utils/format'
import type { PanelHeaderDomRefs, PanelTransferDomRefs } from '../../types'

export interface HeaderPresenter {
  updateHeader: () => void
  updateTransferButton: () => void
}

interface HeaderPresenterDeps {
  headerDom: PanelHeaderDomRefs
  transferDom: PanelTransferDomRefs
}

export function createHeaderPresenter({
  headerDom,
  transferDom,
}: HeaderPresenterDeps): HeaderPresenter {
  const updateHeader = (): void => {
    const hasPoster = Boolean(state.poster?.src)

    if (headerDom.showTitle) {
      const title = state.pageTitle || state.poster?.alt || '等待选择剧集'
      headerDom.showTitle.textContent = title
    }

    if (headerDom.header) {
      headerDom.header.classList.toggle('has-poster', hasPoster)
    }

    if (headerDom.headerArt) {
      if (hasPoster && state.poster?.src) {
        const safeUrl = sanitizeCssUrl(state.poster.src)
        headerDom.headerArt.style.backgroundImage = `url("${safeUrl}")`
        headerDom.headerArt.classList.remove('is-empty')
      } else {
        headerDom.headerArt.style.backgroundImage = ''
        headerDom.headerArt.classList.add('is-empty')
      }
    }

    if (headerDom.headerPoster) {
      disableElementDrag(headerDom.headerPoster)
      if (hasPoster && state.poster?.src) {
        headerDom.headerPoster.src = state.poster.src
        headerDom.headerPoster.alt = state.poster.alt || ''
        headerDom.headerPoster.style.display = 'block'
        headerDom.headerPoster.dataset['action'] = 'preview-poster'
        headerDom.headerPoster.dataset['src'] = state.poster.src
        headerDom.headerPoster.dataset['alt'] = state.poster.alt || state.pageTitle || ''
        headerDom.headerPoster.classList.add('is-clickable')
      } else {
        headerDom.headerPoster.removeAttribute('src')
        headerDom.headerPoster.alt = ''
        headerDom.headerPoster.style.display = 'none'
        delete headerDom.headerPoster.dataset['action']
        delete headerDom.headerPoster.dataset['src']
        delete headerDom.headerPoster.dataset['alt']
        headerDom.headerPoster.classList.remove('is-clickable')
      }
    }
  }

  const updateTransferButton = (): void => {
    const transferButton = transferDom.transferButton
    const transferLabel = transferDom.transferLabel
    const transferSpinner = transferDom.transferSpinner
    if (!transferButton || !transferLabel) {
      return
    }
    const count = state.selectedIds.size
    const isRunning = state.transferStatus === 'running'
    transferButton.disabled = isRunning || count === 0
    transferButton.classList.toggle('is-loading', isRunning)
    if (transferSpinner) {
      transferSpinner.classList.toggle('is-visible', isRunning)
    }
    transferLabel.textContent = isRunning
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
