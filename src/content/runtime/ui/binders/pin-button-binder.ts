import type { PanelDomRefs, PanelRuntimeState } from '../../../types'
import type { createPanelEdgeController } from '../../../controllers/panel-edge-controller'
import type { Binder } from './types'

type PanelEdgeController = ReturnType<typeof createPanelEdgeController>

interface PinButtonBinderDeps {
  panelDom: PanelDomRefs
  panelState: PanelRuntimeState
  edgeController: PanelEdgeController
  scheduleEdgeHide: ((delay?: number) => void) | null
  cancelEdgeHide: ((options?: { show?: boolean }) => void) | null
}

export function createPinButtonBinder({
  panelDom,
  panelState,
  edgeController,
  scheduleEdgeHide,
  cancelEdgeHide,
}: PinButtonBinderDeps): Binder {
  return {
    bind(): () => void {
      const pinBtn = panelDom.pinBtn
      if (!pinBtn) {
        return () => {}
      }
      const handleClick = (event: MouseEvent) => {
        const nextPinnedState = !panelState.isPinned
        panelState.isPinned = nextPinnedState
        edgeController.updatePinButton()

        if (nextPinnedState) {
          cancelEdgeHide?.({ show: true })
          return
        }

        const isPointerLikeActivation =
          (typeof event.detail === 'number' && event.detail > 0) ||
          (typeof event.clientX === 'number' &&
            typeof event.clientY === 'number' &&
            (event.clientX !== 0 || event.clientY !== 0))

        if (isPointerLikeActivation && typeof pinBtn.blur === 'function') {
          pinBtn.blur()
        }

        if (!panelState.pointerInside) {
          scheduleEdgeHide?.()
        }
      }

      pinBtn.addEventListener('click', handleClick)

      return () => {
        pinBtn.removeEventListener('click', handleClick)
      }
    },
  }
}
