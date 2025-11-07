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
    const useSeasonCheckbox = document.createElement('input')
    useSeasonCheckbox.type = 'checkbox'
    panelDom.set('useSeasonCheckbox', useSeasonCheckbox)
    const settingsUseSeason = document.createElement('input')
    settingsUseSeason.type = 'checkbox'
    panelDom.set('settingsUseSeason', settingsUseSeason)
    const baseDirInput = document.createElement('input')
    baseDirInput.value = '/'
    panelDom.set('baseDirInput', baseDirInput)
    panelDom.set('addPresetButton', document.createElement('button'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('loads global default without overriding tab scope', async () => {
    state.useSeasonSubdir = false
    state.seasonPreferenceScope = 'tab'
    vi.mocked(safeStorageGet).mockResolvedValueOnce({
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

    vi.mocked(safeStorageSet).mockResolvedValueOnce(undefined)

    controller.saveSettings()
    await vi.runOnlyPendingTimersAsync()

    const firstCall = vi.mocked(safeStorageSet).mock.calls[0]
    expect(firstCall?.[0]).toMatchObject({
      [STORAGE_KEY]: { useSeasonSubdir: true },
    })
    expect(firstCall?.[1]).toBe('settings')
  })
})
