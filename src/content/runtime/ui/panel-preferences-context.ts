import type { InjectionKey } from 'vue'
import type { createPanelPreferencesController } from '../../controllers/panel-preferences'

export type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>

export const panelPreferencesContextKey: InjectionKey<PanelPreferencesController> = Symbol(
  'ChaospacePanelPreferencesContext',
)
