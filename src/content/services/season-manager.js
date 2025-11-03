import {
  ALL_SEASON_TAB_ID,
  NO_SEASON_TAB_ID
} from '../constants.js';
import { state, panelDom } from '../state/index.js';
import {
  normalizeDir,
  sanitizeSeasonDirSegment,
  deriveSeasonDirectory
} from './page-analyzer.js';
import { extractCleanTitle } from '../utils/title.js';

function isTvShowPage() {
  return /\/tvshows\/\d+\.html/.test(window.location.pathname);
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

function getTargetPath(baseDir, useTitleSubdir, pageTitle) {
  const normalizedBase = normalizeDir(baseDir);
  let targetDirectory = normalizedBase || '/';

  if (useTitleSubdir && pageTitle) {
    const cleanTitle = extractCleanTitle(pageTitle);
    targetDirectory = normalizedBase === '/' ? `/${cleanTitle}` : `${normalizedBase}/${cleanTitle}`;
  }

  return targetDirectory;
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

export {
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
};

