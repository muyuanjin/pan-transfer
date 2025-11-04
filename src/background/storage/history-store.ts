import {
  HISTORY_VERSION,
  STORAGE_KEYS,
  MAX_HISTORY_RECORDS
} from '../common/constants';
import { storageGet, storageSet } from './utils';
import {
  mergeCompletionStatus,
  mergeSeasonCompletionMap,
  normalizeHistoryCompletion,
  normalizeSeasonCompletionMap,
  normalizeSeasonDirectoryMap,
  mergeSeasonDirectoryMap,
  normalizeSeasonEntries,
  type CompletionStatus,
  type CompletionStatusInput,
  type SeasonEntryInput
} from '../../shared/utils/completion-status';
import { sanitizePosterInfo, type PosterInput } from '../../shared/utils/sanitizers';
import { normalizePath } from '../utils/path';
import type {
  HistoryRecord,
  HistoryRecordItem,
  TransferRequestPayload,
  TransferResponsePayload,
  TransferResultEntry
} from '../../shared/types/transfer';

const nowTs = (): number => Date.now();

interface HistoryState {
  version: number;
  records: HistoryRecord[];
}

interface HistoryIndexEntry {
  index: number;
  record: HistoryRecord;
}

let historyState: HistoryState | null = null;
let historyLoadPromise: Promise<void> | null = null;
const historyIndexByUrl = new Map<string, HistoryIndexEntry>();

function createDefaultHistoryRecord(pageUrl: string): HistoryRecord {
  return {
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
  };
}

function createDefaultHistoryState(): HistoryState {
  return {
    version: HISTORY_VERSION,
    records: []
  };
}

function rebuildHistoryIndex(): void {
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

function sanitizeHistoryItems(items: unknown): Record<string, HistoryRecordItem> {
  if (!items || typeof items !== 'object') {
    return {};
  }
  const result: Record<string, HistoryRecordItem> = {};
  Object.entries(items as Record<string, Partial<HistoryRecordItem>>).forEach(([key, value]) => {
    if (!value) {
      return;
    }
    const itemId = typeof value.id === 'string' && value.id ? value.id : key;
    if (!itemId) {
      return;
    }
    const status = value.status === 'success' || value.status === 'failed' || value.status === 'skipped'
      ? value.status
      : 'failed';
    const item: HistoryRecordItem = {
      id: itemId,
      title: typeof value.title === 'string' ? value.title : '',
      status,
      message: typeof value.message === 'string' ? value.message : '',
      lastStatus: value.lastStatus === 'success' || value.lastStatus === 'failed' || value.lastStatus === 'skipped'
        ? value.lastStatus
        : status
    };
    const errno = Number.isFinite(value.errno as number) ? Number(value.errno) : undefined;
    if (typeof errno === 'number') {
      item.errno = errno;
    }
    const files = Array.isArray(value.files)
      ? value.files.filter((name): name is string => typeof name === 'string')
      : [];
    if (files.length) {
      item.files = files;
    }
    const skipped = Array.isArray(value.skippedFiles)
      ? value.skippedFiles.filter((name): name is string => typeof name === 'string')
      : [];
    if (skipped.length) {
      item.skippedFiles = skipped;
    }
    if (typeof value.linkUrl === 'string') {
      item.linkUrl = value.linkUrl;
    }
    if (typeof value.passCode === 'string') {
      item.passCode = value.passCode;
    }
    const lastTransferredAt = Number.isFinite(value.lastTransferredAt as number) ? Number(value.lastTransferredAt) : undefined;
    if (typeof lastTransferredAt === 'number') {
      item.lastTransferredAt = lastTransferredAt;
    }
    const totalSuccess = Number.isFinite(value.totalSuccess as number) ? Number(value.totalSuccess) : undefined;
    if (typeof totalSuccess === 'number') {
      item.totalSuccess = totalSuccess;
    }
    result[itemId] = item;
  });
  return result;
}

export function ensureHistoryRecordStructure(record: Partial<HistoryRecord> | null | undefined): HistoryRecord {
  const pageUrl = typeof record?.pageUrl === 'string' && record.pageUrl ? record.pageUrl : '';
  const normalized = createDefaultHistoryRecord(pageUrl);

  normalized.pageTitle = typeof record?.pageTitle === 'string' ? record.pageTitle : normalized.pageTitle;
  normalized.pageType = record?.pageType === 'series' || record?.pageType === 'movie' || record?.pageType === 'anime'
    ? record.pageType
    : 'unknown';
  normalized.origin = typeof record?.origin === 'string' ? record.origin : normalized.origin;
  normalized.poster = record?.poster ? (sanitizePosterInfo(record.poster as PosterInput) || null) : null;
  normalized.targetDirectory = normalizeHistoryPath(record?.targetDirectory, normalized.targetDirectory);
  normalized.baseDir = normalizeHistoryPath(record?.baseDir || record?.targetDirectory, normalized.baseDir);
  normalized.useTitleSubdir = typeof record?.useTitleSubdir === 'boolean' ? record.useTitleSubdir : normalized.useTitleSubdir;
  normalized.useSeasonSubdir = typeof record?.useSeasonSubdir === 'boolean'
    ? record.useSeasonSubdir
    : normalized.useSeasonSubdir;
  normalized.lastTransferredAt = Number.isFinite(record?.lastTransferredAt as number)
    ? Number(record?.lastTransferredAt)
    : 0;
  normalized.lastCheckedAt = Number.isFinite(record?.lastCheckedAt as number)
    ? Number(record?.lastCheckedAt)
    : 0;
  normalized.totalTransferred = Number.isFinite(record?.totalTransferred as number)
    ? Number(record?.totalTransferred)
    : 0;
  normalized.completion = normalizeHistoryCompletion(record?.completion as CompletionStatusInput) || null;
  normalized.seasonCompletion = normalizeSeasonCompletionMap(
    record?.seasonCompletion as Record<string, CompletionStatus>
  );
  normalized.seasonDirectory = normalizeSeasonDirectoryMap(record?.seasonDirectory as Record<string, string>);
  normalized.seasonEntries = normalizeSeasonEntries(record?.seasonEntries as SeasonEntryInput[]);
  normalized.items = sanitizeHistoryItems(record?.items);

  const rawOrder = Array.isArray(record?.itemOrder)
    ? record!.itemOrder.map(item => String(item)).filter(Boolean)
    : Object.keys(normalized.items);
  normalized.itemOrder = rawOrder.filter(id => Boolean(normalized.items[id]));

  if (record?.lastResult && typeof record.lastResult === 'object') {
    normalized.lastResult = {
      summary: typeof record.lastResult.summary === 'string' ? record.lastResult.summary : '',
      updatedAt: Number.isFinite(record.lastResult.updatedAt as number) ? Number(record.lastResult.updatedAt) : 0,
      success: Number.isFinite(record.lastResult.success as number) ? Number(record.lastResult.success) : 0,
      skipped: Number.isFinite(record.lastResult.skipped as number) ? Number(record.lastResult.skipped) : 0,
      failed: Number.isFinite(record.lastResult.failed as number) ? Number(record.lastResult.failed) : 0
    };
  }

  return normalized;
}

export function normalizeHistoryPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  return normalizePath(value);
}

