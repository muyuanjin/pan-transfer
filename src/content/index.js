import {
  STORAGE_KEY,
  POSITION_KEY,
  SIZE_KEY,
  DEFAULT_PRESETS,
  MAX_LOG_ENTRIES,
  HISTORY_KEY,
  CACHE_KEY,
  HISTORY_BATCH_RATE_LIMIT_MS,
  TV_SHOW_INITIAL_SEASON_BATCH,
  EDGE_HIDE_DELAY,
  EDGE_HIDE_MIN_PEEK,
  EDGE_HIDE_MAX_PEEK,
  EDGE_HIDE_DEFAULT_PEEK,
  INITIAL_PANEL_DELAY_MS,
  PANEL_CREATION_RETRY_DELAY_MS,
  PANEL_CREATION_MAX_ATTEMPTS,
  PAN_DISK_BASE_URL
} from './constants.js';
import { state, panelDom, detailDom } from './state/index.js';
import {
  analyzePage,
  getPageClassification,
  suggestDirectoryFromClassification,
  normalizeDir,
  sanitizeSeasonDirSegment,
  buildPanDirectoryUrl,
  normalizePageUrl,
  isSupportedDetailPage,
  fetchSeasonDetail,
  isSeasonUrl
} from './services/page-analyzer.js';
import {
  computeItemTargetPath,
  dedupeSeasonDirMap,
  updateSeasonExampleDir,
  computeSeasonTabState,
  filterItemsForActiveSeason,
  rebuildSeasonDirMap,
  ensureSeasonSubdirDefault,
  renderSeasonHint,
  renderSeasonControls,
  renderSeasonTabs,
  getTargetPath
} from './services/season-manager.js';
import {
  prepareHistoryRecords,
  normalizeSeasonDirectory,
  deleteHistoryRecords,
  clearAllHistoryRecords,
  requestHistoryUpdate,
  fetchHistorySnapshot,
  isHistoryGroupCompleted,
  canCheckHistoryGroup,
  filterHistoryGroups,
  normalizeHistoryFilter
} from './services/history-service.js';
import {
  ensureHistoryDetailOverlay,
  renderHistoryDetail as renderHistoryDetailComponent,
  buildHistoryDetailFallback,
  normalizeHistoryDetailResponse
} from './components/history-detail.js';
import { renderHistoryCard as renderHistoryCardComponent } from './components/history-card.js';
import { createResourceListRenderer } from './components/resource-list.js';
import { createSettingsModal, clampHistoryRateLimit, sanitizePreset } from './components/settings-modal.js';
import { mountPanelShell } from './components/panel.js';
import { showToast } from './components/toast.js';
import { installZoomPreview } from './components/zoom-preview.js';
import { disableElementDrag } from './utils/dom.js';
import {
  safeStorageGet,
  safeStorageSet,
  safeStorageRemove
} from './utils/storage.js';
import { formatOriginLabel, sanitizeCssUrl } from './utils/format.js';
import { extractCleanTitle } from './utils/title.js';

