// @ts-nocheck
import { normalizeDir, sanitizeSeasonDirSegment, buildPanDirectoryUrl } from '../../services/page-analyzer';
import type { HistoryCompletion, HistoryGroup, HistoryGroupSeasonRow } from '../../types';

export interface HistoryStatusBadge {
  label: string;
  state: string;
}

export function createStatusBadge(completion: HistoryCompletion | null | undefined): HistoryStatusBadge | null {
  if (!completion || !completion.label) {
    return null;
  }
  return {
    label: completion.label,
    state: completion.state || 'unknown'
  };
}

export function formatHistoryTimestamp(timestamp: number | null | undefined): string {
  if (!Number.isFinite(timestamp) || !timestamp || timestamp <= 0) {
    return '';
  }
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    return formatter.format(new Date(timestamp));
  } catch (_error) {
    return '';
  }
}

export interface PanInfo {
  path: string;
  url: string;
  isFallback: boolean;
}

export interface ResolvePanOptions {
  record?: Record<string, unknown> | null;
  group?: HistoryGroup | null;
  seasonId?: string;
}

export function resolveHistoryPanInfo(options: ResolvePanOptions = {}): PanInfo {
  const { record = null, group = null, seasonId = '' } = options;
  const baseCandidates: string[] = [];
  const seasonCandidates: string[] = [];

  const pushBaseCandidate = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const looksAbsolute = trimmed.startsWith('/') || trimmed.startsWith('\\') || trimmed.includes('/');
    if (!looksAbsolute) {
      seasonCandidates.push(trimmed);
      return;
    }
    baseCandidates.push(trimmed);
  };

  const pushSeasonCandidate = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (trimmed) {
      seasonCandidates.push(trimmed);
    }
  };

  if (record && typeof record === 'object') {
    pushBaseCandidate((record as Record<string, unknown>).targetDirectory);
    pushBaseCandidate((record as Record<string, unknown>).baseDir);
  }

  if (group?.main && typeof group.main === 'object') {
    pushBaseCandidate(group.main.targetDirectory);
    pushBaseCandidate(group.main.baseDir);
  }

  if (seasonId && group?.main && group.main.seasonDirectory && typeof group.main.seasonDirectory === 'object') {
    const directories = group.main.seasonDirectory as Record<string, unknown>;
    pushSeasonCandidate(directories[seasonId]);
  }

  const normalizedBases = baseCandidates
    .map(value => normalizeDir(value))
    .filter(Boolean);
  let basePath = normalizedBases.find(path => path && path !== '/');
  if (!basePath) {
    basePath = normalizedBases[0] || '';
  }

  const resolveCandidate = (value: unknown) => {
    if (typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const looksAbsolute = trimmed.startsWith('/') || trimmed.startsWith('\\') || trimmed.includes('/');
    if (looksAbsolute) {
      return normalizeDir(trimmed);
    }
    const segment = sanitizeSeasonDirSegment(trimmed);
    if (!segment) {
      return '';
    }
    if (basePath) {
      const prefix = basePath === '/' ? '' : basePath;
      return normalizeDir(`${prefix}/${segment}`);
    }
    return normalizeDir(segment);
  };

  for (const candidate of seasonCandidates) {
    const resolved = resolveCandidate(candidate);
    if (resolved && resolved !== '/') {
      return {
        path: resolved,
        url: buildPanDirectoryUrl(resolved),
        isFallback: false
      };
    }
  }

  for (const candidate of normalizedBases) {
    if (candidate) {
      return {
        path: candidate,
        url: buildPanDirectoryUrl(candidate),
        isFallback: false
      };
    }
  }

  return {
    path: '/',
    url: buildPanDirectoryUrl('/'),
    isFallback: true
  };
}

export interface DerivedSeasonRow {
  row: HistoryGroupSeasonRow;
  timestampLabel: string;
  panInfo: PanInfo;
  statusBadge: HistoryStatusBadge | null;
  completed: boolean;
}

export function deriveSeasonRow(
  group: HistoryGroup,
  row: HistoryGroupSeasonRow
): DerivedSeasonRow {
  const timestampLabel = formatHistoryTimestamp(row.recordTimestamp);
  const panInfo = resolveHistoryPanInfo({ record: row.record as Record<string, unknown>, group, seasonId: row.seasonId });
  const statusBadge = createStatusBadge(row.completion as HistoryCompletion);
  const completed = Boolean(
    row.completion?.state === 'completed' ||
    (row.record && (row.record as Record<string, unknown>).completion &&
      (row.record as Record<string, unknown>).completion?.state === 'completed')
  );
  return {
    row,
    timestampLabel,
    panInfo,
    statusBadge,
    completed
  };
}

export interface DerivedHistoryGroup {
  group: HistoryGroup;
  statusBadge: HistoryStatusBadge | null;
  timestampLabel: string;
  metaParts: string[];
}

export function deriveHistoryGroupMeta(group: HistoryGroup): DerivedHistoryGroup {
  const mainRecord = group.main || ({} as Record<string, unknown>);
  const typeLabel = (mainRecord as Record<string, unknown>).pageType === 'series'
    ? '剧集'
    : ((mainRecord as Record<string, unknown>).pageType === 'movie' ? '电影' : '资源');
  const updatedAt = group.updatedAt ||
    Number((mainRecord as Record<string, unknown>).lastTransferredAt) ||
    Number((mainRecord as Record<string, unknown>).lastCheckedAt);
  const timeLabel = formatHistoryTimestamp(updatedAt);
  const total = Number((mainRecord as Record<string, unknown>).totalTransferred) ||
    Object.keys((mainRecord as Record<string, unknown>).items || {}).length ||
    0;
  const targetDir = typeof (mainRecord as Record<string, unknown>).targetDirectory === 'string'
    ? String((mainRecord as Record<string, unknown>).targetDirectory)
    : '';
  const metaParts: string[] = [typeLabel];
  if (Array.isArray(group.seasonEntries) && group.seasonEntries.length) {
    metaParts.push(`涵盖 ${group.seasonEntries.length} 季`);
  } else if (Array.isArray(group.children) && group.children.length) {
    metaParts.push(`共 ${group.children.length + 1} 条记录`);
  }
  if (total) {
    metaParts.push(`共 ${total} 项`);
  }
  if (timeLabel) {
    metaParts.push(`更新于 ${timeLabel}`);
  }
  if (targetDir) {
    metaParts.push(targetDir);
  }
  return {
    group,
    statusBadge: createStatusBadge((mainRecord as Record<string, unknown>).completion as HistoryCompletion),
    timestampLabel: timeLabel,
    metaParts
  };
}