function applyResultToHistoryRecord(record: HistoryRecord, result: TransferResultEntry, timestamp: number): void {
  if (typeof result.id === 'undefined') {
    return;
  }
  const itemId = String(result.id);
  if (!itemId) {
    return;
  }
  const existing = record.items[itemId] || {
    id: itemId,
    title: result.title || '',
    status: 'failed',
    message: result.message || ''
  } as HistoryRecordItem;
  const next: HistoryRecordItem = {
    id: itemId,
    title: result.title || existing.title || '',
    status: result.status,
    message: result.message || existing.message || '',
    lastStatus: result.status,
    lastTransferredAt: result.status === 'success'
      ? timestamp
      : (typeof existing.lastTransferredAt === 'number' ? existing.lastTransferredAt : timestamp),
    totalSuccess: result.status === 'success'
      ? (typeof existing.totalSuccess === 'number' ? existing.totalSuccess + 1 : 1)
      : (typeof existing.totalSuccess === 'number' ? existing.totalSuccess : 0)
  };
  const linkUrl = result.linkUrl || existing.linkUrl;
  if (linkUrl) {
    next.linkUrl = linkUrl;
  }
  const passCode = result.passCode || existing.passCode;
  if (passCode) {
    next.passCode = passCode;
  }

  const errnoValue = typeof result.errno === 'number' ? result.errno : existing.errno;
  if (typeof errnoValue === 'number') {
    next.errno = errnoValue;
  }
  const files = result.files ? result.files.slice() : (existing.files ? existing.files.slice() : []);
  if (files.length) {
    next.files = files;
  }
  const skipped = result.skippedFiles ? result.skippedFiles.slice() : (existing.skippedFiles ? existing.skippedFiles.slice() : []);
  if (skipped.length) {
    next.skippedFiles = skipped;
  }
  if (result.status === 'skipped' && !existing.lastTransferredAt) {
    next.lastTransferredAt = timestamp;
  }
  record.items[itemId] = next;
  if (!record.itemOrder.includes(itemId)) {
    record.itemOrder.push(itemId);
  }
}

