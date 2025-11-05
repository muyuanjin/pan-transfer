import { ALL_SEASON_TAB_ID, NO_SEASON_TAB_ID } from '../constants'
import { state, panelDom } from '../state'
import { normalizeDir, sanitizeSeasonDirSegment, deriveSeasonDirectory } from './page-analyzer'
import { extractCleanTitle } from '../utils/title'
import type { ResourceItem, SeasonResolvedPath } from '../types'

type SeasonTabType = 'all' | 'season' | 'misc'

interface SeasonTabItem {
  id: string
  name: string
  count: number
  type: SeasonTabType
  index: number
}

interface SeasonTabState {
  tabItems: SeasonTabItem[]
  activeId: string | null
  activeTab: SeasonTabItem | null
}

function isTvShowPage(): boolean {
  return /\/(tvshows|seasons)\/\d+\.html/.test(window.location.pathname)
}

function dedupeSeasonDirMap(): void {
  if (!state.seasonDirMap || typeof state.seasonDirMap !== 'object') {
    state.seasonDirMap = {}
    return
  }
  const used = new Map<string, number>()
  Object.entries(state.seasonDirMap).forEach(([key, name]) => {
    let sanitized = sanitizeSeasonDirSegment(name)
    if (!sanitized) {
      const fallbackKey =
        String(key || '')
          .replace(/[^a-zA-Z0-9]+/g, '')
          .slice(-6) || 'season'
      sanitized = `season-${fallbackKey}`
    }
    const base = sanitized
    let count = used.get(base) || 0
    let finalName = base
    while (used.has(finalName)) {
      count += 1
      finalName = `${base}-${count}`
    }
    used.set(base, count)
    used.set(finalName, 0)
    state.seasonDirMap[key] = finalName
  })
}

function getTargetPath(baseDir: string, useTitleSubdir: boolean, pageTitle: string): string {
  const normalizedBase = normalizeDir(baseDir)
  let targetDirectory = normalizedBase || '/'

  if (useTitleSubdir && pageTitle) {
    const cleanTitle = extractCleanTitle(pageTitle)
    targetDirectory = normalizedBase === '/' ? `/${cleanTitle}` : `${normalizedBase}/${cleanTitle}`
  }

  return targetDirectory
}

function updateSeasonExampleDir(): void {
  if (!state.useSeasonSubdir) {
    state.seasonResolvedPaths = []
    return
  }

  const base = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle)
  const resolved: SeasonResolvedPath[] = []
  const seen = new Set<string>()

  ;(state.items || []).forEach((item: ResourceItem | undefined) => {
    if (!item || !item.seasonId || seen.has(item.seasonId)) {
      return
    }
    const rawDir = state.seasonDirMap[item.seasonId]
    const safeDir = sanitizeSeasonDirSegment(rawDir)
    const path = safeDir ? (base === '/' ? `/${safeDir}` : `${base}/${safeDir}`) : base
    const label =
      item.seasonLabel ||
      `第${Number.isFinite(item.seasonIndex) ? Number(item.seasonIndex) + 1 : 1}季`
    resolved.push({
      id: item.seasonId,
      label,
      path,
    })
    seen.add(item.seasonId)
  })

  Object.entries(state.seasonDirMap || {}).forEach(([seasonId, rawDir]) => {
    if (seen.has(seasonId)) {
      return
    }
    const safeDir = sanitizeSeasonDirSegment(rawDir)
    const path = safeDir ? (base === '/' ? `/${safeDir}` : `${base}/${safeDir}`) : base
    const label = safeDir || (typeof rawDir === 'string' && rawDir.trim()) || `季 ${seasonId}`
    resolved.push({
      id: seasonId,
      label,
      path,
    })
  })

  state.seasonResolvedPaths = resolved
}

function computeItemTargetPath(item: ResourceItem | null | undefined, defaultPath: string): string {
  if (!state.useSeasonSubdir || !item || !item.seasonId) {
    return defaultPath
  }
  const cleanBase = normalizeDir(defaultPath || state.baseDir || '/')
  const seasonId = item.seasonId
  let dirName = state.seasonDirMap[seasonId]
  if (!dirName || !sanitizeSeasonDirSegment(dirName)) {
    dirName = deriveSeasonDirectory(item.seasonLabel, item.seasonIndex)
    if (!dirName) {
      dirName = `第${Number.isFinite(item.seasonIndex) ? Number(item.seasonIndex) + 1 : 1}季`
    }
    state.seasonDirMap[seasonId] = dirName
    dedupeSeasonDirMap()
    dirName = state.seasonDirMap[seasonId]
    if (state.useSeasonSubdir) {
      updateSeasonExampleDir()
      renderSeasonHint()
    }
  }
  const safeDir = sanitizeSeasonDirSegment(dirName)
  if (!safeDir) {
    return cleanBase
  }
  return cleanBase === '/' ? `/${safeDir}` : `${cleanBase}/${safeDir}`
}

