(() => {
  const STORAGE_KEY = 'chaospace-transfer-settings';
  const POSITION_KEY = 'chaospace-panel-position';
  const SIZE_KEY = 'chaospace-panel-size';
  const DEFAULT_PRESETS = ['/视频/番剧', '/视频/影视', '/视频/电影'];
  const MAX_LOG_ENTRIES = 80;
  const HISTORY_KEY = 'chaospace-transfer-history';
  const HISTORY_DISPLAY_LIMIT = 6;

  const state = {
    baseDir: '/',
    useTitleSubdir: true,
    presets: [...DEFAULT_PRESETS],
    items: [],
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
    historyRecords: [],
    currentHistory: null,
    transferredIds: new Set(),
    newItemIds: new Set(),
    historyExpanded: false
  };

  const panelDom = {};

  let floatingPanel = null;
  let currentToast = null;
  let isMinimized = false;
  let lastKnownSize = null;
  let detachWindowResize = null;

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

  // 从页面标题提取剧集名称
  function getPageCleanTitle() {
    const pageTitle = document.title;

    // 移除网站名称后缀（如 " - CHAOSPACE", " – CHAOSPACE"）
    let title = pageTitle.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, '');

    return extractCleanTitle(title);
  }

  // 只查找百度网盘链接（在 #download 区域）
  function locateBaiduPanRows() {
    const downloadSection = document.getElementById('download');
    if (!downloadSection) {
      return [];
    }

    const selector = 'table tbody tr[id^="link-"]';
    const rows = Array.from(downloadSection.querySelectorAll(selector));

    return rows;
  }

  function extractLinkInfo(row) {
    const anchor = row.querySelector('a[href*="/links/"]');
    if (!anchor) {
      return null;
    }

    const idMatch = anchor.href.match(/\/links\/(\d+)\.html/);
    if (!idMatch) {
      return null;
    }

    const qualityCell = row.querySelector('.quality');
    const cells = Array.from(row.children);

    const rawTitle = anchor.textContent.replace(/\s+/g, ' ').trim();
    const cleanTitle = extractCleanTitle(rawTitle);
    const quality = qualityCell ? qualityCell.textContent.trim() : (cells[1] ? cells[1].textContent.trim() : '');
    const subtitle = cells[2] ? cells[2].textContent.trim() : '';

    return {
      id: idMatch[1],
      href: anchor.href,
      title: cleanTitle,
      rawTitle: rawTitle,
      quality,
      subtitle
    };
  }

  function resolveAbsoluteUrl(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    try {
      return new URL(trimmed, window.location.href).href;
    } catch (_error) {
      return '';
    }
  }

  function parseSrcset(value) {
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
        return {
          url: resolveAbsoluteUrl(urlPart),
          score
        };
      })
      .filter(item => Boolean(item.url));
  }

  function pickImageSource(img) {
    if (!img) {
      return '';
    }

    const fromCurrent = resolveAbsoluteUrl(img.currentSrc || img.src || '');
    const srcsetCandidates = [
      ...parseSrcset(img.getAttribute('data-srcset')),
      ...parseSrcset(img.getAttribute('srcset'))
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
      const absolute = resolveAbsoluteUrl(candidate || '');
      if (absolute) {
        return absolute;
      }
    }

    return fromCurrent;
  }

  function extractPosterDetails() {
    const img =
      document.querySelector('.poster img') ||
      document.querySelector('.post-thumbnail img') ||
      document.querySelector('article img');
    if (!img) {
      return null;
    }

    const src = pickImageSource(img);
    if (!src) {
      return null;
    }

    const altRaw = (img.getAttribute('alt') || '').trim();
    const alt = altRaw ? extractCleanTitle(altRaw) : getPageCleanTitle();
    const anchor = img.closest('a');
    const href = anchor ? resolveAbsoluteUrl(anchor.getAttribute('href') || anchor.href || '') : '';

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

  function collectLinks() {
    try {
      const rows = locateBaiduPanRows();
      const items = rows
        .map((row, index) => {
          const info = extractLinkInfo(row);
          if (!info) {
            return null;
          }
          return { ...info, order: index };
        })
        .filter(Boolean);

      return {
        items,
        url: window.location.href,
        origin: window.location.origin,
        title: getPageCleanTitle(),
        poster: extractPosterDetails()
      };
    } catch (error) {
      console.error('[Chaospace] Failed to collect links:', error);
      return {
        items: [],
        url: window.location.href || '',
        origin: window.location.origin || '',
        title: '',
        poster: null
      };
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
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          baseDir: state.baseDir,
          useTitleSubdir: state.useTitleSubdir,
          presets: state.presets,
          theme: state.theme
        }
      });
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to persist settings', error);
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

  function prepareHistoryRecords(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.records)) {
      return [];
    }
    return raw.records
      .map(record => {
        const safe = record || {};
        if (!safe.items || typeof safe.items !== 'object') {
          safe.items = {};
        }
        return safe;
      })
      .sort((a, b) => {
        const tsA = a.lastTransferredAt || a.lastCheckedAt || 0;
        const tsB = b.lastTransferredAt || b.lastCheckedAt || 0;
        return tsB - tsA;
      });
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

    const limit = state.historyExpanded ? state.historyRecords.length : HISTORY_DISPLAY_LIMIT;
    const entries = state.historyRecords.slice(0, limit);
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

    entries.forEach(record => {
      const item = document.createElement('div');
      item.className = 'chaospace-history-item';
      const recordUrl = normalizePageUrl(record.pageUrl);
      if (recordUrl === currentUrl) {
        item.classList.add('is-current');
      }

      const main = document.createElement('div');
      main.className = 'chaospace-history-main';

      const title = document.createElement('div');
      title.className = 'chaospace-history-title';
      title.textContent = record.pageTitle || '未命名资源';
      main.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'chaospace-history-meta';
      const typeLabel = record.pageType === 'series'
        ? '剧集'
        : (record.pageType === 'movie' ? '电影' : '资源');
      const timeLabel = formatHistoryTimestamp(record.lastTransferredAt || record.lastCheckedAt);
      const total = record.totalTransferred || Object.keys(record.items || {}).length || 0;
      const targetDir = record.targetDirectory || '';

      const metaParts = [
        typeLabel,
        total ? `共 ${total} 项` : ''
      ].filter(Boolean);
      if (timeLabel) {
        metaParts.push(`更新于 ${timeLabel}`);
      }
      if (targetDir) {
        metaParts.push(targetDir);
      }
      meta.textContent = metaParts.join(' · ');
      main.appendChild(meta);
      item.appendChild(main);

      const actions = document.createElement('div');
      actions.className = 'chaospace-history-actions';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.dataset.action = 'open';
      openBtn.dataset.url = record.pageUrl;
      openBtn.className = 'chaospace-history-action chaospace-history-action-open';
      openBtn.textContent = '进入资源';
      actions.appendChild(openBtn);

      if (record.pageType === 'series') {
        const checkBtn = document.createElement('button');
        checkBtn.type = 'button';
        checkBtn.dataset.action = 'check';
        checkBtn.dataset.url = record.pageUrl;
        checkBtn.className = 'chaospace-history-action chaospace-history-action-check';
        checkBtn.textContent = '检测新篇';
        actions.appendChild(checkBtn);
      }

      item.appendChild(actions);
      panelDom.historyList.appendChild(item);
    });

    const summaryRecord = entries.find(record => normalizePageUrl(record.pageUrl) !== currentUrl);
    if (summaryRecord) {
      const timeLabel = formatHistoryTimestamp(summaryRecord.lastTransferredAt || summaryRecord.lastCheckedAt);
      const total = summaryRecord.totalTransferred || Object.keys(summaryRecord.items || {}).length || 0;
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
      title.textContent = summaryRecord.pageTitle || '未命名资源';
      summary.appendChild(title);

      const metaParts = [];
      if (timeLabel) metaParts.push(timeLabel);
      if (total) metaParts.push(`${total} 项`);
      if (summaryRecord.targetDirectory) metaParts.push(summaryRecord.targetDirectory);

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

    if (!state.historyRecords.length && state.historyExpanded) {
      state.historyExpanded = false;
    }

    const expanded = Boolean(state.historyExpanded && state.historyRecords.length);
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
      state.historyRecords = prepareHistoryRecords(stored[HISTORY_KEY]);
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to load history', error);
      state.historyRecords = [];
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
        showToast('success', '无需转存', '所有剧集都已同步 ✅');
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
        button.disabled = false;
        button.textContent = previousText || '检测更新';
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
      panelDom.themeToggle.textContent = isLight ? '切换深色 🌙' : '切换浅色 ☀️';
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
    panelDom.pathPreview.textContent = `📂 当前将保存到：${targetPath}`;
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

  function renderResourceSummary() {
    if (!panelDom.resourceSummary) {
      return;
    }
    const total = state.items.length;
    const selected = state.selectedIds.size;
    const parts = [`🧾 已选 ${selected} / ${total}`];
    if (state.newItemIds.size) {
      parts.push(`新增 ${state.newItemIds.size}`);
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
    const container = panelDom.itemsContainer;
    container.innerHTML = '';

    if (!state.items.length) {
      const empty = document.createElement('div');
      empty.className = 'chaospace-empty';
      empty.textContent = '😅 没有解析到百度网盘资源';
      container.appendChild(empty);
      renderResourceSummary();
      updateTransferButton();
      updatePanelHeader();
      return;
    }

    const sortedItems = sortItems(state.items);
    sortedItems.forEach(item => {
      const isSelected = state.selectedIds.has(item.id);
      const isTransferred = state.transferredIds.has(item.id);
      const isNew = state.currentHistory && state.newItemIds.has(item.id);
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
      if (item.quality) {
        detailBadges.push(`<span class="chaospace-badge">画质：${item.quality}</span>`);
      }
      if (item.subtitle) {
        detailBadges.push(`<span class="chaospace-badge">字幕：${item.subtitle}</span>`);
      }
      const metaBadges = [...statusBadges, ...detailBadges].join('');
      const row = document.createElement('label');
      row.className = 'chaospace-item';
      row.dataset.id = item.id;
      row.innerHTML = `
        <input type="checkbox" class="chaospace-item-checkbox" ${isSelected ? 'checked' : ''} />
        <div class="chaospace-item-body">
          <div class="chaospace-item-title">🔗 ${item.title}</div>
          <div class="chaospace-item-meta">${metaBadges}</div>
        </div>
      `;
      container.appendChild(row);
      requestAnimationFrame(() => {
        row.classList.add('is-visible');
        row.classList.toggle('is-muted', !isSelected);
        row.classList.toggle('is-transferred', isTransferred);
        row.classList.toggle('is-new', isNew);
      });
    });

    renderResourceSummary();
    updateTransferButton();
    updatePanelHeader();
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
    state.selectedIds = selected ? new Set(state.items.map(item => item.id)) : new Set();
    renderResourceList();
  }

  function invertSelection() {
    const next = new Set();
    state.items.forEach(item => {
      if (!state.selectedIds.has(item.id)) {
        next.add(item.id);
      }
    });
    state.selectedIds = next;
    renderResourceList();
  }

  function setPanelControlsDisabled(disabled) {
    if (panelDom.baseDirInput) panelDom.baseDirInput.disabled = disabled;
    if (panelDom.useTitleCheckbox) panelDom.useTitleCheckbox.disabled = disabled;
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
          targetPath: targetDirectory
        })),
        targetDirectory,
        meta: {
          total: selectedItems.length,
          baseDir: state.baseDir,
          useTitleSubdir: state.useTitleSubdir,
          pageTitle: state.pageTitle,
          pageUrl: state.pageUrl || normalizePageUrl(window.location.href),
          pageType: state.items.length > 1 ? 'series' : 'movie',
          targetDirectory,
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
    if (floatingPanel) {
      return;
    }

    if (detachWindowResize) {
      detachWindowResize();
      detachWindowResize = null;
    }
    lastKnownSize = null;

    try {
      await loadSettings();
      await loadHistory({ silent: true });
      applyPanelTheme();

      const data = collectLinks();
      if (!data.items || data.items.length === 0) {
        return;
      }

      state.pageTitle = data.title || '';
       state.pageUrl = normalizePageUrl(data.url || window.location.href);
      state.poster = data.poster || null;
      state.origin = data.origin || window.location.origin;
      state.items = data.items.map((item, index) => ({
        ...item,
        order: typeof item.order === 'number' ? item.order : index
      }));
      state.selectedIds = new Set(state.items.map(item => item.id));
      state.lastResult = null;
      state.transferStatus = 'idle';
      state.statusMessage = '准备就绪 ✨';
      resetLogs();
      applyHistoryToCurrentPage();

      const panel = document.createElement('div');
      panel.className = `chaospace-float-panel chaospace-theme${state.theme === 'light' ? ' theme-light' : ''}`;
      const originLabel = formatOriginLabel(state.origin);
      panel.innerHTML = `
        <div class="chaospace-float-header">
          <div class="chaospace-header-art is-empty" data-role="header-art"></div>
          <div class="chaospace-header-content">
            <div class="chaospace-header-topline">
              <span class="chaospace-assistant-badge">🚀 CHAOSPACE 转存助手</span>
              <div class="chaospace-float-controls">
                <button type="button" class="chaospace-theme-toggle" data-role="theme-toggle">切换浅色 ☀️</button>
                <button type="button" class="chaospace-float-minimize" data-role="minimize" title="折叠">折叠</button>
              </div>
            </div>
            <h2 class="chaospace-show-title" data-role="show-title">${state.pageTitle || '等待选择剧集'}</h2>
            <p class="chaospace-show-subtitle" data-role="show-subtitle">${originLabel ? `来源 ${originLabel}` : '未检测到页面来源'}</p>
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
                    <div class="chaospace-path-preview" data-role="path-preview"></div>
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

      const clamp = (value, min, max) => {
        return Math.min(Math.max(value, min), max);
      };

      const PANEL_MARGIN = 16;
      const PANEL_MIN_WIDTH = 360;
      const PANEL_MIN_HEIGHT = 380;
      const PANEL_MAX_WIDTH = 960;
      const PANEL_MAX_HEIGHT = 840;

      const getPanelBounds = () => {
        const maxWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
        const maxHeight = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, window.innerHeight - PANEL_MARGIN * 2));
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

      const applyPanelSize = (width, height) => {
        const bounds = getPanelBounds();
        const nextWidth = clamp(width, bounds.minWidth, bounds.maxWidth);
        const nextHeight = clamp(height, bounds.minHeight, bounds.maxHeight);
        panel.style.width = `${nextWidth}px`;
        panel.style.height = `${nextHeight}px`;
        lastKnownSize = { width: nextWidth, height: nextHeight };
        syncPanelLayout();
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
        panel.style.left = `${safeLeft}px`;
        panel.style.top = `${safeTop}px`;
        panel.style.right = 'auto';
        panel.style.transform = 'none';
        return { left: safeLeft, top: safeTop };
      };

      let lastKnownPosition = { left: PANEL_MARGIN, top: PANEL_MARGIN };

      const savedState = await chrome.storage.local.get([POSITION_KEY, SIZE_KEY]);
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
      panelDom.showTitle = panel.querySelector('[data-role="show-title"]');
      panelDom.showSubtitle = panel.querySelector('[data-role="show-subtitle"]');
      panelDom.baseDirInput = panel.querySelector('[data-role="base-dir"]');
      panelDom.useTitleCheckbox = panel.querySelector('[data-role="use-title"]');
      panelDom.pathPreview = panel.querySelector('[data-role="path-preview"]');
      panelDom.presetList = panel.querySelector('[data-role="preset-list"]');
      panelDom.addPresetButton = panel.querySelector('[data-role="add-preset"]');
      panelDom.themeToggle = panel.querySelector('[data-role="theme-toggle"]');
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
      panelDom.transferBtn = panel.querySelector('[data-role="transfer-btn"]');
      panelDom.transferLabel = panel.querySelector('[data-role="transfer-label"]');
      panelDom.transferSpinner = panel.querySelector('[data-role="transfer-spinner"]');
      panelDom.resizeHandle = panel.querySelector('[data-role="resize-handle"]');

      updatePanelHeader();
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
          const actionButton = event.target.closest('button[data-action]');
          if (!actionButton) {
            return;
          }
          const url = actionButton.dataset.url;
          const action = actionButton.dataset.action;
          if (!url) {
            return;
          }
          if (action === 'open') {
            window.open(url, '_blank', 'noopener');
          } else if (action === 'check') {
            triggerHistoryUpdate(url, actionButton);
          }
        });
      }

      panel.addEventListener('click', event => {
        const toggleBtn = event.target.closest('[data-role="history-toggle"]');
        if (!toggleBtn || !panel.contains(toggleBtn)) {
          return;
        }
        if (!state.historyRecords.length) {
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
        event.preventDefault();
        event.stopPropagation();
        isResizing = true;
        resizeStartWidth = panel.offsetWidth;
        resizeStartHeight = panel.offsetHeight;
        resizeStartX = event.clientX;
        resizeStartY = event.clientY;
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
          const deltaX = e.clientX - resizeStartX;
          const deltaY = e.clientY - resizeStartY;
          applyPanelSize(resizeStartWidth + deltaX, resizeStartHeight + deltaY);
          const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
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
          chrome.storage.local.set({
            [POSITION_KEY]: lastKnownPosition
          });
          shouldRestoreSelection = true;
        }
        if (isResizing) {
          isResizing = false;
          panel.classList.remove('is-resizing');
          panel.style.transition = '';
          const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
          lastKnownPosition = clampedPosition;
          chrome.storage.local.set({
            [SIZE_KEY]: lastKnownSize,
            [POSITION_KEY]: lastKnownPosition
          });
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
          chrome.storage.local.set({
            [POSITION_KEY]: lastKnownPosition
          });
          return;
        }
        const sourceWidth = lastKnownSize?.width ?? panel.offsetWidth;
        const sourceHeight = lastKnownSize?.height ?? panel.offsetHeight;
        applyPanelSize(sourceWidth, sourceHeight);
        const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
        lastKnownPosition = clampedPosition;
        chrome.storage.local.set({
          [SIZE_KEY]: lastKnownSize,
          [POSITION_KEY]: lastKnownPosition
        });
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
          chrome.storage.local.set({
            [SIZE_KEY]: lastKnownSize,
            [POSITION_KEY]: lastKnownPosition
          });
          updateMinimizeButton();
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
            chrome.storage.local.set({
              [SIZE_KEY]: lastKnownSize,
              [POSITION_KEY]: lastKnownPosition
            });
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
    } catch (error) {
      console.error('[Chaospace] Failed to create floating panel:', error);
      showToast('error', '创建面板失败', error.message);
    }
  }

  function toggleFloatingPanel() {
    if (floatingPanel) {
      if (detachWindowResize) {
        detachWindowResize();
        detachWindowResize = null;
      }
      floatingPanel.remove();
      floatingPanel = null;
      document.body.style.userSelect = '';
      isMinimized = false;
      lastKnownSize = null;
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

  function isSeasonPage() {
    return /\/seasons\/\d+\.html/.test(window.location.pathname);
  }

  function init() {
    if (!isSeasonPage()) {
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

        observerTimeout = setTimeout(() => {
          try {
            if (!floatingPanel) {
              const data = collectLinks();
              if (data.items && data.items.length > 0) {
                createFloatingPanel();
              }
            }
          } catch (error) {
            console.error('[Chaospace] Observer error:', error);
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
      state.historyRecords = prepareHistoryRecords(historyChange.newValue);
      applyHistoryToCurrentPage();
      renderHistoryCard();
      if (floatingPanel) {
        renderResourceList();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'chaospace:collect-links') {
      try {
        sendResponse(collectLinks());
      } catch (error) {
        console.error('[Chaospace] Message handler error:', error);
        sendResponse({ items: [], url: '', origin: '', title: '', poster: null });
      }
      return false;
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