// chaospace content entry

  let floatingPanel = null;
  let panelShellRef = null;
  let settingsModalRef = null;
  let panelCreationInProgress = false;

  const panelState = {
    edgeState: { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK },
    pointerInside: false,
    lastPointerPosition: { x: Number.NaN, y: Number.NaN },
    isPinned: false,
    hideTimer: null,
    edgeAnimationTimer: null,
    edgeTransitionUnbind: null,
    scheduleEdgeHide: null,
    cancelEdgeHide: null,
    lastKnownSize: null,
    detachWindowResize: null,
    documentPointerDownBound: false,
    applyEdgeHiddenPosition: null,
    hidePanelToEdge: null,
    showPanelFromEdge: null,
    beginEdgeAnimation: null,
    lastKnownPosition: { left: 16, top: 16 },
    getPanelBounds: null
  };

  document.addEventListener('keydown', handleHistoryDetailKeydown, true);

  function handleDocumentPointerDown(event) {
    if (!floatingPanel || panelState.isPinned) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (floatingPanel.contains(target)) {
      return;
    }
    if (target.closest('.zi-overlay')) {
      return;
    }
    if (state.historyDetail?.isOpen) {
      if ((detailDom.modal && detailDom.modal.contains(target)) ||
          (detailDom.backdrop && detailDom.backdrop.contains(target))) {
        return;
      }
    }
    panelState.pointerInside = false;
    floatingPanel.classList.remove('is-hovering');
    floatingPanel.classList.add('is-leaving');
    if (typeof panelState.scheduleEdgeHide === 'function') {
      panelState.scheduleEdgeHide(0);
    }
  }

  function wait(ms) {
    const duration = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    return new Promise(resolve => setTimeout(resolve, duration));
  }

  let deferredSeasonLoaderRunning = false;

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
      seasonIndex: Number.isFinite(info.index) ? info.index : (entryIndex >= 0 ? state.seasonEntries[entryIndex].seasonIndex : 0),
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
    if (deferredSeasonLoaderRunning) {
      return;
    }
    if (!state.deferredSeasonInfos || !state.deferredSeasonInfos.length) {
      state.isSeasonLoading = false;
      return;
    }
    deferredSeasonLoaderRunning = true;
    state.isSeasonLoading = true;
    renderResourceList();
    try {
      while (state.deferredSeasonInfos.length && floatingPanel) {
        const info = state.deferredSeasonInfos.shift();
        if (!info) {
          continue;
        }
        await hydrateDeferredSeason(info);
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Deferred season loader error:', error);
    } finally {
      deferredSeasonLoaderRunning = false;
      if (!state.deferredSeasonInfos.length) {
        state.isSeasonLoading = false;
      }
      renderResourceList();
      updatePanelHeader();
      updateTransferButton();
    }
  }

  async function handleHistoryDeleteSelected() {
    if (!state.historySelectedKeys.size) {
      showToast('info', '未选择记录', '请先勾选要删除的历史记录');
      return;
    }
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : [];
    const targetUrls = new Set();
    state.historySelectedKeys.forEach(key => {
      const group = groups.find(entry => entry.key === key);
      if (group && Array.isArray(group.records)) {
        group.records.forEach(record => {
          if (record && record.pageUrl) {
            targetUrls.add(record.pageUrl);
          }
        });
      }
    });
    if (!targetUrls.size) {
      showToast('info', '无可删除记录', '所选历史没有可删除的条目');
      return;
    }
    try {
      const result = await deleteHistoryRecords(Array.from(targetUrls));
      const removed = typeof result?.removed === 'number' ? result.removed : targetUrls.size;
      showToast('success', '已删除历史', `移除 ${removed} 条记录`);
    } catch (error) {
      showToast('error', '删除失败', error.message || '无法删除选中的历史记录');
      return;
    }
    state.historySelectedKeys = new Set();
    await loadHistory({ silent: true });
    applyHistoryToCurrentPage();
    renderHistoryCard();
    if (floatingPanel) {
      renderResourceList();
    }
  }

  async function handleHistoryClear() {
    if (!state.historyGroups.length) {
      showToast('info', '历史为空', '当前没有需要清理的历史记录');
      return;
    }
    try {
      const result = await clearAllHistoryRecords();
      const cleared = typeof result?.removed === 'number' ? result.removed : state.historyGroups.length;
      showToast('success', '已清空历史', `共清理 ${cleared} 条记录`);
    } catch (error) {
      showToast('error', '清理失败', error.message || '无法清空转存历史');
      return;
    }
    state.historySelectedKeys = new Set();
    await loadHistory({ silent: true });
    applyHistoryToCurrentPage();
    renderHistoryCard();
    if (floatingPanel) {
      renderResourceList();
    }
  }

  async function handleHistoryBatchCheck() {
    if (state.historyBatchRunning) {
      return;
    }
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : [];
    const selectedGroups = groups.filter(group => state.historySelectedKeys.has(group.key));
    const candidates = selectedGroups.filter(canCheckHistoryGroup);
    if (!candidates.length) {
      showToast('info', '无可检测剧集', '仅支持检测未完结的剧集，请先勾选目标');
      return;
    }
    state.historyBatchRunning = true;
    setHistoryBatchProgressLabel('准备中...');
    updateHistoryBatchControls();

    let updated = 0;
    let completed = 0;
    let noUpdate = 0;
    let failed = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const group = candidates[index];
      if (index > 0) {
        await wait(state.historyRateLimitMs);
      }
      const progressLabel = `检测中 ${index + 1}/${candidates.length}`;
      setHistoryBatchProgressLabel(progressLabel);
      try {
        const response = await triggerHistoryUpdate(group.main?.pageUrl, null, { silent: true, deferRender: true });
        if (!response || response.ok === false) {
          failed += 1;
          continue;
        }
        if (response.reason === 'completed' || (response.completion && response.completion.state === 'completed')) {
          completed += 1;
        } else if (response.hasUpdates) {
          updated += 1;
        } else {
          noUpdate += 1;
        }
      } catch (error) {
        console.error('[Chaospace Transfer] Batch update failed', error);
        failed += 1;
      }
    }

    state.historyBatchRunning = false;
    setHistoryBatchProgressLabel('');
    await loadHistory({ silent: true });
    applyHistoryToCurrentPage();
    renderHistoryCard();
    if (floatingPanel) {
      renderResourceList();
    }

    const summaryParts = [];
    if (updated) summaryParts.push(`检测到更新 ${updated} 条`);
    if (completed) summaryParts.push(`已完结 ${completed} 条`);
    if (noUpdate) summaryParts.push(`无更新 ${noUpdate} 条`);
    if (failed) summaryParts.push(`失败 ${failed} 条`);
    const detail = summaryParts.join(' · ') || '已完成批量检测';
    const toastType = failed ? (updated ? 'warning' : 'error') : 'success';
    const title = failed ? (updated ? '部分检测成功' : '检测失败') : '批量检测完成';
    showToast(toastType, title, `${detail}（速率 ${Math.round(state.historyRateLimitMs / 1000)} 秒/条）`);
  }

  // 从页面标题提取剧集名称
  function getPageCleanTitle() {
    const pageTitle = document.title;

    // 移除网站名称后缀（如 " - CHAOSPACE", " – CHAOSPACE"）
    let title = pageTitle.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, '');

    return extractCleanTitle(title);
  }

  function isDateLikeLabel(text) {
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

  function classifyCompletionState(label) {
    // 1. 增强类型安全
    if (label == null) return 'unknown';
    const text = String(label || '').trim();
    if (!text) return 'unknown';

    // 2. 使用更精确的正则表达式
    const completedRegex = /^(完结|收官|全集|已完)$|^全\d+[集话]$|已完结|全集完结/;
    const ongoingRegex = /^(更新|连载|播出中|热播|未完结)$|更新至|连载中|第\d+[集话]/;
    const upcomingRegex = /^(未播|敬请期待|即将|待定|预定|未上映)$|即将上映|预计/;

    // 3. 调整匹配优先级（根据业务逻辑）
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

  function createCompletionStatus(label, source = '') {
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

  function extractCompletionStatusFromElements(elements, source = '') {
    if (!elements || typeof elements.length !== 'number') {
      return null;
    }
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const el = elements[i];
      const text = (el?.textContent || '').trim();
      if (!text || isDateLikeLabel(text)) {
        continue;
      }
      const status = createCompletionStatus(text, source);
      if (status) {
        return status;
      }
    }
    return null;
  }

  function extractSeasonPageCompletion(root = document, source = 'season-meta') {
    if (!root || typeof root.querySelector !== 'function') {
      return null;
    }
    const extra = root.querySelector('.data .extra');
    if (!extra) {
      return null;
    }
    const spans = extra.querySelectorAll('.date');
    return extractCompletionStatusFromElements(spans, source);
  }

  function extractSeasonListCompletion(block) {
    if (!block || typeof block.querySelector !== 'function') {
      return null;
    }
    const titleSpan = block.querySelector('.se-q .title');
    if (!titleSpan) {
      return null;
    }
    const infoTags = titleSpan.querySelectorAll('i');
    const status = extractCompletionStatusFromElements(infoTags, 'season-list');
    if (status) {
      return status;
    }
    const textNodes = [];
    titleSpan.childNodes.forEach(node => {
      if (node && node.nodeType === Node.TEXT_NODE) {
        const value = (node.textContent || '').trim();
        if (value) {
          textNodes.push(value);
        }
      }
    });
    for (let i = textNodes.length - 1; i >= 0; i -= 1) {
      const candidate = textNodes[i];
      if (candidate && !isDateLikeLabel(candidate)) {
        const completion = createCompletionStatus(candidate, 'season-list');
        if (completion) {
          return completion;
        }
      }
    }
    return null;
  }

  function summarizeSeasonCompletion(statuses = []) {
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

  // 只查找百度网盘链接（在 #download 区域）
  function locateBaiduPanRows(root = document) {
    const scope = root && typeof root.querySelector === 'function' ? root : document;
    const downloadSection = scope.querySelector('#download');
    if (!downloadSection) {
      return [];
    }

    const selector = 'table tbody tr[id^="link-"]';
    const rows = Array.from(downloadSection.querySelectorAll(selector));

    return rows;
  }

  function resolveAbsoluteUrl(value, baseUrl = window.location.href) {
    if (!value || typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    try {
      return new URL(trimmed, baseUrl).href;
    } catch (_error) {
      return '';
    }
  }

  function parseSrcset(value, baseUrl) {
    if (!value || typeof value !== 'string') {
      return [];
    }
    return value
      .split(',')
      .map(entry => entry.trim())
      .map(entry => {
        const parts = entry.split(/\s+/);
        const urlPart = parts[0];
        const descriptor = parts[1] || '';
        const widthMatch = descriptor.match(/(\d+(?:\.\d+)?)(w|x)?/i);
        let score = 0;
        if (widthMatch) {
          const size = parseFloat(widthMatch[1]);
          if (Number.isFinite(size)) {
            score = widthMatch[2] && widthMatch[2].toLowerCase() === 'x' ? size * 1000 : size;
          }
        }
        const resolved = resolveAbsoluteUrl(urlPart, baseUrl);
        return {
          url: resolved,
          score
        };
      })
      .filter(item => Boolean(item.url));
  }

  function pickImageSource(img, options = {}) {
    if (!img) {
      return '';
    }

    const baseUrl = options.baseUrl || window.location.href;
    const fromCurrent = resolveAbsoluteUrl(img.currentSrc || img.src || '', baseUrl);
    const srcsetCandidates = [
      ...parseSrcset(img.getAttribute('data-srcset'), baseUrl),
      ...parseSrcset(img.getAttribute('srcset'), baseUrl)
    ];

    if (srcsetCandidates.length > 0) {
      srcsetCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
      const best = srcsetCandidates.find(Boolean);
      if (best?.url) {
        return best.url;
      }
    }

    const attributeCandidates = [
      img.getAttribute('data-original'),
      img.getAttribute('data-src'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-medium-file'),
      img.getAttribute('data-large-file'),
      img.getAttribute('src')
    ];

    for (const candidate of attributeCandidates) {
      const absolute = resolveAbsoluteUrl(candidate || '', baseUrl);
      if (absolute) {
        return absolute;
      }
    }

    return fromCurrent;
  }

  function extractPosterFromImageElement(img, options = {}) {
    if (!img) {
      return null;
    }

    const baseUrl = options.baseUrl || window.location.href;
    const src = pickImageSource(img, { baseUrl });
    if (!src) {
      return null;
    }

    const altRaw = (img.getAttribute('alt') || '').trim();
    const fallbackAlt = typeof options.fallbackAlt === 'string' ? options.fallbackAlt : '';
    const alt = altRaw ? extractCleanTitle(altRaw) : (fallbackAlt || '');
    const anchor = img.closest('a');
    const href = anchor ? resolveAbsoluteUrl(anchor.getAttribute('href') || anchor.href || '', baseUrl) : '';

    const widthAttr = parseInt(img.getAttribute('width') || '', 10);
    const heightAttr = parseInt(img.getAttribute('height') || '', 10);
    const width = Number.isFinite(img.naturalWidth) && img.naturalWidth > 0 ? img.naturalWidth : (Number.isFinite(widthAttr) ? widthAttr : null);
    const height = Number.isFinite(img.naturalHeight) && img.naturalHeight > 0 ? img.naturalHeight : (Number.isFinite(heightAttr) ? heightAttr : null);
    const aspectRatio = width && height ? Number((width / height).toFixed(3)) : null;

    return {
      src,
      alt,
      href,
      aspectRatio
    };
  }

  function extractPosterDetails(root = document, options = {}) {
    const scope = root && typeof root.querySelector === 'function' ? root : document;
    const baseUrl = options.baseUrl || window.location.href;
    const fallbackAlt = typeof options.fallbackAlt === 'string' ? options.fallbackAlt : getPageCleanTitle();
    const selectors = Array.isArray(options.selectors) && options.selectors.length
      ? options.selectors
      : ['.poster img', '.post-thumbnail img', 'article img'];
    let img = null;
    for (const selector of selectors) {
      img = scope.querySelector(selector);
      if (img) {
        break;
      }
    }
    if (!img) {
      return null;
    }
    return extractPosterFromImageElement(img, { baseUrl, fallbackAlt });
  }

  function extractPosterFromSeasonBlock(block, options = {}) {
    if (!block || typeof block.querySelector !== 'function') {
      return null;
    }
    const baseUrl = options.baseUrl || window.location.href;
    const fallbackAlt = typeof options.fallbackAlt === 'string' ? options.fallbackAlt : '';
    const img = block.querySelector('img');
    if (!img) {
      return null;
    }
    return extractPosterFromImageElement(img, { baseUrl, fallbackAlt });
  }

  function extractLinkInfo(row, { baseUrl } = {}) {
    const anchor =
      row.querySelector('a[href*="/links/"]') ||
      row.querySelector('a[data-href*="/links/"]') ||
      row.querySelector('a');

    if (!anchor && !row?.id) {
      return null;
    }

    const baseForLinks = baseUrl || window.location.href;
    const hrefCandidates = [];
    if (anchor) {
      hrefCandidates.push(anchor.getAttribute('href') || '');
      hrefCandidates.push(anchor.href || '');
      if (anchor.dataset) {
        hrefCandidates.push(anchor.dataset.href || '');
        hrefCandidates.push(anchor.dataset.link || '');
        hrefCandidates.push(anchor.dataset.url || '');
      }
    }
    if (row?.dataset) {
      hrefCandidates.push(row.dataset.href || '');
      hrefCandidates.push(row.dataset.link || '');
      hrefCandidates.push(row.dataset.url || '');
    }
    hrefCandidates.push(row?.getAttribute?.('data-href') || '');

    let resolvedHref = '';
    let linkId = '';
    for (const candidate of hrefCandidates) {
      const absolute = resolveAbsoluteUrl(candidate, baseForLinks);
      if (!absolute) {
        continue;
      }
      const idMatch = absolute.match(/\/links\/(\d+)\.html/);
      if (idMatch) {
        resolvedHref = absolute;
        linkId = idMatch[1];
        break;
      }
    }

    if (!linkId && row?.id) {
      const idFromRow = row.id.match(/^link-(\d+)/);
      if (idFromRow) {
        linkId = idFromRow[1];
        try {
          const origin = new URL(baseForLinks, window.location.href).origin;
          resolvedHref = `${origin}/links/${linkId}.html`;
        } catch (_error) {
          resolvedHref = `${window.location.origin}/links/${linkId}.html`;
        }
      }
    }

    if (!linkId) {
      return null;
    }

    const qualityCell = row.querySelector('.quality');
    const cells = Array.from(row.children);

    const rawTitle = (anchor ? anchor.textContent : row.textContent || '').replace(/\s+/g, ' ').trim();
    const cleanTitle = extractCleanTitle(rawTitle);
    const quality = qualityCell ? qualityCell.textContent.trim() : (cells[1] ? cells[1].textContent.trim() : '');
    const subtitle = cells[2] ? cells[2].textContent.trim() : '';

    return {
      id: linkId,
      href: resolvedHref,
      title: cleanTitle,
      rawTitle,
      quality,
      subtitle
    };
  }

  function extractItemsFromDocument(root = document, { baseUrl } = {}) {
    return locateBaiduPanRows(root)
      .map((row, index) => {
        const info = extractLinkInfo(row, { baseUrl });
        if (!info) {
          return null;
        }
        return { ...info, order: index };
      })
      .filter(Boolean);
  }

  function deriveSeasonLabel(seasonElement, index) {
    const badgeText = seasonElement?.querySelector?.('.se-t')?.textContent?.trim();
    if (badgeText) {
      const numeric = badgeText.replace(/[^\d]/g, '');
      if (numeric) {
        return `第${numeric}季`;
      }
      if (/^S\d+$/i.test(badgeText)) {
        return badgeText.toUpperCase();
      }
    }

    const anchor = seasonElement?.querySelector?.('.se-q a');
    const titleSpan = anchor?.querySelector?.('.title');
    let rawText = '';
    if (titleSpan) {
      rawText = Array.from(titleSpan.childNodes || [])
        .filter(node => node && node.nodeType === 3)
        .map(node => node.textContent || '')
        .join('');
    }
    if (!rawText && anchor) {
      rawText = anchor.textContent || '';
    }

    const normalized = rawText.replace(/\s+/g, ' ').trim();
    const zhMatch = normalized.match(/第[\d一二三四五六七八九十百零]+季/);
    if (zhMatch) {
      return zhMatch[0];
    }
    const enMatch = normalized.match(/Season\s*\d+/i);
    if (enMatch) {
      return enMatch[0].replace(/\s+/g, ' ').replace(/season/i, 'Season');
    }
    const shortMatch = normalized.match(/S\d+/i);
    if (shortMatch) {
      return shortMatch[0].toUpperCase();
    }
    if (badgeText) {
      return badgeText;
    }
    if (Number.isFinite(index)) {
      return `第${index + 1}季`;
    }
    return normalized || '未知季';
  }

  async function fetchHtmlDocument(url) {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`请求失败：${response.status}`);
    }
    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  async function collectTvShowSeasonItems(options = {}) {
    const {
      defer = false,
      initialBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
    } = options || {};
    const seasonBlocks = Array.from(document.querySelectorAll('#seasons .se-c'));
    if (!seasonBlocks.length) {
      return {
        items: [],
        seasonCompletion: {},
        completion: null,
        deferredSeasons: [],
        totalSeasons: 0,
        loadedSeasons: 0
      };
    }

    const basePageUrl = window.location.href;
    const seasonInfos = seasonBlocks
      .map((block, index) => {
        const anchor = block.querySelector('.se-q a[href]');
        if (!anchor) {
          return null;
        }
        const href = anchor.getAttribute('href') || anchor.href;
        const url = resolveAbsoluteUrl(href);
        if (!url) {
          return null;
        }
        const label = deriveSeasonLabel(block, index);
        const seasonIdMatch = url.match(/\/seasons\/(\d+)\.html/);
        const seasonId = seasonIdMatch ? seasonIdMatch[1] : `season-${index + 1}`;
        const completion = extractSeasonListCompletion(block);
        const poster = extractPosterFromSeasonBlock(block, {
          baseUrl: basePageUrl,
          fallbackAlt: label
        });
        return { url, label, index, seasonId, completion, poster };
      })
      .filter(Boolean);

    if (!seasonInfos.length) {
      return {
        items: [],
        seasonCompletion: {},
        completion: null,
        deferredSeasons: [],
        totalSeasons: 0,
        loadedSeasons: 0
      };
    }

    const aggregated = [];
    const seen = new Set();
    const seasonCompletionMap = new Map();
    const seasonEntryMap = new Map();

    seasonInfos.forEach(info => {
      if (info.completion) {
        seasonCompletionMap.set(info.seasonId, info.completion);
      }
      seasonEntryMap.set(info.seasonId, {
        seasonId: info.seasonId,
        label: info.label,
        url: info.url,
        seasonIndex: info.index,
        completion: info.completion || null,
        poster: info.poster || null,
        loaded: false,
        hasItems: false
      });
    });

    const effectiveBatchSize = defer
      ? Math.max(
        0,
        Math.min(
          Number.isFinite(initialBatchSize) ? Math.trunc(initialBatchSize) : 2,
          seasonInfos.length
        )
      )
      : seasonInfos.length;
    const immediateInfos = seasonInfos.slice(0, effectiveBatchSize);
    const deferredInfos = defer ? seasonInfos.slice(effectiveBatchSize) : [];

    const immediateIdSet = new Set(immediateInfos.map(info => info.seasonId));
    seasonEntryMap.forEach(entry => {
      entry.loaded = immediateIdSet.has(entry.seasonId) || !defer;
    });

    const seasonResults = immediateInfos.length
      ? await Promise.all(
        immediateInfos.map(async info => {
          try {
            const doc = await fetchHtmlDocument(info.url);
            const seasonItems = extractItemsFromDocument(doc, { baseUrl: info.url });
            const completion =
              extractSeasonPageCompletion(doc, 'season-detail') ||
              info.completion ||
              null;
            const poster = extractPosterDetails(doc, {
              baseUrl: info.url,
              fallbackAlt: info.label
            }) || info.poster || null;
            return { info, seasonItems, completion, poster };
          } catch (error) {
            console.error('[Chaospace Transfer] Failed to load season page', info.url, error);
            return {
              info,
              seasonItems: [],
              completion: info.completion || null,
              poster: info.poster || null
            };
          }
        })
      )
      : [];

    seasonResults.forEach(({ info, seasonItems, completion, poster }) => {
      if (completion) {
        seasonCompletionMap.set(info.seasonId, completion);
      } else if (info.completion) {
        seasonCompletionMap.set(info.seasonId, info.completion);
      }
      const entry = seasonEntryMap.get(info.seasonId);
      if (entry) {
        entry.loaded = true;
        entry.completion = completion || info.completion || entry.completion || null;
        const effectivePoster = poster || info.poster || entry.poster || null;
        if (effectivePoster) {
          entry.poster = effectivePoster;
        }
        if (seasonItems && seasonItems.length) {
          entry.hasItems = true;
        }
        entry.lastHydratedAt = Date.now();
      }
      if (!seasonItems || !seasonItems.length) {
        return;
      }
      seasonItems.forEach((item, itemIndex) => {
        if (seen.has(item.id)) {
          console.warn('[Chaospace Transfer] Duplicate link id detected across seasons', item.id);
          return;
        }
        seen.add(item.id);
        aggregated.push({
          ...item,
          order: info.index * 10000 + (typeof item.order === 'number' ? item.order : itemIndex),
          seasonLabel: info.label,
          seasonIndex: info.index,
          seasonId: info.seasonId,
          seasonUrl: info.url,
          seasonCompletion: completion || info.completion || null
        });
      });
    });

    const seasonCompletion = {};
    seasonCompletionMap.forEach((value, key) => {
      if (value) {
        seasonCompletion[key] = value;
      }
    });
    const completionSummary = summarizeSeasonCompletion(Array.from(seasonCompletionMap.values()));
    const seasonEntries = Array.from(seasonEntryMap.values()).sort((a, b) => a.seasonIndex - b.seasonIndex);

    return {
      items: aggregated,
      seasonCompletion,
      completion: completionSummary,
      deferredSeasons: defer ? deferredInfos : [],
      totalSeasons: seasonInfos.length,
      loadedSeasons: seasonInfos.length - deferredInfos.length,
      seasonEntries
    };
  }

  function updatePanelHeader() {
    const hasPoster = Boolean(state.poster && state.poster.src);
    if (panelDom.showTitle) {
      const title = state.pageTitle || (state.poster && state.poster.alt) || '等待选择剧集';
      panelDom.showTitle.textContent = title;
    }
    if (panelDom.showSubtitle) {
      const label = formatOriginLabel(state.origin);
      const hasItemsArray = Array.isArray(state.items);
      const itemCount = hasItemsArray ? state.items.length : 0;
      const infoParts = [];
      if (label) {
        infoParts.push(`来源 ${label}`);
      }
      if (hasItemsArray) {
        infoParts.push(`解析到 ${itemCount} 项资源`);
      }
      if (state.completion && state.completion.label) {
        const statusLabel = state.completion.label;
        infoParts.push(statusLabel);
      }
      panelDom.showSubtitle.textContent = infoParts.length ? infoParts.join(' · ') : '未检测到页面来源';
    }
    if (panelDom.header) {
      panelDom.header.classList.toggle('has-poster', hasPoster);
    }
    if (panelDom.headerArt) {
      if (hasPoster) {
        const safeUrl = sanitizeCssUrl(state.poster.src);
        panelDom.headerArt.style.backgroundImage = `url("${safeUrl}")`;
        panelDom.headerArt.classList.remove('is-empty');
      } else {
        panelDom.headerArt.style.backgroundImage = '';
        panelDom.headerArt.classList.add('is-empty');
      }
    }
    if (panelDom.headerPoster) {
      disableElementDrag(panelDom.headerPoster);
      if (hasPoster) {
        panelDom.headerPoster.src = state.poster.src;
        panelDom.headerPoster.alt = state.poster.alt || '';
        panelDom.headerPoster.style.display = 'block';
        panelDom.headerPoster.dataset.action = 'preview-poster';
        panelDom.headerPoster.dataset.src = state.poster.src;
        panelDom.headerPoster.dataset.alt = state.poster.alt || state.pageTitle || '';
        panelDom.headerPoster.classList.add('is-clickable');
      } else {
        panelDom.headerPoster.removeAttribute('src');
        panelDom.headerPoster.alt = '';
        panelDom.headerPoster.style.display = 'none';
        delete panelDom.headerPoster.dataset.action;
        delete panelDom.headerPoster.dataset.src;
        delete panelDom.headerPoster.dataset.alt;
        panelDom.headerPoster.classList.remove('is-clickable');
      }
    }
  }

  function isDefaultDirectory(value) {
    const normalized = normalizeDir(value);
    return normalized === '/' || DEFAULT_PRESETS.includes(normalized);
  }

  async function loadSettings() {
    try {
      const stored = await safeStorageGet(STORAGE_KEY, 'settings');
      const settings = stored[STORAGE_KEY] || {};
      if (typeof settings.baseDir === 'string') {
        const normalizedBase = normalizeDir(settings.baseDir);
        state.baseDir = normalizedBase;
        state.baseDirLocked = !isDefaultDirectory(normalizedBase);
      } else {
        state.baseDir = '/';
        state.baseDirLocked = false;
      }
      state.autoSuggestedDir = null;
      state.classification = 'unknown';
      state.classificationDetails = null;
      if (typeof settings.useTitleSubdir === 'boolean') {
        state.useTitleSubdir = settings.useTitleSubdir;
      }
      if (typeof settings.useSeasonSubdir === 'boolean') {
        state.useSeasonSubdir = settings.useSeasonSubdir;
        state.hasSeasonSubdirPreference = true;
      }
      if (Array.isArray(settings.presets)) {
        const merged = [...settings.presets, ...DEFAULT_PRESETS]
          .map(sanitizePreset)
          .filter(Boolean);
        const unique = Array.from(new Set(merged));
        state.presets = unique;
      } else {
        state.presets = [...DEFAULT_PRESETS];
      }
      if (settings.theme === 'light' || settings.theme === 'dark') {
        state.theme = settings.theme;
      }
      const rateLimitMs = Number(settings.historyRateLimitMs);
      if (Number.isFinite(rateLimitMs)) {
        state.historyRateLimitMs = clampHistoryRateLimit(rateLimitMs);
      } else {
        state.historyRateLimitMs = HISTORY_BATCH_RATE_LIMIT_MS;
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to load settings', error);
    }
  }

  async function saveSettings() {
    const settings = {
      baseDir: state.baseDir,
      useTitleSubdir: state.useTitleSubdir,
      presets: state.presets,
      theme: state.theme,
      historyRateLimitMs: clampHistoryRateLimit(state.historyRateLimitMs)
    };
    if (state.hasSeasonSubdirPreference) {
      settings.useSeasonSubdir = state.useSeasonSubdir;
    }
    await safeStorageSet({
      [STORAGE_KEY]: settings
    }, 'settings');
  }

  function ensurePreset(value) {
    const preset = sanitizePreset(value);
    if (!preset) {
      return null;
    }
    if (!state.presets.includes(preset)) {
      state.presets = [...state.presets, preset];
      saveSettings();
    }
    return preset;
  }

  function removePreset(value) {
    const preset = sanitizePreset(value);
    if (!preset || preset === '/' || DEFAULT_PRESETS.includes(preset)) {
      return;
    }
    const before = state.presets.length;
    state.presets = state.presets.filter(item => item !== preset);
    if (state.presets.length === before) {
      return;
    }
    if (state.baseDir === preset) {
      setBaseDir('/', { fromPreset: true });
    } else {
      saveSettings();
      renderPresets();
    }
    showToast('info', '已移除路径', `${preset} 已从收藏中移除`);
  }

  installZoomPreview();

  function applyHistoryToCurrentPage() {
    const normalizedUrl = normalizePageUrl(state.pageUrl || window.location.href);
    state.transferredIds = new Set();
    state.newItemIds = new Set();
    state.currentHistory = null;

    if (!normalizedUrl || !state.historyRecords.length) {
      return;
    }

    const matched = state.historyRecords.find(record => normalizePageUrl(record.pageUrl) === normalizedUrl);
    if (!matched) {
      return;
    }

    state.currentHistory = matched;
    const knownIds = new Set(Object.keys(matched.items || {}));
    if (!state.completion && matched.completion) {
      state.completion = matched.completion;
    }
    if (matched.seasonDirectory && typeof matched.seasonDirectory === 'object') {
      const seasonMap = normalizeSeasonDirectory(matched.seasonDirectory);
      if (Object.keys(seasonMap).length) {
        state.seasonDirMap = { ...state.seasonDirMap, ...seasonMap };
        dedupeSeasonDirMap();
        updateSeasonExampleDir();
      }
    }
    if (!state.hasSeasonSubdirPreference && typeof matched.useSeasonSubdir === 'boolean') {
      state.useSeasonSubdir = matched.useSeasonSubdir;
    }
    state.transferredIds = knownIds;
  state.items.forEach(item => {
    if (item && !knownIds.has(item.id)) {
      state.newItemIds.add(item.id);
    }
  });
}

  function getFilteredHistoryGroups() {
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : [];
    return filterHistoryGroups(groups, state.historyFilter);
  }

  function pruneHistorySelection() {
    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : [];
    const validKeys = new Set(groups.map(group => group.key));
    state.historySelectedKeys = new Set(
      Array.from(state.historySelectedKeys).filter(key => validKeys.has(key))
    );
  }

  function setHistoryExpanded(expanded) {
    const next = Boolean(expanded);
    if (state.historyExpanded === next) {
      return;
    }
    state.historyExpanded = next;
    updateHistoryExpansion();
  }

  function setHistoryFilter(filter) {
    const normalized = normalizeHistoryFilter(filter);
    if (state.historyFilter === normalized) {
      updateHistorySelectionSummary();
      updateHistoryBatchControls();
      return;
    }
    state.historyFilter = normalized;
    if (panelDom.historyTabs) {
      panelDom.historyTabs.querySelectorAll('[data-filter]').forEach(button => {
        button.classList.toggle('is-active', (button.dataset.filter || 'all') === normalized);
      });
    }
    renderHistoryCard();
  }

  function setHistoryBatchProgressLabel(label) {
    state.historyBatchProgressLabel = label || '';
    if (panelDom.historyBatchCheck) {
      if (state.historyBatchRunning) {
        panelDom.historyBatchCheck.textContent = state.historyBatchProgressLabel || '检测中...';
      } else {
        panelDom.historyBatchCheck.textContent = '批量检测更新';
      }
    }
  }

  function updateHistorySelectionSummary(filtered = null) {
    if (!panelDom.historySelectionCount || !panelDom.historySelectAll) {
      return;
    }
    const groups = filtered || getFilteredHistoryGroups();
    const filteredKeys = new Set(groups.map(group => group.key));
    const selectedTotal = state.historySelectedKeys.size;
    let selectedWithinFilter = 0;
    state.historySelectedKeys.forEach(key => {
      if (filteredKeys.has(key)) {
        selectedWithinFilter += 1;
      }
    });
    panelDom.historySelectionCount.textContent = `已选 ${selectedTotal} 项`;
    const hasRecords = groups.length > 0;
    const disabled = state.historyBatchRunning || !hasRecords;
    panelDom.historySelectAll.disabled = disabled;
    if (!hasRecords) {
      panelDom.historySelectAll.checked = false;
      panelDom.historySelectAll.indeterminate = false;
      return;
    }
    if (selectedWithinFilter === groups.length) {
      panelDom.historySelectAll.checked = true;
      panelDom.historySelectAll.indeterminate = false;
    } else if (selectedWithinFilter === 0) {
      panelDom.historySelectAll.checked = false;
      panelDom.historySelectAll.indeterminate = false;
    } else {
      panelDom.historySelectAll.checked = false;
      panelDom.historySelectAll.indeterminate = true;
    }
  }

  function updateHistoryBatchControls(filtered = null) {
    const groups = filtered || getFilteredHistoryGroups();
    const selectedGroups = groups.filter(group => state.historySelectedKeys.has(group.key));
    const selectableSelected = selectedGroups.filter(canCheckHistoryGroup);
    if (panelDom.historyBatchCheck) {
      if (state.historyBatchRunning) {
        panelDom.historyBatchCheck.disabled = true;
        panelDom.historyBatchCheck.textContent = state.historyBatchProgressLabel || '检测中...';
      } else {
        panelDom.historyBatchCheck.disabled = selectableSelected.length === 0;
        panelDom.historyBatchCheck.textContent = '批量检测更新';
      }
    }
    if (panelDom.historyDeleteSelected) {
      panelDom.historyDeleteSelected.disabled = state.historyBatchRunning || state.historySelectedKeys.size === 0;
    }
    if (panelDom.historyClear) {
      panelDom.historyClear.disabled = state.historyBatchRunning || !state.historyGroups.length;
    }
    if (panelDom.historySelectAll) {
      panelDom.historySelectAll.disabled = state.historyBatchRunning || groups.length === 0;
    }
    if (panelDom.historyList) {
      panelDom.historyList
        .querySelectorAll('input[type="checkbox"][data-role="history-select-item"]')
        .forEach(input => {
          input.disabled = state.historyBatchRunning;
        });
    }
  }

  function setHistorySelection(groupKey, selected) {
    if (!groupKey) {
      return;
    }
    const next = new Set(state.historySelectedKeys);
    if (selected) {
      next.add(groupKey);
    } else {
      next.delete(groupKey);
    }
    state.historySelectedKeys = next;
    updateHistorySelectionSummary();
    updateHistoryBatchControls();
  }

  function setHistorySelectAll(selected) {
    const groups = getFilteredHistoryGroups();
    const next = new Set(state.historySelectedKeys);
    groups.forEach(group => {
      if (selected) {
        next.add(group.key);
      } else {
        next.delete(group.key);
      }
    });
    state.historySelectedKeys = next;
    renderHistoryCard();
  }

  function renderHistoryCard() {
    renderHistoryCardComponent({
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
    });
  }

  function updateHistoryExpansion() {
    if (!floatingPanel) {
      return;
    }

    if (!state.historyGroups.length && state.historyExpanded) {
      state.historyExpanded = false;
    }

    const expanded = Boolean(state.historyExpanded && state.historyGroups.length);
    floatingPanel.classList.toggle('is-history-expanded', expanded);

    if (panelDom.historyOverlay) {
      panelDom.historyOverlay.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    }

    if (Array.isArray(panelDom.historyToggleButtons)) {
      panelDom.historyToggleButtons.forEach(button => {
        button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        button.textContent = expanded ? '收起' : '展开';
        button.setAttribute('aria-label', expanded ? '收起转存历史' : '展开转存历史');
      });
    }
  }

  function getHistoryGroupByKey(key) {
    if (!key) {
      return null;
    }
    return state.historyGroups.find(group => group && group.key === key) || null;
  }

  function renderHistoryDetail() {
    renderHistoryDetailComponent({
      state,
      detailDom,
      getHistoryGroupByKey,
      onClose: () => closeHistoryDetail()
    });
  }

  function ensureHistoryDetailOverlayMounted() {
    ensureHistoryDetailOverlay(detailDom, { onClose: () => closeHistoryDetail() });
  }

  async function openHistoryDetail(groupKey, overrides = {}) {
    const group = getHistoryGroupByKey(groupKey);
    if (!group) {
      return;
    }
    if (!panelState.isPinned && typeof panelState.cancelEdgeHide === 'function') {
      panelState.cancelEdgeHide({ show: true });
    }
    if (floatingPanel) {
      panelState.pointerInside = true;
      floatingPanel.classList.add('is-hovering');
      floatingPanel.classList.remove('is-leaving');
    }
    ensureHistoryDetailOverlayMounted();
    const fallback = buildHistoryDetailFallback(group, overrides);
    const pageUrl = (typeof overrides.pageUrl === 'string' && overrides.pageUrl.trim())
      ? overrides.pageUrl.trim()
      : fallback.pageUrl;
    state.historyDetail.isOpen = true;
    state.historyDetail.groupKey = groupKey;
    state.historyDetail.pageUrl = pageUrl;
    state.historyDetail.error = '';
    state.historyDetail.fallback = fallback;
    const cacheKey = pageUrl || '';
    const cached = cacheKey ? state.historyDetailCache.get(cacheKey) : null;
    state.historyDetail.data = cached || fallback;
    state.historyDetail.loading = !cached && Boolean(cacheKey);
    renderHistoryDetail();
    if (cached || !cacheKey) {
      if (!cacheKey && !cached) {
        state.historyDetail.loading = false;
        renderHistoryDetail();
      }
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'chaospace:history-detail',
        payload: { pageUrl: cacheKey }
      });
      if (!response || response.ok === false) {
        throw new Error(response?.error || '加载详情失败');
      }
      const normalized = normalizeHistoryDetailResponse(response.detail || {}, fallback);
      state.historyDetailCache.set(cacheKey, normalized);
      state.historyDetail.data = normalized;
      state.historyDetail.loading = false;
      renderHistoryDetail();
    } catch (error) {
      state.historyDetail.loading = false;
      state.historyDetail.error = error.message || '加载详情失败';
      renderHistoryDetail();
    }
  }

  function closeHistoryDetail(options = {}) {
    const { hideDelay = EDGE_HIDE_DELAY } = options;
    if (!state.historyDetail.isOpen) {
      return;
    }
    state.historyDetail.isOpen = false;
    state.historyDetail.loading = false;
    state.historyDetail.error = '';
    state.historyDetail.groupKey = '';
    state.historyDetail.pageUrl = '';
    state.historyDetail.data = null;
    state.historyDetail.fallback = null;
    renderHistoryDetail();
    if (floatingPanel && !panelState.isPinned) {
      const hovering = floatingPanel.matches(':hover');
      panelState.pointerInside = hovering;
      if (!hovering) {
        floatingPanel.classList.remove('is-hovering');
        floatingPanel.classList.add('is-leaving');
        if (typeof panelState.scheduleEdgeHide === 'function') {
          panelState.scheduleEdgeHide(Math.max(0, hideDelay));
        }
      }
    }
  }

  function handleHistoryDetailKeydown(event) {
    if (event.key !== 'Escape') {
      return;
    }
    if (!state.historyDetail.isOpen) {
      return;
    }
    closeHistoryDetail();
    event.stopPropagation();
  }

  async function loadHistory(options = {}) {
    const { silent = false } = options;
    const snapshot = await fetchHistorySnapshot();
    state.historyRecords = snapshot.records;
    state.historyGroups = snapshot.groups;

    if (!silent) {
      applyHistoryToCurrentPage();
      renderHistoryCard();
      if (floatingPanel) {
        renderResourceList();
      }
    }
  }

  async function triggerHistoryUpdate(pageUrl, button, options = {}) {
    if (!pageUrl) {
      return;
    }
    const { silent = false, deferRender = false } = options;
    let previousText = '';
    let shouldRestoreButton = true;
    if (button) {
      previousText = button.textContent;
      button.disabled = true;
      button.textContent = '检测中...';
    }
    try {
      const response = await requestHistoryUpdate(pageUrl);
      if (!response || response.ok === false) {
        const errorMessage = response?.error?.message || response?.error?.toString?.() || '检测失败';
        if (!silent) {
          showToast('error', '检测失败', errorMessage);
        }
        return response;
      }
      if (!response.hasUpdates) {
        const completionLabel = response?.completion?.label || response?.completionLabel || '';
        if (response.reason === 'completed') {
          shouldRestoreButton = false;
          const message = completionLabel ? `${completionLabel} · 无需继续转存 ✅` : '该剧集已完结 · 不再检测更新';
          if (!silent) {
            showToast('success', '剧集已完结', message);
          }
        } else if (!silent) {
          showToast('success', '无需转存', '所有剧集都已同步 ✅');
        }
      } else {
        const transferred = Array.isArray(response.results)
          ? response.results.filter(item => item.status === 'success').length
          : 0;
        const skipped = Array.isArray(response.results)
          ? response.results.filter(item => item.status === 'skipped').length
          : 0;
        const failed = Array.isArray(response.results)
          ? response.results.filter(item => item.status === 'failed').length
          : 0;
        const summary = response.summary || `新增 ${response.newItems} 项`;
        const toastType = failed > 0 ? 'warning' : 'success';
        const stats = {
          success: transferred,
          skipped,
          failed
        };
        if (!silent) {
          showToast(toastType, '检测完成', summary, stats);
        }
      }
      await loadHistory({ silent: deferRender });
      if (!deferRender) {
        applyHistoryToCurrentPage();
        renderHistoryCard();
        if (floatingPanel) {
          renderResourceList();
        }
      }
      return response;
    } catch (error) {
      console.error('[Chaospace Transfer] Update check failed', error);
      if (!silent) {
        showToast('error', '检测失败', error.message || '无法检测更新');
      }
      return { ok: false, error };
    } finally {
      if (button) {
        if (shouldRestoreButton) {
          button.disabled = false;
          button.textContent = previousText || '检测更新';
        } else {
          button.disabled = true;
          button.textContent = '已完结';
        }
      }
    }
  }

  function selectNewItems() {
    if (!state.newItemIds.size) {
      showToast('info', '暂无新增', '没有检测到新的剧集');
      return;
    }
    state.selectedIds = new Set(state.newItemIds);
    renderResourceList();
    showToast('success', '已选中新剧集', `共 ${state.newItemIds.size} 项`);
  }

  function applyPanelTheme() {
    const isLight = state.theme === 'light';
    document.documentElement.classList.toggle('chaospace-light-root', isLight);
    if (floatingPanel) {
      floatingPanel.classList.toggle('theme-light', isLight);
    }
    if (panelDom.themeToggle) {
      const label = isLight ? '切换到深色主题' : '切换到浅色主题';
      panelDom.themeToggle.textContent = isLight ? '🌙' : '🌞';
      panelDom.themeToggle.setAttribute('aria-label', label);
      panelDom.themeToggle.title = label;
    }
  }

  function setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') {
      return;
    }
    if (state.theme === theme) {
      return;
    }
    state.theme = theme;
    applyPanelTheme();
    saveSettings();
  }

  function updatePinButton() {
    if (!panelDom.pinBtn) {
      return;
    }
    const label = panelState.isPinned ? '取消固定面板' : '固定面板';
    panelDom.pinBtn.textContent = '📌';
    panelDom.pinBtn.title = label;
    panelDom.pinBtn.setAttribute('aria-label', label);
    panelDom.pinBtn.setAttribute('aria-pressed', panelState.isPinned ? 'true' : 'false');
    panelDom.pinBtn.classList.toggle('is-active', panelState.isPinned);
    if (floatingPanel) {
      floatingPanel.classList.toggle('is-pinned', panelState.isPinned);
    }
  }

  function formatStageLabel(stage) {
    if (!stage) {
      return '📡 进度';
    }
    const stageKey = String(stage);
    const base = stageKey.split(':')[0] || stageKey;
    const labels = {
      bstToken: '🔐 bdstoken',
      list: '📂 列表',
      verify: '✅ 验证',
      transfer: '🚚 转存',
      item: '🎯 项目',
      bootstrap: '⚙️ 启动',
      prepare: '🧭 准备',
      dispatch: '📤 派发',
      summary: '🧮 汇总',
      complete: '✅ 完成',
      fatal: '💥 故障',
      init: '🚦 初始化',
      error: '⛔ 错误'
    };
    return labels[stageKey] || labels[base] || stageKey;
  }

  function resetLogs() {
    state.logs = [];
    renderLogs();
  }

  function pushLog(message, { level = 'info', detail = '', stage = '' } = {}) {
    const lastEntry = state.logs[state.logs.length - 1];
    if (
      lastEntry &&
      lastEntry.message === message &&
      lastEntry.stage === stage &&
      lastEntry.detail === detail &&
      lastEntry.level === level
    ) {
      return;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      message,
      detail,
      level,
      stage
    };
    state.logs = [...state.logs.slice(-(MAX_LOG_ENTRIES - 1)), entry];
    renderLogs();
  }

  function renderLogs() {
    if (!panelDom.logList) {
      return;
    }
    const list = panelDom.logList;
    list.innerHTML = '';

    if (!state.logs.length) {
      panelDom.logContainer?.classList.add('is-empty');
      return;
    }

    panelDom.logContainer?.classList.remove('is-empty');

    state.logs.forEach(entry => {
      const li = document.createElement('li');
      li.className = `chaospace-log-item chaospace-log-${entry.level}`;
      li.dataset.logId = entry.id;
      li.dataset.stage = entry.stage || '';
      const stageLabel = formatStageLabel(entry.stage);
      li.innerHTML = `
        <span class="chaospace-log-stage">${stageLabel}</span>
        <div class="chaospace-log-content">
          <span class="chaospace-log-message">${entry.message}</span>
          ${entry.detail ? `<span class="chaospace-log-detail">${entry.detail}</span>` : ''}
        </div>
      `;
      list.appendChild(li);
      requestAnimationFrame(() => {
        li.classList.add('is-visible');
      });
    });

    const logWrapper = panelDom.logContainer;
    if (logWrapper) {
      requestAnimationFrame(() => {
        logWrapper.scrollTo({
          top: logWrapper.scrollHeight,
          behavior: 'smooth'
        });
      });
    }
  }

  function setStatus(status, message) {
    state.transferStatus = status;
    if (message) {
      state.statusMessage = message;
    }
    renderStatus();
  }

  function renderStatus() {
    const emojiMap = {
      idle: '🌙',
      running: '⚙️',
      success: '🎉',
      error: '⚠️'
    };
    const emoji = emojiMap[state.transferStatus] || 'ℹ️';
    if (panelDom.statusText) {
      panelDom.statusText.innerHTML = `<span class="chaospace-status-emoji">${emoji}</span>${state.statusMessage}`;
    }

    if (panelDom.resultSummary) {
      if (!state.lastResult) {
        panelDom.resultSummary.innerHTML = '';
        panelDom.resultSummary.classList.add('is-empty');
      } else {
        panelDom.resultSummary.classList.remove('is-empty');
        const title = state.lastResult.title || '';
        const detail = state.lastResult.detail || '';
        panelDom.resultSummary.innerHTML = `
          <span class="chaospace-log-summary-title">${title}</span>
          ${detail ? `<span class="chaospace-log-summary-detail">${detail}</span>` : ''}
        `;
      }
    }
  }

  function renderPathPreview() {
    if (!panelDom.pathPreview) {
      return;
    }
    const targetPath = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle);
    panelDom.pathPreview.innerHTML = `<span class="chaospace-path-label">📂 当前将保存到：</span><span class="chaospace-path-value">${targetPath}</span>`;
    updateSeasonExampleDir();
    renderSeasonHint();
  }

  function renderPresets() {
    if (!panelDom.presetList) {
      return;
    }
    panelDom.presetList.innerHTML = '';
    const presets = Array.from(new Set(['/', ...state.presets]));
    presets.forEach(preset => {
      const group = document.createElement('div');
      group.className = 'chaospace-chip-group';

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = `chaospace-chip-button${preset === state.baseDir ? ' is-active' : ''}`;
      selectBtn.dataset.action = 'select';
      selectBtn.dataset.value = preset;
      selectBtn.textContent = preset;
      group.appendChild(selectBtn);

      const isRemovable = preset !== '/' && !DEFAULT_PRESETS.includes(preset);
      if (isRemovable) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'chaospace-chip-remove';
        removeBtn.dataset.action = 'remove';
        removeBtn.dataset.value = preset;
        removeBtn.setAttribute('aria-label', `移除 ${preset}`);
        removeBtn.textContent = '×';
        group.appendChild(removeBtn);
      }

      panelDom.presetList.appendChild(group);
    });
  }

  function updateTransferButton() {
    if (!panelDom.transferBtn || !panelDom.transferLabel) {
      return;
    }
    const count = state.selectedIds.size;
    const isRunning = state.transferStatus === 'running';
    panelDom.transferBtn.disabled = isRunning || count === 0;
    panelDom.transferBtn.classList.toggle('is-loading', isRunning);
    if (panelDom.transferSpinner) {
      panelDom.transferSpinner.classList.toggle('is-visible', isRunning);
    }
    panelDom.transferLabel.textContent = isRunning ? '正在转存...' : (count > 0 ? `转存选中 ${count} 项` : '请选择资源');
  }

  const { renderResourceList, renderResourceSummary } = createResourceListRenderer({
    state,
    panelDom,
    renderSeasonTabs,
    filterItemsForActiveSeason,
    computeSeasonTabState,
    renderSeasonControls,
    updateTransferButton,
    updatePanelHeader
  });

  function setBaseDir(value, { fromPreset = false, persist = true, lockOverride = null } = {}) {
    const normalized = normalizeDir(value);
    state.baseDir = normalized;
    const shouldLock = typeof lockOverride === 'boolean'
      ? lockOverride
      : !isDefaultDirectory(normalized);
    state.baseDirLocked = shouldLock;

    if (panelDom.baseDirInput) {
      if (panelDom.baseDirInput.value !== normalized) {
        panelDom.baseDirInput.value = normalized;
      }
      if (!shouldLock) {
        delete panelDom.baseDirInput.dataset.dirty;
      }
    }

    if (fromPreset) {
      // 选中 preset 时不立即追加, 但保持已存在
      ensurePreset(normalized);
    }

    if (persist) {
      saveSettings();
    }
    renderPresets();
    renderPathPreview();
  }

  function applyAutoBaseDir(classificationInput, { persist = false } = {}) {
    const detail = classificationInput && typeof classificationInput === 'object'
      ? classificationInput
      : { classification: typeof classificationInput === 'string' ? classificationInput : 'unknown' };
    const type = detail.classification || detail.type || 'unknown';
    state.classification = type || 'unknown';
    state.classificationDetails = detail;

    const suggestion = suggestDirectoryFromClassification(detail);
    state.autoSuggestedDir = suggestion;

    if (!suggestion) {
      return false;
    }
    if (state.baseDirLocked && state.baseDir !== suggestion) {
      return false;
    }
    if (state.baseDir === suggestion) {
      return false;
    }

    setBaseDir(suggestion, { persist, lockOverride: false });
    return true;
  }

  function setSelectionAll(selected) {
    const { tabItems, activeId } = computeSeasonTabState({ syncState: true });
    const hasTabs = Array.isArray(tabItems) && tabItems.length > 0;
    const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items;
    const visibleIds = visibleItems
      .map(item => item && item.id)
      .filter(Boolean);

    if (selected) {
      visibleIds.forEach(id => {
        state.selectedIds.add(id);
      });
    } else if (visibleIds.length) {
      visibleIds.forEach(id => {
        state.selectedIds.delete(id);
      });
    } else if (!hasTabs) {
      state.selectedIds.clear();
    }
    renderResourceList();
  }

  function invertSelection() {
    const { tabItems, activeId } = computeSeasonTabState({ syncState: true });
    const hasTabs = Array.isArray(tabItems) && tabItems.length > 0;
    const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items;
    if (!visibleItems.length) {
      renderResourceList();
      return;
    }
    const next = new Set(state.selectedIds);
    visibleItems.forEach(item => {
      if (!item || !item.id) {
        return;
      }
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
    });
    state.selectedIds = next;
    renderResourceList();
  }

  function setPanelControlsDisabled(disabled) {
    if (panelDom.baseDirInput) panelDom.baseDirInput.disabled = disabled;
    if (panelDom.useTitleCheckbox) panelDom.useTitleCheckbox.disabled = disabled;
    if (panelDom.useSeasonCheckbox) panelDom.useSeasonCheckbox.disabled = disabled;
    if (panelDom.sortKeySelect) panelDom.sortKeySelect.disabled = disabled;
    if (panelDom.sortOrderButton) panelDom.sortOrderButton.disabled = disabled;
    if (panelDom.addPresetButton) panelDom.addPresetButton.disabled = disabled;
    const selectGroup = floatingPanel?.querySelector('.chaospace-select-group');
    if (selectGroup) {
      selectGroup.querySelectorAll('button').forEach(button => {
        button.disabled = disabled;
      });
    }
    if (panelDom.presetList) {
      panelDom.presetList.classList.toggle('is-disabled', disabled);
    }
  }

  function handleProgressEvent(progress) {
    if (!progress || progress.jobId !== state.jobId) {
      return;
    }
    if (progress.message) {
      pushLog(progress.message, {
        level: progress.level || 'info',
        detail: progress.detail || '',
        stage: progress.stage || ''
      });
    }
    if (progress.statusMessage) {
      state.statusMessage = progress.statusMessage;
      renderStatus();
    } else if (typeof progress.current === 'number' && typeof progress.total === 'number') {
      state.statusMessage = `正在处理 ${progress.current}/${progress.total}`;
      renderStatus();
    }
  }

  async function handleTransfer() {
    if (!floatingPanel || state.transferStatus === 'running') {
      return;
    }

    const selectedItems = state.items.filter(item => state.selectedIds.has(item.id));
    if (!selectedItems.length) {
      showToast('warning', '请选择资源', '至少勾选一个百度网盘资源再开始转存哦～');
      return;
    }

    const baseDirValue = panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir;
    setBaseDir(baseDirValue);
    if (panelDom.useTitleCheckbox) {
      state.useTitleSubdir = panelDom.useTitleCheckbox.checked;
      saveSettings();
    }
    if (panelDom.useSeasonCheckbox) {
      state.useSeasonSubdir = panelDom.useSeasonCheckbox.checked;
      state.hasSeasonSubdirPreference = true;
      dedupeSeasonDirMap();
      saveSettings();
    }

    const targetDirectory = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle);

    state.jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    state.lastResult = null;
    state.transferStatus = 'running';
    state.statusMessage = '正在准备转存...';
    resetLogs();
    pushLog('已锁定资源清单，准备开始转存', { stage: 'init' });
    renderStatus();
    renderPathPreview();
    updateTransferButton();
    setPanelControlsDisabled(true);

    try {
      const payload = {
        jobId: state.jobId,
        origin: state.origin || window.location.origin,
        items: selectedItems.map(item => ({
          id: item.id,
          title: item.title,
          targetPath: computeItemTargetPath(item, targetDirectory)
        })),
        targetDirectory,
        meta: {
          total: selectedItems.length,
          baseDir: state.baseDir,
          useTitleSubdir: state.useTitleSubdir,
          useSeasonSubdir: state.useSeasonSubdir,
          pageTitle: state.pageTitle,
          pageUrl: state.pageUrl || normalizePageUrl(window.location.href),
          pageType: state.items.length > 1 ? 'series' : 'movie',
          targetDirectory,
          seasonDirectory: state.useSeasonSubdir ? { ...state.seasonDirMap } : null,
          completion: state.completion || null,
          seasonCompletion: state.seasonCompletion || {},
          seasonEntries: Array.isArray(state.seasonEntries) ? state.seasonEntries : [],
          poster: state.poster && state.poster.src
            ? { src: state.poster.src, alt: state.poster.alt || '' }
            : null
        }
      };

      pushLog(`向后台发送 ${selectedItems.length} 条转存请求`, {
        stage: 'dispatch'
      });

      const response = await chrome.runtime.sendMessage({
        type: 'chaospace:transfer',
        payload
      });

      if (!response) {
        throw new Error('未收到后台响应');
      }
      if (!response.ok) {
        throw new Error(response.error || '后台执行失败');
      }

      const { results, summary } = response;
      const success = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const emoji = failed === 0 ? '🎯' : (success > 0 ? '🟡' : '💥');
      const title = failed === 0 ? '转存成功' : (success > 0 ? '部分成功' : '全部失败');

      state.lastResult = {
        title: `${emoji} ${title}`,
        detail: `成功 ${success} · 跳过 ${skipped} · 失败 ${failed}`
      };

      pushLog(`后台执行完成：${summary}`, { stage: 'complete', level: failed === 0 ? 'success' : 'warning' });

      setStatus(failed === 0 ? 'success' : 'error', `${title}：${summary}`);

      await loadHistory();

      showToast(
        failed === 0 ? 'success' : (success > 0 ? 'warning' : 'error'),
        `${emoji} ${title}`,
        `已保存到 ${targetDirectory}`,
        { success, failed, skipped }
      );
    } catch (error) {
      console.error('[Chaospace Transfer] Transfer error', error);
      pushLog(error.message || '后台执行发生未知错误', { level: 'error', stage: 'error' });
      setStatus('error', `转存失败：${error.message || '未知错误'}`);
      showToast('error', '转存失败', error.message || '发生未知错误');
    } finally {
      if (state.transferStatus === 'running') {
        setStatus('idle', '准备就绪 ✨');
      }
      updateTransferButton();
      setPanelControlsDisabled(false);
      state.jobId = null;
    }
  }

  async function createFloatingPanel() {
    if (floatingPanel || panelCreationInProgress) {
      return Boolean(floatingPanel);
    }
    panelCreationInProgress = true;
    let panelCreated = false;

    try {
      await loadSettings();
      await loadHistory({ silent: true });
      applyPanelTheme();

      state.deferredSeasonInfos = [];
      state.isSeasonLoading = false;
      state.seasonLoadProgress = { total: 0, loaded: 0 };
      state.itemIdSet = new Set();
      state.seasonEntries = [];
      state.historySeasonExpanded = new Set();

      const data = await analyzePage({
        deferTvSeasons: true,
        initialSeasonBatchSize: TV_SHOW_INITIAL_SEASON_BATCH
      });
      const hasItems = Array.isArray(data.items) && data.items.length > 0;
      const deferredSeasons = Array.isArray(data.deferredSeasons)
        ? data.deferredSeasons.map(info => {
          const normalizedLabel =
            sanitizeSeasonDirSegment(info.label || '') ||
            (typeof info.label === 'string' && info.label.trim()) ||
            (Number.isFinite(info.index) ? `第${info.index + 1}季` : '');
          return {
            ...info,
            label: normalizedLabel
          };
        })
        : [];
      if (!hasItems && deferredSeasons.length === 0) {
        return false;
      }

      state.pageTitle = data.title || '';
      state.pageUrl = normalizePageUrl(data.url || window.location.href);
      state.poster = data.poster || null;
      state.origin = data.origin || window.location.origin;
      state.completion = data.completion || null;
      state.seasonCompletion = (data.seasonCompletion && typeof data.seasonCompletion === 'object')
        ? { ...data.seasonCompletion }
        : {};
      state.seasonEntries = Array.isArray(data.seasonEntries)
        ? data.seasonEntries.map(entry => {
          const normalizedLabel =
            sanitizeSeasonDirSegment(entry.label || '') ||
            (typeof entry.label === 'string' && entry.label.trim()) ||
            (Number.isFinite(entry.seasonIndex) ? `第${entry.seasonIndex + 1}季` : '');
          return {
            seasonId: entry.seasonId || entry.id || '',
            label: normalizedLabel,
            url: entry.url || '',
            seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : 0,
            completion: entry.completion || null,
            poster: entry.poster || null,
            loaded: Boolean(entry.loaded),
            hasItems: Boolean(entry.hasItems)
          };
        })
        : [];
      state.classification = data.classification || 'unknown';
      state.classificationDetails = data.classificationDetail || null;
      state.autoSuggestedDir = suggestDirectoryFromClassification(state.classificationDetails || state.classification);
      applyAutoBaseDir(state.classificationDetails || state.classification);
      state.items = (Array.isArray(data.items) ? data.items : []).map((item, index) => {
        const normalizedLabel =
          sanitizeSeasonDirSegment(item.seasonLabel || '') ||
          (typeof item.seasonLabel === 'string' && item.seasonLabel.trim()) ||
          (Number.isFinite(item.seasonIndex) ? `第${item.seasonIndex + 1}季` : '');
        const nextItem = {
          ...item,
          order: typeof item.order === 'number' ? item.order : index
        };
        if (normalizedLabel) {
          nextItem.seasonLabel = normalizedLabel;
        } else if ('seasonLabel' in nextItem) {
          delete nextItem.seasonLabel;
        }
        return nextItem;
      });
      state.itemIdSet = new Set(state.items.map(item => item.id));
      state.selectedIds = new Set(state.items.map(item => item.id));
      rebuildSeasonDirMap({ preserveExisting: false });
      ensureSeasonSubdirDefault();
      updateSeasonExampleDir();
      state.deferredSeasonInfos = deferredSeasons;
      const declaredTotal = Number.isFinite(data.totalSeasons) ? Math.max(0, data.totalSeasons) : 0;
      const declaredLoaded = Number.isFinite(data.loadedSeasons) ? Math.max(0, data.loadedSeasons) : 0;
      let totalSeasons = declaredTotal;
      if (!totalSeasons && (declaredLoaded || deferredSeasons.length)) {
        totalSeasons = declaredLoaded + deferredSeasons.length;
      }
      let loadedSeasons = declaredLoaded;
      if (!loadedSeasons && totalSeasons) {
        loadedSeasons = Math.max(0, totalSeasons - deferredSeasons.length);
      }
      if (loadedSeasons > totalSeasons) {
        loadedSeasons = totalSeasons;
      }
      state.seasonLoadProgress = {
        total: totalSeasons,
        loaded: loadedSeasons
      };
      state.isSeasonLoading = state.deferredSeasonInfos.length > 0;
      state.lastResult = null;
      state.transferStatus = 'idle';
      state.statusMessage = '准备就绪 ✨';
      resetLogs();
      applyHistoryToCurrentPage();
      state.activeSeasonId = null;

      const originLabel = formatOriginLabel(state.origin);

      const panelShell = await mountPanelShell({
        document,
        window,
        panelDom,
        panelState,
        pageTitle: state.pageTitle,
        originLabel,
        theme: state.theme,
        handleDocumentPointerDown,
        constants: {
          EDGE_HIDE_DELAY,
          EDGE_HIDE_DEFAULT_PEEK,
          EDGE_HIDE_MIN_PEEK,
          EDGE_HIDE_MAX_PEEK
        },
        storageKeys: {
          POSITION_KEY,
          SIZE_KEY
        }
      });

      floatingPanel = panelShell.panel;
      panelShellRef = panelShell;

      const {
        applyPanelSize,
        applyPanelPosition,
        getPanelBounds,
        syncPanelLayout,
        scheduleEdgeHide,
        cancelEdgeHide,
        applyEdgeHiddenPosition
      } = panelShell;

      let lastKnownPosition = panelState.lastKnownPosition;

      panelCreated = true;

      ensureHistoryDetailOverlayMounted();
      renderHistoryDetail();

      const handleResetLayout = async () => {
        try {
          await safeStorageRemove([POSITION_KEY, SIZE_KEY], 'panel geometry reset');
          const bounds = getPanelBounds();
          const defaultWidth = Math.min(640, bounds.maxWidth);
          const defaultHeight = Math.min(520, bounds.maxHeight);
          applyPanelSize(defaultWidth, defaultHeight);
          const defaultPosition = applyPanelPosition(undefined, undefined);
          lastKnownPosition = defaultPosition;
          panelState.lastKnownPosition = defaultPosition;
          panelState.edgeState.isHidden = false;
          applyEdgeHiddenPosition();
          cancelEdgeHide({ show: true });
          showToast('success', '布局已重置', '面板大小与位置已恢复默认值');
        } catch (error) {
          console.error('[Chaospace Transfer] Failed to reset layout', error);
          showToast('error', '重置失败', error.message || '无法重置面板布局');
        }
      };

      settingsModalRef = createSettingsModal({
        document,
        floatingPanel,
        panelState,
        scheduleEdgeHide,
        cancelEdgeHide,
        showToast,
        setBaseDir,
        renderSeasonHint,
        renderResourceList,
        applyPanelTheme,
        saveSettings,
        safeStorageSet,
        safeStorageRemove,
        loadSettings,
        loadHistory,
        closeHistoryDetail,
        onResetLayout: handleResetLayout
      });

      panelDom.openSettingsPanel = () => {
        settingsModalRef?.open();
      };
      panelDom.closeSettingsPanel = (options = {}) => {
        settingsModalRef?.close(options);
      };

      updatePinButton();

      if (panelDom.historyTabs) {
        panelDom.historyTabs.querySelectorAll('[data-filter]').forEach(button => {
          const value = button.dataset.filter || 'all';
          button.classList.toggle('is-active', value === state.historyFilter);
        });
      }

      if (panelDom.pinBtn) {
        panelDom.pinBtn.addEventListener('click', (event) => {
          const nextPinnedState = !panelState.isPinned;
          panelState.isPinned = nextPinnedState;
          updatePinButton();
          if (nextPinnedState) {
            cancelEdgeHide({ show: true });
          } else {
            const isPointerLikeActivation = (typeof event?.detail === 'number' && event.detail > 0) ||
              (typeof event?.clientX === 'number' && typeof event?.clientY === 'number' &&
                (event.clientX !== 0 || event.clientY !== 0));
            if (isPointerLikeActivation && typeof panelDom.pinBtn.blur === 'function') {
              panelDom.pinBtn.blur();
            }
            if (!panelState.pointerInside) {
              scheduleEdgeHide();
            }
          }
        });
      }

      if (panelDom.headerPoster) {
        panelDom.headerPoster.addEventListener('click', () => {
          const src = panelDom.headerPoster.dataset.src;
          if (src) {
            window.openZoomPreview({
              src,
              alt: panelDom.headerPoster.dataset.alt || panelDom.headerPoster.alt || state.pageTitle || ''
            });
          }
        });
      }

      updatePanelHeader();

      applyPanelTheme();

      if (panelDom.baseDirInput) {
        panelDom.baseDirInput.value = state.baseDir;
        panelDom.baseDirInput.addEventListener('change', () => {
          setBaseDir(panelDom.baseDirInput.value);
        });
        panelDom.baseDirInput.addEventListener('input', () => {
          panelDom.baseDirInput.dataset.dirty = 'true';
          panelDom.baseDirInput.classList.remove('is-invalid');
          state.baseDir = normalizeDir(panelDom.baseDirInput.value);
          renderPathPreview();
        });
        panelDom.baseDirInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            setBaseDir(panelDom.baseDirInput.value);
            ensurePreset(panelDom.baseDirInput.value);
            renderPresets();
          }
        });
      }

      if (panelDom.useTitleCheckbox) {
        panelDom.useTitleCheckbox.checked = state.useTitleSubdir;
        panelDom.useTitleCheckbox.addEventListener('change', () => {
          state.useTitleSubdir = panelDom.useTitleCheckbox.checked;
          saveSettings();
          renderPathPreview();
        });
      }

      if (panelDom.useSeasonCheckbox) {
        panelDom.useSeasonCheckbox.checked = state.useSeasonSubdir;
        panelDom.useSeasonCheckbox.addEventListener('change', () => {
          state.useSeasonSubdir = panelDom.useSeasonCheckbox.checked;
          state.hasSeasonSubdirPreference = true;
          dedupeSeasonDirMap();
          updateSeasonExampleDir();
          renderPathPreview();
          renderResourceList();
          saveSettings();
        });
      }

      if (panelDom.addPresetButton) {
        panelDom.addPresetButton.addEventListener('click', () => {
          const preset = ensurePreset(panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir);
          if (preset) {
            setBaseDir(preset, { fromPreset: true });
            showToast('success', '已收藏路径', `${preset} 已加入候选列表`);
          }
        });
      }

      if (panelDom.themeToggle) {
        panelDom.themeToggle.addEventListener('click', () => {
          const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
          setTheme(nextTheme);
        });
      }

      if (panelDom.historySummaryBody) {
        const toggleHistoryFromSummary = () => {
          if (!state.historyRecords.length) {
            return;
          }
          state.historyExpanded = !state.historyExpanded;
          renderHistoryCard();
        };

        panelDom.historySummaryBody.addEventListener('click', event => {
          const summaryEntry = event.target.closest('[data-role="history-summary-entry"]');
          if (!summaryEntry) {
            return;
          }
          if (event.target.closest('[data-role="history-toggle"]')) {
            return;
          }
          toggleHistoryFromSummary();
        });

        panelDom.historySummaryBody.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return;
          }
          const summaryEntry = event.target.closest('[data-role="history-summary-entry"]');
          if (!summaryEntry) {
            return;
          }
          if (event.target.closest('[data-role="history-toggle"]')) {
            return;
          }
          event.preventDefault();
          toggleHistoryFromSummary();
        });
      }

      if (panelDom.presetList) {
        panelDom.presetList.addEventListener('click', (event) => {
          if (state.transferStatus === 'running') {
            return;
          }
          const target = event.target.closest('button[data-action][data-value]');
          if (!target) return;
          const { action, value } = target.dataset;
          if (action === 'select') {
            setBaseDir(value, { fromPreset: true });
          } else if (action === 'remove') {
            removePreset(value);
          }
        });
      }

      if (panelDom.itemsContainer) {
        panelDom.itemsContainer.addEventListener('change', event => {
          const checkbox = event.target.closest('.chaospace-item-checkbox');
          if (!checkbox) return;
          const row = checkbox.closest('.chaospace-item');
          const id = row?.dataset.id;
          if (!id) return;
          if (checkbox.checked) {
            state.selectedIds.add(id);
          } else {
            state.selectedIds.delete(id);
          }
          row.classList.toggle('is-muted', !checkbox.checked);
          renderResourceSummary();
          updateTransferButton();
        });
      }

      if (panelDom.seasonTabs) {
        panelDom.seasonTabs.addEventListener('click', event => {
          const button = event.target.closest('button[data-season-id]');
          if (!button || button.disabled) {
            return;
          }
          const nextId = button.dataset.seasonId;
          if (!nextId || nextId === state.activeSeasonId) {
            return;
          }
          state.activeSeasonId = nextId;
          renderResourceList();
          if (panelDom.itemsContainer) {
            panelDom.itemsContainer.scrollTop = 0;
          }
        });
      }

      const toolbar = floatingPanel?.querySelector('.chaospace-select-group');
      if (toolbar) {
        toolbar.addEventListener('click', event => {
          const button = event.target.closest('button[data-action]');
          if (!button) return;
          const action = button.dataset.action;
          if (action === 'select-all') {
            setSelectionAll(true);
          } else if (action === 'select-invert') {
            invertSelection();
          } else if (action === 'select-new') {
            selectNewItems();
          }
        });
      }

      if (panelDom.historyTabs) {
        panelDom.historyTabs.addEventListener('click', event => {
          const tab = event.target.closest('.chaospace-history-tab[data-filter]');
          if (!tab) return;
          if (tab.classList.contains('is-active')) {
            return;
          }
          const filter = tab.dataset.filter || 'all';
          setHistoryFilter(filter);
        });
      }

      if (panelDom.historySelectAll) {
        panelDom.historySelectAll.addEventListener('change', event => {
          if (state.historyBatchRunning) {
            event.preventDefault();
            updateHistorySelectionSummary();
            return;
          }
          setHistorySelectAll(Boolean(event.target.checked));
        });
      }

      if (panelDom.historyBatchCheck) {
        panelDom.historyBatchCheck.addEventListener('click', () => {
          handleHistoryBatchCheck();
        });
      }

      if (panelDom.historyDeleteSelected) {
        panelDom.historyDeleteSelected.addEventListener('click', () => {
          handleHistoryDeleteSelected();
        });
      }

      if (panelDom.historyClear) {
        panelDom.historyClear.addEventListener('click', () => {
          handleHistoryClear();
        });
      }

      if (panelDom.historyList) {
        panelDom.historyList.addEventListener('click', event => {
          const seasonToggle = event.target.closest('[data-role="history-season-toggle"]');
          if (seasonToggle) {
            const groupKey = seasonToggle.dataset.groupKey;
            if (!groupKey) {
              return;
            }
            const expanded = state.historySeasonExpanded.has(groupKey);
            if (expanded) {
              state.historySeasonExpanded.delete(groupKey);
            } else {
              state.historySeasonExpanded.add(groupKey);
            }
            const isExpanded = state.historySeasonExpanded.has(groupKey);
            seasonToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            seasonToggle.textContent = isExpanded ? '收起季' : '展开季';
            const container = seasonToggle.closest('.chaospace-history-item');
            const list = container ? container.querySelector('[data-role="history-season-list"]') : null;
            if (list) {
              list.hidden = !isExpanded;
            }
            if (container) {
              container.classList.toggle('is-season-expanded', isExpanded);
            }
            event.preventDefault();
            return;
          }

          const actionButton = event.target.closest('button[data-action]');
          if (actionButton) {
            const action = actionButton.dataset.action;
            if (action === 'preview-poster') {
              if (!actionButton.disabled) {
                const src = actionButton.dataset.src;
                if (src) {
                  window.openZoomPreview({
                    src,
                    alt: actionButton.dataset.alt || actionButton.getAttribute('aria-label') || ''
                  });
                }
              }
              return;
            }

            if (actionButton.disabled) {
              return;
            }

            const url = actionButton.dataset.url;
            if (action === 'open') {
              if (url) {
                window.open(url, '_blank', 'noopener');
              }
            } else if (action === 'open-pan') {
              const panUrl = actionButton.dataset.url || buildPanDirectoryUrl('/');
              window.open(panUrl, '_blank', 'noopener');
            } else if (action === 'check') {
              if (url) {
                triggerHistoryUpdate(url, actionButton);
              }
            }
            return;
          }

          const seasonRow = event.target.closest('.chaospace-history-season-item[data-detail-trigger="season"]');
          if (seasonRow && !event.target.closest('.chaospace-history-actions') && !event.target.closest('button') && !event.target.closest('input')) {
            const groupKey = seasonRow.dataset.groupKey;
            if (groupKey) {
              const pageUrl = seasonRow.dataset.pageUrl || '';
              const title = seasonRow.dataset.title || '';
              const posterSrc = seasonRow.dataset.posterSrc || '';
              const posterAlt = seasonRow.dataset.posterAlt || title;
              const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null;
              event.preventDefault();
              openHistoryDetail(groupKey, {
                pageUrl,
                title,
                poster
              });
            }
            return;
          }

          const detailTrigger = event.target.closest('[data-action="history-detail"]');
          if (detailTrigger) {
            const groupKey = detailTrigger.dataset.groupKey;
            if (groupKey) {
              event.preventDefault();
              openHistoryDetail(groupKey);
            }
            return;
          }

          const historyItem = event.target.closest('.chaospace-history-item[data-detail-trigger="group"]');
          if (historyItem && !event.target.closest('.chaospace-history-selector') && !event.target.closest('.chaospace-history-actions') && !event.target.closest('button') && !event.target.closest('input') && !event.target.closest('[data-role="history-season-toggle"]')) {
            const groupKey = historyItem.dataset.groupKey;
            if (groupKey) {
              openHistoryDetail(groupKey);
            }
            return;
          }
        });
        panelDom.historyList.addEventListener('change', event => {
          const checkbox = event.target.closest('input[type="checkbox"][data-role="history-select-item"]');
          if (!checkbox) return;
          const groupKey = checkbox.dataset.groupKey;
          if (!groupKey) return;
          setHistorySelection(groupKey, checkbox.checked);
        });
        panelDom.historyList.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return;
          }
          if (event.target.closest('button') || event.target.closest('input')) {
            return;
          }
          const seasonRow = event.target.closest('.chaospace-history-season-item[data-detail-trigger="season"]');
          if (seasonRow && seasonRow === event.target.closest('.chaospace-history-season-item')) {
            const groupKey = seasonRow.dataset.groupKey;
            if (groupKey) {
              const pageUrl = seasonRow.dataset.pageUrl || '';
              const title = seasonRow.dataset.title || '';
              const posterSrc = seasonRow.dataset.posterSrc || '';
              const posterAlt = seasonRow.dataset.posterAlt || title;
              const poster = posterSrc ? { src: posterSrc, alt: posterAlt } : null;
              event.preventDefault();
              openHistoryDetail(groupKey, {
                pageUrl,
                title,
                poster
              });
            }
            return;
          }

          const detailTrigger = event.target.closest('[data-action="history-detail"]');
          if (detailTrigger) {
            const groupKey = detailTrigger.dataset.groupKey;
            if (groupKey) {
              event.preventDefault();
              openHistoryDetail(groupKey);
            }
            return;
          }

          const historyItem = event.target.closest('.chaospace-history-item[data-detail-trigger="group"]');
          if (historyItem && historyItem === event.target.closest('.chaospace-history-item')) {
            const groupKey = historyItem.dataset.groupKey;
            if (!groupKey) {
              return;
            }
            event.preventDefault();
            openHistoryDetail(groupKey);
            return;
          }
        });
      }

      if (floatingPanel) {
        floatingPanel.addEventListener('click', event => {
          const toggleBtn = event.target.closest('[data-role="history-toggle"]');
          if (!toggleBtn || !floatingPanel.contains(toggleBtn)) {
            return;
          }
          if (!state.historyGroups.length) {
            return;
          }
          state.historyExpanded = !state.historyExpanded;
          renderHistoryCard();
        });
      }

      if (panelDom.sortKeySelect) {
        panelDom.sortKeySelect.value = state.sortKey;
        panelDom.sortKeySelect.addEventListener('change', () => {
          state.sortKey = panelDom.sortKeySelect.value;
          renderResourceList();
        });
      }

      if (panelDom.sortOrderButton) {
        const refreshOrderButton = () => {
          panelDom.sortOrderButton.textContent = state.sortOrder === 'asc' ? '正序' : '倒序';
        };
        refreshOrderButton();
        panelDom.sortOrderButton.addEventListener('click', () => {
          state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
          refreshOrderButton();
          renderResourceList();
        });
      }

      if (panelDom.transferBtn) {
        panelDom.transferBtn.addEventListener('click', handleTransfer);
      }

      renderPresets();
      renderPathPreview();
      applyHistoryToCurrentPage();
      renderHistoryCard();
      updateHistoryExpansion();
      renderResourceList();
      setStatus('idle', state.statusMessage);
      renderLogs();
      updateTransferButton();
      if (!panelState.isPinned) {
        scheduleEdgeHide(EDGE_HIDE_DELAY);
      }
      if (state.deferredSeasonInfos.length) {
        ensureDeferredSeasonLoading().catch(error => {
          console.error('[Chaospace Transfer] Failed to schedule deferred season loading:', error);
        });
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to create floating panel:', error);
      showToast('error', '创建面板失败', error.message);
    } finally {
      panelCreationInProgress = false;
    }
    return panelCreated;
  }

  function toggleFloatingPanel() {
    if (floatingPanel) {
      panelShellRef?.destroy();
      panelShellRef = null;
      closePosterPreview();
      if (typeof panelDom.closeSettingsPanel === 'function') {
        panelDom.closeSettingsPanel({ restoreFocus: false });
        delete panelDom.closeSettingsPanel;
      }
      if (panelDom.openSettingsPanel) {
        delete panelDom.openSettingsPanel;
      }
      settingsModalRef = null;
      state.settingsPanel.isOpen = false;
      if (floatingPanel?.isConnected) {
        floatingPanel.remove();
      }
      floatingPanel = null;
      if (panelState.hideTimer) {
        clearTimeout(panelState.hideTimer);
        panelState.hideTimer = null;
      }
      if (panelState.edgeTransitionUnbind) {
        panelState.edgeTransitionUnbind();
        panelState.edgeTransitionUnbind = null;
      }
      if (panelState.edgeAnimationTimer) {
        clearTimeout(panelState.edgeAnimationTimer);
        panelState.edgeAnimationTimer = null;
      }
      if (panelState.documentPointerDownBound) {
        document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
        panelState.documentPointerDownBound = false;
      }
      panelState.scheduleEdgeHide = null;
      panelState.cancelEdgeHide = null;
      panelState.applyEdgeHiddenPosition = null;
      panelState.hidePanelToEdge = null;
      panelState.showPanelFromEdge = null;
      panelState.beginEdgeAnimation = null;
      panelState.lastKnownSize = null;
      panelState.lastKnownPosition = { left: 16, top: 16 };
      panelState.edgeState = { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK };
      panelState.pointerInside = false;
      panelState.lastPointerPosition = { x: Number.NaN, y: Number.NaN };
      panelState.isPinned = false;
      panelState.detachWindowResize = null;
      panelState.getPanelBounds = null;
      state.deferredSeasonInfos = [];
      state.isSeasonLoading = false;
      state.seasonLoadProgress = { total: 0, loaded: 0 };
      state.seasonEntries = [];
      state.historyGroups = [];
      state.historySeasonExpanded = new Set();
      deferredSeasonLoaderRunning = false;
      document.body.style.userSelect = '';
      Object.keys(panelDom).forEach(key => {
        panelDom[key] = null;
      });
    } else {
      createFloatingPanel();
    }
  }

  function injectStyles() {
    if (document.getElementById('chaospace-float-styles')) {
      return;
    }

    try {
      const link = document.createElement('link');
      link.id = 'chaospace-float-styles';
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('floatingButton.css');

      if (document.head) {
        document.head.appendChild(link);
      }
    } catch (error) {
      console.error('[Chaospace] Failed to inject styles:', error);
    }
  }

  function isTvShowPage() {
    return /\/tvshows\/\d+\.html/.test(window.location.pathname);
  }

  function isSeasonPage() {
    return /\/seasons\/\d+\.html/.test(window.location.pathname);
  }

  function scheduleInitialPanelCreation() {
    let attempts = 0;
    const tryCreate = async () => {
      if (floatingPanel || panelCreationInProgress) {
        return;
      }
      attempts += 1;
      const created = await createFloatingPanel();
      if (created || floatingPanel) {
        return;
      }
      if (attempts < PANEL_CREATION_MAX_ATTEMPTS) {
        window.setTimeout(tryCreate, PANEL_CREATION_RETRY_DELAY_MS);
      }
    };

    const kickoff = () => {
      if (INITIAL_PANEL_DELAY_MS <= 0) {
        tryCreate();
      } else {
        window.setTimeout(tryCreate, INITIAL_PANEL_DELAY_MS);
      }
    };

    kickoff();
  }

  function init() {
    if (!isSupportedDetailPage()) {
      return;
    }

    try {
      injectStyles();

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          scheduleInitialPanelCreation();
        });
      } else {
        scheduleInitialPanelCreation();
      }

      // 监听 DOM 变化,如果窗口被移除且有资源则重新创建
      let observerTimeout = null;
      const observer = new MutationObserver(() => {
        if (observerTimeout) {
          clearTimeout(observerTimeout);
        }

        observerTimeout = setTimeout(async () => {
          try {
            if (!floatingPanel && !panelCreationInProgress) {
      const data = await analyzePage();
              if (data.items && data.items.length > 0) {
                await createFloatingPanel();
              }
            }
          } catch (error) {
            console.error('[Chaospace Transfer] Observer error:', error);
          }
        }, 1000);
      });

      const targetNode = document.body;
      if (targetNode) {
        observer.observe(targetNode, {
          childList: true,
          subtree: true
        });
      }
    } catch (error) {
      console.error('[Chaospace] Init error:', error);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    const settingsChange = changes[STORAGE_KEY];
    if (settingsChange?.newValue) {
      const nextTheme = settingsChange.newValue.theme;
      if ((nextTheme === 'light' || nextTheme === 'dark') && nextTheme !== state.theme) {
        state.theme = nextTheme;
        applyPanelTheme();
      }
      if (typeof settingsChange.newValue.historyRateLimitMs === 'number') {
        const nextRate = clampHistoryRateLimit(settingsChange.newValue.historyRateLimitMs);
        if (nextRate !== state.historyRateLimitMs) {
          state.historyRateLimitMs = nextRate;
          if (state.settingsPanel.isOpen) {
            settingsModalRef?.render();
          }
        }
      }
    }
    const historyChange = changes[HISTORY_KEY];
    if (historyChange) {
      const prepared = prepareHistoryRecords(historyChange.newValue);
      state.historyRecords = prepared.records;
      state.historyGroups = prepared.groups;
      applyHistoryToCurrentPage();
      renderHistoryCard();
      if (floatingPanel) {
        renderResourceList();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'chaospace:collect-links') {
      analyzePage()
        .then(result => {
          sendResponse(result);
        })
        .catch(error => {
          console.error('[Chaospace Transfer] Message handler error:', error);
          sendResponse({ items: [], url: '', origin: '', title: '', poster: null });
        });
      return true;
    }

    if (message?.type === 'chaospace:transfer-progress') {
      handleProgressEvent(message);
    }

    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
