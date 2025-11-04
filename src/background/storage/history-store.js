import {
  HISTORY_VERSION,
  STORAGE_KEYS,
  MAX_HISTORY_RECORDS
} from '../common/constants.js';
import { storageGet, storageSet } from './utils.js';
import {
  mergeCompletionStatus,
  mergeSeasonCompletionMap,
  normalizeHistoryCompletion,
  normalizeSeasonCompletionMap,
  normalizeSeasonDirectoryMap,
  mergeSeasonDirectoryMap,
  normalizeSeasonEntries
} from '../../shared/utils/completion-status.js';
import { sanitizePosterInfo } from '../../shared/utils/sanitizers.ts';
import { normalizePath } from '../utils/path.js';

const nowTs = () => Date.now();

let historyState = null;
let historyLoadPromise = null;
const historyIndexByUrl = new Map();

function createDefaultHistoryState() {
  return {
    version: HISTORY_VERSION,
    records: []
  };
}

function rebuildHistoryIndex() {
  historyIndexByUrl.clear();
  if (!historyState || !Array.isArray(historyState.records)) {
    return;
  }
  historyState.records.forEach((record, index) => {
    if (record && typeof record.pageUrl === 'string' && record.pageUrl) {
      historyIndexByUrl.set(record.pageUrl, { index, record });
    }
  });
}

export function ensureHistoryRecordStructure(record) {
  if (!record.items || typeof record.items !== 'object') {
    record.items = {};
  }
  if (!Array.isArray(record.itemOrder)) {
    record.itemOrder = Object.keys(record.items);
  }
  record.completion = normalizeHistoryCompletion(record.completion);
  record.seasonCompletion = normalizeSeasonCompletionMap(record.seasonCompletion);
  record.seasonDirectory = normalizeSeasonDirectoryMap(record.seasonDirectory);
  record.useSeasonSubdir = Boolean(record.useSeasonSubdir);
  record.seasonEntries = normalizeSeasonEntries(record.seasonEntries);
  return record;
}

export function normalizeHistoryPath(value, fallback = '/') {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  return normalizePath(value);
}

function applyResultToHistoryRecord(record, result, timestamp) {
  if (!result || typeof result.id === 'undefined') {
    return;
  }
  const itemId = String(result.id);
  if (!itemId) {
    return;
  }
  const existing = record.items[itemId] || {};
  const next = {
    id: itemId,
    title: typeof result.title === 'string' && result.title ? result.title : (existing.title || ''),
    lastStatus: result.status || existing.lastStatus || 'unknown',
    lastTransferredAt: result.status === 'success' ? timestamp : (existing.lastTransferredAt || timestamp),
    files: Array.isArray(result.files) ? result.files.slice() : (existing.files || []),
    linkUrl: result.linkUrl || existing.linkUrl || '',
    passCode: result.passCode || existing.passCode || '',
    skippedFiles: Array.isArray(result.skippedFiles) ? result.skippedFiles.slice() : (existing.skippedFiles || []),
    message: result.message || existing.message || '',
    attempts: typeof existing.attempts === 'number' ? existing.attempts + 1 : 1,
    totalSuccess: (result.status === 'success')
      ? (typeof existing.totalSuccess === 'number' ? existing.totalSuccess + 1 : 1)
      : (existing.totalSuccess || 0),
    lastUpdatedAt: timestamp
  };
  if (result.status === 'skipped' && !existing.lastTransferredAt) {
    next.lastTransferredAt = timestamp;
  }
  record.items[itemId] = next;
  if (!record.itemOrder.includes(itemId)) {
    record.itemOrder.push(itemId);
  }
}

function upsertHistoryRecord(pageUrl) {
  if (!historyState) {
    historyState = createDefaultHistoryState();
  }
  let entry = historyIndexByUrl.get(pageUrl);
  if (entry) {
    return { record: ensureHistoryRecordStructure(entry.record), index: entry.index };
  }
  const record = ensureHistoryRecordStructure({
    pageUrl,
    pageTitle: '',
    pageType: 'unknown',
    origin: '',
    poster: null,
    targetDirectory: '/',
    baseDir: '/',
    useTitleSubdir: true,
    useSeasonSubdir: false,
    lastTransferredAt: 0,
    lastCheckedAt: 0,
    totalTransferred: 0,
    completion: null,
    seasonCompletion: {},
    seasonDirectory: {},
    seasonEntries: [],
    items: {},
    itemOrder: [],
    lastResult: null
  });
  historyState.records.push(record);
  rebuildHistoryIndex();
  const index = historyState.records.length - 1;
  historyIndexByUrl.set(pageUrl, { index, record });
  return { record, index };
}

export async function ensureHistoryLoaded() {
  if (historyLoadPromise) {
    await historyLoadPromise;
    return;
  }
  historyLoadPromise = (async () => {
    try {
      const stored = await storageGet([STORAGE_KEYS.history]);
      const raw = stored[STORAGE_KEYS.history];
      if (raw && raw.version === HISTORY_VERSION && Array.isArray(raw.records)) {
        historyState = {
          version: HISTORY_VERSION,
          records: raw.records.map(record => {
            const safeRecord = record || {};
            if (!safeRecord.items || typeof safeRecord.items !== 'object') {
              safeRecord.items = {};
            }
            if (!Array.isArray(safeRecord.itemOrder)) {
              safeRecord.itemOrder = Object.keys(safeRecord.items);
            }
            return ensureHistoryRecordStructure(safeRecord);
          })
        };
      } else {
        historyState = createDefaultHistoryState();
      }
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to load transfer history', error);
      historyState = createDefaultHistoryState();
    }
    rebuildHistoryIndex();
  })();
  await historyLoadPromise;
}

