import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPanelFactory } from '../panel-factory'
import { state } from '../../../state'
import { createPanelDomRefs } from '../../../types'
import { createPanelRuntimeState } from '../../panel-state'
import type { PanelShellInstance } from '../../types'

describe('panel-factory geometry restore', () => {
  const mountedPanels: HTMLElement[] = []

  beforeEach(() => {
    state.$reset()
  })

  afterEach(() => {
    mountedPanels.forEach((panel) => panel.remove())
    mountedPanels.length = 0
    vi.restoreAllMocks()
  })

  it('does not overwrite restored panel size/position after mount', async () => {
    const panelDom = createPanelDomRefs()
    const panelState = createPanelRuntimeState()

    let floatingPanel: HTMLElement | null = null
    const getFloatingPanel = vi.fn(() => floatingPanel)
    const setFloatingPanel = vi.fn((panel: HTMLElement | null) => {
      floatingPanel = panel
    })

    const scheduleEdgeHide = vi.fn()
    const syncPanelLayout = vi.fn()

    const mountPanelShell = vi.fn(async () => {
      const panel = document.createElement('div')
      panel.className = 'chaospace-float-panel'
      document.body.appendChild(panel)
      mountedPanels.push(panel)

      // Simulate mountPanelShell restoring geometry from storage.
      panelState.lastKnownSize = { width: 480, height: 520 }
      panelState.lastKnownPosition = { left: 100, top: 100 }

      const shell: PanelShellInstance = {
        panel,
        applyPanelSize: vi.fn(() => ({ width: 480, height: 520 })),
        applyPanelPosition: vi.fn(() => ({ left: 700, top: 16 })),
        getPanelBounds: vi.fn(() => ({
          minWidth: 360,
          minHeight: 380,
          maxWidth: 1168,
          maxHeight: 800,
        })),
        syncPanelLayout,
        lastKnownPosition: { left: 100, top: 100 },
        scheduleEdgeHide,
        cancelEdgeHide: vi.fn(),
        isPointerLikelyInsidePanel: vi.fn(),
        updatePointerPosition: vi.fn(),
        applyEdgeHiddenPosition: vi.fn(),
        destroy: vi.fn(),
      }
      return shell
    })

    const settingsCoordinator = {
      attachToShell: vi.fn(() => ({
        open: vi.fn(),
        close: vi.fn(),
        destroy: vi.fn(),
      })),
    }

    const factory = createPanelFactory({
      document,
      window,
      state,
      panelDom,
      panelState,
      preferences: {
        loadSettings: vi.fn().mockResolvedValue(undefined),
        applyPanelTheme: vi.fn(),
        setBaseDir: vi.fn(),
      } as unknown as never,
      edgeController: {
        handleDocumentPointerDown: vi.fn(),
        updatePinButton: vi.fn(),
      } as unknown as never,
      history: {
        loadHistory: vi.fn().mockResolvedValue(undefined),
        applyHistoryToCurrentPage: vi.fn(),
        renderHistoryDetail: vi.fn(),
      } as unknown as never,
      seasonLoader: {
        resetSeasonLoader: vi.fn(),
        ensureDeferredSeasonLoading: vi.fn().mockResolvedValue(undefined),
      } as unknown as never,
      hydrator: {
        normalizeDeferredSeasons: vi.fn(() => []),
        hydrate: vi.fn(),
      } as unknown as never,
      analyzePage: vi.fn(async () => ({
        classification: 'movie',
        classificationDetails: { classification: 'movie' },
        items: [{ id: '1', title: 'Sample', surl: 'surl', password: null }],
        deferredSeasons: [],
      })) as unknown as never,
      mountPanelShell,
      settingsCoordinator: settingsCoordinator as unknown as never,
      staticBinders: [],
      shellBinderFactories: [],
      getFloatingPanel,
      setFloatingPanel,
      showToast: vi.fn(),
      seasonPreference: {
        initialize: vi.fn().mockResolvedValue(undefined),
      } as unknown as never,
      hydratePinState: vi.fn().mockResolvedValue(undefined),
      hydrateEdgeState: vi.fn().mockResolvedValue(undefined),
      applyStoredEdgeState: vi.fn(),
      providerPreferences: {
        loadPreferences: vi.fn().mockResolvedValue(undefined),
      } as unknown as never,
      renderPanelState: vi.fn(),
    })

    const created = await factory.createPanel()

    expect(created).toBe(true)
    expect(panelState.lastKnownSize).toEqual({ width: 480, height: 520 })
    expect(panelState.lastKnownPosition).toEqual({ left: 100, top: 100 })
  })
})
