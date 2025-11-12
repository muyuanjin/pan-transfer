import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { HistoryRecord } from '@/shared/types/transfer'
import type { PanelDomRefs, PanelRuntimeState, DetailDomRefs } from '@/content/types'
import type { ContentStore } from '@/content/state'
import type { PanelPreferencesController } from '@/content/controllers/panel-preferences'
import type { TabSeasonPreferenceController } from '@/content/services/tab-season-preference'
import type { createLoggingController } from '@/content/controllers/logging-controller'
import { STORAGE_KEYS, HISTORY_VERSION, CACHE_VERSION } from './common/constants'

interface HarnessProgressHandlers {
  emitProgress: (jobId?: string, payload?: Record<string, unknown>) => void
  logStage: (jobId?: string, stage?: string, message?: string) => void
}

const progressHandlers: HarnessProgressHandlers = {
  emitProgress: () => {
    /* noop */
  },
  logStage: () => {
    /* noop */
  },
}

type LoggingController = ReturnType<typeof createLoggingController>
const handleHistoryDetailMock = vi.fn()
const handleCheckUpdatesMock = vi.fn()

vi.mock('./services/transfer-service', () => {
  return {
    handleTransfer: vi.fn(),
    setProgressHandlers: (handlers: Partial<HarnessProgressHandlers>) => {
      if (handlers.emitProgress) {
        progressHandlers.emitProgress = handlers.emitProgress
      }
      if (handlers.logStage) {
        progressHandlers.logStage = handlers.logStage
      }
    },
  }
})

vi.mock('./services/history-service', () => ({
  handleHistoryDetail: handleHistoryDetailMock,
  handleCheckUpdates: handleCheckUpdatesMock,
}))

type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0]
type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0]

class ChromeTestHarness {
  private context: 'background' | 'content' = 'content'
  private readonly backgroundListeners = new Set<MessageListener>()
  private readonly contentListeners = new Set<MessageListener>()
  private readonly storageListeners = new Set<StorageListener>()
  private readonly tabRemovedListeners = new Set<(tabId: number) => void>()
  private readonly storage = new Map<string, unknown>()
  private lastErrorMessage: string | null = null

  readonly chrome: typeof chrome

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const harness = this
    const runtime = {
      get lastError() {
        return ChromeTestHarness.toRuntimeError(harness.lastErrorMessage)
      },
      set lastError(value: chrome.runtime.LastError | undefined) {
        harness.lastErrorMessage = value?.message ?? null
      },
      onMessage: {
        addListener: (listener: MessageListener) => {
          harness.getListenerSet().add(listener)
        },
        removeListener: (listener: MessageListener) => {
          harness.backgroundListeners.delete(listener)
          harness.contentListeners.delete(listener)
        },
      },
      onInstalled: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      sendMessage: (
        message: unknown,
        optionsOrCallback?: unknown,
        maybeCallback?: (response?: unknown) => void,
      ) => this.sendMessage(message, optionsOrCallback, maybeCallback),
      getURL: (path: string) => `chrome-extension://test/${path.replace(/^\//, '')}`,
    }

