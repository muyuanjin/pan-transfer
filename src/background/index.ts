import { chaosLogger } from '@/shared/log'
import { setProgressHandlers } from './services/transfer-service'
import { handleCheckUpdates, handleHistoryDetail } from './services/history-service'
import {
  deleteHistoryRecords,
  clearHistoryRecords,
  ensureHistoryLoaded,
  reloadHistoryFromStorage,
} from './storage/history-store'
import { ensureCacheLoaded, reloadCacheFromStorage } from './storage/cache-store'
import {
  clearTabSeasonPreference,
  getTabSeasonPreference,
  setTabSeasonPreference,
} from './storage/season-preference-store'
import type { TransferRequestPayload } from '../shared/types/transfer'
import {
  dispatchTransferPayload,
  getBackgroundTransferPipeline,
  getLastTransferDispatchSnapshot,
  resetBackgroundTransferPipelineCache,
} from './providers/pipeline'
import { resetBackgroundProviderRegistryCache } from './providers/registry'
import { setStorageProviderModeOverride, type StorageProviderMode } from './providers/storage-mode'

interface JobContext {
  tabId?: number
  frameId?: number
}

type ProgressPayload = Record<string, unknown>

interface HistoryDeleteMessage {
  type: 'chaospace:history-delete'
  payload?: {
    urls?: unknown
  }
}

interface HistoryClearMessage {
  type: 'chaospace:history-clear'
  payload?: undefined
}

interface HistoryRefreshMessage {
  type: 'chaospace:history-refresh'
}

interface HistoryDetailMessage {
  type: 'chaospace:history-detail'
  payload?: {
    pageUrl?: unknown
  }
}

interface CheckUpdatesMessage {
  type: 'chaospace:check-updates'
  payload?: {
    pageUrl?: unknown
    targetDirectory?: unknown
  }
}

interface TransferMessage {
  type: 'chaospace:transfer'
  payload?: TransferRequestPayload
}

interface SeasonPreferenceInitMessage {
  type: 'chaospace:season-pref:init'
}

interface SeasonPreferenceUpdateMessage {
  type: 'chaospace:season-pref:update'
  payload?: {
    value?: unknown
  }
}

interface SeasonPreferenceClearMessage {
  type: 'chaospace:season-pref:clear'
}

interface DevStorageModeMessage {
  type: 'pan-transfer:dev:set-storage-mode'
  payload?: {
    mode?: unknown
  }
}

interface DevLastTransferMessage {
  type: 'pan-transfer:dev:last-transfer'
}

type BackgroundMessage =
  | HistoryDeleteMessage
  | HistoryClearMessage
  | HistoryRefreshMessage
  | HistoryDetailMessage
  | CheckUpdatesMessage
  | TransferMessage
  | SeasonPreferenceInitMessage
  | SeasonPreferenceUpdateMessage
  | SeasonPreferenceClearMessage
  | DevStorageModeMessage
  | DevLastTransferMessage
  | {
      type?: string
      payload?: unknown
    }

const isHistoryDeleteMessage = (message: BackgroundMessage): message is HistoryDeleteMessage =>
  message?.type === 'chaospace:history-delete'

const isHistoryClearMessage = (message: BackgroundMessage): message is HistoryClearMessage =>
  message?.type === 'chaospace:history-clear'

const isHistoryRefreshMessage = (message: BackgroundMessage): message is HistoryRefreshMessage =>
  message?.type === 'chaospace:history-refresh'

const isHistoryDetailMessage = (message: BackgroundMessage): message is HistoryDetailMessage =>
  message?.type === 'chaospace:history-detail'

const isCheckUpdatesMessage = (message: BackgroundMessage): message is CheckUpdatesMessage =>
  message?.type === 'chaospace:check-updates'

const isTransferMessage = (message: BackgroundMessage): message is TransferMessage =>
  message?.type === 'chaospace:transfer'

const isSeasonPreferenceInitMessage = (
  message: BackgroundMessage,
): message is SeasonPreferenceInitMessage => message?.type === 'chaospace:season-pref:init'

const isSeasonPreferenceUpdateMessage = (
  message: BackgroundMessage,
): message is SeasonPreferenceUpdateMessage => message?.type === 'chaospace:season-pref:update'

const isSeasonPreferenceClearMessage = (
  message: BackgroundMessage,
): message is SeasonPreferenceClearMessage => message?.type === 'chaospace:season-pref:clear'

const isDevStorageModeMessage = (message: BackgroundMessage): message is DevStorageModeMessage =>
  message?.type === 'pan-transfer:dev:set-storage-mode'

