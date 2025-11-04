import { renderHistoryCard as renderHistoryCardImpl } from './history-card-impl.js';
import type { HistoryGroup, ContentState } from '../types';

export type HistoryCardPanelDom = Record<string, any>;

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

export function renderHistoryCard(params: HistoryCardRenderParams): void {
  renderHistoryCardImpl(params);
}
