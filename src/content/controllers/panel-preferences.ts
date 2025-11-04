import { DEFAULT_PRESETS, HISTORY_BATCH_RATE_LIMIT_MS, STORAGE_KEY } from '../constants'
import { normalizeDir } from '../services/page-analyzer'
import { clampHistoryRateLimit, sanitizePreset } from '../components/settings-modal'
import { safeStorageGet, safeStorageSet } from '../utils/storage'
import type { ContentState, PanelDomRefs } from '../types'
import type { ToastHandler } from '../components/toast'

interface PanelPreferencesDeps {
  state: ContentState
  panelDom: PanelDomRefs
  document: Document
  getFloatingPanel: () => HTMLElement | null
  renderSeasonHint: () => void
  updateSeasonExampleDir: () => void
  getTargetPath: (baseDir: string, useTitleSubdir: boolean, pageTitle: string) => string
  showToast: ToastHandler
}

interface StoredSettings {
  baseDir?: string
  useTitleSubdir?: boolean
  useSeasonSubdir?: boolean
  presets?: unknown
  theme?: string
  historyRateLimitMs?: number
  [key: string]: unknown
}

interface SettingsPayload {
  baseDir: string
  useTitleSubdir: boolean
  presets: string[]
  theme: 'light' | 'dark'
  historyRateLimitMs: number
  useSeasonSubdir?: boolean
}

interface SetBaseDirOptions {
  fromPreset?: boolean
  persist?: boolean
  lockOverride?: boolean | null
}

