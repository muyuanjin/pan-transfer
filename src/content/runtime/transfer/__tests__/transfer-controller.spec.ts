import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTransferController } from '../transfer-controller'
import { state } from '../../../state'
import type {
  PanelBaseDirDomRefs,
  PanelResourceDomRefs,
  PanelSeasonDomRefs,
  ResourceItem,
} from '../../../types'
import type { createHistoryController } from '../../../history/controller'
import type { createPanelPreferencesController } from '../../../controllers/panel-preferences'
import type { createLoggingController } from '../../../controllers/logging-controller'
import type { TabSeasonPreferenceController } from '../../../services/tab-season-preference'
import * as toastModule from '../../../components/toast'
import { bindSeasonManagerDomRefs } from '../../../services/season-manager'

type LoggingController = ReturnType<typeof createLoggingController>
type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>
type HistoryController = ReturnType<typeof createHistoryController>

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('transfer-controller', () => {
  let chromeSendMessage: ReturnType<typeof vi.fn>
  let showToastSpy: ReturnType<typeof vi.spyOn>
  const mountedPanels: HTMLElement[] = []

  beforeEach(() => {
    state.$reset()
    chromeSendMessage = vi.fn()
    ;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = {
      runtime: {
        sendMessage: chromeSendMessage,
      },
    } as unknown as typeof chrome
    showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(vi.fn())
  })

  afterEach(() => {
    mountedPanels.forEach((panel) => panel.remove())
    mountedPanels.length = 0
    vi.restoreAllMocks()
    delete (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome
  })

  function createPanelDom(): PanelBaseDirDomRefs {
    const baseDirInput = document.createElement('input')
    baseDirInput.value = '/Downloads'
    const useTitleCheckbox = document.createElement('input')
    useTitleCheckbox.type = 'checkbox'
    useTitleCheckbox.checked = true
    const useSeasonCheckbox = document.createElement('input')
    useSeasonCheckbox.type = 'checkbox'
    useSeasonCheckbox.checked = false
    const addPresetButton = document.createElement('button')
    return {
      baseDirInput,
      useTitleCheckbox,
      useSeasonCheckbox,
      addPresetButton,
      themeToggle: null,
      pathPreview: null,
      settingsUseSeason: null,
    }
  }

  function mountPanel(): HTMLElement {
    const panel = document.createElement('div')
    document.body.appendChild(panel)
    mountedPanels.push(panel)
    return panel
  }

  function setupController(
    overrides: {
      panelDom?: PanelBaseDirDomRefs
      logging?: LoggingController
      preferences?: PanelPreferencesController
      history?: HistoryController
      seasonPreference?: TabSeasonPreferenceController
    } = {},
  ) {
    const panelDom = overrides.panelDom ?? createPanelDom()
    const resourceDom: PanelResourceDomRefs = {
      itemsContainer: document.createElement('div'),
      resourceSummary: document.createElement('div'),
      resourceTitle: document.createElement('div'),
      seasonTabs: document.createElement('div'),
    }
    const seasonDom: PanelSeasonDomRefs = {
      seasonRow: document.createElement('div'),
      seasonPathHint: document.createElement('div'),
    }
    bindSeasonManagerDomRefs({
      baseDir: panelDom,
      resource: resourceDom,
      season: seasonDom,
    })
    const logging =
      overrides.logging ??
      ({
        pushLog: vi.fn(),
        renderStatus: vi.fn(),
        resetLogs: vi.fn(),
        setStatus: vi.fn(),
      } as unknown as LoggingController)
    const preferences =
      overrides.preferences ??
      ({
        setBaseDir: vi.fn((value: string) => {
          state.baseDir = value
        }),
        saveSettings: vi.fn().mockResolvedValue(undefined),
      } as unknown as PanelPreferencesController)
    const historyLoadHistory =
      overrides.history?.loadHistory ?? vi.fn().mockResolvedValue(undefined)
    const history =
      overrides.history ??
      ({
        loadHistory: historyLoadHistory,
      } as unknown as HistoryController)
    const seasonPreference =
      overrides.seasonPreference ??
      ({
        applyUserSelection: vi.fn(async (next: boolean) => {
          state.useSeasonSubdir = next
        }),
      } as unknown as TabSeasonPreferenceController)

    const panel = mountPanel()
    const updateTransferButton = vi.fn()
    const renderPathPreview = vi.fn()
    const getFloatingPanel = vi.fn(() => panel)
    const controller = createTransferController({
      panelDom,
      logging,
      preferences,
      history,
      getFloatingPanel,
      updateTransferButton,
      renderPathPreview,
      seasonPreference,
    })

    return {
      controller,
      panel,
      panelDom,
      logging,
      preferences,
      history,
      seasonPreference,
      updateTransferButton,
      renderPathPreview,
      historyLoadHistory,
      getFloatingPanel,
    }
  }

  function seedSelectedItems(items: ResourceItem[], selectedIds: Array<string | number>) {
    state.items = items
    state.selectedIds = new Set(selectedIds)
    state.baseDir = '/Downloads'
    state.pageTitle = 'Sample Show'
    state.pageUrl = 'https://chaospace.test/resource'
    state.origin = 'https://chaospace.test'
  }

  it('warns the user when attempting to transfer without selected resources', async () => {
    const { controller } = setupController()
    state.items = []
    state.selectedIds = new Set()

    await controller.handleTransfer()

    expect(showToastSpy).toHaveBeenCalledWith(
      'warning',
      '请选择资源',
      '至少勾选一个百度网盘资源再开始转存哦～',
    )
    expect(chromeSendMessage).not.toHaveBeenCalled()
  })

  it('transitions into running state and emits success toast on completion', async () => {
    const {
      controller,
      panelDom,
      preferences,
      seasonPreference,
      updateTransferButton,
      getFloatingPanel,
      logging,
    } = setupController()
    panelDom.baseDirInput!.value = '/Volumes/transfer'
    panelDom.useTitleCheckbox!.checked = true
    panelDom.useSeasonCheckbox!.checked = true
    const items: ResourceItem[] = [
      { id: 'item-1', title: 'Episode 1', order: 1, seasonId: 's1', seasonLabel: 'Season 1' },
      { id: 'item-2', title: 'Episode 2', order: 2 },
    ]
    seedSelectedItems(items, ['item-1'])
    expect(state.items).toHaveLength(2)
    expect(state.selectedIds.has('item-1')).toBe(true)
    expect(state.items.filter((item) => state.selectedIds.has(item.id)).length).toBe(1)

    const deferred = createDeferred<{
      ok: boolean
      results: Array<Record<string, string>>
      summary: string
    }>()
    chromeSendMessage.mockImplementation(() => {
      expect(panelDom.baseDirInput!.disabled).toBe(true)
      expect(state.toolbarDisabled).toBe(true)
      return deferred.promise
    })

    const transferPromise = controller.handleTransfer()
    expect(getFloatingPanel).toHaveBeenCalledTimes(1)
    expect(preferences.setBaseDir).toHaveBeenCalledWith('/Volumes/transfer')
    expect(seasonPreference.applyUserSelection).toHaveBeenCalledWith(true)

    deferred.resolve({
      ok: true,
      summary: 'All done',
      results: [{ status: 'success' }],
    })
    await transferPromise

    expect(logging.pushLog).toHaveBeenCalledWith(
      expect.stringContaining('向后台发送 1 条转存请求'),
      expect.objectContaining({ stage: 'dispatch' }),
    )
    expect(chromeSendMessage).toHaveBeenCalledTimes(1)
    expect(updateTransferButton).toHaveBeenCalledTimes(2)
    expect(panelDom.baseDirInput!.disabled).toBe(false)
    expect(state.transferStatus).toBe('idle')
    expect(state.jobId).toBeNull()
    expect(showToastSpy).not.toHaveBeenCalledWith('warning', '请选择资源', expect.any(String))
    expect(showToastSpy).toHaveBeenLastCalledWith(
      'success',
      expect.stringContaining('转存成功'),
      expect.stringContaining('/Volumes/transfer'),
      expect.objectContaining({ success: 1, failed: 0, skipped: 0 }),
    )
  })

  it('recovers from background errors so the user can retry transfers', async () => {
    const { controller, panelDom } = setupController()
    seedSelectedItems([{ id: 'item-9', title: 'Resource', order: 1 }], ['item-9'])
    chromeSendMessage
      .mockRejectedValueOnce(new Error('background failure'))
      .mockResolvedValueOnce({ ok: true, summary: 'done', results: [{ status: 'success' }] })

    await controller.handleTransfer()

    expect(panelDom.baseDirInput!.disabled).toBe(false)
    expect(state.transferStatus).toBe('idle')
    expect(showToastSpy).toHaveBeenCalledWith('error', '转存失败', 'background failure')

    await controller.handleTransfer()

    expect(chromeSendMessage).toHaveBeenCalledTimes(2)
    expect(showToastSpy).toHaveBeenLastCalledWith(
      'success',
      expect.stringContaining('转存成功'),
      expect.any(String),
      expect.objectContaining({ success: 1 }),
    )
  })
})
