import { HISTORY_DISPLAY_LIMIT } from '../constants';
import { buildHistoryGroupSeasonRows } from '../services/history-service';
import {
  normalizeDir,
  sanitizeSeasonDirSegment,
  buildPanDirectoryUrl,
  normalizePageUrl
} from '../services/page-analyzer';
import { disableElementDrag } from '../utils/dom';

function formatHistoryTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
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

function createHistoryStatusBadge(completion, extraClass = '') {
  if (!completion || !completion.label) {
    return null;
  }
  const badge = document.createElement('span');
  badge.className = `chaospace-history-status ${extraClass || ''}`.trim();
  const state = completion.state || 'unknown';
  badge.classList.add(`is-${state}`);
  const emojiMap = {
    completed: '✅',
    ongoing: '📡',
    upcoming: '🕒',
    unknown: 'ℹ️'
  };
  const emoji = emojiMap[state] || emojiMap.unknown;
  badge.textContent = `${emoji} ${completion.label}`;
  return badge;
}

function resolveHistoryPanInfo(options = {}) {
  const { record = null, group = null, seasonId = '' } = options;
  const baseCandidates = [];
  const seasonCandidates = [];

  const pushBaseCandidate = value => {
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

  const pushSeasonCandidate = value => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    seasonCandidates.push(trimmed);
  };

  if (record && typeof record === 'object') {
    pushBaseCandidate(record.targetDirectory);
    pushBaseCandidate(record.baseDir);
  }

  if (group?.main && typeof group.main === 'object') {
    pushBaseCandidate(group.main.targetDirectory);
    pushBaseCandidate(group.main.baseDir);
  }

  if (seasonId && group?.main && group.main.seasonDirectory && typeof group.main.seasonDirectory === 'object') {
    pushSeasonCandidate(group.main.seasonDirectory[seasonId]);
  }

  const normalizedBases = baseCandidates
    .map(value => normalizeDir(value))
    .filter(Boolean);
  let basePath = normalizedBases.find(path => path && path !== '/');
  if (!basePath) {
    basePath = normalizedBases[0] || '';
  }

  const resolveCandidate = (value) => {
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

export function renderHistoryCard({
  state,
  panelDom,
  floatingPanel,
  pruneHistorySelection,
  getHistoryGroupByKey,
  closeHistoryDetail,
  getFilteredHistoryGroups,
  updateHistorySelectionSummary,
  updateHistoryBatchControls,
  updateHistoryExpansion,
  isHistoryGroupCompleted
}) {
  if (!panelDom?.historyList || !panelDom?.historyEmpty || !panelDom?.historySummaryBody) {
    return;
  }

  if (typeof pruneHistorySelection === 'function') {
    pruneHistorySelection();
  }

  if (state.historyDetail?.isOpen) {
    const activeGroup = typeof getHistoryGroupByKey === 'function'
      ? getHistoryGroupByKey(state.historyDetail.groupKey)
      : null;
    if (!activeGroup && typeof closeHistoryDetail === 'function') {
      closeHistoryDetail();
    }
  }

  const allGroups = Array.isArray(state.historyGroups) ? state.historyGroups : [];
  const validGroupKeys = new Set(allGroups.map(group => group.key));
  state.historySeasonExpanded = new Set(
    Array.from(state.historySeasonExpanded || []).filter(key => validGroupKeys.has(key))
  );

  const filteredGroups = typeof getFilteredHistoryGroups === 'function'
    ? getFilteredHistoryGroups()
    : allGroups;
  const limit = state.historyExpanded
    ? filteredGroups.length
    : Math.min(filteredGroups.length, HISTORY_DISPLAY_LIMIT);
  const entries = filteredGroups.slice(0, limit);

  panelDom.historyList.innerHTML = '';
  panelDom.historySummaryBody.innerHTML = '';
  const currentUrl = normalizePageUrl(state.pageUrl || window.location.href);
  const hasEntries = entries.length > 0;

  const refreshToggleCache = () => {
    panelDom.historyToggleButtons = Array.from(
      floatingPanel ? floatingPanel.querySelectorAll('[data-role="history-toggle"]') : []
    );
  };

  if (!hasEntries) {
    const totalGroups = allGroups.length;
    const emptyMessage = totalGroups ? '当前筛选没有记录' : '还没有转存记录';

    panelDom.historyEmpty.textContent = emptyMessage;
    panelDom.historyEmpty.classList.remove('is-hidden');

    panelDom.historySummary?.classList.add('is-empty');

    panelDom.historySummaryBody.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'chaospace-history-summary-item is-placeholder';
    placeholder.dataset.role = 'history-summary-entry';
    placeholder.setAttribute('role', 'button');
    placeholder.tabIndex = 0;

    const topRow = document.createElement('div');
    topRow.className = 'chaospace-history-summary-topline';

    const label = document.createElement('span');
    label.className = 'chaospace-history-summary-label';
    label.textContent = '🔖 转存历史';
    topRow.appendChild(label);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'chaospace-history-toggle';
    toggleBtn.dataset.role = 'history-toggle';
    toggleBtn.setAttribute('aria-expanded', state.historyExpanded ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', state.historyExpanded ? '收起转存历史' : '展开转存历史');
    toggleBtn.textContent = state.historyExpanded ? '收起' : '展开';
    topRow.appendChild(toggleBtn);

    placeholder.appendChild(topRow);

    const emptyText = document.createElement('div');
    emptyText.className = 'chaospace-history-summary-empty';
    emptyText.textContent = emptyMessage;
    placeholder.appendChild(emptyText);

    panelDom.historySummaryBody.appendChild(placeholder);

    refreshToggleCache();
    if (typeof updateHistorySelectionSummary === 'function') {
      updateHistorySelectionSummary(filteredGroups);
    }
    if (typeof updateHistoryBatchControls === 'function') {
      updateHistoryBatchControls(filteredGroups);
    }
    if (typeof updateHistoryExpansion === 'function') {
      updateHistoryExpansion();
    }
    return;
  }

  panelDom.historyEmpty.classList.add('is-hidden');
  panelDom.historyEmpty.textContent = '还没有转存记录';
  panelDom.historySummary?.classList.remove('is-empty');

  entries.forEach(group => {
    const mainRecord = group.main || {};
    const item = document.createElement('div');
    item.className = 'chaospace-history-item';
    item.dataset.groupKey = group.key;
    item.dataset.detailTrigger = 'group';
    if (state.historySelectedKeys?.has(group.key)) {
      item.classList.add('is-selected');
    }
    if (Array.isArray(group.urls) && group.urls.includes(currentUrl)) {
      item.classList.add('is-current');
    }

    const selector = document.createElement('label');
    selector.className = 'chaospace-history-selector';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.role = 'history-select-item';
    checkbox.dataset.groupKey = group.key;
    checkbox.checked = state.historySelectedKeys?.has(group.key) || false;
    checkbox.disabled = state.historyBatchRunning;
    selector.appendChild(checkbox);
    item.appendChild(selector);

    const header = document.createElement('div');
    header.className = 'chaospace-history-item-header';

    const posterElement = document.createElement(group.poster && group.poster.src ? 'button' : 'div');
    posterElement.className = 'chaospace-history-poster';
    if (group.poster && group.poster.src) {
      posterElement.type = 'button';
      posterElement.dataset.action = 'preview-poster';
      posterElement.dataset.src = group.poster.src;
      posterElement.dataset.alt = group.poster.alt || group.title || '';
      const posterImg = document.createElement('img');
      posterImg.src = group.poster.src;
      posterImg.alt = group.poster.alt || group.title || '';
      disableElementDrag(posterImg);
      posterElement.appendChild(posterImg);
    } else {
      posterElement.classList.add('is-placeholder');
    }
    header.appendChild(posterElement);

    const detailLabel = group.title || mainRecord.pageTitle || '转存记录';
    const main = document.createElement('div');
    main.className = 'chaospace-history-main';
    main.dataset.action = 'history-detail';
    main.dataset.groupKey = group.key;
    main.dataset.pageUrl = mainRecord.pageUrl || '';
    main.tabIndex = 0;
    main.setAttribute('role', 'button');
    main.setAttribute('aria-label', `查看 ${detailLabel} 的转存详情`);

    const title = document.createElement('div');
    title.className = 'chaospace-history-title';
    title.textContent = group.title || mainRecord.pageTitle || '未命名资源';
    const statusBadge = createHistoryStatusBadge(mainRecord.completion, 'chaospace-history-status-inline');
    if (statusBadge) {
      title.appendChild(statusBadge);
    }
    main.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'chaospace-history-meta';
    const typeLabel = mainRecord.pageType === 'series'
      ? '剧集'
      : (mainRecord.pageType === 'movie' ? '电影' : '资源');
    const timeLabel = formatHistoryTimestamp(group.updatedAt || mainRecord.lastTransferredAt || mainRecord.lastCheckedAt);
    const total = mainRecord.totalTransferred || Object.keys(mainRecord.items || {}).length || 0;
    const targetDir = mainRecord.targetDirectory || '';
    const metaParts = [typeLabel];
    if (group.seasonEntries && group.seasonEntries.length) {
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
    meta.textContent = metaParts.filter(Boolean).join(' · ');
    main.appendChild(meta);

    header.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'chaospace-history-actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.dataset.action = 'open';
    openBtn.dataset.url = mainRecord.pageUrl || '';
    openBtn.className = 'chaospace-history-action chaospace-history-action-open';
    openBtn.textContent = '进入资源';
    if (!mainRecord.pageUrl) {
      openBtn.disabled = true;
      openBtn.classList.add('is-disabled');
    }
    actions.appendChild(openBtn);

    const panInfo = resolveHistoryPanInfo({ record: mainRecord, group });
    const panBtn = document.createElement('button');
    panBtn.type = 'button';
    panBtn.dataset.action = 'open-pan';
    panBtn.dataset.url = panInfo.url;
    panBtn.dataset.path = panInfo.path;
    panBtn.className = 'chaospace-history-action chaospace-history-action-pan';
    panBtn.textContent = '进入网盘';
    panBtn.title = panInfo.path === '/' ? '打开网盘首页' : `打开网盘目录 ${panInfo.path}`;
    actions.appendChild(panBtn);

    if (mainRecord.pageType === 'series') {
      const checkBtn = document.createElement('button');
      checkBtn.type = 'button';
      checkBtn.dataset.action = 'check';
      checkBtn.dataset.url = mainRecord.pageUrl || '';
      checkBtn.className = 'chaospace-history-action chaospace-history-action-check';
      const completed = typeof isHistoryGroupCompleted === 'function'
        ? isHistoryGroupCompleted(group)
        : false;
      checkBtn.textContent = completed ? '已完结' : '检测新篇';
      if (completed || !mainRecord.pageUrl) {
        checkBtn.disabled = true;
        checkBtn.classList.add('is-disabled');
        checkBtn.dataset.reason = 'completed';
      }
      actions.appendChild(checkBtn);
    }

    header.appendChild(actions);
    item.appendChild(header);

    const seasonRows = buildHistoryGroupSeasonRows(group);
    if (seasonRows.length) {
      const expanded = state.historySeasonExpanded?.has(group.key);
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'chaospace-history-season-toggle';
      toggleBtn.dataset.role = 'history-season-toggle';
      toggleBtn.dataset.groupKey = group.key;
      toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggleBtn.textContent = expanded ? '收起季' : '展开季';
      header.appendChild(toggleBtn);

      const seasonList = document.createElement('div');
      seasonList.className = 'chaospace-history-season-list';
      seasonList.dataset.role = 'history-season-list';
      seasonList.dataset.groupKey = group.key;
      seasonList.hidden = !expanded;
      if (expanded) {
        item.classList.add('is-season-expanded');
      }

      seasonRows.forEach(row => {
        const rowElement = document.createElement('div');
        rowElement.className = 'chaospace-history-season-item';
        rowElement.dataset.key = row.key;
        rowElement.dataset.groupKey = group.key;
        rowElement.dataset.detailTrigger = 'season';
        if (row.url) {
          rowElement.dataset.pageUrl = row.url;
        }
        if (row.label) {
          rowElement.dataset.title = row.label;
        }
        if (row.poster && row.poster.src) {
          rowElement.dataset.posterSrc = row.poster.src;
          rowElement.dataset.posterAlt = row.poster.alt || row.label || '';
        }
        rowElement.tabIndex = 0;
        rowElement.setAttribute('role', 'button');
        rowElement.setAttribute('aria-label', `查看 ${row.label || '季详情'} 的转存详情`);

        const rowPoster = document.createElement(row.poster && row.poster.src ? 'button' : 'div');
        rowPoster.className = 'chaospace-history-season-poster';
        if (row.poster && row.poster.src) {
          rowPoster.type = 'button';
          rowPoster.dataset.action = 'preview-poster';
          rowPoster.dataset.src = row.poster.src;
          rowPoster.dataset.alt = row.poster.alt || row.label || '';
          const img = document.createElement('img');
          img.src = row.poster.src;
          img.alt = row.poster.alt || row.label || '';
          disableElementDrag(img);
          rowPoster.appendChild(img);
        } else {
          rowPoster.classList.add('is-placeholder');
        }
        rowElement.appendChild(rowPoster);

        const rowBody = document.createElement('div');
        rowBody.className = 'chaospace-history-season-body';

        const rowTitle = document.createElement('div');
        rowTitle.className = 'chaospace-history-season-title';
        rowTitle.textContent = row.label || '未知季';
        const seasonBadge = createHistoryStatusBadge(row.completion, 'chaospace-history-status-inline');
        if (seasonBadge) {
          rowTitle.appendChild(seasonBadge);
        }
        rowBody.appendChild(rowTitle);

        const rowMeta = document.createElement('div');
        rowMeta.className = 'chaospace-history-season-meta';
        const metaParts = [];
        if (row.recordTimestamp) {
          const ts = formatHistoryTimestamp(row.recordTimestamp);
          if (ts) {
            metaParts.push(`更新于 ${ts}`);
          }
        }
        rowMeta.textContent = metaParts.join(' · ');
        rowBody.appendChild(rowMeta);

        rowElement.appendChild(rowBody);

        const rowActions = document.createElement('div');
        rowActions.className = 'chaospace-history-actions';

        const rowOpen = document.createElement('button');
        rowOpen.type = 'button';
        rowOpen.className = 'chaospace-history-action chaospace-history-action-open';
        rowOpen.dataset.action = 'open';
        rowOpen.dataset.url = row.url || '';
        rowOpen.textContent = '进入资源';
        if (!row.url) {
          rowOpen.disabled = true;
          rowOpen.classList.add('is-disabled');
        }
        rowActions.appendChild(rowOpen);

        const rowPanInfo = resolveHistoryPanInfo({ record: row.record, group, seasonId: row.seasonId });
        const rowPanBtn = document.createElement('button');
        rowPanBtn.type = 'button';
        rowPanBtn.className = 'chaospace-history-action chaospace-history-action-pan';
        rowPanBtn.dataset.action = 'open-pan';
        rowPanBtn.dataset.url = rowPanInfo.url;
        rowPanBtn.dataset.path = rowPanInfo.path;
        rowPanBtn.textContent = '进入网盘';
        rowPanBtn.title = rowPanInfo.path === '/' ? '打开网盘首页' : `打开网盘目录 ${rowPanInfo.path}`;
        rowActions.appendChild(rowPanBtn);

        const rowCheck = document.createElement('button');
        rowCheck.type = 'button';
        rowCheck.className = 'chaospace-history-action chaospace-history-action-check';
        rowCheck.dataset.action = 'check';
        rowCheck.dataset.url = row.url || '';
        const seasonCompleted = (row.completion && row.completion.state === 'completed') ||
          (row.record && row.record.completion && row.record.completion.state === 'completed');
        if (!row.canCheck || !row.url) {
          rowCheck.disabled = true;
          rowCheck.classList.add('is-disabled');
          rowCheck.textContent = row.url ? '无法检测' : '无链接';
        } else if (seasonCompleted) {
          rowCheck.disabled = true;
          rowCheck.classList.add('is-disabled');
          rowCheck.dataset.reason = 'completed';
          rowCheck.textContent = '已完结';
        } else {
          rowCheck.textContent = '检测新篇';
        }
        rowActions.appendChild(rowCheck);

        rowElement.appendChild(rowActions);
        seasonList.appendChild(rowElement);
      });

      item.appendChild(seasonList);
    }
    panelDom.historyList.appendChild(item);
  });

  if (panelDom.historyTabs) {
    panelDom.historyTabs.querySelectorAll('[data-filter]').forEach(button => {
      const value = button.dataset.filter || 'all';
      button.classList.toggle('is-active', value === state.historyFilter);
    });
  }

  const summaryGroup = entries.find(group => !(Array.isArray(group.urls) && group.urls.includes(currentUrl)));
  if (summaryGroup) {
    const summary = document.createElement('div');
    summary.className = 'chaospace-history-summary-item';
    summary.dataset.role = 'history-summary-entry';
    summary.setAttribute('role', 'button');
    summary.tabIndex = 0;

    const topRow = document.createElement('div');
    topRow.className = 'chaospace-history-summary-topline';

    const label = document.createElement('span');
    label.className = 'chaospace-history-summary-label';
    label.textContent = '🔖 转存历史';
    topRow.appendChild(label);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'chaospace-history-toggle';
    toggleBtn.dataset.role = 'history-toggle';
    toggleBtn.setAttribute('aria-expanded', state.historyExpanded ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', state.historyExpanded ? '收起转存历史' : '展开转存历史');
    toggleBtn.textContent = state.historyExpanded ? '收起' : '展开';
    topRow.appendChild(toggleBtn);

    summary.appendChild(topRow);

    const title = document.createElement('div');
    title.className = 'chaospace-history-summary-title';
    title.textContent = summaryGroup.title || summaryGroup.main?.pageTitle || '未命名资源';
    summary.appendChild(title);

    const metaParts = [];
    const summaryCompletion = summaryGroup.main?.completion;
    if (summaryCompletion && summaryCompletion.label) {
      metaParts.push(summaryCompletion.label);
    }
    const summaryTime = formatHistoryTimestamp(
      summaryGroup.updatedAt ||
      summaryGroup.main?.lastTransferredAt ||
      summaryGroup.main?.lastCheckedAt
    );
    if (summaryTime) {
      metaParts.push(summaryTime);
    }
    if (summaryGroup.seasonEntries && summaryGroup.seasonEntries.length) {
      metaParts.push(`涵盖 ${summaryGroup.seasonEntries.length} 季`);
    }
    if (summaryGroup.main && summaryGroup.main.targetDirectory) {
      metaParts.push(summaryGroup.main.targetDirectory);
    }

    if (metaParts.length) {
      const meta = document.createElement('div');
      meta.className = 'chaospace-history-summary-meta';
      metaParts.forEach(part => {
        const span = document.createElement('span');
        span.textContent = part;
        meta.appendChild(span);
      });
      summary.appendChild(meta);
    }

    panelDom.historySummaryBody.appendChild(summary);
  } else {
    panelDom.historySummary?.classList.add('is-empty');
    const placeholder = document.createElement('div');
    placeholder.className = 'chaospace-history-summary-item is-placeholder';
    placeholder.dataset.role = 'history-summary-entry';
    placeholder.setAttribute('role', 'button');
    placeholder.tabIndex = 0;

    const topRow = document.createElement('div');
    topRow.className = 'chaospace-history-summary-topline';

    const label = document.createElement('span');
    label.className = 'chaospace-history-summary-label';
    label.textContent = '🔖 转存历史';
    topRow.appendChild(label);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'chaospace-history-toggle';
    toggleBtn.dataset.role = 'history-toggle';
    toggleBtn.setAttribute('aria-expanded', state.historyExpanded ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', state.historyExpanded ? '收起转存历史' : '展开转存历史');
    toggleBtn.textContent = state.historyExpanded ? '收起' : '展开';
    topRow.appendChild(toggleBtn);

    placeholder.appendChild(topRow);

    const emptyText = document.createElement('div');
    emptyText.className = 'chaospace-history-summary-empty';
    emptyText.textContent = '暂无其他转存记录';
    placeholder.appendChild(emptyText);

    panelDom.historySummaryBody.appendChild(placeholder);
  }

  refreshToggleCache();
  if (Array.isArray(panelDom.historyToggleButtons)) {
    panelDom.historyToggleButtons.forEach(btn => {
      btn.disabled = false;
    });
  }

  if (typeof updateHistorySelectionSummary === 'function') {
    updateHistorySelectionSummary(filteredGroups);
  }
  if (typeof updateHistoryBatchControls === 'function') {
    updateHistoryBatchControls(filteredGroups);
  }
  if (typeof updateHistoryExpansion === 'function') {
    updateHistoryExpansion();
  }
}

