import { handleTransfer, setProgressHandlers } from './services/transfer-service.js';
import { handleCheckUpdates, handleHistoryDetail } from './services/history-service.js';
import {
  deleteHistoryRecords,
  clearHistoryRecords,
  ensureHistoryLoaded
} from './storage/history-store.js';
import { ensureCacheLoaded } from './storage/cache-store.js';

const jobContexts = new Map();

function isIgnorableMessageError(error) {
  if (!error) {
    return true;
  }
  const message = typeof error === 'string' ? error : error.message;
  if (!message) {
    return false;
  }
  return message.includes('Receiving end does not exist') ||
    message.includes('The message port closed before a response was received.');
}

function emitProgress(jobId, data = {}) {
  if (!jobId) {
    return;
  }
  const message = {
    type: 'chaospace:transfer-progress',
    jobId,
    ...data
  };
  const context = jobContexts.get(jobId);

  if (context && typeof context.tabId === 'number') {
    const args = [context.tabId, message];
    if (typeof context.frameId === 'number') {
      args.push({ frameId: context.frameId });
    }
    args.push(() => {
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
    });
    try {
      chrome.tabs.sendMessage(...args);
    } catch (error) {
      console.warn('[Chaospace Transfer] tabs.sendMessage threw', {
        jobId,
        tabId: context.tabId,
        message: error.message
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

function logStage(jobId, stage, message, extra = {}) {
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

async function bootstrapStores() {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'chaospace:history-delete') {
    const urls = Array.isArray(message?.payload?.urls) ? message.payload.urls : [];
    deleteHistoryRecords(urls)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '删除历史记录失败' }));
    return true;
  }

  if (message?.type === 'chaospace:history-clear') {
    clearHistoryRecords()
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message || '清空历史失败' }));
    return true;
  }

  if (message?.type === 'chaospace:history-detail') {
    handleHistoryDetail(message.payload || {})
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message || '获取详情失败' }));
    return true;
  }

  if (message?.type === 'chaospace:check-updates') {
    handleCheckUpdates(message.payload || {})
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message || '检测更新失败' }));
    return true;
  }

  if (message?.type === 'chaospace:transfer') {
    const payload = message.payload || {};
    if (payload.jobId) {
      jobContexts.set(payload.jobId, {
        tabId: sender?.tab?.id,
        frameId: typeof sender?.frameId === 'number' ? sender.frameId : undefined
      });
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
