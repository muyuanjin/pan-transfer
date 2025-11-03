import { HISTORY_KEY, HISTORY_FILTERS } from '../constants.js';
import { normalizePageUrl } from './page-analyzer.js';

export async function readHistoryFromStorage() {
  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    return stored[HISTORY_KEY] || null;
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to read history from storage', error);
    return null;
  }
}

export function normalizeHistoryCompletion(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';
  const state = typeof entry.state === 'string' ? entry.state : 'unknown';
  const normalized = {
    label,
    state
  };
  if (entry.source && typeof entry.source === 'string') {
    normalized.source = entry.source;
  }
  if (typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)) {
    normalized.updatedAt = entry.updatedAt;
  }
  return normalized;
}

export function normalizeSeasonCompletionMap(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const result = {};
  Object.entries(value).forEach(([key, entry]) => {
    const normalized = normalizeHistoryCompletion(entry);
    if (normalized) {
      result[key] = normalized;
    }
  });
  return result;
}

export function normalizeSeasonDirectory(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const result = {};
  Object.entries(value).forEach(([key, dir]) => {
    if (typeof dir !== 'string') {
      return;
    }
    const trimmed = dir.trim();
    if (trimmed) {
      result[key] = trimmed;
    }
  });
  return result;
}

export function normalizeHistorySeasonEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map(entry => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const seasonId = typeof entry.seasonId === 'string' && entry.seasonId
        ? entry.seasonId
        : (typeof entry.id === 'string' ? entry.id : '');
      const url = typeof entry.url === 'string' ? entry.url : '';
      const label = typeof entry.label === 'string' ? entry.label : '';
      const seasonIndex = Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : 0;
      const completion = entry.completion && typeof entry.completion === 'object'
        ? normalizeHistoryCompletion(entry.completion)
        : null;
      const poster = entry.poster && typeof entry.poster === 'object' && entry.poster.src
        ? { src: entry.poster.src, alt: entry.poster.alt || '' }
        : null;
      return {
        seasonId,
        url,
        label,
        seasonIndex,
        completion,
        poster,
        loaded: Boolean(entry.loaded),
        hasItems: Boolean(entry.hasItems)
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.seasonIndex === b.seasonIndex) {
        return a.seasonId.localeCompare(b.seasonId, 'zh-CN');
      }
      return a.seasonIndex - b.seasonIndex;
    });
}

export function getHistoryRecordTimestamp(record) {
  if (!record || typeof record !== 'object') {
    return 0;
  }
  const timestamps = [
    record.lastTransferredAt,
    record.lastCheckedAt,
    record.lastResult && record.lastResult.updatedAt
  ].filter(value => Number.isFinite(value) && value > 0);
  if (!timestamps.length) {
    return 0;
  }
  return Math.max(...timestamps);
}

export function deriveHistoryGroupKey(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }
  let origin = typeof record.origin === 'string' ? record.origin : '';
  if (!origin) {
    try {
      const url = new URL(record.pageUrl);
      origin = `${url.protocol}//${url.host}`;
    } catch (_error) {
      origin = '';
    }
  }
  const title = typeof record.pageTitle === 'string' && record.pageTitle.trim()
    ? record.pageTitle.trim()
    : '未命名资源';
  return `${origin}::${title}`;
}

export function selectHistoryMainRecord(records) {
  if (!Array.isArray(records) || !records.length) {
    return null;
  }
  const tvShowRecord = records.find(record => /\/tvshows\/\d+\.html/.test(record.pageUrl));
  if (tvShowRecord) {
    return tvShowRecord;
  }
  const aggregatedRecord = records.find(record => Array.isArray(record.seasonEntries) && record.seasonEntries.length > 0);
  if (aggregatedRecord) {
    return aggregatedRecord;
  }
  const nonSeasonRecord = records.find(record => !/\/seasons\/\d+\.html/.test(record.pageUrl));
  if (nonSeasonRecord) {
    return nonSeasonRecord;
  }
  return records[0];
}

