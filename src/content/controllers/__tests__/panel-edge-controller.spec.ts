import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPanelEdgeController } from '../panel-edge-controller'
import { createPanelRuntimeState } from '../../runtime/panel-state'
import { state } from '../../state'
import type { DetailDomRefs, PanelEdgeDomRefs } from '../../types'

describe('panel-edge-controller', () => {
  let panel: HTMLElement
  let pinButton: HTMLButtonElement
  let panelDom: PanelEdgeDomRefs
  let detailDom: DetailDomRefs

  beforeEach(() => {
    state.$reset()
    panel = document.createElement('div')
    panel.className = 'chaospace-floating-panel is-hovering'
    document.body.appendChild(panel)

    pinButton = document.createElement('button')
    detailDom = {}
    panelDom = {
      get pinButton() {
        return pinButton
      },
    }
  })

  afterEach(() => {
    panel.remove()
  })

  function buildController(overrides: Partial<ReturnType<typeof createPanelRuntimeState>> = {}) {
    const panelState = createPanelRuntimeState()
    Object.assign(panelState, overrides)
    return {
      controller: createPanelEdgeController({
        state,
        panelState,
        panelDom,
        detailDom,
        getFloatingPanel: () => panel,
      }),
      panelState,
    }
  }

  it('hides the floating panel when pointerdown happens outside', () => {
    const scheduleEdgeHide = vi.fn()
    const { controller, panelState } = buildController({
      pointerInside: true,
      scheduleEdgeHide,
    })
    const outsideTarget = document.createElement('div')

    controller.handleDocumentPointerDown({ target: outsideTarget } as unknown as PointerEvent)

    expect(panelState.pointerInside).toBe(false)
    expect(panel.classList.contains('is-hovering')).toBe(false)
    expect(panel.classList.contains('is-leaving')).toBe(true)
    expect(scheduleEdgeHide).toHaveBeenCalledWith(0)
  })

  it('ignores overlay clicks when history detail is open', () => {
    const scheduleEdgeHide = vi.fn()
    state.historyDetail.isOpen = true
    const overlay = document.createElement('div')
    detailDom['modal'] = overlay
    const { controller } = buildController({
      pointerInside: true,
      scheduleEdgeHide,
    })

    controller.handleDocumentPointerDown({ target: overlay } as unknown as PointerEvent)

    expect(scheduleEdgeHide).not.toHaveBeenCalled()
    expect(panel.classList.contains('is-leaving')).toBe(false)
    expect(panel.classList.contains('is-hovering')).toBe(true)
  })

  it('syncs the pin button label, aria state, and panel class', () => {
    const { controller, panelState } = buildController({
      isPinned: true,
    })

    controller.updatePinButton()

    expect(pinButton.textContent).toBe('📌')
    expect(pinButton.title).toBe('取消固定面板')
    expect(pinButton.getAttribute('aria-label')).toBe('取消固定面板')
    expect(pinButton.getAttribute('aria-pressed')).toBe('true')
    expect(pinButton.classList.contains('is-active')).toBe(true)
    expect(panel.classList.contains('is-pinned')).toBe(true)

    panelState.isPinned = false
    controller.updatePinButton()

    expect(pinButton.title).toBe('固定面板')
    expect(pinButton.getAttribute('aria-pressed')).toBe('false')
    expect(panel.classList.contains('is-pinned')).toBe(false)
  })
})
