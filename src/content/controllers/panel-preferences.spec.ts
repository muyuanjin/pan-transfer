import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { createPanelPreferencesController } from './panel-preferences'
import { state, panelDom } from '../state'
import { STORAGE_KEY } from '../constants'
import { getPanelBaseDirDom } from '../types'

vi.mock('../utils/storage', () => {
  return {
    safeStorageGet: vi.fn(),
    safeStorageSet: vi.fn(),
  }
})

import { safeStorageGet, safeStorageSet } from '../utils/storage'

describe('panel preferences controller', () => {
  const panelBaseDirDom = getPanelBaseDirDom(panelDom)
  beforeEach(() => {
    vi.useFakeTimers()
    state.$reset()
    state.seasonSubdirDefault = false
    state.useSeasonSubdir = false
    state.seasonPreferenceScope = 'default'
    panelDom.useSeasonCheckbox = document.createElement('input')
    panelDom.useSeasonCheckbox.type = 'checkbox'
    panelDom.settingsUseSeason = document.createElement('input')
    panelDom.settingsUseSeason.type = 'checkbox'
    panelDom.baseDirInput = document.createElement('input')
    panelDom.baseDirInput.value = '/'
    panelDom.addPresetButton = document.createElement('button')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('loads global default without overriding tab scope', async () => {
    state.useSeasonSubdir = false
    state.seasonPreferenceScope = 'tab'
    ;(safeStorageGet as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      [STORAGE_KEY]: {
        useSeasonSubdir: true,
      },
    })
    const onSeasonDefaultChange = vi.fn()

    const controller = createPanelPreferencesController({
      state,
      panelDom: panelBaseDirDom,
      document,
      getFloatingPanel: () => document.createElement('div'),
      renderSeasonHint: vi.fn(),
      updateSeasonExampleDir: vi.fn(),
      getTargetPath: () => '/',
      showToast: vi.fn(),
      onSeasonDefaultChange,
    })

    await controller.loadSettings()

    expect(state.seasonSubdirDefault).toBe(true)
    expect(state.useSeasonSubdir).toBe(false)
    expect(onSeasonDefaultChange).toHaveBeenCalledWith(true)
  })

  it('persists global default when saving settings', async () => {
    state.seasonSubdirDefault = true
    state.useSeasonSubdir = true
    const onSeasonDefaultChange = vi.fn()
    const controller = createPanelPreferencesController({
      state,
      panelDom: panelBaseDirDom,
      document,
      getFloatingPanel: () => document.createElement('div'),
      renderSeasonHint: vi.fn(),
      updateSeasonExampleDir: vi.fn(),
      getTargetPath: () => '/',
      showToast: vi.fn(),
      onSeasonDefaultChange,
    })

    ;(safeStorageSet as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)

    controller.saveSettings()
    await vi.runOnlyPendingTimersAsync()

    expect(safeStorageSet).toHaveBeenCalledWith(
      {
        [STORAGE_KEY]: expect.objectContaining({
          useSeasonSubdir: true,
        }),
      },
      'settings',
    )
  })
})
