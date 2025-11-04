import { EDGE_HIDE_DEFAULT_PEEK } from '../constants'
import type { PanelRuntimeState } from '../types'

export function createPanelRuntimeState(): PanelRuntimeState {
  return {
    edgeState: { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK },
    pointerInside: false,
    lastPointerPosition: { x: Number.NaN, y: Number.NaN },
    isPinned: false,
    hideTimer: null,
    edgeAnimationTimer: null,
    edgeTransitionUnbind: null,
    scheduleEdgeHide: null,
    cancelEdgeHide: null,
    applyEdgeHiddenPosition: null,
    hidePanelToEdge: null,
    showPanelFromEdge: null,
    beginEdgeAnimation: null,
    lastKnownSize: null,
    detachWindowResize: null,
    documentPointerDownBound: false,
    getPanelBounds: null,
    lastKnownPosition: { left: 16, top: 16 },
  }
}
