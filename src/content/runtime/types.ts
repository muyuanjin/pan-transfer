import type { mountPanelShell } from '../components/panel'
import type { createSettingsModal } from '../components/settings-modal'

export type PanelShellInstance = Awaited<ReturnType<typeof mountPanelShell>>
export type SettingsModalHandle = ReturnType<typeof createSettingsModal>

export interface PanelCreationResult {
  panel: HTMLElement
  shell: PanelShellInstance
  settings: SettingsModalHandle
}