    const storageApi = {
      local: {
        get: (
          keys: string | string[] | Record<string, unknown> | null | undefined,
          callback?: (items: Record<string, unknown>) => void,
        ) => {
          const result = harness.readStorage(keys)
          if (typeof callback === 'function') {
            queueMicrotask(() => callback(result))
            return
          }
          return Promise.resolve(result)
        },
        set: (entries: Record<string, unknown>, callback?: () => void) => {
          const runner = (done: () => void) => {
            const changes: Record<string, { oldValue?: unknown; newValue: unknown }> = {}
            Object.entries(entries || {}).forEach(([key, value]) => {
              const cloned = ChromeTestHarness.clone(value)
              const oldValue = harness.storage.has(key)
                ? ChromeTestHarness.clone(harness.storage.get(key))
                : undefined
              harness.storage.set(key, cloned)
              changes[key] = { oldValue, newValue: cloned }
            })
            queueMicrotask(() => {
              if (Object.keys(changes).length) {
                harness.storageListeners.forEach((listener) => listener(changes, 'local'))
              }
              done()
            })
          }
          if (typeof callback === 'function') {
            runner(callback)
            return
          }
          return new Promise<void>((resolve) => runner(resolve))
        },
        remove: (keys: string | string[], callback?: () => void) => {
          const runner = (done: () => void) => {
            const normalized = Array.isArray(keys) ? keys : [keys]
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
            normalized.forEach((key) => {
              if (!harness.storage.has(key)) {
                return
              }
              changes[key] = {
                oldValue: ChromeTestHarness.clone(harness.storage.get(key)),
                newValue: undefined,
              }
              harness.storage.delete(key)
            })
            queueMicrotask(() => {
              if (Object.keys(changes).length) {
                harness.storageListeners.forEach((listener) => listener(changes, 'local'))
              }
              done()
            })
          }
          if (typeof callback === 'function') {
            runner(callback)
            return
          }
          return new Promise<void>((resolve) => runner(resolve))
        },
        clear: (callback?: () => void) => {
          const runner = (done: () => void) => {
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
            harness.storage.forEach((value, key) => {
              changes[key] = { oldValue: ChromeTestHarness.clone(value), newValue: undefined }
            })
            harness.storage.clear()
            queueMicrotask(() => {
              if (Object.keys(changes).length) {
                harness.storageListeners.forEach((listener) => listener(changes, 'local'))
              }
              done()
            })
          }
          if (typeof callback === 'function') {
            runner(callback)
            return
          }
          return new Promise<void>((resolve) => runner(resolve))
        },
      },
      onChanged: {
        addListener: (listener: StorageListener) => {
          harness.storageListeners.add(listener)
        },
        removeListener: (listener: StorageListener) => {
          harness.storageListeners.delete(listener)
        },
      },
    }

    const tabs = {
      sendMessage: (
        tabId: number,
        message: unknown,
        optionsOrCallback?: unknown,
        callback?: (response?: unknown) => void,
      ) => {
        const responseCallback: ((response?: unknown) => void) | undefined =
          typeof optionsOrCallback === 'function'
            ? (optionsOrCallback as (response?: unknown) => void)
            : callback
        harness.dispatchToListeners(
          harness.contentListeners,
          message,
          harness.createMessageSender(tabId),
          (response) => {
            responseCallback?.(response)
          },
        )
      },
      onRemoved: {
        addListener: (listener: (tabId: number) => void) => {
          harness.tabRemovedListeners.add(listener)
        },
        removeListener: (listener: (tabId: number) => void) => {
          harness.tabRemovedListeners.delete(listener)
        },
      },
    }

    const declarativeNetRequest = {
      updateDynamicRules: vi.fn(),
    }