function getAvailableSeasonIds(): string[] {
  return state.items.map((item) => item && item.seasonId).filter((id): id is string => Boolean(id))
}

function getSeasonCount(): number {
  return new Set(getAvailableSeasonIds()).size
}

function buildSeasonTabItems(): SeasonTabItem[] {
  const seasonMap = new Map<string, { id: string; name: string; count: number; index: number }>()
  let miscCount = 0
  let total = 0

  state.items.forEach((item: ResourceItem | undefined) => {
    if (!item) {
      return
    }
    total += 1
    if (item.seasonId) {
      const key = item.seasonId
      const normalizedLabel = typeof item.seasonLabel === 'string' ? item.seasonLabel.trim() : ''
      const numericSuffix = String(key).match(/\d+$/)
      const fallbackLabel = Number.isFinite(item.seasonIndex)
        ? `第${Number(item.seasonIndex) + 1}季`
        : numericSuffix
          ? `第${numericSuffix[0]}季`
          : `季 ${seasonMap.size + 1}`
      const label = normalizedLabel || fallbackLabel || '未知季'
      const index = Number.isFinite(item.seasonIndex)
        ? Number(item.seasonIndex)
        : Number.MAX_SAFE_INTEGER
      const existing = seasonMap.get(key)
      if (existing) {
        existing.count += 1
        existing.index = Math.min(existing.index, index)
        if (!existing.name && label) {
          existing.name = label
        }
      } else {
        seasonMap.set(key, {
          id: key,
          name: label,
          count: 1,
          index,
        })
      }
    } else {
      miscCount += 1
    }
  })

  const seasons: SeasonTabItem[] = Array.from(seasonMap.values()).map((entry) => ({
    id: entry.id,
    name: entry.name || '未知季',
    count: entry.count,
    type: 'season',
    index: Number.isFinite(entry.index) ? entry.index : Number.MAX_SAFE_INTEGER,
  }))

  seasons.sort((a, b) => {
    const indexDiff = a.index - b.index
    if (indexDiff !== 0) {
      return indexDiff
    }
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  const hasMultipleSeasons = seasons.length > 1
  if (!hasMultipleSeasons && miscCount === 0) {
    return []
  }

  const tabs: SeasonTabItem[] = []
  if (hasMultipleSeasons || (miscCount > 0 && seasons.length)) {
    tabs.push({
      id: ALL_SEASON_TAB_ID,
      name: '全部',
      count: total,
      type: 'all',
      index: -1,
    })
  }

  seasons.forEach((entry) => {
    tabs.push(entry)
  })

  if (miscCount > 0) {
    tabs.push({
      id: NO_SEASON_TAB_ID,
      name: '未分季',
      count: miscCount,
      type: 'misc',
      index: Number.MAX_SAFE_INTEGER,
    })
  }

  return tabs
}

function resolveActiveSeasonId(tabItems: SeasonTabItem[]): string | null {
  if (!tabItems || !tabItems.length) {
    return null
  }
  const availableIds = tabItems.map((tab) => tab.id)
  if (state.activeSeasonId && availableIds.includes(state.activeSeasonId)) {
    return state.activeSeasonId
  }
  const firstSeasonTab = tabItems.find((tab) => tab.type === 'season')
  if (firstSeasonTab) {
    return firstSeasonTab.id
  }
  const fallback = tabItems[0] ?? null
  return fallback ? fallback.id : null
}

function computeSeasonTabState({
  syncState = false,
}: { syncState?: boolean } = {}): SeasonTabState {
  const tabItems = buildSeasonTabItems()
  if (!tabItems.length) {
    if (syncState && state.activeSeasonId) {
      state.activeSeasonId = null
    }
    return { tabItems, activeId: null, activeTab: null }
  }
  const activeId = resolveActiveSeasonId(tabItems)
  if (syncState && state.activeSeasonId !== activeId) {
    state.activeSeasonId = activeId
  }
  const activeTab = tabItems.find((tab) => tab.id === activeId) || null
  return { tabItems, activeId, activeTab }
}

function filterItemsForActiveSeason(
  items: ResourceItem[],
  activeId: string | null,
): ResourceItem[] {
  if (!Array.isArray(items) || !items.length) {
    return []
  }
  if (!activeId || activeId === ALL_SEASON_TAB_ID) {
    return items
  }
  if (activeId === NO_SEASON_TAB_ID) {
    return items.filter((item) => item && !item.seasonId)
  }
  return items.filter((item) => item && item.seasonId === activeId)
}

function rebuildSeasonDirMap({
  preserveExisting = true,
}: { preserveExisting?: boolean } = {}): void {
  const existing = preserveExisting && state.seasonDirMap ? { ...state.seasonDirMap } : {}
  const next: Record<string, string> = {}
  state.items.forEach((item: ResourceItem | undefined) => {
    if (!item || !item.seasonId) {
      return
    }
    if (next[item.seasonId]) {
      return
    }
    let candidate = preserveExisting ? existing[item.seasonId] : ''
    if (!candidate || !String(candidate).trim()) {
      candidate = deriveSeasonDirectory(item.seasonLabel, item.seasonIndex)
    }
    if (!candidate) {
      candidate = `第${Number.isFinite(item.seasonIndex) ? Number(item.seasonIndex) + 1 : 1}季`
    }
    next[item.seasonId] = candidate
  })
  state.seasonDirMap = next
  dedupeSeasonDirMap()
  updateSeasonExampleDir()
}

function ensureSeasonSubdirDefault(): void {
  if (state.hasSeasonSubdirPreference) {
    return
  }
  const seasonCount = getSeasonCount()
  state.useSeasonSubdir = isTvShowPage() && seasonCount > 0
}

function renderSeasonHint(): void {
  const seasonPathHint = panelDom['seasonPathHint']
  if (!seasonPathHint) {
    return
  }
  const entries = state.seasonResolvedPaths || []
  const showHint = state.useSeasonSubdir && entries.length
  if (!showHint) {
    seasonPathHint.textContent = ''
    seasonPathHint.classList.add('is-empty')
    return
  }

  seasonPathHint.classList.remove('is-empty')
  seasonPathHint.textContent = ''

  const heading = document.createElement('div')
  heading.className = 'chaospace-path-heading'
  heading.textContent = '📂 实际转存路径'
  seasonPathHint.appendChild(heading)

  entries.forEach((entry) => {
    const row = document.createElement('div')
    row.className = 'chaospace-path-line'

    const labelSpan = document.createElement('span')
    labelSpan.className = 'chaospace-path-label chaospace-path-line-label'
    labelSpan.textContent = String(entry.label || '未命名季')
    row.appendChild(labelSpan)

    const valueSpan = document.createElement('span')
    valueSpan.className = 'chaospace-path-value chaospace-path-line-value'
    valueSpan.textContent = String(entry.path || '/')
    row.appendChild(valueSpan)

    seasonPathHint.appendChild(row)
  })
}

function renderSeasonControls(): void {
  const seasonRow = panelDom['seasonRow']
  const useSeasonCheckbox = panelDom['useSeasonCheckbox']
  const seasonCount = getSeasonCount()
  const shouldShow = isTvShowPage() && seasonCount > 0
  if (seasonRow) {
    seasonRow.style.display = shouldShow ? 'flex' : 'none'
  }
  if (useSeasonCheckbox) {
    useSeasonCheckbox.checked = shouldShow ? state.useSeasonSubdir : false
    useSeasonCheckbox.disabled = state.transferStatus === 'running'
  }
  if (shouldShow) {
    updateSeasonExampleDir()
  }
  renderSeasonHint()
}

function renderSeasonTabs(): SeasonTabState {
  const seasonTabs = panelDom['seasonTabs']
  if (!seasonTabs) {
    return computeSeasonTabState({ syncState: true })
  }

  const tabState = computeSeasonTabState({ syncState: true })
  const { tabItems, activeId } = tabState

  if (!tabItems.length) {
    seasonTabs.innerHTML = ''
    seasonTabs.hidden = true
    seasonTabs.setAttribute('aria-hidden', 'true')
    return tabState
  }

  seasonTabs.hidden = false
  seasonTabs.removeAttribute('aria-hidden')
  seasonTabs.innerHTML = ''

  const fragment = document.createDocumentFragment()
  tabItems.forEach((tab) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `chaospace-season-tab${tab.id === activeId ? ' is-active' : ''}`
    button.dataset['seasonId'] = tab.id
    button.dataset['seasonType'] = tab.type
    button.setAttribute('aria-pressed', tab.id === activeId ? 'true' : 'false')

    const labelSpan = document.createElement('span')
    labelSpan.className = 'chaospace-season-tab-label'
    labelSpan.textContent = tab.name
    button.appendChild(labelSpan)

    const countSpan = document.createElement('span')
    countSpan.className = 'chaospace-season-tab-count'
    countSpan.textContent = String(tab.count)
    button.appendChild(countSpan)

    fragment.appendChild(button)
  })

  seasonTabs.appendChild(fragment)
  seasonTabs.scrollLeft = 0
  return tabState
}

export {
  computeItemTargetPath,
  dedupeSeasonDirMap,
  updateSeasonExampleDir,
  computeSeasonTabState,
  filterItemsForActiveSeason,
  rebuildSeasonDirMap,
  ensureSeasonSubdirDefault,
  renderSeasonHint,
  renderSeasonControls,
  renderSeasonTabs,
  getTargetPath,
}
