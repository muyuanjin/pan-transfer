import { handleTransfer, setProgressHandlers } from './services/transfer-service';
import { handleCheckUpdates, handleHistoryDetail } from './services/history-service';
import {
  deleteHistoryRecords,
  clearHistoryRecords,
  ensureHistoryLoaded
} from './storage/history-store';
import { ensureCacheLoaded } from './storage/cache-store';
import type { TransferRequestPayload } from '../shared/types/transfer';

interface JobContext {
  tabId?: number;
  frameId?: number;
}

type ProgressPayload = Record<string, unknown>;

type IncomingMessage = {
  type?: string;
  payload?: unknown;
};

const jobContexts = new Map<string, JobContext>();

function isIgnorableMessageError(error: unknown): boolean {
  if (!error) {
    return true;
  }
  const message = typeof error === 'string' ? error : (error as Error)?.message;
  if (!message) {
    return false;
  }
  return message.includes('Receiving end does not exist') ||
    message.includes('The message port closed before a response was received.');
}

type TransferProgressMessage = {
  type: 'chaospace:transfer-progress';
  jobId: string;
} & ProgressPayload;

function emitProgress(jobId: string | undefined, data: ProgressPayload = {}): void {
  if (!jobId) {
    return;
  }
  const message: TransferProgressMessage = {
    type: 'chaospace:transfer-progress',
    jobId,
    ...data
  };
  const context = jobContexts.get(jobId);

  if (context && typeof context.tabId === 'number') {
    const callback = (): void => {
      const error = chrome.runtime.lastError;
      if (error && !isIgnorableMessageError(error)) {
        console.warn('[Chaospace Transfer] Failed to post progress to tab', {
          jobId,
          tabId: context.tabId,
          message: error.message
        });
      }
      if (error && error.message && error.message.includes('No tab with id')) {
        jobContexts.delete(jobId);
      }
    };
    try {
      if (typeof context.frameId === 'number') {
        chrome.tabs.sendMessage(context.tabId, message, { frameId: context.frameId }, callback);
      } else {
        chrome.tabs.sendMessage(context.tabId, message, callback);
      }
    } catch (error) {
      const err = error as Error;
      console.warn('[Chaospace Transfer] tabs.sendMessage threw', {
        jobId,
        tabId: context.tabId,
        message: err.message
      });
    }
  }

  chrome.runtime.sendMessage(message, () => {
    const error = chrome.runtime.lastError;
    if (error && !isIgnorableMessageError(error)) {
      console.warn('[Chaospace Transfer] Failed to post progress via runtime message', {
        jobId,
        message: error.message
      });
    }
  });
}

function logStage(
  jobId: string | undefined,
  stage: string,
  message: string,
  extra: ProgressPayload = {}
): void {
  if (!jobId) {
    return;
  }
  emitProgress(jobId, {
    stage,
    message,
    ...extra
  });
}

setProgressHandlers({ emitProgress, logStage });

async function bootstrapStores(): Promise<void> {
  try {
    await ensureCacheLoaded();
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to preload cache store', error);
  }
  try {
    await ensureHistoryLoaded();
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to preload history store', error);
  }
}

bootstrapStores();

chrome.runtime.onMessage.addListener((message: IncomingMessage, sender, sendResponse) => {
  if (message?.type === 'chaospace:history-delete') {
    const payload = (message.payload ?? {}) as { urls?: unknown };
    const urls = Array.isArray(payload.urls)
      ? payload.urls.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : [];
    deleteHistoryRecords(urls)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message || '删除历史记录失败' }));
    return true;
  }

  if (message?.type === 'chaospace:history-clear') {
    clearHistoryRecords()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message || '清空历史失败' }));
    return true;
  }

  if (message?.type === 'chaospace:history-detail') {
    handleHistoryDetail((message.payload ?? {}) as { pageUrl?: string })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message || '获取详情失败' }));
    return true;
  }

  if (message?.type === 'chaospace:check-updates') {
    handleCheckUpdates((message.payload ?? {}) as Record<string, unknown>)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message || '检测更新失败' }));
    return true;
  }

  if (message?.type === 'chaospace:transfer') {
    const payload = (message.payload ?? {}) as TransferRequestPayload;
    if (payload.jobId) {
      const context: JobContext = {};
      if (typeof sender?.tab?.id === 'number') {
        context.tabId = sender.tab.id;
      }
      if (typeof sender?.frameId === 'number') {
        context.frameId = sender.frameId;
      }
      jobContexts.set(payload.jobId, context);
    }
    handleTransfer(payload)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '转存失败' }))
      .finally(() => {
        if (payload.jobId) {
          jobContexts.delete(payload.jobId);
        }
      });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: 'https://pan.baidu.com' },
          { header: 'Origin', operation: 'set', value: 'https://pan.baidu.com' }
        ]
      },
      condition: {
        urlFilter: 'pan.baidu.com/*',
        resourceTypes: ['xmlhttprequest']
      }
    }]
  });
});
