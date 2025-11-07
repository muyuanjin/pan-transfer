import { handleTransfer, setProgressHandlers } from './services/transfer-service'
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
const jobContexts = new Map<string, JobContext>()

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
        console.warn('[Chaospace Transfer] Failed to post progress to tab', {
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
      console.warn('[Chaospace Transfer] tabs.sendMessage threw', {
        jobId,
        tabId: context.tabId,
        message: err.message,
      })
    }
  }

  chrome.runtime.sendMessage(message, () => {
    const error = chrome.runtime.lastError
    if (error && !isIgnorableMessageError(error)) {
      console.warn('[Chaospace Transfer] Failed to post progress via runtime message', {
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
    console.warn('[Chaospace Transfer] Failed to preload cache store', error)
  }
  try {
    await ensureHistoryLoaded()
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to preload history store', error)
  }
}

bootstrapStores()

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  if (isHistoryRefreshMessage(message)) {
    const reloadPromise = (async () => {
      await reloadCacheFromStorage()
      await reloadHistoryFromStorage()
    })()
    reloadPromise
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.warn('[Chaospace Transfer] Failed to reload storage state', error)
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
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
      .catch((error) => {
        console.warn('[Chaospace Transfer] Failed to read tab season preference', {
          tabId,
          error,
        })
        sendResponse({
          ok: false,
          tabId,
          value: null,
          error: error instanceof Error ? error.message : '无法读取按季偏好',
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
      .catch((error) => {
        console.warn('[Chaospace Transfer] Failed to persist tab season preference', {
          tabId,
          error,
        })
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '无法保存按季偏好',
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
      .catch((error) => {
        console.warn('[Chaospace Transfer] Failed to clear tab season preference', {
          tabId,
          error,
        })
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : '无法清理按季偏好',
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
      .catch((error) => sendResponse({ ok: false, error: error.message || '删除历史记录失败' }))
    return true
  }

  if (isHistoryClearMessage(message)) {
    clearHistoryRecords()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || '清空历史失败' }))
    return true
  }

  if (isHistoryDetailMessage(message)) {
    const pageUrl = typeof message.payload?.pageUrl === 'string' ? message.payload.pageUrl : ''
    handleHistoryDetail({ pageUrl })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || '获取详情失败' }))
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
      .catch((error) => sendResponse({ ok: false, error: error.message || '检测更新失败' }))
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
    handleTransfer(payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || '转存失败' }))
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
