import {
  ensureHistoryLoaded,
  ensureHistoryRecordStructure,
  getHistoryIndexMap,
  normalizeHistoryPath,
  persistHistoryNow
} from '../storage/history-store';
import {
  parseItemsFromHtml,
  parsePageTitleFromHtml,
  isTvShowUrl,
  parseTvShowSeasonCompletionFromHtml,
  parseCompletionFromHtml,
  isSeasonUrl,
  parseTvShowSeasonEntriesFromHtml,
  parseHistoryDetailFromHtml,
  type ParsedItem,
  type SeasonEntrySummary,
  type HistoryDetail
} from './parser-service';
import {
  mergeCompletionStatus,
  mergeSeasonCompletionMap,
  normalizeSeasonEntries,
  summarizeSeasonCompletion,
  type CompletionStatus
} from '../../shared/utils/completion-status';
import { handleTransfer } from './transfer-service';
import type {
  TransferRequestPayload,
  TransferResultEntry,
  TransferJobMeta
} from '../../shared/types/transfer';

interface PageSnapshot {
  pageUrl: string;
  pageTitle: string;
  pageType: 'series' | 'movie' | 'anime' | 'unknown';
  total: number;
  items: ParsedItem[];
  completion: CompletionStatus | null;
  seasonCompletion: Record<string, CompletionStatus>;
  seasonEntries: SeasonEntrySummary[];
}

const nowTs = (): number => Date.now();

export async function collectPageSnapshot(pageUrl: string): Promise<PageSnapshot> {
  const response = await fetch(pageUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`获取页面失败：${response.status}`);
  }
  const html = await response.text();

  await ensureHistoryLoaded();
  const historyIndex = getHistoryIndexMap();
  const existing = historyIndex.get(pageUrl);
  const recordItems = (existing?.record?.items ?? {}) as Record<string, { linkUrl?: string; passCode?: string }>;

  const items = parseItemsFromHtml(html, recordItems);
  const pageTitle = parsePageTitleFromHtml(html);
  const pageType: PageSnapshot['pageType'] = items.length > 1 ? 'series' : 'movie';
  const seasonCompletion: Record<string, CompletionStatus> = isTvShowUrl(pageUrl)
    ? parseTvShowSeasonCompletionFromHtml(html)
    : {};
  let completion: CompletionStatus | null = null;
  if (isSeasonUrl(pageUrl)) {
    completion = parseCompletionFromHtml(html, 'season-meta');
    if (completion) {
      const seasonIdMatch = pageUrl.match(/\/seasons\/(\d+)\.html/);
      const seasonId = seasonIdMatch?.[1];
      if (seasonId) {
        seasonCompletion[seasonId] = completion;
      }
    }
  } else if (isTvShowUrl(pageUrl)) {
    completion = summarizeSeasonCompletion(Object.values(seasonCompletion));
  } else {
    completion = parseCompletionFromHtml(html, 'detail-meta');
  }
  if (!completion && Object.keys(seasonCompletion).length) {
    completion = summarizeSeasonCompletion(Object.values(seasonCompletion));
  }

  const seasonEntries: SeasonEntrySummary[] = isTvShowUrl(pageUrl)
    ? parseTvShowSeasonEntriesFromHtml(html, pageUrl).map((entry, idx) => ({
      seasonId: entry.seasonId,
      url: entry.url,
      label: entry.label,
      seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : idx,
      poster: entry.poster || null,
      completion: seasonCompletion[entry.seasonId] || null
    }))
    : [];

  return {
    pageUrl,
    pageTitle,
    pageType,
    total: items.length,
    items,
    completion,
    seasonCompletion,
    seasonEntries
  };
}

export async function collectHistoryDetail(pageUrl: string): Promise<HistoryDetail> {
  if (!pageUrl) {
    throw new Error('缺少页面地址');
  }
  const response = await fetch(pageUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`获取页面失败：${response.status}`);
  }
  const html = await response.text();
  return parseHistoryDetailFromHtml(html, pageUrl);
}

interface HistoryDetailPayload {
  pageUrl?: string;
}

export async function handleHistoryDetail(payload: HistoryDetailPayload = {}): Promise<{
  ok: true;
  pageUrl: string;
  detail: HistoryDetail;
}> {
  const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
  if (!pageUrl) {
    throw new Error('缺少页面地址');
  }
  const detail = await collectHistoryDetail(pageUrl);
  return {
    ok: true,
    pageUrl,
    detail
  };
}

interface CheckUpdatesPayload extends HistoryDetailPayload {
  targetDirectory?: string;
}