    this.chrome = {
      runtime: runtime as unknown as typeof chrome.runtime,
      storage: storageApi as unknown as typeof chrome.storage,
      tabs: tabs as unknown as typeof chrome.tabs,
      declarativeNetRequest:
        declarativeNetRequest as unknown as typeof chrome.declarativeNetRequest,
    } as unknown as typeof chrome
  }

  install(): void {
    ;(globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome = this.chrome
  }

  restore(): void {
    delete (globalThis as { chrome?: typeof chrome }).chrome
    this.backgroundListeners.clear()
    this.contentListeners.clear()
    this.storageListeners.clear()
    this.tabRemovedListeners.clear()
    this.storage.clear()
    this.lastErrorMessage = null
    this.context = 'content'
  }

  seedStorage(entries: Record<string, unknown>): void {
    Object.entries(entries).forEach(([key, value]) => {
      this.storage.set(key, ChromeTestHarness.clone(value))
    })
  }

  setContext(context: 'background' | 'content'): void {
    this.context = context
  }

  private sendMessage(
    message: unknown,
    optionsOrCallback?: unknown,
    maybeCallback?: (response?: unknown) => void,
  ): Promise<unknown> | undefined {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    if (this.context === 'content') {
      return new Promise((resolve) => {
        this.dispatchToListeners(
          this.backgroundListeners,
          message,
          this.createMessageSender(1),
          (response) => {
            callback?.(response)
            resolve(response)
          },
        )
      })
    }
    this.dispatchToListeners(
      this.contentListeners,
      message,
      this.createMessageSender(),
      (response) => {
        callback?.(response)
      },
    )
    return undefined
  }

  private dispatchToListeners(
    listeners: Set<MessageListener>,
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): void {
    if (!listeners.size) {
      sendResponse(undefined)
      return
    }
    const previousContext = this.context
    this.context = listeners === this.backgroundListeners ? 'background' : 'content'
    let responded = false
    const wrappedSendResponse = (response?: unknown): void => {
      if (responded) {
        return
      }
      responded = true
      sendResponse(response)
    }
    let asyncHandled = false
    listeners.forEach((listener) => {
      const handled = listener(message, sender, wrappedSendResponse) as boolean | void
      if (handled === true) {
        asyncHandled = true
      }
    })
    if (!asyncHandled && !responded) {
      wrappedSendResponse(undefined)
    }
    this.context = previousContext
  }

  private getListenerSet(): Set<MessageListener> {
    return this.context === 'background' ? this.backgroundListeners : this.contentListeners
  }

  private createTab(tabId?: number): chrome.tabs.Tab | undefined {
    if (typeof tabId !== 'number') {
      return undefined
    }
    return {
      id: tabId,
      index: 0,
      windowId: 1,
      highlighted: false,
      active: true,
      pinned: false,
      frozen: false,
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      status: 'complete',
    }
  }

  private createMessageSender(tabId?: number): chrome.runtime.MessageSender {
    const tab = this.createTab(tabId)
    return tab ? { tab } : {}
  }

  private readStorage(
    keys: string | string[] | Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!keys || (Array.isArray(keys) && keys.length === 0)) {
      return this.snapshotStorage()
    }
    if (typeof keys === 'string') {
      return { [keys]: ChromeTestHarness.clone(this.storage.get(keys)) }
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {}
      keys.forEach((key) => {
        result[key] = ChromeTestHarness.clone(this.storage.get(key))
      })
      return result
    }
    const result: Record<string, unknown> = {}
    Object.entries(keys).forEach(([key, fallback]) => {
      result[key] = this.storage.has(key)
        ? ChromeTestHarness.clone(this.storage.get(key))
        : ChromeTestHarness.clone(fallback)
    })
    return result
  }

  private snapshotStorage(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    this.storage.forEach((value, key) => {
      result[key] = ChromeTestHarness.clone(value)
    })
    return result
  }

  private static clone<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
      return value
    }
    return structuredClone(value)
  }

  private static toRuntimeError(message: string | null): chrome.runtime.LastError | undefined {
    if (!message) {
      return undefined
    }
    return { message } as chrome.runtime.LastError
  }
}

const trackedKeydownListeners = new Set<EventListenerOrEventListenerObject>()
const originalAddEventListener = document.addEventListener.bind(document)
const originalRemoveEventListener = document.removeEventListener.bind(document)

beforeAll(() => {
  document.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'keydown') {
      trackedKeydownListeners.add(listener)
    }
    return originalAddEventListener(type, listener, options)
  }) as typeof document.addEventListener
  document.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === 'keydown') {
      trackedKeydownListeners.delete(listener)
    }
    return originalRemoveEventListener(type, listener, options)
  }) as typeof document.removeEventListener
})

afterAll(() => {
  document.addEventListener = originalAddEventListener
  document.removeEventListener = originalRemoveEventListener
})

const flushTasks = () => new Promise((resolve) => setTimeout(resolve, 0))

