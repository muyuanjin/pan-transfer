import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderSeasonControls, ensureSeasonSubdirDefault } from './season-manager'
import { state, panelDom } from '../state'

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
    state.hasSeasonSubdirPreference = false
    state.baseDir = '/'
    state.pageTitle = 'Sample Show'
    state.useTitleSubdir = true
    state.transferStatus = 'idle'
    state.seasonDirMap = {}
    state.seasonResolvedPaths = []
    panelDom.seasonRow = null
    panelDom.useSeasonCheckbox = null
  })

  it('defaults to season subdirectories for single-season tv shows without preference', () => {
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

    ensureSeasonSubdirDefault()

    expect(state.useSeasonSubdir).toBe(true)
  })

  it('also enables season subdirectories on standalone season pages', () => {
    resetLocation('/seasons/428609.html')
    state.items = [
      {
        id: 'r1',
        title: 'Season 1 E01',
        order: 0,
        seasonId: '428609',
        seasonIndex: 0,
      },
    ]

    ensureSeasonSubdirDefault()

    expect(state.useSeasonSubdir).toBe(true)
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
    panelDom.seasonRow = seasonRow
    panelDom.useSeasonCheckbox = seasonCheckbox

    renderSeasonControls()

    expect(seasonRow.style.display).toBe('flex')
    expect(seasonCheckbox.checked).toBe(true)
    expect(seasonCheckbox.disabled).toBe(false)
  })
})