export interface CheckUpdatesResult {
  ok: true;
  hasUpdates: boolean;
  pageUrl: string;
  pageTitle: string;
  totalKnown: number;
  latestCount: number;
  reason?: string;
  completion?: CompletionStatus | null;
  newItems?: number;
  summary?: string;
  results?: TransferResultEntry[];
  jobId?: string;
}

export async function handleCheckUpdates(payload: CheckUpdatesPayload = {}): Promise<CheckUpdatesResult> {
  const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
  if (!pageUrl) {
    throw new Error('缺少页面地址');
  }
  await ensureHistoryLoaded();
  const historyIndex = getHistoryIndexMap();
  const entry = historyIndex.get(pageUrl);
  if (!entry || !entry.record) {
    throw new Error('未找到该页面的历史记录');
  }
  const record = ensureHistoryRecordStructure(entry.record);
  const snapshot = await collectPageSnapshot(pageUrl);
  const knownIds = new Set(Object.keys(record.items || {}));
  const timestamp = nowTs();

  if (snapshot.completion) {
    record.completion = mergeCompletionStatus(
      record.completion,
      snapshot.completion,
      timestamp,
      snapshot.completion.source || 'snapshot'
    );
  }
  if (snapshot.seasonCompletion && typeof snapshot.seasonCompletion === 'object') {
    record.seasonCompletion = mergeSeasonCompletionMap(
      record.seasonCompletion,
      snapshot.seasonCompletion,
      timestamp,
      'snapshot'
    );
  }
  if (Array.isArray(snapshot.seasonEntries) && snapshot.seasonEntries.length) {
    const normalizedEntries = normalizeSeasonEntries(snapshot.seasonEntries);
    if (normalizedEntries.length) {
      record.seasonEntries = normalizedEntries;
    }
  }

  const newItems = snapshot.items.filter(item => !knownIds.has(String(item.id)));

  if (record.completion && record.completion.state === 'completed') {
    record.lastCheckedAt = timestamp;
    await persistHistoryNow();
    return {
      ok: true,
      hasUpdates: false,
      pageUrl,
      pageTitle: snapshot.pageTitle || record.pageTitle || '',
      totalKnown: knownIds.size,
      latestCount: snapshot.items.length,
      reason: 'completed',
      completion: record.completion
    };
  }

  if (!newItems.length) {
    record.lastCheckedAt = timestamp;
    await persistHistoryNow();
    return {
      ok: true,
      hasUpdates: false,
      pageUrl,
      pageTitle: snapshot.pageTitle || record.pageTitle || '',
      totalKnown: knownIds.size,
      latestCount: snapshot.items.length,
      completion: record.completion
    };
  }

  const targetDirectory = normalizeHistoryPath(record.targetDirectory || payload.targetDirectory || '/');
  let origin = record.origin;
  if (!origin) {
    try {
      const url = new URL(pageUrl);
      origin = `${url.protocol}//${url.host}`;
    } catch (_error) {
      origin = record.origin || '';
    }
  }

  const jobId = `update-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const meta: TransferJobMeta & { trigger: string; total: number } = {
    baseDir: normalizeHistoryPath(record.baseDir || targetDirectory),
    useTitleSubdir: false,
    pageTitle: snapshot.pageTitle || record.pageTitle || '',
    pageUrl,
    pageType: record.pageType || snapshot.pageType || 'series',
    targetDirectory,
    completion: snapshot.completion || record.completion || null,
    seasonCompletion: snapshot.seasonCompletion || record.seasonCompletion || {},
    poster: record.poster || null,
    trigger: 'history-update',
    total: newItems.length
  };

  const transferPayload: TransferRequestPayload = {
    jobId,
    origin: origin || '',
    items: newItems.map(item => ({
      id: item.id,
      title: item.title,
      targetPath: targetDirectory,
      linkUrl: item.linkUrl || '',
      passCode: item.passCode || ''
    })),
    targetDirectory,
    meta
  };

  const transferResult = await handleTransfer(transferPayload);

  const updateResult: CheckUpdatesResult = {
    ok: true,
    hasUpdates: true,
    pageUrl,
    pageTitle: meta.pageTitle || '',
    newItems: newItems.length,
    summary: transferResult.summary,
    results: transferResult.results || [],
    completion: record.completion,
    totalKnown: knownIds.size,
    latestCount: snapshot.items.length
  };
  if (transferResult.jobId) {
    updateResult.jobId = transferResult.jobId;
  }
  return updateResult;
}