export async function persistHistoryNow() {
  await ensureHistoryLoaded();
  if (!historyState) {
    historyState = createDefaultHistoryState();
  }
  try {
    await storageSet({
      [STORAGE_KEYS.history]: historyState
    });
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to persist history', error);
  }
}

export function getHistoryRecord(pageUrl) {
  const entry = historyIndexByUrl.get(pageUrl);
  return entry ? ensureHistoryRecordStructure(entry.record) : null;
}

export function getHistoryRecords() {
  return historyState?.records || [];
}

export async function recordTransferHistory(payload, outcome) {
  if (!payload || !payload.meta) {
    return;
  }
  await ensureHistoryLoaded();
  const { meta } = payload;
  const pageUrl = typeof meta.pageUrl === 'string' && meta.pageUrl ? meta.pageUrl : '';
  if (!pageUrl) {
    return;
  }

  const timestamp = nowTs();
  const { record } = upsertHistoryRecord(pageUrl);
  const origin = payload.origin || record.origin || '';
  record.pageTitle = typeof meta.pageTitle === 'string' && meta.pageTitle ? meta.pageTitle : (record.pageTitle || '');
  record.origin = origin;
  record.pageType = typeof meta.pageType === 'string' && meta.pageType ? meta.pageType : (record.pageType || 'unknown');
  record.poster = sanitizePosterInfo(meta.poster) || record.poster || null;
  record.targetDirectory = normalizeHistoryPath(meta.targetDirectory || payload.targetDirectory || record.targetDirectory, record.targetDirectory || '/');
  record.baseDir = normalizeHistoryPath(meta.baseDir || record.baseDir || record.targetDirectory, record.baseDir || '/');
  record.useTitleSubdir = typeof meta.useTitleSubdir === 'boolean' ? meta.useTitleSubdir : Boolean(record.useTitleSubdir);
  record.useSeasonSubdir = typeof meta.useSeasonSubdir === 'boolean' ? meta.useSeasonSubdir : Boolean(record.useSeasonSubdir);
  if (meta.seasonDirectory && typeof meta.seasonDirectory === 'object') {
    record.seasonDirectory = mergeSeasonDirectoryMap(record.seasonDirectory, meta.seasonDirectory);
  }
  if (Array.isArray(meta.seasonEntries)) {
    const normalizedEntries = normalizeSeasonEntries(meta.seasonEntries);
    if (normalizedEntries.length) {
      record.seasonEntries = normalizedEntries;
    }
  }
  record.lastCheckedAt = timestamp;
  if (meta.completion) {
    record.completion = mergeCompletionStatus(record.completion, meta.completion, timestamp, meta.completion.source || 'transfer-meta');
  }
  if (meta.seasonCompletion && typeof meta.seasonCompletion === 'object') {
    record.seasonCompletion = mergeSeasonCompletionMap(record.seasonCompletion, meta.seasonCompletion, timestamp, 'transfer-meta');
  }

  const results = Array.isArray(outcome?.results) ? outcome.results : [];
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const res of results) {
    if (!res || typeof res.id === 'undefined') {
      continue;
    }
    if (res.status === 'failed') {
      failedCount += 1;
      continue;
    }
    applyResultToHistoryRecord(record, res, timestamp);
    if (res.status === 'success') {
      successCount += 1;
    } else if (res.status === 'skipped') {
      skippedCount += 1;
    }
  }

  record.totalTransferred = Object.keys(record.items).length;
  if (successCount > 0) {
    record.lastTransferredAt = timestamp;
  }
  const summary = typeof outcome?.summary === 'string' ? outcome.summary : '';
  record.lastResult = {
    summary,
    updatedAt: timestamp,
    success: successCount,
    skipped: skippedCount,
    failed: failedCount
  };

  historyState.records.sort((a, b) => {
    const tsA = a.lastTransferredAt || a.lastCheckedAt || 0;
    const tsB = b.lastTransferredAt || b.lastCheckedAt || 0;
    return tsB - tsA;
  });

  if (historyState.records.length > MAX_HISTORY_RECORDS) {
    historyState.records = historyState.records.slice(0, MAX_HISTORY_RECORDS);
  }

  rebuildHistoryIndex();
  await persistHistoryNow();
}

export async function deleteHistoryRecords(urls = []) {
  await ensureHistoryLoaded();
  if (!Array.isArray(urls) || !urls.length) {
    return { ok: true, removed: 0, total: historyState.records.length };
  }
  const targets = new Set(urls.filter(url => typeof url === 'string' && url));
  if (!targets.size) {
    return { ok: true, removed: 0, total: historyState.records.length };
  }
  const beforeCount = historyState.records.length;
  historyState.records = historyState.records.filter(record => !targets.has(record.pageUrl));
  const removed = beforeCount - historyState.records.length;
  if (!removed) {
    return { ok: true, removed: 0, total: historyState.records.length };
  }
  rebuildHistoryIndex();
  await persistHistoryNow();
  return { ok: true, removed, total: historyState.records.length };
}

export async function clearHistoryRecords() {
  await ensureHistoryLoaded();
  const removed = historyState.records.length;
  if (!removed) {
    return { ok: true, removed: 0, total: 0 };
  }
  historyState = createDefaultHistoryState();
  rebuildHistoryIndex();
  await persistHistoryNow();
  return { ok: true, removed, total: 0, cleared: true };
}

export function getHistoryIndexMap() {
  return historyIndexByUrl;
}
