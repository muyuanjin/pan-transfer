import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { createTabSeasonPreferenceController } from './tab-season-preference'
import { bindSeasonManagerDomRefs } from './season-manager'
import { state, panelDom } from '../state'
import { getPanelBaseDirDom, getPanelResourceDom, getPanelSeasonDom } from '../types'

const panelBaseDirDom = getPanelBaseDirDom(panelDom)
const panelResourceDom = getPanelResourceDom(panelDom)
const panelSeasonDom = getPanelSeasonDom(panelDom)

describe('tab-season-preference controller', () => {
  let originalChrome: typeof chrome | undefined
  let sendMessageMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalChrome = globalThis.chrome
    sendMessageMock = vi.fn()
    const runtimeMock = {
      sendMessage: sendMessageMock,
    } as unknown as typeof chrome.runtime
    ;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: runtimeMock,
    } as unknown as typeof chrome
    state.$reset()
    state.seasonSubdirDefault = false
    state.useSeasonSubdir = false
    state.seasonPreferenceScope = 'default'
    state.seasonPreferenceTabId = null
    state.items = [{ id: 'item-1', title: 'Episode 1', order: 0, seasonId: 's-1', seasonIndex: 0 }]
    window.history.replaceState({}, '', '/tvshows/123.html')
    const useSeasonCheckbox = document.createElement('input')
    useSeasonCheckbox.type = 'checkbox'
    panelDom.set('useSeasonCheckbox', useSeasonCheckbox)
    const settingsUseSeason = document.createElement('input')
    settingsUseSeason.type = 'checkbox'
    panelDom.set('settingsUseSeason', settingsUseSeason)
    panelDom.set('seasonRow', document.createElement('div'))
    bindSeasonManagerDomRefs({
      baseDir: panelBaseDirDom,
      resource: panelResourceDom,
      season: panelSeasonDom,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalChrome) {
      globalThis.chrome = originalChrome
    } else {
      delete (globalThis as { chrome?: unknown }).chrome
    }
  })

  it('initializes from stored session preference', async () => {
    sendMessageMock.mockResolvedValueOnce({ ok: true, tabId: 12, value: true })

    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()

    const controller = createTabSeasonPreferenceController({
      getFloatingPanel: () => document.createElement('div'),
      renderResourceList,
      renderPathPreview,
      panelDom: panelBaseDirDom,
    })

    await controller.initialize()

    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'chaospace:season-pref:init' })
    expect(state.useSeasonSubdir).toBe(true)
    expect(state.seasonPreferenceScope).toBe('tab')
    expect(state.seasonPreferenceTabId).toBe(12)
    expect(renderResourceList).toHaveBeenCalled()
    expect(renderPathPreview).toHaveBeenCalled()
  })

  it('defers forced season renders until items hydrate', async () => {
    state.items = []
    state.seasonSubdirDefault = true
    sendMessageMock.mockResolvedValueOnce({ ok: true, tabId: 22, value: null })

    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()

    const controller = createTabSeasonPreferenceController({
      getFloatingPanel: () => document.createElement('div'),
      renderResourceList,
      renderPathPreview,
      panelDom: panelBaseDirDom,
    })

    await controller.initialize()

    expect(state.useSeasonSubdir).toBe(true)
    expect(renderResourceList).not.toHaveBeenCalled()
    expect(renderPathPreview).toHaveBeenCalled()
    expect(panelDom.get('useSeasonCheckbox')?.checked).toBe(true)
  })

  it('persists user override to session storage', async () => {
    sendMessageMock.mockImplementation((message) => {
      if ((message as { type?: string }).type === 'chaospace:season-pref:init') {
        return Promise.resolve({ ok: true, tabId: 8, value: null })
      }
      if ((message as { type?: string }).type === 'chaospace:season-pref:update') {
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true })
    })

    const controller = createTabSeasonPreferenceController({
      getFloatingPanel: () => document.createElement('div'),
      renderResourceList: vi.fn(),
      renderPathPreview: vi.fn(),
      panelDom: panelBaseDirDom,
    })

    await controller.applyUserSelection(true)

    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'chaospace:season-pref:init' })
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'chaospace:season-pref:update',
      payload: { value: true },
    })
    expect(state.useSeasonSubdir).toBe(true)
    expect(state.seasonPreferenceScope).toBe('tab')
  })

  it('keeps history-driven preference changes scoped to the current page', async () => {
    sendMessageMock.mockImplementation((message) => {
      if ((message as { type?: string }).type === 'chaospace:season-pref:init') {
        return Promise.resolve({ ok: true, tabId: 11, value: null })
      }
      if ((message as { type?: string }).type === 'chaospace:season-pref:update') {
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true })
    })

    const renderResourceList = vi.fn()
    const renderPathPreview = vi.fn()

    const controller = createTabSeasonPreferenceController({
      getFloatingPanel: () => document.createElement('div'),
      renderResourceList,
      renderPathPreview,
      panelDom: panelBaseDirDom,
    })

    await controller.applyHistorySelection(true)

    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'chaospace:season-pref:init' })
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chaospace:season-pref:update' }),
    )
    expect(state.useSeasonSubdir).toBe(true)
    expect(state.seasonPreferenceScope).toBe('history')
    expect(panelDom.get('useSeasonCheckbox')?.checked).toBe(true)
    expect(renderResourceList).toHaveBeenCalled()
    expect(renderPathPreview).toHaveBeenCalled()
  })

  it('clears session override when matching global default', async () => {
    state.seasonSubdirDefault = false
    sendMessageMock.mockImplementation((message) => {
      if ((message as { type?: string }).type === 'chaospace:season-pref:init') {
        return Promise.resolve({ ok: true, tabId: 9, value: true })
      }
      if ((message as { type?: string }).type === 'chaospace:season-pref:clear') {
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true })
    })

    const controller = createTabSeasonPreferenceController({
      getFloatingPanel: () => document.createElement('div'),
      renderResourceList: vi.fn(),
      renderPathPreview: vi.fn(),
      panelDom: panelBaseDirDom,
    })

    await controller.initialize()
    expect(state.useSeasonSubdir).toBe(true)
    await controller.applyUserSelection(false)

    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'chaospace:season-pref:clear' })
    expect(state.useSeasonSubdir).toBe(false)
    expect(state.seasonPreferenceScope).toBe('default')
  })

  it('drops tab overrides when the global default changes', async () => {
    sendMessageMock.mockImplementation((message) => {
      if ((message as { type?: string }).type === 'chaospace:season-pref:init') {
        return Promise.resolve({ ok: true, tabId: 10, value: null })
      }
      if ((message as { type?: string }).type === 'chaospace:season-pref:update') {
        return Promise.resolve({ ok: true })
      }
      if ((message as { type?: string }).type === 'chaospace:season-pref:clear') {
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true })
    })

    const controller = createTabSeasonPreferenceController({
      getFloatingPanel: () => document.createElement('div'),
      renderResourceList: vi.fn(),
      renderPathPreview: vi.fn(),
      panelDom: panelBaseDirDom,
    })

    await controller.applyUserSelection(true)
    expect(state.useSeasonSubdir).toBe(true)
    expect(state.seasonPreferenceScope).toBe('tab')

    controller.handleGlobalDefaultChange(true)

    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'chaospace:season-pref:clear' })
    expect(state.useSeasonSubdir).toBe(true)
    expect(state.seasonSubdirDefault).toBe(true)
    expect(state.seasonPreferenceScope).toBe('default')
    expect(panelDom.get('useSeasonCheckbox')?.checked).toBe(true)
    expect(panelDom.get('settingsUseSeason')?.checked).toBe(true)
  })
})
