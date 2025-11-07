import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bindSeasonManagerDomRefs, renderSeasonControls } from './season-manager'
import { state, panelDom } from '../state'
import { getPanelBaseDirDom, getPanelResourceDom, getPanelSeasonDom } from '../types'

bindSeasonManagerDomRefs({
  baseDir: getPanelBaseDirDom(panelDom),
  resource: getPanelResourceDom(panelDom),
  season: getPanelSeasonDom(panelDom),
})

function resetLocation(pathname = '/'): void {
  const url = new URL(`https://www.chaospace.cc${pathname}`)
  try {
    window.history.replaceState({}, '', url.toString())
  } catch {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: url.toString(),
        origin: url.origin,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        assign: vi.fn(),
        replace: vi.fn(),
        reload: vi.fn(),
        toString() {
          return url.toString()
        },
      },
    })
  }
}

describe('season-manager', () => {
  beforeEach(() => {
    resetLocation('/')
    state.items = []
    state.useSeasonSubdir = false
    state.seasonSubdirDefault = false
    state.seasonPreferenceScope = 'default'
    state.seasonPreferenceTabId = null
    state.baseDir = '/'
    state.pageTitle = 'Sample Show'
    state.useTitleSubdir = true
    state.transferStatus = 'idle'
    state.seasonDirMap = {}
    state.seasonResolvedPaths = []
    panelDom.set('seasonRow', null)
    panelDom.set('useSeasonCheckbox', null)
  })

  it('does not auto-enable season subdirectories without explicit preference', () => {
    resetLocation('/tvshows/428628.html')
    state.items = [
      {
        id: 'r1',
        title: 'Season 1 E01',
        order: 0,
        seasonId: 's1',
        seasonIndex: 0,
      },
    ]
    const seasonRow = document.createElement('label')
    seasonRow.style.display = 'none'
    const seasonCheckbox = document.createElement('input')
    seasonCheckbox.type = 'checkbox'
    seasonCheckbox.checked = true
    panelDom.set('seasonRow', seasonRow)
    panelDom.set('useSeasonCheckbox', seasonCheckbox)

    renderSeasonControls()

    expect(seasonRow.style.display).toBe('flex')
    expect(seasonCheckbox.checked).toBe(false)
  })

  it('shows season controls for single-season tv shows and keeps checkbox synced', () => {
    resetLocation('/tvshows/428628.html')
    state.items = [
      {
        id: 'r1',
        title: 'Season 1 E01',
        order: 0,
        seasonId: 's1',
        seasonIndex: 0,
      },
    ]
    state.useSeasonSubdir = true

    const seasonRow = document.createElement('label')
    seasonRow.style.display = 'none'
    const seasonCheckbox = document.createElement('input')
    seasonCheckbox.type = 'checkbox'
    seasonCheckbox.checked = false
    panelDom.set('seasonRow', seasonRow)
    panelDom.set('useSeasonCheckbox', seasonCheckbox)

    renderSeasonControls()

    expect(seasonRow.style.display).toBe('flex')
    expect(seasonCheckbox.checked).toBe(true)
    expect(seasonCheckbox.disabled).toBe(false)
  })
})