function upsertHistoryRecord(pageUrl: string): { record: HistoryRecord; index: number } {
  if (!historyState) {
    historyState = createDefaultHistoryState();
  }
  const existing = historyIndexByUrl.get(pageUrl);
  if (existing) {
    return { record: ensureHistoryRecordStructure(existing.record), index: existing.index };
  }
  const record = ensureHistoryRecordStructure(createDefaultHistoryRecord(pageUrl));
  historyState.records.push(record);
  rebuildHistoryIndex();
  const index = historyState.records.length - 1;
  historyIndexByUrl.set(pageUrl, { index, record });
  return { record, index };
}

export async function ensureHistoryLoaded(): Promise<void> {
  if (historyLoadPromise) {
    await historyLoadPromise;
    return;
  }
  historyLoadPromise = (async () => {
    try {
      const stored = await storageGet<{ [STORAGE_KEYS.history]: HistoryState | undefined }>([STORAGE_KEYS.history]);
      const raw = stored[STORAGE_KEYS.history];
      if (raw && raw.version === HISTORY_VERSION && Array.isArray(raw.records)) {
        historyState = {
          version: HISTORY_VERSION,
          records: raw.records.map(record => ensureHistoryRecordStructure(record))
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

export async function persistHistoryNow(): Promise<void> {
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

export function getHistoryRecord(pageUrl: string): HistoryRecord | null {
  const entry = historyIndexByUrl.get(pageUrl);
  return entry ? ensureHistoryRecordStructure(entry.record) : null;
}

export function getHistoryRecords(): HistoryRecord[] {
  return historyState?.records || [];
}

export async function recordTransferHistory(
  payload: TransferRequestPayload,
  outcome: TransferResponsePayload
): Promise<void> {
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
  record.pageType = typeof meta.pageType === 'string' && meta.pageType ? meta.pageType as HistoryRecord['pageType'] : (record.pageType || 'unknown');
  record.poster = sanitizePosterInfo(meta.poster as PosterInput) || record.poster || null;
  record.targetDirectory = normalizeHistoryPath(meta.targetDirectory || payload.targetDirectory || record.targetDirectory, record.targetDirectory || '/');
  record.baseDir = normalizeHistoryPath(meta.baseDir || record.baseDir || record.targetDirectory, record.baseDir || '/');
  record.useTitleSubdir = typeof meta.useTitleSubdir === 'boolean' ? meta.useTitleSubdir : Boolean(record.useTitleSubdir);
  record.useSeasonSubdir = typeof meta.useSeasonSubdir === 'boolean' ? meta.useSeasonSubdir : Boolean(record.useSeasonSubdir);
  if (meta.seasonDirectory && typeof meta.seasonDirectory === 'object') {
    record.seasonDirectory = mergeSeasonDirectoryMap(record.seasonDirectory, meta.seasonDirectory as Record<string, string>);
  }
  if (Array.isArray(meta.seasonEntries)) {
    const normalizedEntries = normalizeSeasonEntries(meta.seasonEntries as SeasonEntryInput[]);
    if (normalizedEntries.length) {
      record.seasonEntries = normalizedEntries;
    }
  }
  record.lastCheckedAt = timestamp;
  if (meta.completion) {
    record.completion = mergeCompletionStatus(record.completion, meta.completion, timestamp, meta.completion?.source || 'transfer-meta');
  }
  if (meta.seasonCompletion && typeof meta.seasonCompletion === 'object') {
    record.seasonCompletion = mergeSeasonCompletionMap(
      record.seasonCompletion,
      meta.seasonCompletion as Record<string, CompletionStatusInput>,
      timestamp,
      'transfer-meta'
    );
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

  historyState!.records.sort((a, b) => {
    const tsA = a.lastTransferredAt || a.lastCheckedAt || 0;
    const tsB = b.lastTransferredAt || b.lastCheckedAt || 0;
    return tsB - tsA;
  });

  if (historyState!.records.length > MAX_HISTORY_RECORDS) {
    historyState!.records = historyState!.records.slice(0, MAX_HISTORY_RECORDS);
  }

  rebuildHistoryIndex();
  await persistHistoryNow();
}

export async function deleteHistoryRecords(urls: string[] = []): Promise<{ ok: boolean; removed: number; total: number }> {
  await ensureHistoryLoaded();
  if (!historyState) {
    historyState = createDefaultHistoryState();
  }
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

export async function clearHistoryRecords(): Promise<{ ok: boolean; removed: number; total: number; cleared?: boolean }> {
  await ensureHistoryLoaded();
  if (!historyState) {
    historyState = createDefaultHistoryState();
  }
  const removed = historyState.records.length;
  if (!removed) {
    return { ok: true, removed: 0, total: 0 };
  }
  historyState = createDefaultHistoryState();
  rebuildHistoryIndex();
  await persistHistoryNow();
  return { ok: true, removed, total: 0, cleared: true };
}

export function getHistoryIndexMap(): Map<string, HistoryIndexEntry> {
  return historyIndexByUrl;
}