export function buildHistoryGroups(records) {
  if (!Array.isArray(records) || !records.length) {
    return [];
  }
  const groupMap = new Map();
  records.forEach(record => {
    const key = deriveHistoryGroupKey(record);
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key).push(record);
  });
  const groups = [];
  groupMap.forEach((groupRecords, key) => {
    const sortedRecords = groupRecords.slice().sort((a, b) => {
      const diff = getHistoryRecordTimestamp(b) - getHistoryRecordTimestamp(a);
      if (diff !== 0) {
        return diff;
      }
      return (b.totalTransferred || 0) - (a.totalTransferred || 0);
    });
    const mainRecord = selectHistoryMainRecord(sortedRecords) || sortedRecords[0];
    const children = sortedRecords.filter(record => record !== mainRecord);
    const urls = sortedRecords
      .map(record => normalizePageUrl(record.pageUrl))
      .filter(Boolean);
    const updatedAt = sortedRecords.reduce((maxTs, record) => Math.max(maxTs, getHistoryRecordTimestamp(record)), 0);
    const posterCandidate = (mainRecord.poster && mainRecord.poster.src)
      ? mainRecord.poster
      : (children.find(record => record.poster && record.poster.src)?.poster || null);
    groups.push({
      key,
      title: mainRecord.pageTitle || '未命名资源',
      origin: mainRecord.origin || '',
      poster: posterCandidate,
      updatedAt,
      records: sortedRecords,
      main: mainRecord,
      children,
      urls,
      seasonEntries: Array.isArray(mainRecord.seasonEntries) ? mainRecord.seasonEntries : []
    });
  });
  groups.sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}

export function buildHistoryGroupSeasonRows(group) {
  if (!group) {
    return [];
  }
  const seasonEntries = Array.isArray(group.seasonEntries) ? group.seasonEntries : [];
  const entryByUrl = new Map();
  const entryById = new Map();
  seasonEntries.forEach((entry, index) => {
    const normalizedUrl = normalizePageUrl(entry.url);
    const normalizedEntry = {
      seasonId: entry.seasonId || '',
      url: entry.url || '',
      label: entry.label || `季 ${index + 1}`,
      poster: entry.poster || null,
      completion: entry.completion || null,
      seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : index
    };
    if (normalizedUrl) {
      entryByUrl.set(normalizedUrl, normalizedEntry);
    }
    if (normalizedEntry.seasonId) {
      entryById.set(normalizedEntry.seasonId, normalizedEntry);
    }
  });

  const rows = [];
  const usedKeys = new Set();
  const children = Array.isArray(group.children) ? group.children : [];
  children.forEach((record, index) => {
    const normalizedUrl = normalizePageUrl(record.pageUrl);
    const primaryEntry = (normalizedUrl && entryByUrl.get(normalizedUrl)) ||
      (Array.isArray(record.seasonEntries) && record.seasonEntries.length === 1
        ? entryById.get(record.seasonEntries[0].seasonId)
        : null);
    let label = primaryEntry?.label || '';
    if (!label && typeof record.pageUrl === 'string') {
      const seasonMatch = record.pageUrl.match(/\/seasons\/(\d+)\.html/);
      if (seasonMatch) {
        label = `第${seasonMatch[1]}季`;
      }
    }
    if (!label) {
      label = record.pageTitle || `季 ${index + 1}`;
    }
    const poster = record.poster || primaryEntry?.poster || null;
    const completion = primaryEntry?.completion || record.completion || null;
    const seasonId = primaryEntry?.seasonId ||
      (Array.isArray(record.seasonEntries) && record.seasonEntries.length === 1 ? record.seasonEntries[0].seasonId : '');
    let seasonIndex = Number.isFinite(primaryEntry?.seasonIndex)
      ? primaryEntry.seasonIndex
      : (Number.isFinite(index) ? index : 0);
    if (!Number.isFinite(seasonIndex) && typeof record.pageUrl === 'string') {
      const seasonMatch = record.pageUrl.match(/\/seasons\/(\d+)\.html/);
      if (seasonMatch) {
        const parsed = parseInt(seasonMatch[1], 10);
        if (Number.isFinite(parsed)) {
          seasonIndex = parsed;
        }
      }
    }
    const key = normalizedUrl || seasonId || `${group.key}-child-${index}`;
    usedKeys.add(key);
    rows.push({
      key,
      label,
      url: record.pageUrl,
      poster,
      completion,
      seasonId,
      seasonIndex,
      canCheck: true,
      record,
      recordTimestamp: getHistoryRecordTimestamp(record)
    });
  });

  seasonEntries.forEach((entry, index) => {
    const normalizedUrl = normalizePageUrl(entry.url);
    const key = normalizedUrl || entry.seasonId || `${group.key}-season-${index}`;
    if (usedKeys.has(key)) {
      return;
    }
    rows.push({
      key,
      label: entry.label || `季 ${index + 1}`,
      url: entry.url || '',
      poster: entry.poster || null,
      completion: entry.completion || null,
      seasonId: entry.seasonId || '',
      seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : index,
      canCheck: false,
      record: null,
      recordTimestamp: 0
    });
  });

  rows.sort((a, b) => {
    if (a.seasonIndex === b.seasonIndex) {
      return a.label.localeCompare(b.label, 'zh-CN');
    }
    return a.seasonIndex - b.seasonIndex;
  });
  return rows;
}

