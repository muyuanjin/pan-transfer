(() => {
  const STORAGE_KEY = 'chaospace-transfer-settings';
  const POSITION_KEY = 'chaospace-panel-position';
  const SIZE_KEY = 'chaospace-panel-size';
  const DEFAULT_PRESETS = ['/视频/番剧', '/视频/影视', '/视频/电影'];
  const MAX_LOG_ENTRIES = 80;
  const HISTORY_KEY = 'chaospace-transfer-history';
  const HISTORY_DISPLAY_LIMIT = 6;
  const TV_SHOW_INITIAL_SEASON_BATCH = 2;
  const ALL_SEASON_TAB_ID = '__all__';
  const NO_SEASON_TAB_ID = '__no-season__';
  const EDGE_HIDE_DELAY = 480;
  const EDGE_HIDE_MIN_PEEK = 44;
  const EDGE_HIDE_MAX_PEEK = 128;
  const EDGE_HIDE_DEFAULT_PEEK = 64;

  const state = {
    baseDir: '/',
    useTitleSubdir: true,
    useSeasonSubdir: false,
    hasSeasonSubdirPreference: false,
    presets: [...DEFAULT_PRESETS],
    items: [],
    itemIdSet: new Set(),
    isSeasonLoading: false,
    seasonLoadProgress: { total: 0, loaded: 0 },
    deferredSeasonInfos: [],
    sortKey: 'page', // page | title
    sortOrder: 'asc', // asc | desc
    selectedIds: new Set(),
    pageTitle: '',
    pageUrl: '',
    poster: null,
    origin: '',
    jobId: null,
    logs: [],
    transferStatus: 'idle', // idle | running | success | error
    lastResult: null,
    statusMessage: '准备就绪 ✨',
    theme: 'dark',
    completion: null,
    seasonCompletion: {},
    seasonEntries: [],
    historyRecords: [],
    historyGroups: [],
    currentHistory: null,
    transferredIds: new Set(),
    newItemIds: new Set(),
    historyExpanded: false,
    historySeasonExpanded: new Set(),
    seasonDirMap: {},
    seasonResolvedPaths: [],
    activeSeasonId: null
  };

  const panelDom = {};

  let floatingPanel = null;
  let currentToast = null;
  let posterPreviewOverlay = null;
  let isMinimized = false;
  let lastKnownSize = null;
  let detachWindowResize = null;
  let panelCreationInProgress = false;
  let panelHideTimer = null;
  let panelEdgeState = { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK };
  let pointerInsidePanel = false;
  let isPanelPinned = false;

  function computeItemTargetPath(item, defaultPath) {
    if (!state.useSeasonSubdir || !item || !item.seasonId) {
      return defaultPath;
    }
    const cleanBase = normalizeDir(defaultPath || state.baseDir || '/');
    const seasonId = item.seasonId;
    let dirName = state.seasonDirMap[seasonId];
    if (!dirName || !sanitizeSeasonDirSegment(dirName)) {
      dirName = deriveSeasonDirectory(item.seasonLabel, item.seasonIndex);
      if (!dirName) {
        dirName = `第${Number.isFinite(item.seasonIndex) ? item.seasonIndex + 1 : 1}季`;
      }
      state.seasonDirMap[seasonId] = dirName;
      dedupeSeasonDirMap();
      dirName = state.seasonDirMap[seasonId];
      if (state.useSeasonSubdir) {
        updateSeasonExampleDir();
        renderSeasonHint();
      }
    }
    const safeDir = sanitizeSeasonDirSegment(dirName);
    if (!safeDir) {
      return cleanBase;
    }
    return cleanBase === '/' ? `/${safeDir}` : `${cleanBase}/${safeDir}`;
  }

  function sanitizeSeasonDirSegment(value) {
    const text = (value || '').trim();
    if (!text) {
      return '';
    }
    let normalized = text.replace(/\s+/g, ' ').trim();
    normalized = normalized.replace(/[<>:"|?*]+/g, '-');
    normalized = normalized.replace(/[/\\]+/g, '-');
    normalized = normalized.replace(/-+/g, '-');
    normalized = normalized.replace(/^-+|-+$/g, '');
    return normalized.trim();
  }

  function dedupeSeasonDirMap() {
    if (!state.seasonDirMap || typeof state.seasonDirMap !== 'object') {
      state.seasonDirMap = {};
      return;
    }
    const used = new Map();
    Object.entries(state.seasonDirMap).forEach(([key, name]) => {
      let sanitized = sanitizeSeasonDirSegment(name);
      if (!sanitized) {
        const fallbackKey = String(key || '').replace(/[^a-zA-Z0-9]+/g, '').slice(-6) || 'season';
        sanitized = `season-${fallbackKey}`;
      }
      const base = sanitized;
      let count = used.get(base) || 0;
      let finalName = base;
      while (used.has(finalName)) {
        count += 1;
        finalName = `${base}-${count}`;
      }
      used.set(base, count);
      used.set(finalName, 0);
      state.seasonDirMap[key] = finalName;
    });
  }

  function updateSeasonExampleDir() {
    if (!state.useSeasonSubdir) {
      state.seasonResolvedPaths = [];
      return;
    }

    const base = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle);
    const resolved = [];
    const seen = new Set();

    (state.items || []).forEach(item => {
      if (!item || !item.seasonId || seen.has(item.seasonId)) {
        return;
      }
      const rawDir = state.seasonDirMap[item.seasonId];
      const safeDir = sanitizeSeasonDirSegment(rawDir);
      const path = safeDir ? (base === '/' ? `/${safeDir}` : `${base}/${safeDir}`) : base;
      const label = item.seasonLabel || `第${Number.isFinite(item.seasonIndex) ? item.seasonIndex + 1 : 1}季`;
      resolved.push({
        id: item.seasonId,
        label,
        path
      });
      seen.add(item.seasonId);
    });

    Object.entries(state.seasonDirMap || {}).forEach(([seasonId, rawDir]) => {
      if (seen.has(seasonId)) {
        return;
      }
      const safeDir = sanitizeSeasonDirSegment(rawDir);
      const path = safeDir ? (base === '/' ? `/${safeDir}` : `${base}/${safeDir}`) : base;
      const label = safeDir || (typeof rawDir === 'string' && rawDir.trim()) || `季 ${seasonId}`;
      resolved.push({
        id: seasonId,
        label,
        path
      });
    });

    state.seasonResolvedPaths = resolved;
  }

  function getAvailableSeasonIds() {
    return state.items
      .map(item => item && item.seasonId)
      .filter(Boolean);
  }

  function getSeasonCount() {
    return new Set(getAvailableSeasonIds()).size;
  }

  function buildSeasonTabItems() {
    const seasonMap = new Map();
    let miscCount = 0;
    let total = 0;

    state.items.forEach(item => {
      if (!item) {
        return;
      }
      total += 1;
      if (item.seasonId) {
        const key = item.seasonId;
        const normalizedLabel = typeof item.seasonLabel === 'string' ? item.seasonLabel.trim() : '';
        const numericSuffix = String(key).match(/\d+$/);
        const fallbackLabel = Number.isFinite(item.seasonIndex)
          ? `第${item.seasonIndex + 1}季`
          : (numericSuffix ? `第${numericSuffix[0]}季` : `季 ${seasonMap.size + 1}`);
        const label = normalizedLabel || fallbackLabel || '未知季';
        const index = Number.isFinite(item.seasonIndex) ? item.seasonIndex : Number.MAX_SAFE_INTEGER;
        const existing = seasonMap.get(key);
        if (existing) {
          existing.count += 1;
          existing.index = Math.min(existing.index, index);
          if (!existing.name && label) {
            existing.name = label;
          }
        } else {
          seasonMap.set(key, {
            id: key,
            name: label,
            count: 1,
            index
          });
        }
      } else {
        miscCount += 1;
      }
    });

    const seasons = Array.from(seasonMap.values()).map(entry => ({
      ...entry,
      name: entry.name || '未知季',
      index: Number.isFinite(entry.index) ? entry.index : Number.MAX_SAFE_INTEGER
    }));

    seasons.sort((a, b) => {
      const indexDiff = a.index - b.index;
      if (indexDiff !== 0) {
        return indexDiff;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    const hasMultipleSeasons = seasons.length > 1;
    if (!hasMultipleSeasons && miscCount === 0) {
      return [];
    }

    const tabs = [];
    if (hasMultipleSeasons || (miscCount > 0 && seasons.length)) {
      tabs.push({
        id: ALL_SEASON_TAB_ID,
        name: '全部',
        count: total,
        type: 'all',
        index: -1
      });
    }

    seasons.forEach(entry => {
      tabs.push({
        id: entry.id,
        name: entry.name,
        count: entry.count,
        type: 'season',
        index: entry.index
      });
    });

    if (miscCount > 0) {
      tabs.push({
        id: NO_SEASON_TAB_ID,
        name: '未分季',
        count: miscCount,
        type: 'misc',
        index: Number.MAX_SAFE_INTEGER
      });
    }

    return tabs;
  }

  function resolveActiveSeasonId(tabItems) {
    if (!tabItems || !tabItems.length) {
      return null;
    }
    const availableIds = tabItems.map(tab => tab.id);
    if (state.activeSeasonId && availableIds.includes(state.activeSeasonId)) {
      return state.activeSeasonId;
    }
    const firstSeasonTab = tabItems.find(tab => tab.type === 'season');
    if (firstSeasonTab) {
      return firstSeasonTab.id;
    }
    return tabItems[0].id;
  }

  function computeSeasonTabState({ syncState = false } = {}) {
    const tabItems = buildSeasonTabItems();
    if (!tabItems.length) {
      if (syncState && state.activeSeasonId) {
        state.activeSeasonId = null;
      }
      return { tabItems, activeId: null, activeTab: null };
    }
    const activeId = resolveActiveSeasonId(tabItems);
    if (syncState && state.activeSeasonId !== activeId) {
      state.activeSeasonId = activeId;
    }
    const activeTab = tabItems.find(tab => tab.id === activeId) || null;
    return { tabItems, activeId, activeTab };
  }

  function filterItemsForActiveSeason(items, activeId) {
    if (!Array.isArray(items) || !items.length) {
      return [];
    }
    if (!activeId || activeId === ALL_SEASON_TAB_ID) {
      return items;
    }
    if (activeId === NO_SEASON_TAB_ID) {
      return items.filter(item => item && !item.seasonId);
    }
    return items.filter(item => item && item.seasonId === activeId);
  }

  function rebuildSeasonDirMap({ preserveExisting = true } = {}) {
    const existing = preserveExisting && state.seasonDirMap ? { ...state.seasonDirMap } : {};
    const next = {};
    state.items.forEach(item => {
      if (!item || !item.seasonId) {
        return;
      }
      if (next[item.seasonId]) {
        return;
      }
      let candidate = preserveExisting ? existing[item.seasonId] : '';
      if (!candidate || !String(candidate).trim()) {
        candidate = deriveSeasonDirectory(item.seasonLabel, item.seasonIndex);
      }
      if (!candidate) {
        candidate = `第${Number.isFinite(item.seasonIndex) ? item.seasonIndex + 1 : 1}季`;
      }
      next[item.seasonId] = candidate;
    });
    state.seasonDirMap = next;
    dedupeSeasonDirMap();
    updateSeasonExampleDir();
  }

  function ensureSeasonSubdirDefault() {
    if (state.hasSeasonSubdirPreference) {
      return;
    }
    const seasonCount = getSeasonCount();
    state.useSeasonSubdir = isTvShowPage() && seasonCount > 1;
  }

  function renderSeasonHint() {
    if (!panelDom.seasonPathHint) {
      return;
    }
    const entries = state.seasonResolvedPaths || [];
    const showHint = state.useSeasonSubdir && entries.length;
    if (!showHint) {
      panelDom.seasonPathHint.textContent = '';
      panelDom.seasonPathHint.classList.add('is-empty');
      return;
    }

    panelDom.seasonPathHint.classList.remove('is-empty');
    panelDom.seasonPathHint.textContent = '';

    const heading = document.createElement('div');
    heading.className = 'chaospace-path-heading';
    heading.textContent = '📂 实际转存路径';
    panelDom.seasonPathHint.appendChild(heading);

    entries.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'chaospace-path-line';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'chaospace-path-label chaospace-path-line-label';
      labelSpan.textContent = String(entry.label || '未命名季');
      row.appendChild(labelSpan);

      const valueSpan = document.createElement('span');
      valueSpan.className = 'chaospace-path-value chaospace-path-line-value';
      valueSpan.textContent = String(entry.path || '/');
      row.appendChild(valueSpan);

      panelDom.seasonPathHint.appendChild(row);
    });
  }

  function renderSeasonControls() {
    const seasonCount = getSeasonCount();
    const shouldShow = isTvShowPage() && seasonCount > 1;
    if (panelDom.seasonRow) {
      panelDom.seasonRow.style.display = shouldShow ? 'flex' : 'none';
    }
    if (panelDom.useSeasonCheckbox) {
      panelDom.useSeasonCheckbox.checked = shouldShow ? state.useSeasonSubdir : false;
      panelDom.useSeasonCheckbox.disabled = state.transferStatus === 'running';
    }
    if (shouldShow) {
      updateSeasonExampleDir();
    }
    renderSeasonHint();
  }

  function renderSeasonTabs() {
    if (!panelDom.seasonTabs) {
      return computeSeasonTabState({ syncState: true });
    }

    const tabState = computeSeasonTabState({ syncState: true });
    const { tabItems, activeId } = tabState;

    if (!tabItems.length) {
      panelDom.seasonTabs.innerHTML = '';
      panelDom.seasonTabs.hidden = true;
      panelDom.seasonTabs.setAttribute('aria-hidden', 'true');
      return tabState;
    }

    panelDom.seasonTabs.hidden = false;
    panelDom.seasonTabs.removeAttribute('aria-hidden');
    panelDom.seasonTabs.innerHTML = '';

    const fragment = document.createDocumentFragment();
    tabItems.forEach(tab => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `chaospace-season-tab${tab.id === activeId ? ' is-active' : ''}`;
      button.dataset.seasonId = tab.id;
      button.dataset.seasonType = tab.type;
      button.setAttribute('aria-pressed', tab.id === activeId ? 'true' : 'false');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'chaospace-season-tab-label';
      labelSpan.textContent = tab.name;
      button.appendChild(labelSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'chaospace-season-tab-count';
      countSpan.textContent = String(tab.count);
      button.appendChild(countSpan);

      fragment.appendChild(button);
    });

    panelDom.seasonTabs.appendChild(fragment);
    panelDom.seasonTabs.scrollLeft = 0;
    return tabState;
  }

  // 智能提取剧集标题
  function extractCleanTitle(rawTitle) {
    if (!rawTitle) return '未命名资源';

    let title = rawTitle.trim();

    // 移除 " 提取码 xxxx" 这种后缀
    title = title.replace(/\s*提取码\s+\S+\s*$/gi, '');

    // 移除末尾的 :：及其后面的内容（如 ":第1季"、"：第一季"）
    title = title.replace(/[:：]\s*(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');

    // 移除末尾的 " 第X季"、" SXX" 等
    title = title.replace(/\s+(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');

    // 移除末尾的单独冒号
    title = title.replace(/[:：]\s*$/, '');

    // 移除多余空格
    title = title.replace(/\s+/g, ' ').trim();

    return title || '未命名资源';
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

    const entryIndex = state.seasonEntries.findIndex(entry => entry.seasonId === info.seasonId);
    const normalizedEntry = {
      seasonId: info.seasonId,
      label: info.label,
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
        seasonLabel: info.label,
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

  async function collectLinks(options = {}) {
    const {
      deferTvSeasons = false,
      initialSeasonBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
    } = options || {};
    const baseResult = {
      items: [],
      url: window.location.href || '',
      origin: window.location.origin || '',
      title: getPageCleanTitle(),
      poster: extractPosterDetails(),
      completion: null,
      seasonCompletion: {},
      deferredSeasons: [],
      totalSeasons: 0,
      loadedSeasons: 0,
      seasonEntries: []
    };

    try {
      let completion = null;
      let seasonCompletion = {};
      let deferredSeasons = [];
      let totalSeasons = 0;
      let loadedSeasons = 0;
      let seasonEntries = [];
      let seasonData = null;
      let items = extractItemsFromDocument(document);
      if (isSeasonPage()) {
        completion = extractSeasonPageCompletion(document);
      }
      if (isTvShowPage()) {
        seasonData = await collectTvShowSeasonItems({
          defer: deferTvSeasons,
          initialBatchSize: initialSeasonBatchSize
        });
        if (seasonData.items && seasonData.items.length > 0) {
          items = seasonData.items;
        }
        if (seasonData.seasonCompletion) {
          seasonCompletion = seasonData.seasonCompletion;
        }
        if (Array.isArray(seasonData.deferredSeasons)) {
          deferredSeasons = seasonData.deferredSeasons;
        }
        if (Number.isFinite(seasonData.totalSeasons)) {
          totalSeasons = seasonData.totalSeasons;
        }
        if (Number.isFinite(seasonData.loadedSeasons)) {
          loadedSeasons = seasonData.loadedSeasons;
        }
        if (seasonData.completion) {
          completion = seasonData.completion;
        } else if (seasonData.seasonCompletion) {
          const statuses = Object.values(seasonData.seasonCompletion);
          if (statuses.length) {
            completion = summarizeSeasonCompletion(statuses);
          }
        }
        if (Array.isArray(seasonData.seasonEntries)) {
          seasonEntries = seasonData.seasonEntries;
        }
      }
      if (!completion && isSeasonPage()) {
        completion = extractSeasonPageCompletion(document);
      }
      if (!completion && items.length === 0) {
        completion = null;
      }
      return {
        ...baseResult,
        items,
        completion,
        seasonCompletion,
        deferredSeasons,
        totalSeasons,
        loadedSeasons,
        seasonEntries
      };
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to collect links', error);
      return baseResult;
    }
  }

  function normalizePageUrl(input) {
    if (!input || typeof input !== 'string') {
      return '';
    }
    try {
      const url = new URL(input, window.location.href);
      url.hash = '';
      return url.toString();
    } catch (_error) {
      return input.split('#')[0];
    }
  }

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

  function formatOriginLabel(origin) {
    if (!origin) {
      return '';
    }
    try {
      const url = new URL(origin, window.location.href);
      return url.hostname.replace(/^www\./, '');
    } catch (_error) {
      return origin;
    }
  }

  function sanitizeCssUrl(url) {
    if (!url) {
      return '';
    }
    return url.replace(/["\n\r]/g, '').trim();
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

  function normalizeDir(value) {
    const input = (value || '').trim();
    if (!input) {
      return '/';
    }
    let normalized = input.replace(/\\/g, '/');
    normalized = normalized.replace(/\/+/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  function sanitizePreset(value) {
    if (!value) {
      return '';
    }
    let sanitized = value.trim();
    sanitized = sanitized.replace(/\s+/g, ' ');
    if (!sanitized.startsWith('/')) {
      sanitized = `/${sanitized}`;
    }
    sanitized = sanitized.replace(/\/+/g, '/');
    if (sanitized.length > 1 && sanitized.endsWith('/')) {
      sanitized = sanitized.slice(0, -1);
    }
    return sanitized;
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const settings = stored[STORAGE_KEY] || {};
      if (typeof settings.baseDir === 'string') {
        state.baseDir = normalizeDir(settings.baseDir);
      }
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
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to load settings', error);
    }
  }

  async function saveSettings() {
    const settings = {
      baseDir: state.baseDir,
      useTitleSubdir: state.useTitleSubdir,
      presets: state.presets,
      theme: state.theme
    };
    if (state.hasSeasonSubdirPreference) {
      settings.useSeasonSubdir = state.useSeasonSubdir;
    }
    await safeStorageSet({
      [STORAGE_KEY]: settings
    }, 'settings');
  }

  let storageInvalidationWarned = false;

  function isExtensionContextInvalidated(error) {
    if (!error) {
      return false;
    }
    const message = typeof error === 'string' ? error : error.message;
    if (!message) {
      return false;
    }
    return message.toLowerCase().includes('context invalidated');
  }

  function warnStorageInvalidation(operation = 'Storage operation') {
    if (storageInvalidationWarned) {
      return;
    }
    console.warn(`[Chaospace Transfer] ${operation} skipped · extension context invalidated. 请重新加载扩展或页面以继续。`);
    storageInvalidationWarned = true;
  }

  async function safeStorageSet(entries, contextLabel = 'storage') {
    try {
      await chrome.storage.local.set(entries);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        warnStorageInvalidation('Storage write');
        return;
      }
      console.error(`[Chaospace Transfer] Failed to persist ${contextLabel}`, error);
    }
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

  function normalizeHistoryCompletion(entry) {
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

  function normalizeSeasonCompletionMap(value) {
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

  function normalizeSeasonDirectory(value) {
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

  function normalizeHistorySeasonEntries(entries) {
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

  function prepareHistoryRecords(raw) {
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

  function getHistoryRecordTimestamp(record) {
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

  function deriveHistoryGroupKey(record) {
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

  function selectHistoryMainRecord(records) {
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

  function buildHistoryGroups(records) {
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

  function buildHistoryGroupSeasonRows(group) {
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

  function closePosterPreview() {
    if (posterPreviewOverlay && posterPreviewOverlay.parentNode) {
      posterPreviewOverlay.parentNode.removeChild(posterPreviewOverlay);
    }
    posterPreviewOverlay = null;
    document.removeEventListener('keydown', handlePosterPreviewKeydown, true);
  }

  function handlePosterPreviewKeydown(event) {
    if (event.key === 'Escape') {
      closePosterPreview();
    }
  }

  function showPosterPreview(options = {}) {
    const src = options.src || '';
    if (!src) {
      return;
    }
    closePosterPreview();
    posterPreviewOverlay = document.createElement('div');
    posterPreviewOverlay.className = 'chaospace-poster-preview';
    const inner = document.createElement('div');
    inner.className = 'chaospace-poster-preview-inner';
    const img = document.createElement('img');
    img.src = src;
    img.alt = options.alt || '';
    inner.appendChild(img);
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'chaospace-poster-preview-close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', closePosterPreview);
    inner.appendChild(closeButton);
    posterPreviewOverlay.appendChild(inner);
    posterPreviewOverlay.addEventListener('click', event => {
      if (event.target === posterPreviewOverlay) {
        closePosterPreview();
      }
    });
    document.body.appendChild(posterPreviewOverlay);
    document.addEventListener('keydown', handlePosterPreviewKeydown, true);
  }

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

  function renderHistoryCard() {
    if (!panelDom.historyList || !panelDom.historyEmpty || !panelDom.historySummaryBody) {
      return;
    }

    const groups = Array.isArray(state.historyGroups) ? state.historyGroups : [];
    const validGroupKeys = new Set(groups.map(group => group.key));
    state.historySeasonExpanded = new Set(
      Array.from(state.historySeasonExpanded).filter(key => validGroupKeys.has(key))
    );
    const limit = state.historyExpanded ? groups.length : Math.min(groups.length, HISTORY_DISPLAY_LIMIT);
    const entries = groups.slice(0, limit);
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
      panelDom.historyEmpty.classList.remove('is-hidden');
      if (state.historyExpanded) {
        state.historyExpanded = false;
      }
      if (panelDom.historySummary) {
        panelDom.historySummary.classList.add('is-empty');
      }
      panelDom.historySummaryBody.innerHTML = '<span class="chaospace-history-summary-empty">暂无转存记录</span>';
      refreshToggleCache();
      if (Array.isArray(panelDom.historyToggleButtons)) {
        panelDom.historyToggleButtons.forEach(btn => {
          btn.disabled = true;
        });
      }
      updateHistoryExpansion();
      return;
    }

    panelDom.historyEmpty.classList.add('is-hidden');
    panelDom.historySummary?.classList.remove('is-empty');

    entries.forEach(group => {
      const mainRecord = group.main || {};
      const item = document.createElement('div');
      item.className = 'chaospace-history-item';
      item.dataset.groupKey = group.key;
      if (Array.isArray(group.urls) && group.urls.includes(currentUrl)) {
        item.classList.add('is-current');
      }

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
        posterElement.appendChild(posterImg);
      } else {
        posterElement.classList.add('is-placeholder');
      }
      header.appendChild(posterElement);

      const main = document.createElement('div');
      main.className = 'chaospace-history-main';

      const title = document.createElement('div');
      title.className = 'chaospace-history-title';
      title.textContent = group.title || mainRecord.pageTitle || '未命名资源';
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
      if (mainRecord.completion && mainRecord.completion.label) {
        metaParts.push(mainRecord.completion.label);
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

      if (mainRecord.pageType === 'series') {
        const checkBtn = document.createElement('button');
        checkBtn.type = 'button';
        checkBtn.dataset.action = 'check';
        checkBtn.dataset.url = mainRecord.pageUrl || '';
        checkBtn.className = 'chaospace-history-action chaospace-history-action-check';
        const isCompleted = mainRecord.completion && mainRecord.completion.state === 'completed';
        checkBtn.textContent = isCompleted ? '已完结' : '检测新篇';
        if (isCompleted || !mainRecord.pageUrl) {
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
        const expanded = state.historySeasonExpanded.has(group.key);
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
        if (!expanded) {
          seasonList.hidden = true;
        } else {
          item.classList.add('is-season-expanded');
        }

        seasonRows.forEach(row => {
          const rowElement = document.createElement('div');
          rowElement.className = 'chaospace-history-season-item';
          rowElement.dataset.key = row.key;

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
          rowBody.appendChild(rowTitle);

          const rowMeta = document.createElement('div');
          rowMeta.className = 'chaospace-history-season-meta';
          const metaParts = [];
          if (row.completion && row.completion.label) {
            metaParts.push(row.completion.label);
          }
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
      if (summaryGroup.main && summaryGroup.main.completion && summaryGroup.main.completion.label) {
        metaParts.push(summaryGroup.main.completion.label);
      }
      const summaryTime = formatHistoryTimestamp(summaryGroup.updatedAt || summaryGroup.main?.lastTransferredAt || summaryGroup.main?.lastCheckedAt);
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

    updateHistoryExpansion();
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

  async function loadHistory(options = {}) {
    const { silent = false } = options;
    try {
      const stored = await chrome.storage.local.get(HISTORY_KEY);
      const prepared = prepareHistoryRecords(stored[HISTORY_KEY]);
      state.historyRecords = prepared.records;
      state.historyGroups = prepared.groups;
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to load history', error);
      state.historyRecords = [];
      state.historyGroups = [];
    }

    if (!silent) {
      applyHistoryToCurrentPage();
      renderHistoryCard();
      if (floatingPanel) {
        renderResourceList();
      }
    }
  }

  async function triggerHistoryUpdate(pageUrl, button) {
    if (!pageUrl) {
      return;
    }
    let previousText = '';
    let shouldRestoreButton = true;
    if (button) {
      previousText = button.textContent;
      button.disabled = true;
      button.textContent = '检测中...';
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'chaospace:check-updates',
        payload: { pageUrl }
      });
      if (!response || response.ok === false) {
        const errorMessage = response?.error || '检测失败';
        showToast('error', '检测失败', errorMessage);
        return;
      }
      if (!response.hasUpdates) {
        const completionLabel = response?.completion?.label || response?.completionLabel || '';
        if (response.reason === 'completed') {
          shouldRestoreButton = false;
          const message = completionLabel ? `${completionLabel} · 无需继续转存 ✅` : '该剧集已完结 · 不再检测更新';
          showToast('success', '剧集已完结', message);
        } else {
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
        showToast(toastType, '检测完成', summary, stats);
      }
      await loadHistory();
      applyHistoryToCurrentPage();
      renderHistoryCard();
      if (floatingPanel) {
        renderResourceList();
      }
    } catch (error) {
      console.error('[Chaospace Transfer] Update check failed', error);
      showToast('error', '检测失败', error.message || '无法检测更新');
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

  function updateMinimizeButton() {
    if (!panelDom.minimizeBtn) {
      return;
    }
    const label = isMinimized ? '展开' : '折叠';
    panelDom.minimizeBtn.textContent = label;
    panelDom.minimizeBtn.title = label;

    // 同步路径到迷你窗口输入框
    const miniPathInput = floatingPanel?.querySelector('[data-role="mini-path"]');
    if (miniPathInput && isMinimized) {
      miniPathInput.value = state.baseDir;
    }
  }

  function updatePinButton() {
    if (!panelDom.pinBtn) {
      return;
    }
    const label = isPanelPinned ? '取消固定面板' : '固定面板';
    panelDom.pinBtn.textContent = '📌';
    panelDom.pinBtn.title = label;
    panelDom.pinBtn.setAttribute('aria-label', label);
    panelDom.pinBtn.setAttribute('aria-pressed', isPanelPinned ? 'true' : 'false');
    panelDom.pinBtn.classList.toggle('is-active', isPanelPinned);
    if (floatingPanel) {
      floatingPanel.classList.toggle('is-pinned', isPanelPinned);
    }
  }

  function showToast(type, title, message, stats = null) {
    try {
      if (currentToast && currentToast.parentNode) {
        currentToast.remove();
        currentToast = null;
      }

      if (!document.body) {
        return;
      }

      const toast = document.createElement('div');
      toast.className = `chaospace-toast ${type}`;

      const titleEl = document.createElement('div');
      titleEl.className = 'chaospace-toast-title';
      titleEl.textContent = title;
      toast.appendChild(titleEl);

      if (message) {
        const messageEl = document.createElement('div');
        messageEl.className = 'chaospace-toast-message';
        messageEl.textContent = message;
        toast.appendChild(messageEl);
      }

      if (stats) {
        const statsEl = document.createElement('div');
        statsEl.className = 'chaospace-toast-stats';

        if (stats.success > 0) {
          const successStat = document.createElement('div');
          successStat.className = 'chaospace-toast-stat success';
          successStat.textContent = `✅ 成功 · ${stats.success}`;
          statsEl.appendChild(successStat);
        }

        if (stats.failed > 0) {
          const failedStat = document.createElement('div');
          failedStat.className = 'chaospace-toast-stat failed';
          failedStat.textContent = `❌ 失败 · ${stats.failed}`;
          statsEl.appendChild(failedStat);
        }

        if (stats.skipped > 0) {
          const skippedStat = document.createElement('div');
          skippedStat.className = 'chaospace-toast-stat skipped';
          skippedStat.textContent = `🌀 跳过 · ${stats.skipped}`;
          statsEl.appendChild(skippedStat);
        }

        toast.appendChild(statsEl);
      }

      document.body.appendChild(toast);
      currentToast = toast;

      setTimeout(() => {
        if (currentToast === toast && toast.parentNode) {
          toast.remove();
          currentToast = null;
        }
      }, 5000);
    } catch (error) {
      console.error('[Chaospace] Failed to show toast:', error);
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

  function deriveSeasonDirectory(label, index) {
    const resolvedLabel = (label || '').trim();
    if (resolvedLabel) {
      return resolvedLabel;
    }
    if (Number.isFinite(index)) {
      return `第${index + 1}季`;
    }
    return '第1季';
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

  function renderResourceSummary(context = {}) {
    if (!panelDom.resourceSummary) {
      return;
    }
    const total = state.items.length;
    const selected = state.selectedIds.size;
    const { tabState, visibleCount, visibleSelected } = context || {};
    const computedTabState = tabState || computeSeasonTabState({ syncState: false });
    const hasTabs = Array.isArray(computedTabState.tabItems) && computedTabState.tabItems.length > 0;

    let currentVisibleCount = typeof visibleCount === 'number' ? visibleCount : total;
    let currentVisibleSelected = typeof visibleSelected === 'number' ? visibleSelected : selected;
    if (hasTabs) {
      const filtered = filterItemsForActiveSeason(state.items, computedTabState.activeId);
      if (typeof visibleCount !== 'number') {
        currentVisibleCount = filtered.length;
      }
      if (typeof visibleSelected !== 'number') {
        currentVisibleSelected = filtered.filter(item => state.selectedIds.has(item.id)).length;
      }
    }

    const parts = [`🧾 已选 ${selected} / ${total}`];
    if (hasTabs) {
      const activeTab = computedTabState.activeTab;
      if (activeTab && activeTab.type === 'all') {
        parts.push(`显示全部 ${currentVisibleCount}`);
      } else if (activeTab) {
        parts.push(`${activeTab.name} ${currentVisibleSelected}/${activeTab.count}`);
      } else {
        parts.push(`当前显示 ${currentVisibleCount}`);
      }
    }

    if (state.newItemIds.size) {
      parts.push(`新增 ${state.newItemIds.size}`);
    }
    const seasonIds = new Set(state.items.map(item => item.seasonId).filter(Boolean));
    if (seasonIds.size > 1) {
      parts.push(`涵盖 ${seasonIds.size} 季`);
    }
    if (state.isSeasonLoading && state.seasonLoadProgress.total > 0) {
      parts.push(`⏳ 加载 ${state.seasonLoadProgress.loaded}/${state.seasonLoadProgress.total}`);
    }
    if (state.completion && state.completion.label) {
      const stateEmoji = state.completion.state === 'completed'
        ? '✅'
        : (state.completion.state === 'ongoing' ? '📡' : (state.completion.state === 'upcoming' ? '🕒' : 'ℹ️'));
      parts.push(`${stateEmoji} ${state.completion.label}`);
    }
    panelDom.resourceSummary.textContent = parts.join(' · ');
    if (panelDom.resourceTitle) {
      panelDom.resourceTitle.textContent = `🔍 找到 ${total} 个百度网盘资源`;
    }
  }

  function sortItems(items) {
    const sorted = [...items];
    if (state.sortKey === 'title') {
      sorted.sort((a, b) => {
        const compare = a.title.localeCompare(b.title, 'zh-CN');
        return state.sortOrder === 'asc' ? compare : -compare;
      });
    } else {
      sorted.sort((a, b) => {
        const compare = a.order - b.order;
        return state.sortOrder === 'asc' ? compare : -compare;
      });
    }
    return sorted;
  }

  function renderResourceList() {
    if (!panelDom.itemsContainer) {
      return;
    }
    const tabState = renderSeasonTabs();
    const container = panelDom.itemsContainer;
    container.innerHTML = '';

    const hasAnyItems = state.items.length > 0;
    const hasTabs = Array.isArray(tabState.tabItems) && tabState.tabItems.length > 0;
    const filteredItems = hasTabs
      ? filterItemsForActiveSeason(state.items, tabState.activeId)
      : [...state.items];

    let visibleSelected = 0;

    if (!filteredItems.length) {
      const empty = document.createElement('div');
      empty.className = 'chaospace-empty';

      if (!hasAnyItems) {
        if (state.isSeasonLoading) {
          const { loaded, total } = state.seasonLoadProgress;
          const progress = total > 0 ? ` (${loaded}/${total})` : '';
          empty.textContent = `⏳ 正在加载多季资源${progress}...`;
        } else {
          empty.textContent = '😅 没有解析到百度网盘资源';
        }
      } else if (state.isSeasonLoading && tabState.activeTab && tabState.activeTab.type === 'season') {
        const { loaded, total } = state.seasonLoadProgress;
        const progress = total > 0 ? ` (${loaded}/${total})` : '';
        empty.textContent = `⏳ ${tabState.activeTab.name} 正在加载${progress}...`;
      } else {
        const label = tabState.activeTab ? tabState.activeTab.name : '当前标签';
        empty.textContent = `😴 ${label} 暂无资源`;
      }

      container.appendChild(empty);
      renderResourceSummary({
        tabState,
        visibleCount: filteredItems.length,
        visibleSelected
      });
      updateTransferButton();
      updatePanelHeader();
      renderSeasonControls();
      return;
    }

    const sortedItems = sortItems(filteredItems);
    const fragment = document.createDocumentFragment();

    sortedItems.forEach(item => {
      const isSelected = state.selectedIds.has(item.id);
      const isTransferred = state.transferredIds.has(item.id);
      const isNew = state.currentHistory && state.newItemIds.has(item.id);
      if (isSelected) {
        visibleSelected += 1;
      }
      const statusBadges = [];
      if (isTransferred) {
        statusBadges.push('<span class="chaospace-badge chaospace-badge-success">已转存</span>');
      }
      if (isNew) {
        statusBadges.push('<span class="chaospace-badge chaospace-badge-new">新增</span>');
      }
      if (!isTransferred && !isNew && state.currentHistory) {
        statusBadges.push('<span class="chaospace-badge chaospace-badge-pending">待转存</span>');
      }
      const detailBadges = [];
      if (item.seasonLabel) {
        detailBadges.push(`<span class="chaospace-badge">季：${item.seasonLabel}</span>`);
      }
      if (item.seasonCompletion && item.seasonCompletion.label) {
        const badgeClass = item.seasonCompletion.state === 'completed'
          ? 'chaospace-badge chaospace-badge-success'
          : 'chaospace-badge';
        detailBadges.push(`<span class="${badgeClass}">状态：${item.seasonCompletion.label}</span>`);
      }
      if (item.quality) {
        detailBadges.push(`<span class="chaospace-badge">画质：${item.quality}</span>`);
      }
      if (item.subtitle) {
        detailBadges.push(`<span class="chaospace-badge">字幕：${item.subtitle}</span>`);
      }
      const metaBadges = [...statusBadges, ...detailBadges].join('');
      const displayTitle = item.seasonLabel ? `🔗 [${item.seasonLabel}] ${item.title}` : `🔗 ${item.title}`;
      const row = document.createElement('label');
      row.className = 'chaospace-item';
      row.dataset.id = item.id;
      row.innerHTML = `
        <input type="checkbox" class="chaospace-item-checkbox" ${isSelected ? 'checked' : ''} />
        <div class="chaospace-item-body">
          <div class="chaospace-item-title">${displayTitle}</div>
          <div class="chaospace-item-meta">${metaBadges}</div>
        </div>
      `;
      fragment.appendChild(row);
      requestAnimationFrame(() => {
        row.classList.add('is-visible');
        row.classList.toggle('is-muted', !isSelected);
        row.classList.toggle('is-transferred', isTransferred);
        row.classList.toggle('is-new', isNew);
      });
    });

    container.appendChild(fragment);

    renderResourceSummary({
      tabState,
      visibleCount: sortedItems.length,
      visibleSelected
    });
    updateTransferButton();
    updatePanelHeader();
    renderSeasonControls();
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

  function setBaseDir(value, { fromPreset = false } = {}) {
    const normalized = normalizeDir(value);
    state.baseDir = normalized;
    if (panelDom.baseDirInput && panelDom.baseDirInput.value !== normalized) {
      panelDom.baseDirInput.value = normalized;
    }
    if (fromPreset) {
      // 选中 preset 时不立即追加, 但保持已存在
      ensurePreset(normalized);
    }
    saveSettings();
    renderPresets();
    renderPathPreview();
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

  function getTargetPath(baseDir, useTitleSubdir, pageTitle) {
    const normalizedBase = normalizeDir(baseDir);
    let targetDirectory = normalizedBase || '/';

    if (useTitleSubdir && pageTitle) {
      const cleanTitle = extractCleanTitle(pageTitle);
      targetDirectory = normalizedBase === '/' ? `/${cleanTitle}` : `${normalizedBase}/${cleanTitle}`;
    }

    return targetDirectory;
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
      return;
    }
    panelCreationInProgress = true;

    if (detachWindowResize) {
      detachWindowResize();
      detachWindowResize = null;
    }
    lastKnownSize = null;

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

      const data = await collectLinks({
        deferTvSeasons: true,
        initialSeasonBatchSize: TV_SHOW_INITIAL_SEASON_BATCH
      });
      const hasItems = Array.isArray(data.items) && data.items.length > 0;
      const deferredSeasons = Array.isArray(data.deferredSeasons) ? [...data.deferredSeasons] : [];
      if (!hasItems && deferredSeasons.length === 0) {
        return;
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
        ? data.seasonEntries.map(entry => ({
          seasonId: entry.seasonId || entry.id || '',
          label: entry.label || '',
          url: entry.url || '',
          seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : 0,
          completion: entry.completion || null,
          poster: entry.poster || null,
          loaded: Boolean(entry.loaded),
          hasItems: Boolean(entry.hasItems)
        }))
        : [];
      state.items = (Array.isArray(data.items) ? data.items : []).map((item, index) => ({
        ...item,
        order: typeof item.order === 'number' ? item.order : index
      }));
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

      const panel = document.createElement('div');
      panel.className = `chaospace-float-panel chaospace-theme${state.theme === 'light' ? ' theme-light' : ''}`;
      const originLabel = formatOriginLabel(state.origin);
      panel.innerHTML = `
        <div class="chaospace-float-header">
          <div class="chaospace-header-art is-empty" data-role="header-art"></div>
          <button
            type="button"
            class="chaospace-float-pin"
            data-role="pin-toggle"
            title="固定面板"
            aria-pressed="false"
          >📌</button>
          <div class="chaospace-header-content">
            <div class="chaospace-header-body">
              <div class="chaospace-header-topline">
                <span class="chaospace-assistant-badge">🚀 CHAOSPACE 转存助手</span>
              </div>
              <h2 class="chaospace-show-title" data-role="show-title">${state.pageTitle || '等待选择剧集'}</h2>
              <p class="chaospace-show-subtitle" data-role="show-subtitle">${originLabel ? `来源 ${originLabel}` : '未检测到页面来源'}</p>
            </div>
            <div class="chaospace-header-actions">
              <img
                class="chaospace-header-poster"
                data-role="header-poster"
                alt=""
                loading="lazy"
                decoding="async"
                style="display: none;"
              />
              <div class="chaospace-float-controls">
                <button
                  type="button"
                  class="chaospace-float-minimize"
                  data-role="minimize"
                  title="折叠"
                >折叠</button>
                <button
                  type="button"
                  class="chaospace-theme-toggle"
                  data-role="theme-toggle"
                  aria-label="切换主题"
                  title="切换主题"
                >☀️</button>
              </div>
            </div>
          </div>
        </div>
        <div class="chaospace-float-body">
          <div class="chaospace-history-overlay" data-role="history-overlay" aria-hidden="true">
            <div class="chaospace-history-overlay-header">
              <div class="chaospace-history-overlay-title">🔖 转存历史</div>
              <button
                type="button"
                class="chaospace-history-toggle"
                data-role="history-toggle"
                aria-expanded="false"
                aria-label="收起转存历史"
              >收起</button>
            </div>
            <div class="chaospace-history-overlay-scroll">
              <div class="chaospace-history-empty" data-role="history-empty">还没有转存记录</div>
              <div class="chaospace-history-list" data-role="history-list"></div>
            </div>
          </div>
          <div class="chaospace-float-main">
            <div class="chaospace-float-columns">
              <section class="chaospace-column chaospace-column-left">
                <div class="chaospace-section-heading">
                  <div class="chaospace-section-title" data-role="resource-title"></div>
                  <div class="chaospace-section-caption" data-role="resource-summary"></div>
                </div>
                <div class="chaospace-season-tabs" data-role="season-tabs" hidden></div>
                <div class="chaospace-toolbar">
                  <div class="chaospace-sort-group">
                    <label class="chaospace-sort-label">
                      <span>排序</span>
                      <select data-role="sort-key">
                        <option value="page">默认顺序</option>
                        <option value="title">标题</option>
                      </select>
                    </label>
                    <button type="button" class="chaospace-order-btn" data-role="sort-order">正序</button>
                  </div>
                  <div class="chaospace-select-group">
                    <button type="button" data-action="select-all">全选</button>
                    <button type="button" data-action="select-invert">反选</button>
                    <button type="button" data-action="select-new">仅选新增</button>
                  </div>
                </div>
                <div class="chaospace-items-scroll" data-role="items"></div>
              </section>
              <section class="chaospace-column chaospace-column-right">
                <div class="chaospace-card chaospace-path-card">
                  <div class="chaospace-card-title">📁 转存目录</div>
                  <div class="chaospace-card-body">
                    <div class="chaospace-preset-list" data-role="preset-list"></div>
                    <div class="chaospace-input-row">
                      <input type="text" placeholder="/视频/番剧" data-role="base-dir" />
                      <button type="button" data-role="add-preset">收藏路径</button>
                    </div>
                    <label class="chaospace-checkbox">
                      <input type="checkbox" data-role="use-title" />
                      <span>为本页创建子目录（推荐）</span>
                    </label>
                    <label class="chaospace-checkbox chaospace-season-checkbox" data-role="season-row" style="display: none;">
                      <input type="checkbox" data-role="use-season" />
                      <span>为每季创建子文件夹</span>
                    </label>
                    <div class="chaospace-path-preview" data-role="path-preview"></div>
                    <div class="chaospace-path-hint is-empty" data-role="season-path-hint"></div>
                  </div>
                </div>
                <div class="chaospace-card chaospace-status-card">
                  <div class="chaospace-card-title chaospace-log-header">
                    <span class="chaospace-log-title">📜 日志</span>
                    <div class="chaospace-log-summary is-empty" data-role="result-summary"></div>
                  </div>
                  <div class="chaospace-log-container" data-role="log-container">
                    <ul class="chaospace-log-list" data-role="log-list"></ul>
                  </div>
                </div>
              </section>
            </div>
          </div>
          <div class="chaospace-float-footer">
            <div class="chaospace-history-summary" data-role="history-summary">
              <div class="chaospace-history-summary-body" data-role="history-summary-body"></div>
            </div>
            <div class="chaospace-transfer-card chaospace-footer-actions">
              <button class="chaospace-float-btn chaospace-float-btn-compact" data-role="transfer-btn">
                <span class="chaospace-btn-spinner" data-role="transfer-spinner"></span>
                <span data-role="transfer-label">开始转存</span>
                <span class="chaospace-btn-icon">🚀</span>
              </button>
            </div>
          </div>
        </div>
        <div
          class="chaospace-resize-handle"
          data-role="resize-handle"
          title="拖动调整面板大小"
          aria-hidden="true"
        ></div>
        <div class="chaospace-float-mini">
          <button
            type="button"
            class="chaospace-mini-expand"
            data-role="mini-expand"
            title="展开面板"
            aria-label="展开面板"
          >⤢</button>
          <input type="text" class="chaospace-mini-input" data-role="mini-path" placeholder="/视频/番剧" />
          <button type="button" class="chaospace-mini-save" data-role="mini-save">保存</button>
        </div>
      `;

      document.body.appendChild(panel);
      floatingPanel = panel;
      panelEdgeState = { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK };
      pointerInsidePanel = false;
      isPanelPinned = false;
      if (panelHideTimer) {
        clearTimeout(panelHideTimer);
        panelHideTimer = null;
      }

      const clamp = (value, min, max) => {
        return Math.min(Math.max(value, min), max);
      };

      const PANEL_MARGIN = 16;
      const PANEL_MIN_WIDTH = 360;
      const PANEL_MIN_HEIGHT = 380;
      let lastKnownPosition = { left: PANEL_MARGIN, top: PANEL_MARGIN };

      const computeEdgePeek = () => {
        const width = panel.offsetWidth || PANEL_MIN_WIDTH;
        const derived = Math.round(width * 0.18);
        const normalized = Number.isFinite(derived) ? derived : EDGE_HIDE_DEFAULT_PEEK;
        const viewportWidth = Math.max(window.innerWidth || 0, 0);
        const baseMax = Math.max(16, viewportWidth - 8);
        const dynamicMax = Math.max(16, Math.min(EDGE_HIDE_MAX_PEEK, baseMax));
        const dynamicMin = Math.min(EDGE_HIDE_MIN_PEEK, dynamicMax);
        return Math.max(dynamicMin, Math.min(dynamicMax, normalized));
      };

      const determineDockSide = () => {
        const panelCenter = lastKnownPosition.left + panel.offsetWidth / 2;
        const viewportCenter = window.innerWidth / 2;
        return panelCenter < viewportCenter ? 'left' : 'right';
      };

      const getPanelBounds = () => {
        const availableWidth = window.innerWidth - PANEL_MARGIN * 2;
        const availableHeight = window.innerHeight - PANEL_MARGIN * 2;
        const maxWidth = Math.max(PANEL_MIN_WIDTH, availableWidth);
        const maxHeight = Math.max(PANEL_MIN_HEIGHT, availableHeight);
        return {
          minWidth: PANEL_MIN_WIDTH,
          minHeight: PANEL_MIN_HEIGHT,
          maxWidth,
          maxHeight
        };
      };

      const syncPanelLayout = () => {
        const width = panel.offsetWidth;
        panel.classList.toggle('is-narrow', width < 620);
        panel.classList.toggle('is-compact', width < 520);
      };

      const applyEdgeHiddenPosition = () => {
        if (!floatingPanel) {
          return;
        }
        const shouldHide = panelEdgeState.isHidden && !isPanelPinned;
        panel.classList.toggle('is-edge-left', panelEdgeState.side === 'left');
        panel.classList.toggle('is-edge-right', panelEdgeState.side === 'right');
        if (!shouldHide) {
          panelEdgeState.isHidden = false;
          panel.classList.remove('is-edge-hidden');
          panel.style.left = `${lastKnownPosition.left}px`;
          panel.style.top = `${lastKnownPosition.top}px`;
          panel.style.right = 'auto';
          panel.style.removeProperty('--chaospace-edge-peek');
          return;
        }

        const peek = computeEdgePeek();
        panelEdgeState.peek = peek;
        panel.style.setProperty('--chaospace-edge-peek', `${peek}px`);

        const panelHeight = panel.offsetHeight;
        const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN);
        const safeTop = clamp(lastKnownPosition.top, PANEL_MARGIN, maxTop);
        lastKnownPosition.top = safeTop;
        panel.style.top = `${safeTop}px`;

        let targetLeft;
        if (panelEdgeState.side === 'left') {
          targetLeft = -(panel.offsetWidth - peek);
        } else {
          targetLeft = window.innerWidth - peek;
        }
        panel.style.left = `${targetLeft}px`;
        panel.style.right = 'auto';
        panel.classList.add('is-edge-hidden');
      };

      const showPanelFromEdge = () => {
        if (!panelEdgeState.isHidden) {
          return;
        }
        panelEdgeState.isHidden = false;
        applyEdgeHiddenPosition();
      };

      const hidePanelToEdge = () => {
        if (!floatingPanel || isPanelPinned) {
          return;
        }
        panelEdgeState.side = determineDockSide();
        panelEdgeState.isHidden = true;
        applyEdgeHiddenPosition();
      };

      const scheduleEdgeHide = (delay = EDGE_HIDE_DELAY) => {
        if (!floatingPanel || isPanelPinned) {
          return;
        }
        if (panelHideTimer) {
          clearTimeout(panelHideTimer);
        }
        panelHideTimer = window.setTimeout(() => {
          panelHideTimer = null;
          if (!pointerInsidePanel && floatingPanel && !floatingPanel.matches(':focus-within')) {
            hidePanelToEdge();
          }
        }, Math.max(0, delay));
      };

      const cancelEdgeHide = ({ show = false } = {}) => {
        if (panelHideTimer) {
          clearTimeout(panelHideTimer);
          panelHideTimer = null;
        }
        if (show) {
          showPanelFromEdge();
        }
      };

      const applyPanelSize = (width, height) => {
        const bounds = getPanelBounds();
        const nextWidth = clamp(width, bounds.minWidth, bounds.maxWidth);
        const nextHeight = clamp(height, bounds.minHeight, bounds.maxHeight);
        panel.style.width = `${nextWidth}px`;
        panel.style.height = `${nextHeight}px`;
        lastKnownSize = { width: nextWidth, height: nextHeight };
        syncPanelLayout();
        panelEdgeState.side = determineDockSide();
        applyEdgeHiddenPosition();
        return lastKnownSize;
      };

      const applyPanelPosition = (left, top) => {
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;
        const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - panelWidth - PANEL_MARGIN);
        const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN);
        const fallbackLeft = maxLeft;
        const fallbackTop = PANEL_MARGIN;
        const hasLeft = Number.isFinite(left);
        const hasTop = Number.isFinite(top);
        const safeLeft = clamp(hasLeft ? left : fallbackLeft, PANEL_MARGIN, maxLeft);
        const safeTop = clamp(hasTop ? top : fallbackTop, PANEL_MARGIN, maxTop);
        lastKnownPosition = { left: safeLeft, top: safeTop };
        panel.style.left = `${safeLeft}px`;
        panel.style.top = `${safeTop}px`;
        panel.style.right = 'auto';
        panelEdgeState.side = determineDockSide();
        applyEdgeHiddenPosition();
        return { left: safeLeft, top: safeTop };
      };

      let savedState = {};
      try {
        savedState = await chrome.storage.local.get([POSITION_KEY, SIZE_KEY]);
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          warnStorageInvalidation('Storage read');
        } else {
          console.error('[Chaospace Transfer] Failed to restore panel geometry', error);
        }
        savedState = {};
      }
      const savedSize = savedState[SIZE_KEY];
      if (savedSize && Number.isFinite(savedSize.width) && Number.isFinite(savedSize.height)) {
        applyPanelSize(savedSize.width, savedSize.height);
      } else {
        const bounds = getPanelBounds();
        const fallbackWidth = Math.min(640, bounds.maxWidth);
        const fallbackHeight = Math.min(520, bounds.maxHeight);
        applyPanelSize(fallbackWidth, fallbackHeight);
      }

      const savedPosition = savedState[POSITION_KEY];
      lastKnownPosition = applyPanelPosition(
        savedPosition && Number.isFinite(savedPosition.left) ? savedPosition.left : undefined,
        savedPosition && Number.isFinite(savedPosition.top) ? savedPosition.top : undefined
      );

      panelDom.header = panel.querySelector('.chaospace-float-header');
      panelDom.headerArt = panel.querySelector('[data-role="header-art"]');
      panelDom.headerPoster = panel.querySelector('[data-role="header-poster"]');
      panelDom.showTitle = panel.querySelector('[data-role="show-title"]');
      panelDom.showSubtitle = panel.querySelector('[data-role="show-subtitle"]');
      panelDom.baseDirInput = panel.querySelector('[data-role="base-dir"]');
      panelDom.useTitleCheckbox = panel.querySelector('[data-role="use-title"]');
      panelDom.useSeasonCheckbox = panel.querySelector('[data-role="use-season"]');
      panelDom.seasonRow = panel.querySelector('[data-role="season-row"]');
      panelDom.seasonPathHint = panel.querySelector('[data-role="season-path-hint"]');
      panelDom.pathPreview = panel.querySelector('[data-role="path-preview"]');
      panelDom.presetList = panel.querySelector('[data-role="preset-list"]');
      panelDom.addPresetButton = panel.querySelector('[data-role="add-preset"]');
      panelDom.themeToggle = panel.querySelector('[data-role="theme-toggle"]');
      panelDom.pinBtn = panel.querySelector('[data-role="pin-toggle"]');
      panelDom.minimizeBtn = panel.querySelector('[data-role="minimize"]');
      panelDom.logContainer = panel.querySelector('[data-role="log-container"]');
      panelDom.logList = panel.querySelector('[data-role="log-list"]');
      panelDom.resultSummary = panel.querySelector('[data-role="result-summary"]');
      panelDom.itemsContainer = panel.querySelector('[data-role="items"]');
      panelDom.sortKeySelect = panel.querySelector('[data-role="sort-key"]');
      panelDom.sortOrderButton = panel.querySelector('[data-role="sort-order"]');
      panelDom.historyOverlay = panel.querySelector('[data-role="history-overlay"]');
      panelDom.historyList = panel.querySelector('[data-role="history-list"]');
      panelDom.historyEmpty = panel.querySelector('[data-role="history-empty"]');
      panelDom.historySummary = panel.querySelector('[data-role="history-summary"]');
      panelDom.historySummaryBody = panel.querySelector('[data-role="history-summary-body"]');
      panelDom.historyToggleButtons = Array.from(panel.querySelectorAll('[data-role="history-toggle"]'));
      panelDom.resourceSummary = panel.querySelector('[data-role="resource-summary"]');
      panelDom.resourceTitle = panel.querySelector('[data-role="resource-title"]');
      panelDom.seasonTabs = panel.querySelector('[data-role="season-tabs"]');
      panelDom.transferBtn = panel.querySelector('[data-role="transfer-btn"]');
      panelDom.transferLabel = panel.querySelector('[data-role="transfer-label"]');
      panelDom.transferSpinner = panel.querySelector('[data-role="transfer-spinner"]');
      panelDom.resizeHandle = panel.querySelector('[data-role="resize-handle"]');

      updatePinButton();

      if (panelDom.pinBtn) {
        panelDom.pinBtn.addEventListener('click', () => {
          isPanelPinned = !isPanelPinned;
          updatePinButton();
          if (isPanelPinned) {
            cancelEdgeHide({ show: true });
          } else if (!pointerInsidePanel) {
            scheduleEdgeHide();
          }
        });
      }

      if (panelDom.headerPoster) {
        panelDom.headerPoster.addEventListener('click', () => {
          const src = panelDom.headerPoster.dataset.src;
          if (src) {
            showPosterPreview({
              src,
              alt: panelDom.headerPoster.dataset.alt || panelDom.headerPoster.alt || state.pageTitle || ''
            });
          }
        });
      }

      updatePanelHeader();

      panel.addEventListener('pointerenter', () => {
        pointerInsidePanel = true;
        cancelEdgeHide({ show: true });
      });

      panel.addEventListener('pointerleave', () => {
        pointerInsidePanel = false;
        scheduleEdgeHide();
      });

      panel.addEventListener('focusin', () => {
        cancelEdgeHide({ show: true });
      });

      panel.addEventListener('focusout', (event) => {
        if (!panel.contains(event.relatedTarget)) {
          scheduleEdgeHide();
        }
      });
      applyPanelTheme();
      updateMinimizeButton();

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

      const toolbar = panel.querySelector('.chaospace-select-group');
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
            const list = panelDom.historyList.querySelector(`[data-role="history-season-list"][data-group-key="${groupKey}"]`);
            if (list) {
              list.hidden = !isExpanded;
            }
            const container = seasonToggle.closest('.chaospace-history-item');
            if (container) {
              container.classList.toggle('is-season-expanded', isExpanded);
            }
            event.preventDefault();
            return;
          }

          const actionButton = event.target.closest('button[data-action]');
          if (!actionButton) {
            return;
          }

          const action = actionButton.dataset.action;
          if (action === 'preview-poster') {
            if (!actionButton.disabled) {
              const src = actionButton.dataset.src;
              if (src) {
                showPosterPreview({
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
          } else if (action === 'check') {
            if (url) {
              triggerHistoryUpdate(url, actionButton);
            }
          }
        });
      }

      panel.addEventListener('click', event => {
        const toggleBtn = event.target.closest('[data-role="history-toggle"]');
        if (!toggleBtn || !panel.contains(toggleBtn)) {
          return;
        }
        if (!state.historyGroups.length) {
          return;
        }
        state.historyExpanded = !state.historyExpanded;
        renderHistoryCard();
      });

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

      // 迷你窗口的路径输入和保存按钮
      const miniPathInput = panel.querySelector('[data-role="mini-path"]');
      const miniSaveBtn = panel.querySelector('[data-role="mini-save"]');

      if (miniPathInput && miniSaveBtn) {
        // 同步当前路径到迷你窗口
        miniPathInput.value = state.baseDir;

        // 保存按钮点击
        miniSaveBtn.addEventListener('click', async () => {
          const targetPath = normalizeDir(miniPathInput.value);
          if (!targetPath) {
            showToast('warning', '路径无效', '请输入有效的保存路径');
            return;
          }

          // 获取选中的资源
          const selectedItems = state.items.filter(item => state.selectedIds.has(item.id));
          if (!selectedItems.length) {
            showToast('warning', '未选择资源', '请在展开窗口中选择要保存的资源');
            // 自动展开窗口
            isMinimized = false;
            panel.classList.remove('minimized');
            updateMinimizeButton();
            return;
          }

          // 更新状态并保存设置
          state.baseDir = targetPath;
          if (panelDom.baseDirInput) {
            panelDom.baseDirInput.value = targetPath;
          }
          await saveSettings();
          renderPathPreview();

          // 触发转存
          handleTransfer();
        });

        // 输入框回车
        miniPathInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            miniSaveBtn.click();
          }
        });

        // 输入框失焦时同步到主输入框
        miniPathInput.addEventListener('blur', () => {
          const normalized = normalizeDir(miniPathInput.value);
          miniPathInput.value = normalized;
          if (panelDom.baseDirInput) {
            panelDom.baseDirInput.value = normalized;
          }
          state.baseDir = normalized;
          renderPathPreview();
        });
      }

      const header = panel.querySelector('.chaospace-float-header');
      const miniBar = panel.querySelector('.chaospace-float-mini');
      const miniExpandBtn = panel.querySelector('[data-role="mini-expand"]');
      let isDragging = false;
      let isResizing = false;
      let currentX = 0;
      let currentY = 0;
      let initialX = 0;
      let initialY = 0;
      let resizeStartX = 0;
      let resizeStartY = 0;
      let resizeStartWidth = 0;
      let resizeStartHeight = 0;
      let resizeAnchorRight = 0;

      // 拖拽功能 - 适用于标题栏和迷你栏
      const startDrag = (e) => {
        if (e.button !== 0) {
          return;
        }
        if (e.target.closest('button') ||
            e.target.closest('input') ||
            e.target.closest('.chaospace-theme-toggle')) {
          return;
        }
        cancelEdgeHide({ show: true });
        panelEdgeState.isHidden = false;
        pointerInsidePanel = true;
        applyEdgeHiddenPosition();
        isDragging = true;
        const rect = panel.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
        panel.style.transition = 'none';
        document.body.style.userSelect = 'none';
        e.currentTarget.style.cursor = 'grabbing';
      };

      const startResize = (event) => {
        if (event.button !== 0 || !panelDom.resizeHandle) {
          return;
        }
        if (panel.classList.contains('minimized')) {
          return;
        }
        if (!panelDom.resizeHandle.contains(event.target)) {
          return;
        }
        cancelEdgeHide({ show: true });
        panelEdgeState.isHidden = false;
        pointerInsidePanel = true;
        applyEdgeHiddenPosition();
        event.preventDefault();
        event.stopPropagation();
        isResizing = true;
        resizeStartWidth = panel.offsetWidth;
        resizeStartHeight = panel.offsetHeight;
        resizeStartX = event.clientX;
        resizeStartY = event.clientY;
        const rect = panel.getBoundingClientRect();
        resizeAnchorRight = rect.right;
        panel.classList.add('is-resizing');
        panel.style.transition = 'none';
        document.body.style.userSelect = 'none';
      };

      if (header) {
        header.addEventListener('mousedown', startDrag);
      }

      if (miniBar) {
        miniBar.style.cursor = 'grab';
        miniBar.addEventListener('mousedown', startDrag);
      }

      if (panelDom.resizeHandle) {
        panelDom.resizeHandle.addEventListener('mousedown', startResize);
      }

      document.addEventListener('mousemove', (e) => {
        if (isResizing) {
          e.preventDefault();
          const deltaX = resizeStartX - e.clientX;
          const deltaY = e.clientY - resizeStartY;
          const nextSize = applyPanelSize(resizeStartWidth + deltaX, resizeStartHeight + deltaY);
          const targetLeft = resizeAnchorRight - nextSize.width;
          const clampedPosition = applyPanelPosition(targetLeft, lastKnownPosition.top);
          lastKnownPosition = clampedPosition;
          return;
        }
        if (!isDragging) return;
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        const maxX = Math.max(PANEL_MARGIN, window.innerWidth - panel.offsetWidth - PANEL_MARGIN);
        const maxY = Math.max(PANEL_MARGIN, window.innerHeight - panel.offsetHeight - PANEL_MARGIN);
        currentX = clamp(currentX, PANEL_MARGIN, maxX);
        currentY = clamp(currentY, PANEL_MARGIN, maxY);
        panel.style.left = currentX + 'px';
        panel.style.top = currentY + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';
        lastKnownPosition = { left: currentX, top: currentY };
      });

      document.addEventListener('mouseup', () => {
        let shouldRestoreSelection = false;
        if (isDragging) {
          isDragging = false;
          panel.style.transition = '';
          if (header) header.style.cursor = 'move';
          if (miniBar) miniBar.style.cursor = 'grab';
          safeStorageSet({
            [POSITION_KEY]: lastKnownPosition
          }, 'panel position');
          shouldRestoreSelection = true;
        }
        if (isResizing) {
          isResizing = false;
          panel.classList.remove('is-resizing');
          panel.style.transition = '';
          const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
          lastKnownPosition = clampedPosition;
          safeStorageSet({
            [SIZE_KEY]: lastKnownSize,
            [POSITION_KEY]: lastKnownPosition
          }, 'panel geometry');
          shouldRestoreSelection = true;
        }
        if (shouldRestoreSelection) {
          document.body.style.userSelect = '';
        }
      });

      const handleWindowResize = () => {
        if (!floatingPanel) {
          return;
        }
        if (panel.classList.contains('minimized')) {
          const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
          lastKnownPosition = clampedPosition;
          safeStorageSet({
            [POSITION_KEY]: lastKnownPosition
          }, 'panel position');
          return;
        }
        const sourceWidth = lastKnownSize?.width ?? panel.offsetWidth;
        const sourceHeight = lastKnownSize?.height ?? panel.offsetHeight;
        applyPanelSize(sourceWidth, sourceHeight);
        const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
        lastKnownPosition = clampedPosition;
        safeStorageSet({
          [SIZE_KEY]: lastKnownSize,
          [POSITION_KEY]: lastKnownPosition
        }, 'panel geometry');
      };

      window.addEventListener('resize', handleWindowResize);
      detachWindowResize = () => {
        window.removeEventListener('resize', handleWindowResize);
      };

      if (miniExpandBtn) {
        miniExpandBtn.addEventListener('click', () => {
          if (!isMinimized) {
            return;
          }
          isMinimized = false;
          panel.classList.remove('minimized');
          const restoreWidth = lastKnownSize?.width ?? panel.offsetWidth;
          const restoreHeight = lastKnownSize?.height ?? panel.offsetHeight;
          applyPanelSize(restoreWidth, restoreHeight);
          const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
          lastKnownPosition = clampedPosition;
          safeStorageSet({
            [SIZE_KEY]: lastKnownSize,
            [POSITION_KEY]: lastKnownPosition
          }, 'panel geometry');
          updateMinimizeButton();
          cancelEdgeHide({ show: true });
          if (!isPanelPinned) {
            scheduleEdgeHide();
          }
          if (panelDom.baseDirInput) {
            panelDom.baseDirInput.focus();
          }
        });
      }

      if (panelDom.transferBtn) {
        panelDom.transferBtn.addEventListener('click', handleTransfer);
      }

      if (panelDom.minimizeBtn) {
        panelDom.minimizeBtn.addEventListener('click', () => {
          isMinimized = !isMinimized;
          if (isMinimized) {
            panelEdgeState.isHidden = false;
            panel.classList.add('minimized');
            panel.style.removeProperty('width');
            panel.style.removeProperty('height');
          } else {
            panel.classList.remove('minimized');
            const restoreWidth = lastKnownSize?.width ?? panel.offsetWidth;
            const restoreHeight = lastKnownSize?.height ?? panel.offsetHeight;
            applyPanelSize(restoreWidth, restoreHeight);
            const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
            lastKnownPosition = clampedPosition;
            safeStorageSet({
              [SIZE_KEY]: lastKnownSize,
              [POSITION_KEY]: lastKnownPosition
            }, 'panel geometry');
          }
          cancelEdgeHide({ show: true });
          if (!isPanelPinned && !pointerInsidePanel) {
            scheduleEdgeHide();
          }
          updateMinimizeButton();
        });
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
      if (!isPanelPinned) {
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
  }

  function toggleFloatingPanel() {
    if (floatingPanel) {
      if (detachWindowResize) {
        detachWindowResize();
        detachWindowResize = null;
      }
      closePosterPreview();
      floatingPanel.remove();
      floatingPanel = null;
      if (panelHideTimer) {
        clearTimeout(panelHideTimer);
        panelHideTimer = null;
      }
      state.deferredSeasonInfos = [];
      state.isSeasonLoading = false;
      state.seasonLoadProgress = { total: 0, loaded: 0 };
      state.seasonEntries = [];
      state.historyGroups = [];
      state.historySeasonExpanded = new Set();
      deferredSeasonLoaderRunning = false;
      document.body.style.userSelect = '';
      isMinimized = false;
      lastKnownSize = null;
      panelEdgeState = { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK };
      pointerInsidePanel = false;
      isPanelPinned = false;
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

  function isSupportedDetailPage() {
    return isSeasonPage() || /\/movies\/\d+\.html/.test(window.location.pathname) || isTvShowPage();
  }

  function init() {
    if (!isSupportedDetailPage()) {
      return;
    }

    try {
      injectStyles();

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(createFloatingPanel, 800);
        });
      } else {
        setTimeout(createFloatingPanel, 800);
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
              const data = await collectLinks();
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
      collectLinks()
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
})();
