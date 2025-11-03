import {
  ensureHistoryLoaded,
  ensureHistoryRecordStructure,
  getHistoryIndexMap,
  normalizeHistoryPath,
  persistHistoryNow
} from '../storage/history-store.js';
import {
  parseItemsFromHtml,
  parsePageTitleFromHtml,
  isTvShowUrl,
  parseTvShowSeasonCompletionFromHtml,
  parseCompletionFromHtml,
  isSeasonUrl,
  parseTvShowSeasonEntriesFromHtml,
  parseHistoryDetailFromHtml
} from './parser-service.js';
import {
  mergeCompletionStatus,
  mergeSeasonCompletionMap,
  normalizeSeasonEntries,
  summarizeSeasonCompletion
} from '../../shared/utils/completion-status.js';
import { handleTransfer } from './transfer-service.js';

const nowTs = () => Date.now();

export async function collectPageSnapshot(pageUrl) {
  const response = await fetch(pageUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`获取页面失败：${response.status}`);
  }
  const html = await response.text();

  await ensureHistoryLoaded();
  const historyIndex = getHistoryIndexMap();
  const existing = historyIndex.get(pageUrl);
  const recordItems = existing?.record?.items || {};

  const items = parseItemsFromHtml(html, recordItems);
  const pageTitle = parsePageTitleFromHtml(html);
  const pageType = items.length > 1 ? 'series' : 'movie';
  const seasonCompletion = isTvShowUrl(pageUrl) ? parseTvShowSeasonCompletionFromHtml(html) : {};
  let completion = null;
  if (isSeasonUrl(pageUrl)) {
    completion = parseCompletionFromHtml(html, 'season-meta');
    if (completion) {
      const seasonIdMatch = pageUrl.match(/\/seasons\/(\d+)\.html/);
      if (seasonIdMatch) {
        seasonCompletion[seasonIdMatch[1]] = completion;
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

  const seasonEntries = isTvShowUrl(pageUrl)
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

export async function collectHistoryDetail(pageUrl) {
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

export async function handleHistoryDetail(payload = {}) {
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

export async function handleCheckUpdates(payload = {}) {
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
  const meta = {
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

  const transferPayload = {
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

  return {
    ok: true,
    hasUpdates: true,
    pageUrl,
    pageTitle: meta.pageTitle,
    newItems: newItems.length,
    summary: transferResult.summary,
    results: transferResult.results || [],
    jobId: transferResult.jobId,
    completion: record.completion
  };
}