function assignPanelDomRefs(panelDom: PanelDomRefs, floatingPanel: HTMLElement): void {
  const checkbox = () => {
    const el = document.createElement('input')
    el.type = 'checkbox'
    return el
  }
  panelDom.assignAll({
    container: floatingPanel,
    historyOverlay: document.createElement('div'),
    historyList: document.createElement('div'),
    historyEmpty: document.createElement('div'),
    historySummary: document.createElement('div'),
    historySummaryBody: document.createElement('div'),
    itemsContainer: document.createElement('div'),
    resourceSummary: document.createElement('div'),
    resourceTitle: document.createElement('div'),
    seasonTabs: document.createElement('div'),
    baseDirInput: document.createElement('input'),
    useTitleCheckbox: checkbox(),
    useSeasonCheckbox: checkbox(),
    addPresetButton: document.createElement('button'),
    transferBtn: document.createElement('button'),
    transferLabel: document.createElement('div'),
    transferSpinner: document.createElement('div'),
    statusText: document.createElement('div'),
    seasonRow: document.createElement('div'),
    seasonPathHint: document.createElement('div'),
    pathPreview: document.createElement('div'),
  })
}

function createPanelState(): PanelRuntimeState {
  return {
    edgeState: { isHidden: false, side: 'right', peek: 0 },
    pointerInside: false,
    lastPointerPosition: { x: 0, y: 0 },
    isPinned: true,
    hideTimer: null,
    edgeAnimationTimer: null,
    edgeTransitionUnbind: null,
    scheduleEdgeHide: vi.fn(),
    cancelEdgeHide: vi.fn(),
    applyEdgeHiddenPosition: vi.fn(),
    hidePanelToEdge: vi.fn(),
    showPanelFromEdge: vi.fn(),
    beginEdgeAnimation: vi.fn(),
    applyPanelSize: vi.fn(),
    applyPanelPosition: vi.fn(() => ({ left: 0, top: 0 })),
    lastKnownSize: null,
    lastKnownPosition: null,
    getPanelBounds: vi.fn(() => ({
      minWidth: 0,
      minHeight: 0,
      maxWidth: 400,
      maxHeight: 400,
    })),
    detachWindowResize: vi.fn(),
    edgeStateChange: vi.fn(),
    documentPointerDownBound: false,
  }
}

function createLoggingStub(): LoggingController {
  return {
    pushLog: vi.fn(),
    renderStatus: vi.fn(),
    resetLogs: vi.fn(),
    setStatus: vi.fn(),
    renderLogs: vi.fn(),
  }
}

function createPreferencesStub(): PanelPreferencesController {
  return {
    loadSettings: vi.fn().mockResolvedValue(undefined),
    saveSettings: vi.fn(),
    ensurePreset: vi.fn().mockReturnValue(null),
    removePreset: vi.fn(),
    setBaseDir: vi.fn(),
    renderPresets: vi.fn(),
    renderPathPreview: vi.fn(),
    applyPanelTheme: vi.fn(),
    setTheme: vi.fn(),
  }
}

function createSeasonPreferenceStub(): TabSeasonPreferenceController {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    applyHistorySelection: vi.fn().mockResolvedValue(undefined),
    applyUserSelection: vi.fn().mockResolvedValue(undefined),
    handleGlobalDefaultChange: vi.fn(),
    syncCheckboxes: vi.fn(),
  }
}

function resetDetailDomRefs(detailDom: DetailDomRefs): void {
  detailDom.hideTimer = null
  detailDom.backdrop = null
  detailDom.modal = null
  detailDom.close = null
  detailDom.poster = null
  detailDom.title = null
  detailDom.date = null
  detailDom.country = null
  detailDom.runtime = null
  detailDom.rating = null
  detailDom.genres = null
  detailDom.info = null
  detailDom.synopsis = null
  detailDom.stills = null
  detailDom.body = null
  detailDom.loading = null
  detailDom.error = null
}