const isDevLastTransferMessage = (message: BackgroundMessage): message is DevLastTransferMessage =>
  message?.type === 'pan-transfer:dev:last-transfer'

const normalizeStorageMode = (value: unknown): StorageProviderMode | null => {
  if (typeof value !== 'string') {
    return 'auto'
  }
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'auto') {
    return 'auto'
  }
  if (normalized === 'mock' || normalized === 'baidu') {
    return normalized
  }
  return null
}

const isExtensionSender = (sender?: chrome.runtime.MessageSender): boolean => {
  const origin = sender?.origin || sender?.url
  if (typeof origin !== 'string') {
    return false
  }
  return origin.startsWith('chrome-extension://')
}
const jobContexts = new Map<string, JobContext>()
void getBackgroundTransferPipeline()

const resolveErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return fallback
}

function isIgnorableMessageError(error: unknown): boolean {
  if (!error) {
    return true
  }
  const message = typeof error === 'string' ? error : (error as Error)?.message
  if (!message) {
    return false
  }
  return (
    message.includes('Receiving end does not exist') ||
    message.includes('The message port closed before a response was received.')
  )
}

type TransferProgressMessage = {
  type: 'chaospace:transfer-progress'
  jobId: string
} & ProgressPayload

function emitProgress(jobId: string | undefined, data: ProgressPayload = {}): void {
  if (!jobId) {
    return
  }
  const message: TransferProgressMessage = {
    type: 'chaospace:transfer-progress',
    jobId,
    ...data,
  }
  const context = jobContexts.get(jobId)

  if (context && typeof context.tabId === 'number') {
    const callback = (): void => {
      const error = chrome.runtime.lastError
      if (error && !isIgnorableMessageError(error)) {
        chaosLogger.warn('[Pan Transfer] Failed to post progress to tab', {
          jobId,
          tabId: context.tabId,
          message: error.message,
        })
      }
      if (error && error.message && error.message.includes('No tab with id')) {
        jobContexts.delete(jobId)
      }
    }
    try {
      if (typeof context.frameId === 'number') {
        chrome.tabs.sendMessage(context.tabId, message, { frameId: context.frameId }, callback)
      } else {
        chrome.tabs.sendMessage(context.tabId, message, callback)
      }
    } catch (error) {
      const err = error as Error
      chaosLogger.warn('[Pan Transfer] tabs.sendMessage threw', {
        jobId,
        tabId: context.tabId,
        message: err.message,
      })
    }
  }

  chrome.runtime.sendMessage(message, () => {
    const error = chrome.runtime.lastError
    if (error && !isIgnorableMessageError(error)) {
      chaosLogger.warn('[Pan Transfer] Failed to post progress via runtime message', {
        jobId,
        message: error.message,
      })
    }
  })
}

function logStage(
  jobId: string | undefined,
  stage: string,
  message: string,
  extra: ProgressPayload = {},
): void {
  if (!jobId) {
    return
  }
  emitProgress(jobId, {
    stage,
    message,
    ...extra,
  })
}

setProgressHandlers({ emitProgress, logStage })

async function bootstrapStores(): Promise<void> {
  try {
    await ensureCacheLoaded()
  } catch (error) {
    chaosLogger.warn('[Pan Transfer] Failed to preload cache store', error)
  }
  try {
    await ensureHistoryLoaded()
  } catch (error) {
    chaosLogger.warn('[Pan Transfer] Failed to preload history store', error)
  }
}

