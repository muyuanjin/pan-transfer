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
    applyPanelSize: null,
    applyPanelPosition: null,
    lastKnownSize: null,
    detachWindowResize: null,
    documentPointerDownBound: false,
    getPanelBounds: null,
    lastKnownPosition: { left: 16, top: 16 },
    edgeStateChange: null,
  }
}

export function resetPanelRuntimeState(target: PanelRuntimeState): void {
  const next = createPanelRuntimeState()
  const edgeChange = target.edgeStateChange
  const previousPinned = target.isPinned
  const record = target as Record<string, unknown>
  for (const key of Object.keys(record)) {
    delete record[key]
  }
  Object.assign(target, next)
  target.edgeStateChange = edgeChange ?? null
  if (typeof previousPinned === 'boolean') {
    target.isPinned = previousPinned
  }
}
