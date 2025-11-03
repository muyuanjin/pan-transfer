import { sanitizePosterInfo } from './sanitizers.js';

export function isDateLikeLabel(text) {
  if (!text) {
    return false;
  }
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  if (/^\d{4}([\-\/年\.]|$)/.test(normalized)) {
    return true;
  }
  if (/^\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}$/.test(normalized)) {
    return true;
  }
  return false;
}

export function classifyCompletionState(label) {
  if (label == null) return 'unknown';
  const text = String(label || '').trim();
  if (!text) return 'unknown';

  const completedRegex = /^(完结|收官|全集|已完)$|^全\d+[集话]$|已完结|全集完结/;
  const ongoingRegex = /^(更新|连载|播出中|热播|未完结)$|更新至|连载中|第\d+[集话]/;
  const upcomingRegex = /^(未播|敬请期待|即将|待定|预定|未上映)$|即将上映|预计/;

  if (upcomingRegex.test(text)) {
    return 'upcoming';
  }
  if (ongoingRegex.test(text)) {
    return 'ongoing';
  }
  if (completedRegex.test(text)) {
    return 'completed';
  }

  return 'unknown';
}

export function createCompletionStatus(label, source = '') {
  const text = (label || '').trim();
  if (!text) {
    return null;
  }
  const status = {
    label: text,
    state: classifyCompletionState(text)
  };
  if (source) {
    status.source = source;
  }
  return status;
}

export function normalizeHistoryCompletion(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';
  const state = typeof entry.state === 'string' && entry.state ? entry.state : classifyCompletionState(label);
  const normalized = {
    label,
    state: state || 'unknown'
  };
  if (entry.source && typeof entry.source === 'string' && entry.source.trim()) {
    normalized.source = entry.source.trim();
  }
  if (typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)) {
    normalized.updatedAt = entry.updatedAt;
  }
  return normalized;
}

export function mergeCompletionStatus(existing, incoming, timestamp, sourceHint = '') {
  const normalizedIncoming = normalizeHistoryCompletion(incoming);
  if (!normalizedIncoming) {
    return existing || null;
  }
  const next = { ...normalizedIncoming };
  if (sourceHint && !next.source) {
    next.source = sourceHint;
  }
  if (existing) {
    if (!next.label && existing.label) {
      next.label = existing.label;
    }
    if ((!next.state || next.state === 'unknown') && existing.state) {
      next.state = existing.state;
    }
    if (!next.updatedAt && existing.updatedAt) {
      next.updatedAt = existing.updatedAt;
    }
    if (!next.source && existing.source) {
      next.source = existing.source;
    }
  }
  if (timestamp && Number.isFinite(timestamp)) {
    next.updatedAt = timestamp;
  }
  return next;
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

export function mergeSeasonCompletionMap(current, updates, timestamp, sourceHint = '') {
  const target = current && typeof current === 'object' ? current : {};
  if (!updates || typeof updates !== 'object') {
    return target;
  }
  Object.entries(updates).forEach(([key, entry]) => {
    const merged = mergeCompletionStatus(target[key], entry, timestamp, sourceHint);
    if (merged) {
      target[key] = merged;
    }
  });
  return target;
}

export function normalizeSeasonDirectoryMap(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const result = {};
  Object.entries(value).forEach(([key, dir]) => {
    if (typeof dir !== 'string') {
      return;
    }
    const trimmed = dir.trim();
    if (!trimmed) {
      return;
    }
    const safe = trimmed.replace(/[/\\]+/g, '/');
    result[key] = safe;
  });
  return result;
}

export function mergeSeasonDirectoryMap(current, updates) {
  const base = normalizeSeasonDirectoryMap(current);
  const incoming = normalizeSeasonDirectoryMap(updates);
  return { ...base, ...incoming };
}

export function sanitizeSeasonEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const seasonId = typeof entry.seasonId === 'string' && entry.seasonId
    ? entry.seasonId
    : (typeof entry.id === 'string' ? entry.id : '');
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!seasonId && !url) {
    return null;
  }
  const sanitized = {
    seasonId,
    url,
    label: typeof entry.label === 'string' ? entry.label.trim() : '',
    seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : 0,
    completion: entry.completion ? normalizeHistoryCompletion(entry.completion) : null,
    loaded: Boolean(entry.loaded),
    hasItems: Boolean(entry.hasItems)
  };
  if (entry.poster) {
    const poster = sanitizePosterInfo(entry.poster);
    if (poster) {
      sanitized.poster = poster;
    }
  }
  if (entry.updatedAt && Number.isFinite(entry.updatedAt)) {
    sanitized.updatedAt = entry.updatedAt;
  }
  return sanitized;
}

export function normalizeSeasonEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map(sanitizeSeasonEntry)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.seasonIndex === b.seasonIndex) {
        return a.seasonId.localeCompare(b.seasonId, 'zh-CN');
      }
      return a.seasonIndex - b.seasonIndex;
    });
}

export function summarizeSeasonCompletion(statuses = []) {
  const valid = statuses.filter(Boolean);
  if (!valid.length) {
    return null;
  }
  const states = valid.map(status => status.state || 'unknown');
  if (states.every(state => state === 'completed')) {
    return { label: '已完结', state: 'completed' };
  }
  if (states.some(state => state === 'ongoing')) {
    return { label: '连载中', state: 'ongoing' };
  }
  if (states.some(state => state === 'upcoming')) {
    return { label: '未开播', state: 'upcoming' };
  }
  const fallback = valid.find(status => status.label) || valid[0];
  return {
    label: fallback.label || '未知状态',
    state: fallback.state || 'unknown'
  };
}
