import type { ContentStore } from '../state'
import type { DetailDomRefs, PanelDomRefs, PanelRuntimeState } from '../types'

interface PanelEdgeControllerOptions {
  state: ContentStore
  panelState: PanelRuntimeState
  panelDom: PanelDomRefs
  detailDom: DetailDomRefs
  getFloatingPanel: () => HTMLElement | null
}

export interface PanelEdgeController {
  handleDocumentPointerDown: (event: PointerEvent) => void
  updatePinButton: () => void
}

function isHistoryOverlayTarget(target: Node | null, detailDom: DetailDomRefs): boolean {
  if (!target) {
    return false
  }
  const modal = detailDom['modal']
  if (modal && modal.contains(target)) {
    return true
  }
  const backdrop = detailDom['backdrop']
  if (backdrop && backdrop.contains(target)) {
    return true
  }
  return false
}

export function createPanelEdgeController(
  options: PanelEdgeControllerOptions,
): PanelEdgeController {
  const { state, panelState, panelDom, detailDom, getFloatingPanel } = options

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    const panel = getFloatingPanel()
    if (!panel || panelState.isPinned) {
      return
    }

    const target = event.target
    if (!(target instanceof Node)) {
      return
    }
    if (panel.contains(target)) {
      return
    }
    if (target instanceof Element && target.closest('.zi-overlay')) {
      return
    }
    if (state.historyDetail?.isOpen && isHistoryOverlayTarget(target, detailDom)) {
      return
    }

    panelState.pointerInside = false
    panel.classList.remove('is-hovering')
    panel.classList.add('is-leaving')

    if (typeof panelState.scheduleEdgeHide === 'function') {
      panelState.scheduleEdgeHide(0)
    }
  }

  const updatePinButton = (): void => {
    const pinButton = panelDom['pinBtn']
    const panel = getFloatingPanel()
    if (!pinButton) {
      if (panel) {
        panel.classList.toggle('is-pinned', panelState.isPinned)
      }
      return
    }

    const label = panelState.isPinned ? '取消固定面板' : '固定面板'
    pinButton.textContent = '📌'
    pinButton.title = label
    pinButton.setAttribute('aria-label', label)
    pinButton.setAttribute('aria-pressed', panelState.isPinned ? 'true' : 'false')
    pinButton.classList.toggle('is-active', panelState.isPinned)
    if (panel) {
      panel.classList.toggle('is-pinned', panelState.isPinned)
    }
  }

  return {
    handleDocumentPointerDown,
    updatePinButton,
  }
}
