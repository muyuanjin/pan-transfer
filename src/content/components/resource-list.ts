import { createResourceListRenderer as createResourceListRendererImpl } from './resource-list-impl.js';
import type { ContentState, ResourceItem } from '../types';

export interface ResourceListPanelDom {
  [key: string]: HTMLElement | null | undefined;
  resourceSummary?: HTMLElement | null;
  resourceTitle?: HTMLElement | null;
  itemsContainer?: HTMLElement | null;
}

export interface ResourceListRendererParams {
  state: ContentState & {
    items: Array<ResourceItem & { id: string | number } & Record<string, unknown>>;
  };
  panelDom: ResourceListPanelDom;
  renderSeasonTabs: () => { tabItems: unknown[]; activeId: string | null; activeTab?: unknown };
  filterItemsForActiveSeason: (items: ResourceItem[], activeId: string | null) => ResourceItem[];
  computeSeasonTabState: (options?: { syncState?: boolean }) => { tabItems: unknown[]; activeId: string | null; activeTab?: unknown };
  renderSeasonControls: () => void;
  updateTransferButton: () => void;
  updatePanelHeader: () => void;
}

export interface ResourceSummaryContext {
  tabState?: ReturnType<ResourceListRendererParams['computeSeasonTabState']>;
  visibleCount?: number;
  visibleSelected?: number;
}

export interface ResourceListRenderer {
  renderResourceList: () => void;
  renderResourceSummary: (context?: ResourceSummaryContext) => void;
}

export function createResourceListRenderer(
  params: ResourceListRendererParams
): ResourceListRenderer {
  return createResourceListRendererImpl(params) as ResourceListRenderer;
}
