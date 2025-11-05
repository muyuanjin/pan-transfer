import { closestElement } from '../../../utils/dom'
import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createPanelPreferencesController } from '../../../controllers/panel-preferences'

type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>

interface PresetsBinderDeps {
  panelDom: PanelDomRefs
  state: ContentStore
  preferences: PanelPreferencesController
}

export function createPresetsBinder({ panelDom, state, preferences }: PresetsBinderDeps): {
  bind: () => () => void
} {
  return {
    bind(): () => void {
      if (!panelDom.presetList) {
        return () => {}
      }

      const abort = new AbortController()
      const { signal } = abort

      panelDom.presetList.addEventListener(
        'click',
        (event) => {
          if (state.transferStatus === 'running') {
            return
          }
          const target = closestElement<HTMLButtonElement>(
            event.target,
            'button[data-action][data-value]',
          )
          if (!target) {
            return
          }
          const { action, value } = target.dataset as { action?: string; value?: string }
          if (action === 'select' && value) {
            preferences.setBaseDir(value, { fromPreset: true })
          } else if (action === 'remove' && value) {
            preferences.removePreset(value)
          }
        },
        { signal },
      )

      return () => abort.abort()
    },
  }
}
