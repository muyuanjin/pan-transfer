// @ts-nocheck
import { createApp, type App } from 'vue';
import HistoryListView from './history/HistoryListView.vue';
import HistorySummaryView from './history/HistorySummaryView.vue';
import { formatHistoryTimestamp } from './history/history-card.helpers';
import type { HistoryGroup, ContentState } from '../types';
import { normalizePageUrl } from '../services/page-analyzer';
import { HISTORY_DISPLAY_LIMIT } from '../constants';

export interface HistoryCardPanelDom {
  historyList?: HTMLElement | null;
  historyEmpty?: HTMLElement | null;
  historySummaryBody?: HTMLElement | null;
  historySummary?: HTMLElement | null;
  historyOverlay?: HTMLElement | null;
  historyToggleButtons?: Array<HTMLButtonElement> | null;
  [key: string]: unknown;
}

export interface HistoryCardRenderParams {
  state: ContentState & {
    historyGroups: HistoryGroup[];
    historyDetail: ContentState['historyDetail'];
  };
  panelDom: HistoryCardPanelDom;
  floatingPanel: HTMLElement | null | undefined;
  pruneHistorySelection: (() => void) | undefined;
  getHistoryGroupByKey: ((key: string) => HistoryGroup | null | undefined) | undefined;
  closeHistoryDetail: (() => void) | undefined;
  getFilteredHistoryGroups: (() => HistoryGroup[]) | undefined;
  updateHistorySelectionSummary: ((groups: HistoryGroup[]) => void) | undefined;
  updateHistoryBatchControls: ((groups: HistoryGroup[]) => void) | undefined;
  updateHistoryExpansion: (() => void) | undefined;
  isHistoryGroupCompleted: ((group: HistoryGroup) => boolean) | undefined;
}

let historyListApp: App<Element> | null = null;
let historySummaryApp: App<Element> | null = null;

export function renderHistoryCard(params: HistoryCardRenderParams): void {
  const {
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
  } = params;

  const historyList = panelDom?.historyList as HTMLElement | undefined;
  const historyEmpty = panelDom?.historyEmpty as HTMLElement | undefined;
  const historySummaryBody = panelDom?.historySummaryBody as HTMLElement | undefined;
  const historySummary = panelDom?.historySummary as HTMLElement | undefined;

  if (!historyList || !historyEmpty || !historySummaryBody) {
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
  const validKeys = new Set(allGroups.map(group => group.key));
  state.historySeasonExpanded = new Set(
    Array.from(state.historySeasonExpanded || []).filter(key => validKeys.has(key))
  );

  const filteredGroups = typeof getFilteredHistoryGroups === 'function'
    ? getFilteredHistoryGroups()
    : allGroups;

  const limit = state.historyExpanded
    ? filteredGroups.length
    : Math.min(filteredGroups.length, HISTORY_DISPLAY_LIMIT);
  const entries = filteredGroups.slice(0, limit);

  const currentUrl = normalizePageUrl(state.pageUrl || window.location.href);
  const hasEntries = entries.length > 0;

  const totalGroups = allGroups.length;
  const emptyMessage = totalGroups ? '当前筛选没有记录' : '还没有转存记录';

  if (!hasEntries) {
    historyEmpty.textContent = emptyMessage;
    historyEmpty.classList.remove('is-hidden');
  } else {
    historyEmpty.textContent = '还没有转存记录';
    historyEmpty.classList.add('is-hidden');
  }

  if (historyListApp) {
    historyListApp.unmount();
    historyListApp = null;
  }
  historyList.innerHTML = '';

  if (hasEntries) {
    const selectedKeys = Array.from(state.historySelectedKeys || []);
    const seasonExpandedKeys = Array.from(state.historySeasonExpanded || []);
    historyListApp = createApp(HistoryListView, {
      entries,
      currentUrl,
      selectedKeys,
      seasonExpandedKeys,
      historyBatchRunning: Boolean(state.historyBatchRunning),
      isHistoryGroupCompleted: typeof isHistoryGroupCompleted === 'function'
        ? isHistoryGroupCompleted
        : undefined
    });
    historyListApp.mount(historyList);
  }

  const summaryEntry = entries.find(group => {
    if (!Array.isArray(group.urls) || !group.urls.length) {
      return true;
    }
    return !group.urls.some(url => normalizePageUrl(url) === currentUrl);
  }) || null;

  const summaryData = summaryEntry ? buildSummaryData(summaryEntry) : null;

  if (historySummaryApp) {
    historySummaryApp.unmount();
    historySummaryApp = null;
  }
  historySummaryBody.innerHTML = '';

  historySummaryApp = createApp(HistorySummaryView, {
    summary: summaryData,
    historyExpanded: Boolean(state.historyExpanded),
    emptyMessage: summaryEntry ? undefined : (hasEntries ? '暂无其他转存记录' : emptyMessage)
  });
  historySummaryApp.mount(historySummaryBody);

  if (historySummary) {
    historySummary.classList.toggle('is-empty', !summaryData);
  }

  refreshToggleCache(panelDom, floatingPanel);
  if (Array.isArray(panelDom.historyToggleButtons)) {
    panelDom.historyToggleButtons.forEach((button: HTMLButtonElement) => {
      button.disabled = false;
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

function refreshToggleCache(panelDom: HistoryCardPanelDom, floatingPanel: HTMLElement | null | undefined): void {
  const scope = floatingPanel || panelDom?.historyOverlay || null;
  if (!scope) {
    panelDom.historyToggleButtons = Array.from(document.querySelectorAll('[data-role="history-toggle"]')) as HTMLButtonElement[];
    return;
  }
  panelDom.historyToggleButtons = Array.from(scope.querySelectorAll('[data-role="history-toggle"]')) as HTMLButtonElement[];
}

function buildSummaryData(group: HistoryGroup): { title: string; metaParts: string[] } {
  const mainRecord = group.main || {};
  const title = group.title || mainRecord.pageTitle || '未命名资源';
  const metaParts: string[] = [];
  const completion = mainRecord.completion;
  if (completion && completion.label) {
    metaParts.push(completion.label);
  }
  const summaryTime = formatHistoryTimestamp(
    group.updatedAt ||
    Number(mainRecord.lastTransferredAt) ||
    Number(mainRecord.lastCheckedAt)
  );
  if (summaryTime) {
    metaParts.push(summaryTime);
  }
  if (Array.isArray(group.seasonEntries) && group.seasonEntries.length) {
    metaParts.push(`涵盖 ${group.seasonEntries.length} 季`);
  }
  if (mainRecord.targetDirectory) {
    metaParts.push(String(mainRecord.targetDirectory));
  }
  return {
    title,
    metaParts
  };
}