describe('background/content messaging integration', () => {
  let harness: ChromeTestHarness
  let unregisterChromeEvents: (() => void) | null
  let state: ContentStore
  let panelDom: PanelDomRefs
  let detailDom: DetailDomRefs
  let historyController: ReturnType<
    (typeof import('@/content/history/controller'))['createHistoryController']
  >
  let transferController: ReturnType<
    (typeof import('@/content/runtime/transfer/transfer-controller'))['createTransferController']
  >
  let reloadHistoryFromStorage: (typeof import('./storage/history-store'))['reloadHistoryFromStorage']
  let floatingPanel: HTMLElement

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    harness = new ChromeTestHarness()
    harness.install()
    harness.seedStorage({
      [STORAGE_KEYS.cache]: {
        version: CACHE_VERSION,
        directories: {},
        ensured: { '/': Date.now() },
        completedShares: {},
      },
      [STORAGE_KEYS.history]: { version: HISTORY_VERSION, records: [] },
    })
    const historyStoreModule = await import('./storage/history-store')
    reloadHistoryFromStorage = historyStoreModule.reloadHistoryFromStorage
    harness.setContext('background')
    await import('./index')
    harness.setContext('content')

    const stateModule = await import('@/content/state')
    state = stateModule.state
    panelDom = stateModule.panelDom
    detailDom = stateModule.detailDom
    state.$reset()
    panelDom.clear()
    resetDetailDomRefs(detailDom)

    const historyModule = (await import(
      '@/content/history/controller'
    )) as typeof import('@/content/history/controller')
    const transferModule = (await import(
      '@/content/runtime/transfer/transfer-controller'
    )) as typeof import('@/content/runtime/transfer/transfer-controller')
    const chromeEventsModule = (await import(
      '@/content/runtime/lifecycle/chrome-events'
    )) as typeof import('@/content/runtime/lifecycle/chrome-events')
    const typesModule = (await import('@/content/types')) as typeof import('@/content/types')

    floatingPanel = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(floatingPanel)
    assignPanelDomRefs(panelDom, floatingPanel)

    const panelState = createPanelState()
    const logging = createLoggingStub()
    const preferences = createPreferencesStub()
    const seasonPreference = createSeasonPreferenceStub()

    historyController = historyModule.createHistoryController({
      getFloatingPanel: () => floatingPanel,
      panelState,
      renderResourceList: vi.fn(),
      renderPathPreview: vi.fn(),
      renderSeasonHint: vi.fn(),
      seasonPreference,
      panelDom: typesModule.getPanelHistoryDom(panelDom),
    })

    transferController = transferModule.createTransferController({
      panelDom: typesModule.getPanelBaseDirDom(panelDom),
      logging,
      preferences,
      history: historyController,
      getFloatingPanel: () => floatingPanel,
      updateTransferButton: vi.fn(),
      renderPathPreview: vi.fn(),
      seasonPreference,
    })

    unregisterChromeEvents = chromeEventsModule.registerChromeEvents({
      history: historyController,
      applyTheme: vi.fn(),
      rerenderSettingsIfOpen: vi.fn(),
      renderResourceList: vi.fn(),
      syncSeasonPreference: vi.fn(),
      syncPanelSizeFromStorage: vi.fn(),
      syncPanelPositionFromStorage: vi.fn(),
      syncEdgeStateFromStorage: vi.fn(),
      syncPinStateFromStorage: vi.fn(),
      setStatusProgress: (progress) => transferController.handleProgressEvent(progress),
      getFloatingPanel: () => floatingPanel,
      analyzePageForMessage: vi.fn().mockResolvedValue({
        items: [],
        url: '',
        origin: '',
        title: '',
        poster: null,
      }),
    })
  })

  afterEach(() => {
    unregisterChromeEvents?.()
    harness.restore()
    document.body.innerHTML = ''
    trackedKeydownListeners.forEach((listener) => {
      originalRemoveEventListener('keydown', listener, true)
    })
    trackedKeydownListeners.clear()
  })

  async function writeHistorySnapshot(records: HistoryRecord[]): Promise<void> {
    harness.seedStorage({
      [STORAGE_KEYS.history]: {
        version: HISTORY_VERSION,
        records,
      },
    })
    harness.setContext('background')
    await reloadHistoryFromStorage()
    harness.setContext('content')
    await flushTasks()
  }

  function createHistoryRecord(
    overrides: Partial<HistoryRecord> & { pageUrl: string },
  ): HistoryRecord {
    return {
      pageUrl: overrides.pageUrl,
      pageTitle: overrides.pageTitle ?? '示例剧集',
      pageType: overrides.pageType ?? 'series',
      origin: overrides.origin ?? 'https://chaospace.example',
      poster: overrides.poster ?? null,
      targetDirectory: overrides.targetDirectory ?? '/剧集',
      baseDir: overrides.baseDir ?? '/剧集',
      useTitleSubdir: overrides.useTitleSubdir ?? true,
      useSeasonSubdir: overrides.useSeasonSubdir ?? false,
      lastTransferredAt: overrides.lastTransferredAt ?? 0,
      lastCheckedAt: overrides.lastCheckedAt ?? Date.now(),
      totalTransferred: overrides.totalTransferred ?? 1,
      completion: overrides.completion ?? null,
      seasonCompletion: overrides.seasonCompletion ?? {},
      seasonDirectory: overrides.seasonDirectory ?? {},
      seasonEntries: overrides.seasonEntries ?? [],
      items: overrides.items ?? {
        'item-1': {
          id: 'item-1',
          title: '第1集',
          status: 'success',
          message: '',
        },
      },
      itemOrder: overrides.itemOrder ?? ['item-1'],
      lastResult: overrides.lastResult ?? {
        summary: '同步完成',
        updatedAt: Date.now(),
        success: 1,
        skipped: 0,
        failed: 0,
      },
      pendingTransfer: overrides.pendingTransfer ?? null,
    }
  }

  it('propagates transfer progress updates to the content store', async () => {
    state.jobId = 'job-alpha'
    expect(progressHandlers.emitProgress).toBeDefined()

    harness.setContext('background')
    progressHandlers.emitProgress?.('job-alpha', {
      statusMessage: '正在转存 1/3',
      message: 'processing',
      jobId: 'job-alpha',
    })
    harness.setContext('content')
    await flushTasks()

    expect(state.statusMessage).toBe('正在转存 1/3')
  })

  it('loads history detail via background messaging and updates content state', async () => {
    const record = createHistoryRecord({ pageUrl: 'https://chaospace.example/tvshows/1.html' })
    await writeHistorySnapshot([record])
    await historyController.loadHistory()
    const groupKey = state.historyGroups[0]?.key
    expect(groupKey).toBeTruthy()

    handleHistoryDetailMock.mockResolvedValueOnce({
      ok: true,
      pageUrl: record.pageUrl,
      detail: {
        title: '示例剧集详情',
        synopsis: '剧情简介',
        pageUrl: record.pageUrl,
      },
    })

    await historyController.openHistoryDetail(groupKey!)
    await flushTasks()

    expect(handleHistoryDetailMock).toHaveBeenCalledWith({ pageUrl: record.pageUrl })
    expect(state.historyDetail.isOpen).toBe(true)
    expect((state.historyDetail.data as { title?: string })?.title).toBe('示例剧集详情')
    expect(state.historyDetail.loading).toBe(false)
  })

  it('deletes history records via background messaging and syncs the content store', async () => {
    const first = createHistoryRecord({ pageUrl: 'https://chaospace.example/tvshows/1.html' })
    const second = createHistoryRecord({
      pageUrl: 'https://chaospace.example/tvshows/2.html',
      pageTitle: '另一部剧',
    })
    await writeHistorySnapshot([first, second])
    await historyController.loadHistory()
    expect(state.historyRecords).toHaveLength(2)

    harness.setContext('content')
    await new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'chaospace:history-delete', payload: { urls: [first.pageUrl] } },
        (response: { ok?: boolean; error?: string } | undefined) => {
          if (!response || response.ok === false) {
            reject(new Error(response?.error ?? '删除历史记录失败'))
            return
          }
          resolve()
        },
      )
    })
    await flushTasks()

    expect(state.historyRecords).toHaveLength(1)
    expect(state.historyRecords[0]?.pageUrl).toBe(second.pageUrl)
  })
})
