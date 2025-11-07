import { chaosLogger } from '@/shared/log'
import { state } from '../state'
import {
  dedupeSeasonDirMap,
  renderSeasonControls,
  renderSeasonHint,
  updateSeasonExampleDir,
} from './season-manager'
import type { SeasonPreferenceScope } from '../types'
import type { PanelBaseDirDomRefs } from '../types'

interface TabSeasonPreferenceDeps {
  getFloatingPanel: () => HTMLElement | null
  renderResourceList: () => void
  renderPathPreview: () => void
  panelDom: PanelBaseDirDomRefs
}

type SeasonPreferenceMessageResponse = {
  ok?: boolean
  tabId?: number | null
  value?: unknown
  error?: string
}

async function runtimeSendMessage<T = SeasonPreferenceMessageResponse>(
  message: unknown,
): Promise<T | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return null
  }
  try {
    return (await chrome.runtime.sendMessage(message)) as T
  } catch (error) {
    chaosLogger.warn('[Pan Transfer] Failed to send season preference message', {
      message,
      error,
    })
    return null
  }
}

function applySeasonPreference(
  value: boolean,
  scope: SeasonPreferenceScope,
  {
    forceRender = false,
    getFloatingPanel,
    renderResourceList,
    renderPathPreview,
    syncCheckboxes,
  }: {
    forceRender?: boolean
    getFloatingPanel: () => HTMLElement | null
    renderResourceList: () => void
    renderPathPreview: () => void
    syncCheckboxes: () => void
  },
): void {
  const previousValue = state.useSeasonSubdir
  const previousScope = state.seasonPreferenceScope
  state.useSeasonSubdir = Boolean(value)
  state.seasonPreferenceScope = scope
  syncCheckboxes()

  const valueChanged = forceRender || previousValue !== state.useSeasonSubdir
  const scopeChanged = previousScope !== state.seasonPreferenceScope
  if (!valueChanged && !scopeChanged) {
    return
  }

  if (valueChanged) {
    dedupeSeasonDirMap()
  }

  updateSeasonExampleDir()
  renderSeasonHint()
  if (typeof renderPathPreview === 'function') {
    renderPathPreview()
  }
  const panelExists = typeof getFloatingPanel === 'function' && Boolean(getFloatingPanel())
  if (panelExists) {
    renderSeasonControls()
    if (valueChanged && typeof renderResourceList === 'function') {
      renderResourceList()
    }
  }
}

async function persistTabPreference(value: boolean): Promise<SeasonPreferenceScope> {
  if (value === state.seasonSubdirDefault) {
    const response = await runtimeSendMessage({ type: 'chaospace:season-pref:clear' })
    if (response && response.ok === false) {
      chaosLogger.warn('[Pan Transfer] Failed to clear tab season preference', response.error)
    }
    return 'default'
  }
  const response = await runtimeSendMessage({
    type: 'chaospace:season-pref:update',
    payload: { value: Boolean(value) },
  })
  if (response && response.ok === false) {
    chaosLogger.warn('[Pan Transfer] Failed to persist tab season preference', response.error)
  }
  return 'tab'
}

export interface TabSeasonPreferenceController {
  initialize: () => Promise<void>
  applyUserSelection: (value: boolean) => Promise<void>
  applyHistorySelection: (value: boolean) => Promise<void>
  handleGlobalDefaultChange: (value: boolean) => void
  syncCheckboxes: () => void
}

export function createTabSeasonPreferenceController({
  getFloatingPanel,
  renderResourceList,
  renderPathPreview,
  panelDom,
}: TabSeasonPreferenceDeps): TabSeasonPreferenceController {
  let initialized = false
  let pendingInit: Promise<void> | null = null

  const syncCheckboxes = (): void => {
    const useSeasonCheckbox = panelDom.useSeasonCheckbox
    if (useSeasonCheckbox instanceof HTMLInputElement) {
      useSeasonCheckbox.checked = state.useSeasonSubdir
    }
    const settingsUseSeason = panelDom.settingsUseSeason
    if (settingsUseSeason instanceof HTMLInputElement) {
      settingsUseSeason.checked = state.seasonSubdirDefault
    }
  }

  const ensureInitialized = async (): Promise<void> => {
    if (initialized) {
      return
    }
    if (pendingInit) {
      return pendingInit
    }
    pendingInit = (async () => {
      const response = await runtimeSendMessage({
        type: 'chaospace:season-pref:init',
      })
      const tabId =
        response && typeof response.tabId === 'number' ? (response.tabId as number) : null
      const storedValue =
        response && typeof response.value === 'boolean' ? (response.value as boolean) : null
      state.seasonPreferenceTabId = tabId
      const scope: SeasonPreferenceScope = storedValue === null ? 'default' : 'tab'
      const effectiveValue =
        storedValue === null ? Boolean(state.seasonSubdirDefault) : Boolean(storedValue)
      applySeasonPreference(effectiveValue, scope, {
        forceRender: true,
        getFloatingPanel,
        renderResourceList,
        renderPathPreview,
        syncCheckboxes,
      })
      initialized = true
    })()
    try {
      await pendingInit
    } catch (error) {
      chaosLogger.warn('[Pan Transfer] Failed to initialize tab season preference', error)
      applySeasonPreference(Boolean(state.seasonSubdirDefault), 'default', {
        forceRender: true,
        getFloatingPanel,
        renderResourceList,
        renderPathPreview,
        syncCheckboxes,
      })
    } finally {
      pendingInit = null
      initialized = true
    }
  }

  const applyOverride = async (value: boolean): Promise<void> => {
    await ensureInitialized()
    const scope = await persistTabPreference(value)
    applySeasonPreference(value, scope, {
      forceRender: true,
      getFloatingPanel,
      renderResourceList,
      renderPathPreview,
      syncCheckboxes,
    })
  }

  const applyHistorySelection = async (value: boolean): Promise<void> => {
    await ensureInitialized()
    const scope = await persistTabPreference(value)
    applySeasonPreference(value, scope, {
      forceRender: true,
      getFloatingPanel,
      renderResourceList,
      renderPathPreview,
      syncCheckboxes,
    })
  }

  const handleGlobalDefaultChange = (nextDefault: boolean): void => {
    const normalized = Boolean(nextDefault)
    const previousDefault = state.seasonSubdirDefault
    state.seasonSubdirDefault = normalized
    if (previousDefault === normalized && state.seasonPreferenceScope !== 'default') {
      syncCheckboxes()
      return
    }
    if (state.seasonPreferenceScope === 'default') {
      applySeasonPreference(normalized, 'default', {
        forceRender: true,
        getFloatingPanel,
        renderResourceList,
        renderPathPreview,
        syncCheckboxes,
      })
    } else {
      syncCheckboxes()
    }
  }

  return {
    initialize: ensureInitialized,
    applyUserSelection: applyOverride,
    applyHistorySelection,
    handleGlobalDefaultChange,
    syncCheckboxes,
  }
}