export interface PanelPreferencesController {
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  ensurePreset: (value: string) => string | null
  removePreset: (value: string) => void
  setBaseDir: (value: string, options?: SetBaseDirOptions) => void
  renderPresets: () => void
  renderPathPreview: () => void
  applyPanelTheme: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

function isDefaultDirectory(value: string): boolean {
  const normalized = normalizeDir(value)
  return normalized === '/' || DEFAULT_PRESETS.includes(normalized)
}

export function createPanelPreferencesController({
  state,
  panelDom,
  document,
  getFloatingPanel,
  renderSeasonHint,
  updateSeasonExampleDir,
  getTargetPath,
  showToast,
}: PanelPreferencesDeps): PanelPreferencesController {
  async function loadSettings(): Promise<void> {
    try {
      const stored = await safeStorageGet(STORAGE_KEY, 'settings')
      const settings = (stored[STORAGE_KEY] || {}) as StoredSettings
      if (typeof settings.baseDir === 'string') {
        const normalizedBase = normalizeDir(settings.baseDir)
        state.baseDir = normalizedBase
        state.baseDirLocked = !isDefaultDirectory(normalizedBase)
      } else {
        state.baseDir = '/'
        state.baseDirLocked = false
      }
      state.autoSuggestedDir = null
      state.classification = 'unknown'
      state.classificationDetails = null
      if (typeof settings.useTitleSubdir === 'boolean') {
        state.useTitleSubdir = settings.useTitleSubdir
      }
      if (typeof settings.useSeasonSubdir === 'boolean') {
        state.useSeasonSubdir = settings.useSeasonSubdir
        state.hasSeasonSubdirPreference = true
      }
      if (Array.isArray(settings.presets)) {
        const merged = [...settings.presets, ...DEFAULT_PRESETS].map(sanitizePreset).filter(Boolean)
        const unique = Array.from(new Set(merged))
        state.presets = unique
      } else {
        state.presets = [...DEFAULT_PRESETS]
      }
      if (settings.theme === 'light' || settings.theme === 'dark') {
        state.theme = settings.theme
      }
      const rateLimitMs = Number(settings.historyRateLimitMs)
      if (Number.isFinite(rateLimitMs)) {
        state.historyRateLimitMs = clampHistoryRateLimit(rateLimitMs)
      } else {
        state.historyRateLimitMs = HISTORY_BATCH_RATE_LIMIT_MS
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to load settings', error)
    }
  }

  async function saveSettings(): Promise<void> {
    const themeValue: 'light' | 'dark' = state.theme === 'light' ? 'light' : 'dark'
    const settings: SettingsPayload = {
      baseDir: state.baseDir,
      useTitleSubdir: state.useTitleSubdir,
      presets: state.presets,
      theme: themeValue,
      historyRateLimitMs: clampHistoryRateLimit(state.historyRateLimitMs),
    }
    if (state.hasSeasonSubdirPreference) {
      settings.useSeasonSubdir = state.useSeasonSubdir
    }
    await safeStorageSet(
      {
        [STORAGE_KEY]: settings,
      },
      'settings',
    )
  }

  function renderPresets(): void {
    const presetList = panelDom.presetList
    if (!presetList) {
      return
    }
    presetList.innerHTML = ''
    const presets = Array.from(new Set(['/', ...state.presets]))
    presets.forEach((preset) => {
      const group = document.createElement('div')
      group.className = 'chaospace-chip-group'

      const selectBtn = document.createElement('button')
      selectBtn.type = 'button'
      selectBtn.className = `chaospace-chip-button${preset === state.baseDir ? ' is-active' : ''}`
      selectBtn.dataset['action'] = 'select'
      selectBtn.dataset['value'] = preset
      selectBtn.textContent = preset
      group.appendChild(selectBtn)

      const isRemovable = preset !== '/' && !DEFAULT_PRESETS.includes(preset)
      if (isRemovable) {
        const removeBtn = document.createElement('button')
        removeBtn.type = 'button'
        removeBtn.className = 'chaospace-chip-remove'
        removeBtn.dataset['action'] = 'remove'
        removeBtn.dataset['value'] = preset
        removeBtn.setAttribute('aria-label', `移除 ${preset}`)
        removeBtn.textContent = '×'
        group.appendChild(removeBtn)
      }

      presetList.appendChild(group)
    })
  }

  function renderPathPreview(): void {
    if (!panelDom.pathPreview) {
      return
    }
    const targetPath = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle)
    panelDom.pathPreview.innerHTML = `<span class="chaospace-path-label">📂 当前将保存到：</span><span class="chaospace-path-value">${targetPath}</span>`
    updateSeasonExampleDir()
    renderSeasonHint()
  }

  function ensurePreset(value: string): string | null {
    const preset = sanitizePreset(value)
    if (!preset) {
      return null
    }
    if (!state.presets.includes(preset)) {
      state.presets = [...state.presets, preset]
      void saveSettings()
    }
    return preset
  }

  function setBaseDir(value: string, options: SetBaseDirOptions = {}): void {
    const { fromPreset = false, persist = true, lockOverride = null } = options
    const normalized = normalizeDir(value)
    state.baseDir = normalized
    const shouldLock =
      typeof lockOverride === 'boolean' ? lockOverride : !isDefaultDirectory(normalized)
    state.baseDirLocked = shouldLock

    if (panelDom.baseDirInput) {
      if (panelDom.baseDirInput.value !== normalized) {
        panelDom.baseDirInput.value = normalized
      }
      if (!shouldLock) {
        delete panelDom.baseDirInput.dataset['dirty']
      }
    }

    if (fromPreset) {
      ensurePreset(normalized)
    }

    if (persist) {
      void saveSettings()
    }
    renderPresets()
    renderPathPreview()
  }

  function removePreset(value: string): void {
    const preset = sanitizePreset(value)
    if (!preset || preset === '/' || DEFAULT_PRESETS.includes(preset)) {
      return
    }
    const before = state.presets.length
    state.presets = state.presets.filter((item) => item !== preset)
    if (state.presets.length === before) {
      return
    }
    if (state.baseDir === preset) {
      setBaseDir('/', { fromPreset: true })
    } else {
      void saveSettings()
      renderPresets()
    }
    showToast('info', '已移除路径', `${preset} 已从收藏中移除`)
  }

  function applyPanelTheme(): void {
    const isLight = state.theme === 'light'
    document.documentElement.classList.toggle('chaospace-light-root', isLight)
    const panel = getFloatingPanel()
    if (panel) {
      panel.classList.toggle('theme-light', isLight)
    }
    if (panelDom.themeToggle) {
      const label = isLight ? '切换到深色主题' : '切换到浅色主题'
      panelDom.themeToggle.textContent = isLight ? '🌙' : '🌞'
      panelDom.themeToggle.setAttribute('aria-label', label)
      panelDom.themeToggle.title = label
    }
  }

  function setTheme(theme: 'light' | 'dark'): void {
    if (theme !== 'light' && theme !== 'dark') {
      return
    }
    if (state.theme === theme) {
      return
    }
    state.theme = theme
    applyPanelTheme()
    void saveSettings()
  }

  return {
    loadSettings,
    saveSettings,
    ensurePreset,
    removePreset,
    setBaseDir,
    renderPresets,
    renderPathPreview,
    applyPanelTheme,
    setTheme,
  }
}
