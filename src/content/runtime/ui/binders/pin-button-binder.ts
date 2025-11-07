import type { PanelEdgeDomRefs } from '../../../types'
import type { Binder } from './types'

interface PinButtonBinderDeps {
  panelDom: PanelEdgeDomRefs
  getPinnedState: () => boolean
  onPinChange: (nextPinned: boolean, context: { event: MouseEvent }) => void
}

export function createPinButtonBinder({
  panelDom,
  getPinnedState,
  onPinChange,
}: PinButtonBinderDeps): Binder {
  return {
    bind(): () => void {
      const pinBtn = panelDom.pinButton
      if (!pinBtn) {
        return () => {}
      }
      const handleClick = (event: MouseEvent) => {
        const nextPinnedState = !getPinnedState()
        onPinChange(nextPinnedState, { event })
      }

      pinBtn.addEventListener('click', handleClick)

      return () => {
        pinBtn.removeEventListener('click', handleClick)
      }
    },
  }
}
