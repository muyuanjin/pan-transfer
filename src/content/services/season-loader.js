import { state } from '../state/index.js';
import {
  sanitizeSeasonDirSegment
} from './page-analyzer.js';
import {
  rebuildSeasonDirMap,
  ensureSeasonSubdirDefault,
  updateSeasonExampleDir
} from './season-manager.js';
import { summarizeSeasonCompletion } from '@/shared/utils/completion-status';

export function createSeasonLoader({
  getFloatingPanel,
  fetchHtmlDocument,
  extractItemsFromDocument,
  extractSeasonPageCompletion,
  extractPosterDetails,
  renderResourceList,
  renderPathPreview,
  updatePanelHeader,
  updateTransferButton
}) {
  let loaderRunning = false;

  async function hydrateDeferredSeason(info) {
    if (!info || !info.url) {
      return;
    }

    let seasonItems = [];
    let completion = info.completion || null;
    let poster = info.poster || null;
    try {
      const doc = await fetchHtmlDocument(info.url);
      seasonItems = extractItemsFromDocument(doc, { baseUrl: info.url });
      const derivedCompletion =
        extractSeasonPageCompletion(doc, 'season-detail') ||
        info.completion ||
        null;
      if (derivedCompletion) {
        completion = derivedCompletion;
      }
      const docPoster = extractPosterDetails(doc, {
        baseUrl: info.url,
        fallbackAlt: info.label
      });
      if (docPoster) {
        poster = docPoster;
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to load deferred season page', info.url, error);
    }

    const floatingPanel = getFloatingPanel();
    if (!floatingPanel) {
      return;
    }

    const seasonCompletion = completion || info.completion || null;
    if (seasonCompletion) {
      state.seasonCompletion[info.seasonId] = seasonCompletion;
    }

    const normalizedLabel =
      sanitizeSeasonDirSegment(info.label) ||
      (typeof info.label === 'string' && info.label.trim()) ||
      (Number.isFinite(info.index) ? `第${info.index + 1}季` : '');
    const entryIndex = state.seasonEntries.findIndex(entry => entry.seasonId === info.seasonId);
    const normalizedEntry = {
      seasonId: info.seasonId,
      label: normalizedLabel,
      url: info.url,
      seasonIndex: Number.isFinite(info.index)
        ? info.index
        : (entryIndex >= 0 ? state.seasonEntries[entryIndex].seasonIndex : 0),
      completion: seasonCompletion || (entryIndex >= 0 ? state.seasonEntries[entryIndex].completion : null),
      poster: poster || (entryIndex >= 0 ? state.seasonEntries[entryIndex].poster : null),
      loaded: true,
      hasItems: Array.isArray(seasonItems) && seasonItems.length > 0
    };
    if (entryIndex >= 0) {
      state.seasonEntries[entryIndex] = { ...state.seasonEntries[entryIndex], ...normalizedEntry };
    } else {
      state.seasonEntries.push(normalizedEntry);
    }
    state.seasonEntries.sort((a, b) => {
      if (a.seasonIndex === b.seasonIndex) {
        return a.seasonId.localeCompare(b.seasonId, 'zh-CN');
      }
      return a.seasonIndex - b.seasonIndex;
    });

    if (Array.isArray(seasonItems) && seasonItems.length) {
      const normalizedItems = seasonItems.map((item, itemIndex) => ({
        ...item,
        order: info.index * 10000 + (typeof item.order === 'number' ? item.order : itemIndex),
        seasonLabel: normalizedLabel,
        seasonIndex: info.index,
        seasonId: info.seasonId,
        seasonUrl: info.url,
        seasonCompletion: seasonCompletion
      }));
      const newItems = normalizedItems.filter(item => !state.itemIdSet.has(item.id));
      if (newItems.length) {
        newItems.forEach(item => {
          state.itemIdSet.add(item.id);
          state.items.push(item);
          state.selectedIds.add(item.id);
          if (state.currentHistory && !state.transferredIds.has(item.id)) {
            state.newItemIds.add(item.id);
          }
        });
      }
    }

    rebuildSeasonDirMap();
    ensureSeasonSubdirDefault();
    updateSeasonExampleDir();

    const completionEntries = Object.values(state.seasonCompletion || {}).filter(Boolean);
    if (completionEntries.length) {
      state.completion = summarizeSeasonCompletion(completionEntries);
    }

    state.seasonLoadProgress.loaded = Math.min(
      state.seasonLoadProgress.loaded + 1,
      state.seasonLoadProgress.total || state.seasonLoadProgress.loaded + 1
    );

    renderResourceList();
    renderPathPreview();
  }

  async function ensureDeferredSeasonLoading() {
    if (loaderRunning) {
      return;
    }
    if (!state.deferredSeasonInfos || !state.deferredSeasonInfos.length) {
      state.isSeasonLoading = false;
      return;
    }
    loaderRunning = true;
    state.isSeasonLoading = true;
    renderResourceList();
    try {
      while (state.deferredSeasonInfos.length && getFloatingPanel()) {
        const info = state.deferredSeasonInfos.shift();
        if (!info) {
          continue;
        }
        await hydrateDeferredSeason(info);
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Deferred season loader error:', error);
    } finally {
      loaderRunning = false;
      if (!state.deferredSeasonInfos.length) {
        state.isSeasonLoading = false;
      }
      renderResourceList();
      updatePanelHeader();
      updateTransferButton();
    }
  }

  function resetSeasonLoader() {
    loaderRunning = false;
  }

  return {
    ensureDeferredSeasonLoading,
    resetSeasonLoader
  };
}
