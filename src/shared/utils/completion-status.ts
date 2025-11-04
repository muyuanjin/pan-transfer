import { sanitizePosterInfo, type PosterInfo } from './sanitizers';

export type CompletionState = 'unknown' | 'ongoing' | 'completed' | 'upcoming';

export interface CompletionStatus {
  label: string;
  state: CompletionState;
  source?: string;
  updatedAt?: number;
}

export type CompletionStatusInput = Partial<CompletionStatus> | null | undefined;

export interface SeasonEntry {
  seasonId: string;
  url: string;
  label: string;
  seasonIndex: number;
  completion: CompletionStatus | null;
  loaded: boolean;
  hasItems: boolean;
  poster?: PosterInfo | null;
  updatedAt?: number;
}

export type SeasonEntryInput = {
  seasonId?: unknown;
  id?: unknown;
  url?: unknown;
  label?: unknown;
  seasonIndex?: unknown;
  completion?: CompletionStatusInput;
  loaded?: unknown;
  hasItems?: unknown;
  poster?: unknown;
  updatedAt?: unknown;
} | null | undefined;

export function isDateLikeLabel(text: unknown): boolean {
  if (typeof text !== 'string') {
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

export function classifyCompletionState(label: unknown): CompletionState {
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

export function createCompletionStatus(label: unknown, source = ''): CompletionStatus | null {
  const text = typeof label === 'string' ? label.trim() : String(label || '').trim();
  if (!text) {
    return null;
  }
  const status: CompletionStatus = {
    label: text,
    state: classifyCompletionState(text)
  };
  if (source) {
    status.source = source;
  }
  return status;
}

export function normalizeHistoryCompletion(entry: CompletionStatusInput): CompletionStatus | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';
  const state = typeof entry.state === 'string' && entry.state
    ? entry.state as CompletionState
    : classifyCompletionState(label);
  const normalized: CompletionStatus = {
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

export function mergeCompletionStatus(
  existing: CompletionStatus | null | undefined,
  incoming: CompletionStatusInput,
  timestamp?: number,
  sourceHint = ''
): CompletionStatus | null {
  const normalizedIncoming = normalizeHistoryCompletion(incoming);
  if (!normalizedIncoming) {
    return existing || null;
  }
  const next: CompletionStatus = { ...normalizedIncoming };
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

export function normalizeSeasonCompletionMap(
  value: Record<string, CompletionStatusInput> | null | undefined
): Record<string, CompletionStatus> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const result: Record<string, CompletionStatus> = {};
  Object.entries(value).forEach(([key, entry]) => {
    const normalized = normalizeHistoryCompletion(entry);
    if (normalized) {
      result[key] = normalized;
    }
  });
  return result;
}

export function mergeSeasonCompletionMap(
  current: Record<string, CompletionStatus | undefined> | null,
  updates: Record<string, CompletionStatusInput> | null | undefined,
  timestamp?: number,
  sourceHint = ''
): Record<string, CompletionStatus> {
  const target: Record<string, CompletionStatus> = current && typeof current === 'object'
    ? { ...current } as Record<string, CompletionStatus>
    : {};
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

export function normalizeSeasonDirectoryMap(
  value: Record<string, unknown> | null | undefined
): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const result: Record<string, string> = {};
  Object.entries(value).forEach(([key, dir]) => {
    if (typeof dir !== 'string') {
      return;
    }
    const trimmed = dir.trim();
    if (!trimmed) {
      return;
    }
    const safe = trimmed.replace(/[\/\\]+/g, '/');
    result[key] = safe;
  });
  return result;
}

export function mergeSeasonDirectoryMap(
  current: Record<string, unknown> | null | undefined,
  updates: Record<string, unknown> | null | undefined
): Record<string, string> {
  const base = normalizeSeasonDirectoryMap(current as Record<string, unknown>);
  const incoming = normalizeSeasonDirectoryMap(updates as Record<string, unknown>);
  return { ...base, ...incoming };
}

export function sanitizeSeasonEntry(entry: SeasonEntryInput): SeasonEntry | null {
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
  const sanitized: SeasonEntry = {
    seasonId,
    url,
    label: typeof entry.label === 'string' ? entry.label.trim() : '',
    seasonIndex: Number.isFinite(entry.seasonIndex as number) ? Number(entry.seasonIndex) : 0,
    completion: entry.completion ? normalizeHistoryCompletion(entry.completion) : null,
    loaded: Boolean(entry.loaded),
    hasItems: Boolean(entry.hasItems)
  };
  if (entry.poster) {
    const poster = sanitizePosterInfo(entry.poster as Record<string, unknown>);
    if (poster) {
      sanitized.poster = poster;
    }
  }
  if (Number.isFinite(entry.updatedAt as number)) {
    sanitized.updatedAt = Number(entry.updatedAt);
  }
  return sanitized;
}

export function normalizeSeasonEntries(entries: SeasonEntryInput[] | null | undefined): SeasonEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map(sanitizeSeasonEntry)
    .filter((entry): entry is SeasonEntry => Boolean(entry))
    .sort((a, b) => {
      if (a.seasonIndex === b.seasonIndex) {
        return a.seasonId.localeCompare(b.seasonId, 'zh-CN');
      }
      return a.seasonIndex - b.seasonIndex;
    });
}

export function summarizeSeasonCompletion(statuses: CompletionStatusInput[] = []): CompletionStatus | null {
  const valid = statuses
    .map(normalizeHistoryCompletion)
    .filter((status): status is CompletionStatus => Boolean(status));
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
  const fallback = valid.find(status => Boolean(status.label)) ?? valid[0]!;
  return {
    label: fallback.label || '未知状态',
    state: fallback.state || 'unknown'
  };
}