export function getHistoryGroupMain(group) {
  if (!group || typeof group !== 'object') {
    return null;
  }
  return group.main || null;
}

export function getHistoryGroupCompletion(group) {
  const main = getHistoryGroupMain(group);
  return main && main.completion ? main.completion : null;
}

export function getHistoryGroupCompletionState(group) {
  const completion = getHistoryGroupCompletion(group);
  return completion && completion.state ? completion.state : 'unknown';
}

export function isHistoryGroupCompleted(group) {
  return getHistoryGroupCompletionState(group) === 'completed';
}

export function isHistoryGroupSeries(group) {
  const main = getHistoryGroupMain(group);
  return Boolean(main && main.pageType === 'series');
}

export function isHistoryGroupMovie(group) {
  const main = getHistoryGroupMain(group);
  return Boolean(main && main.pageType === 'movie');
}

export function canCheckHistoryGroup(group) {
  if (!group) {
    return false;
  }
  if (!isHistoryGroupSeries(group)) {
    return false;
  }
  return !isHistoryGroupCompleted(group);
}

export function normalizeHistoryFilter(filter) {
  return HISTORY_FILTERS.includes(filter) ? filter : 'all';
}

export function filterHistoryGroups(groups, filter = 'all') {
  const normalized = normalizeHistoryFilter(filter);
  const list = Array.isArray(groups) ? groups : [];
  return list.filter(group => {
    switch (normalized) {
      case 'series':
        return isHistoryGroupSeries(group);
      case 'movie':
        return isHistoryGroupMovie(group);
      case 'ongoing':
        return canCheckHistoryGroup(group);
      case 'completed':
        return isHistoryGroupCompleted(group);
      case 'all':
      default:
        return true;
    }
  });
}

export function prepareHistoryRecords(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.records)) {
    return { records: [], groups: [] };
  }
  const records = raw.records
    .map(record => {
      const safe = record || {};
      if (!safe.items || typeof safe.items !== 'object') {
        safe.items = {};
      }
      safe.completion = normalizeHistoryCompletion(safe.completion);
      safe.seasonCompletion = normalizeSeasonCompletionMap(safe.seasonCompletion);
      safe.seasonDirectory = normalizeSeasonDirectory(safe.seasonDirectory);
      safe.useSeasonSubdir = Boolean(safe.useSeasonSubdir);
      safe.seasonEntries = normalizeHistorySeasonEntries(safe.seasonEntries);
      return safe;
    })
    .sort((a, b) => {
      const tsA = a.lastTransferredAt || a.lastCheckedAt || 0;
      const tsB = b.lastTransferredAt || b.lastCheckedAt || 0;
      return tsB - tsA;
    });
  const groups = buildHistoryGroups(records);
  return { records, groups };
}

export async function deleteHistoryRecords(urls) {
  if (!Array.isArray(urls) || !urls.length) {
    return { ok: true, removed: 0 };
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'chaospace:history-delete',
      payload: { urls }
    });
    if (!response || response.ok === false) {
      throw new Error(response?.error || '删除历史记录失败');
    }
    return response;
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to delete history records', error);
    throw error;
  }
}

export async function clearAllHistoryRecords() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'chaospace:history-clear' });
    if (!response || response.ok === false) {
      throw new Error(response?.error || '清空历史记录失败');
    }
    return response;
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to clear history', error);
    throw error;
  }
}

export async function requestHistoryUpdate(pageUrl) {
  if (!pageUrl) {
    return { ok: false, error: new Error('缺少页面地址') };
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'chaospace:check-updates',
      payload: { pageUrl }
    });
    if (!response || response.ok === false) {
      const errorMessage = response?.error || '检测失败';
      return { ok: false, error: new Error(errorMessage) };
    }
    return response;
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to request history update', error);
    return { ok: false, error };
  }
}

export async function fetchHistorySnapshot() {
  try {
    const rawHistory = await readHistoryFromStorage();
    return prepareHistoryRecords(rawHistory);
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to load history', error);
    return { records: [], groups: [] };
  }
}
