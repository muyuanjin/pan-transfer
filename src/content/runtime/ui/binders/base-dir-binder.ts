import { normalizeDir } from '../../../services/page-analyzer'
import type { PanelBaseDirDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { createPanelPreferencesController } from '../../../controllers/panel-preferences'
import type { ToastHandler } from '../../../components/toast'
import type { Binder } from './types'
import type { TabSeasonPreferenceController } from '../../../services/tab-season-preference'

type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>

interface BaseDirBinderDeps {
  panelDom: PanelBaseDirDomRefs
  state: ContentStore
  preferences: PanelPreferencesController
  showToast: ToastHandler
  seasonPreference: TabSeasonPreferenceController
}

export function createBaseDirBinder({
  panelDom,
  state,
  preferences,
  showToast,
  seasonPreference,
}: BaseDirBinderDeps): Binder {
  return {
    bind(): () => void {
      const abort = new AbortController()
      const { signal } = abort
      const add = <T extends EventTarget>(
        target: T | null | undefined,
        event: string,
        handler: EventListenerOrEventListenerObject,
      ) => {
        target?.addEventListener(event, handler, { signal })
      }

      if (panelDom.baseDirInput) {
        panelDom.baseDirInput.value = state.baseDir

        add(panelDom.baseDirInput, 'change', () => {
          preferences.setBaseDir(panelDom.baseDirInput?.value ?? state.baseDir)
        })

        add(panelDom.baseDirInput, 'input', () => {
          if (!panelDom.baseDirInput) {
            return
          }
          panelDom.baseDirInput.dataset['dirty'] = 'true'
          panelDom.baseDirInput.classList.remove('is-invalid')
          state.baseDir = normalizeDir(panelDom.baseDirInput.value)
          preferences.renderPathPreview()
        })

        add(panelDom.baseDirInput, 'keydown', (event) => {
          if ((event as KeyboardEvent).key !== 'Enter') {
            return
          }
          event.preventDefault()
          if (!panelDom.baseDirInput) {
            return
          }
          preferences.setBaseDir(panelDom.baseDirInput.value)
          const preset = preferences.ensurePreset(panelDom.baseDirInput.value)
          if (preset) {
            showToast('success', '已收藏路径', `${preset} 已加入候选列表`)
          }
          preferences.renderPresets()
        })
      }

      if (panelDom.useTitleCheckbox) {
        panelDom.useTitleCheckbox.checked = state.useTitleSubdir
        add(panelDom.useTitleCheckbox, 'change', () => {
          state.useTitleSubdir = Boolean(panelDom.useTitleCheckbox?.checked)
          void preferences.saveSettings()
          preferences.renderPathPreview()
        })
      }

      if (panelDom.useSeasonCheckbox) {
        panelDom.useSeasonCheckbox.checked = state.useSeasonSubdir
        add(panelDom.useSeasonCheckbox, 'change', () => {
          const nextValue = Boolean(panelDom.useSeasonCheckbox?.checked)
          void seasonPreference.applyUserSelection(nextValue)
        })
      }

      if (panelDom.addPresetButton) {
        add(panelDom.addPresetButton, 'click', () => {
          const preset = preferences.ensurePreset(
            panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir,
          )
          if (preset) {
            preferences.setBaseDir(preset, { fromPreset: true })
            showToast('success', '已收藏路径', `${preset} 已加入候选列表`)
          }
        })
      }

      if (panelDom.themeToggle) {
        add(panelDom.themeToggle, 'click', () => {
          const nextTheme = state.theme === 'dark' ? 'light' : 'dark'
          preferences.setTheme(nextTheme)
        })
      }

      return () => abort.abort()
    },
  }
}