bootstrapStores()

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  if (isDevStorageModeMessage(message)) {
    if (!isExtensionSender(sender)) {
      sendResponse({ ok: false, error: '无权更新存储模式' })
      return false
    }
    const requestedMode = normalizeStorageMode(message.payload?.mode)
    if (!requestedMode) {
      sendResponse({ ok: false, error: '无效的存储模式' })
      return false
    }
    setStorageProviderModeOverride(requestedMode === 'auto' ? null : requestedMode)
    resetBackgroundProviderRegistryCache()
    resetBackgroundTransferPipelineCache()
    void getBackgroundTransferPipeline()
    chaosLogger.info('[Pan Transfer] Storage provider mode updated via dev hook', {
      mode: requestedMode,
    })
    sendResponse({ ok: true, mode: requestedMode })
    return true
  }

  if (isDevLastTransferMessage(message)) {
    if (!isExtensionSender(sender)) {
      sendResponse({ ok: false, error: '无权查看调试状态' })
      return false
    }
    const snapshot = getLastTransferDispatchSnapshot()
    sendResponse({ ok: true, snapshot })
    return true
  }

  if (isHistoryRefreshMessage(message)) {
    const reloadPromise = (async () => {
      await reloadCacheFromStorage()
      await reloadHistoryFromStorage()
    })()
    reloadPromise
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        chaosLogger.warn('[Pan Transfer] Failed to reload storage state', error)
        sendResponse({ ok: false, error: resolveErrorMessage(error, String(error)) })
      })
    return true
  }
  if (isSeasonPreferenceInitMessage(message)) {
    const tabId = sender?.tab?.id
    if (typeof tabId !== 'number') {
      sendResponse({ ok: true, tabId: null, value: null })
      return
    }
    getTabSeasonPreference(tabId)
      .then((value) => sendResponse({ ok: true, tabId, value }))
      .catch((error: unknown) => {
        chaosLogger.warn('[Pan Transfer] Failed to read tab season preference', {
          tabId,
          error,
        })
        sendResponse({
          ok: false,
          tabId,
          value: null,
          error: resolveErrorMessage(error, '无法读取按季偏好'),
        })
      })
    return true
  }

  if (isSeasonPreferenceUpdateMessage(message)) {
    const tabId = sender?.tab?.id
    const rawValue = message.payload?.value
    if (typeof tabId !== 'number' || typeof rawValue !== 'boolean') {
      sendResponse({ ok: false, error: '无效的按季偏好更新请求' })
      return
    }
    setTabSeasonPreference(tabId, rawValue)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        chaosLogger.warn('[Pan Transfer] Failed to persist tab season preference', {
          tabId,
          error,
        })
        sendResponse({
          ok: false,
          error: resolveErrorMessage(error, '无法保存按季偏好'),
        })
      })
    return true
  }

  if (isSeasonPreferenceClearMessage(message)) {
    const tabId = sender?.tab?.id
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: '无法清理按季偏好：缺少标签页' })
      return
    }
    clearTabSeasonPreference(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        chaosLogger.warn('[Pan Transfer] Failed to clear tab season preference', {
          tabId,
          error,
        })
        sendResponse({
          ok: false,
          error: resolveErrorMessage(error, '无法清理按季偏好'),
        })
      })
    return true
  }

  if (isHistoryDeleteMessage(message)) {
    const urlsInput = message.payload?.urls
    const urls = Array.isArray(urlsInput)
      ? urlsInput.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : []
    deleteHistoryRecords(urls)
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: resolveErrorMessage(error, '删除历史记录失败') }),
      )
    return true
  }

  if (isHistoryClearMessage(message)) {
    clearHistoryRecords()
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: resolveErrorMessage(error, '清空历史失败') }),
      )
    return true
  }

  if (isHistoryDetailMessage(message)) {
    const pageUrl = typeof message.payload?.pageUrl === 'string' ? message.payload.pageUrl : ''
    handleHistoryDetail({ pageUrl })
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: resolveErrorMessage(error, '获取详情失败') }),
      )
    return true
  }

  if (isCheckUpdatesMessage(message)) {
    const updatesPayload: Parameters<typeof handleCheckUpdates>[0] = {
      pageUrl: typeof message.payload?.pageUrl === 'string' ? message.payload.pageUrl : '',
    }
    if (typeof message.payload?.targetDirectory === 'string') {
      updatesPayload.targetDirectory = message.payload.targetDirectory
    }
    handleCheckUpdates(updatesPayload)
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: resolveErrorMessage(error, '检测更新失败') }),
      )
    return true
  }

  if (isTransferMessage(message)) {
    const payload = message.payload
    if (!payload || !Array.isArray(payload.items)) {
      sendResponse({ ok: false, error: '缺少任务信息' })
      return false
    }
    if (payload.jobId) {
      const context: JobContext = {}
      if (typeof sender?.tab?.id === 'number') {
        context.tabId = sender.tab.id
      }
      if (typeof sender?.frameId === 'number') {
        context.frameId = sender.frameId
      }
      jobContexts.set(payload.jobId, context)
    }
    dispatchTransferPayload(payload)
      .then(({ response }) => sendResponse({ ok: true, ...response }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: resolveErrorMessage(error, '转存失败') }),
      )
      .finally(() => {
        if (payload.jobId) {
          jobContexts.delete(payload.jobId)
        }
      })
    return true
  }

  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabSeasonPreference(tabId)
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: 'https://pan.baidu.com' },
            { header: 'Origin', operation: 'set', value: 'https://pan.baidu.com' },
          ],
        },
        condition: {
          urlFilter: 'pan.baidu.com/*',
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ],
  })
})
