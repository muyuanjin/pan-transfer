import { createSettingsModal } from '../../components/settings-modal'
import type { ToastHandler } from '../../components/toast'
import { safeStorageRemove, safeStorageSet } from '../../utils/storage'
import type { PanelRuntimeState, PanelSettingsDomRefs } from '../../types'
import type { createPanelPreferencesController } from '../../controllers/panel-preferences'
import type { createHistoryController } from '../../history/controller'
import type { PanelShellInstance, SettingsModalHandle } from '../types'
import { PIN_STATE_KEY, POSITION_KEY, SIZE_KEY } from '../../constants'
import { renderSeasonHint } from '../../services/season-manager'
import type { TabSeasonPreferenceController } from '../../services/tab-season-preference'

type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>
type HistoryController = ReturnType<typeof createHistoryController>

interface SettingsCoordinatorDeps {
  document: Document
  panelState: PanelRuntimeState
  preferences: PanelPreferencesController
  history: HistoryController
  renderResourceList: () => void
  showToast: ToastHandler
  seasonPreference: TabSeasonPreferenceController
  panelDom: PanelSettingsDomRefs
}

export interface SettingsCoordinator {
  attachToShell: (shell: PanelShellInstance) => SettingsModalHandle
}

export function createSettingsCoordinator({
  document,
  panelState,
  preferences,
  history,
  renderResourceList,
  showToast,
  seasonPreference,
  panelDom,
}: SettingsCoordinatorDeps): SettingsCoordinator {
  const attachToShell = (shell: PanelShellInstance): SettingsModalHandle => {
    const {
      applyPanelSize,
      applyPanelPosition,
      getPanelBounds,
      scheduleEdgeHide,
      cancelEdgeHide,
      applyEdgeHiddenPosition,
    } = shell

    panelState.getPanelBounds = getPanelBounds
    panelState.scheduleEdgeHide = scheduleEdgeHide
    panelState.cancelEdgeHide = cancelEdgeHide
    panelState.applyEdgeHiddenPosition = applyEdgeHiddenPosition
    panelState.applyPanelSize = applyPanelSize
    panelState.applyPanelPosition = applyPanelPosition

    const handleResetLayout = async () => {
      try {
        await safeStorageRemove([POSITION_KEY, SIZE_KEY, PIN_STATE_KEY], 'panel geometry reset')
        const bounds = getPanelBounds()
        const defaultWidth = Math.min(640, bounds.maxWidth)
        const defaultHeight = Math.min(520, bounds.maxHeight)
        applyPanelSize(defaultWidth, defaultHeight)
        const defaultPosition = applyPanelPosition(undefined, undefined)
        panelState.lastKnownPosition = defaultPosition
        panelState.edgeState.isHidden = false
        applyEdgeHiddenPosition()
        cancelEdgeHide({ show: true })
        showToast('success', '布局已重置', '面板大小与位置已恢复默认值')
      } catch (error) {
        console.error('[Chaospace Transfer] Failed to reset layout', error)
        const message = error instanceof Error ? error.message : '无法重置面板布局'
        showToast('error', '重置失败', message)
      }
    }

    return createSettingsModal({
      document,
      floatingPanel: shell.panel,
      panelState,
      panelDom,
      scheduleEdgeHide,
      cancelEdgeHide,
      applyPanelSize,
      applyPanelPosition,
      showToast,
      setBaseDir: (value, options) => {
        const normalized = options || {}
        preferences.setBaseDir(value, {
          persist:
            typeof normalized['persist'] === 'boolean' ? (normalized['persist'] as boolean) : true,
          fromPreset:
            typeof normalized['fromPreset'] === 'boolean'
              ? (normalized['fromPreset'] as boolean)
              : false,
          lockOverride:
            typeof normalized['lockOverride'] === 'boolean'
              ? (normalized['lockOverride'] as boolean)
              : null,
        })
      },
      renderSeasonHint,
      renderResourceList,
      applyPanelTheme: () => preferences.applyPanelTheme(),
      saveSettings: () => {
        void preferences.saveSettings()
      },
      safeStorageSet,
      safeStorageRemove,
      loadSettings: () => preferences.loadSettings(),
      loadHistory: () => history.loadHistory(),
      closeHistoryDetail: (options) => history.closeHistoryDetail(options),
      onResetLayout: handleResetLayout,
      handleSeasonDefaultChange: (value) => seasonPreference.handleGlobalDefaultChange(value),
    })
  }

  return {
    attachToShell,
  }
}
