(() => {
  const STORAGE_KEY = 'chaospace-transfer-settings';
  const POSITION_KEY = 'chaospace-panel-position';
  const DEFAULT_PRESETS = ['/视频/番剧', '/视频/影视', '/视频/电影'];
  const MAX_LOG_ENTRIES = 80;
  const LOG_COLLAPSED_COUNT = 4;

  const state = {
    baseDir: '/',
    useTitleSubdir: true,
    presets: [...DEFAULT_PRESETS],
    items: [],
    sortKey: 'page', // page | title
    sortOrder: 'asc', // asc | desc
    selectedIds: new Set(),
    pageTitle: '',
    origin: '',
    jobId: null,
    logs: [],
    logExpanded: false,
    transferStatus: 'idle', // idle | running | success | error
    lastResult: null,
    statusMessage: '准备就绪 ✨',
    theme: 'dark'
  };

  const panelDom = {};

  let floatingPanel = null;
  let currentToast = null;
  let isMinimized = false;

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
        title: getPageCleanTitle()
      };
    } catch (error) {
      console.error('[Chaospace] Failed to collect links:', error);
      return {
        items: [],
        url: window.location.href || '',
        origin: window.location.origin || '',
        title: ''
      };
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

  function formatTime(date) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(date);
    } catch (_error) {
      // 兼容部分环境
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    }
  }

  function resetLogs() {
    state.logs = [];
    renderLogs();
  }

  function pushLog(message, { level = 'info', detail = '', stage = '' } = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      time: new Date(),
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
    const container = panelDom.logList;
    container.innerHTML = '';

    const entries = state.logExpanded ? state.logs : state.logs.slice(-LOG_COLLAPSED_COUNT);
    if (!entries.length) {
      panelDom.logContainer?.classList.add('is-empty');
      if (panelDom.toggleLogButton) {
        panelDom.toggleLogButton.textContent = state.logExpanded ? '折叠日志' : '展开日志';
      }
      return;
    }
    panelDom.logContainer?.classList.remove('is-empty');

    entries.forEach(entry => {
      const li = document.createElement('li');
      li.className = `chaospace-log-item chaospace-log-${entry.level}`;
      li.dataset.logId = entry.id;
      li.innerHTML = `
        <span class="chaospace-log-time">${formatTime(entry.time)}</span>
        <span class="chaospace-log-message">${entry.message}</span>
        ${entry.detail ? `<span class="chaospace-log-detail">${entry.detail}</span>` : ''}
      `;
      container.appendChild(li);
      requestAnimationFrame(() => {
        li.classList.add('is-visible');
      });
    });

    if (panelDom.toggleLogButton) {
      panelDom.toggleLogButton.textContent = state.logExpanded ? '折叠日志' : '展开日志';
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
    if (!panelDom.statusText) {
      return;
    }
    const emojiMap = {
      idle: '🌙',
      running: '⚙️',
      success: '🎉',
      error: '⚠️'
    };
    const emoji = emojiMap[state.transferStatus] || 'ℹ️';
    panelDom.statusText.innerHTML = `<span class="chaospace-status-emoji">${emoji}</span>${state.statusMessage}`;

    if (panelDom.miniStatus) {
      panelDom.miniStatus.textContent = `${emoji} ${state.statusMessage}`;
    }

    if (panelDom.resultSummary) {
      if (!state.lastResult) {
        panelDom.resultSummary.innerHTML = '';
        panelDom.resultSummary.classList.add('is-empty');
      } else {
        panelDom.resultSummary.classList.remove('is-empty');
        panelDom.resultSummary.innerHTML = `
          <div class="chaospace-result-heading">${state.lastResult.title}</div>
          <div class="chaospace-result-detail">${state.lastResult.detail}</div>
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
    panelDom.resourceSummary.textContent = `🧾 已选 ${selected} / ${total}`;
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
      return;
    }

    const sortedItems = sortItems(state.items);
    sortedItems.forEach(item => {
      const isSelected = state.selectedIds.has(item.id);
      const row = document.createElement('label');
      row.className = 'chaospace-item';
      row.dataset.id = item.id;
      row.innerHTML = `
        <input type="checkbox" class="chaospace-item-checkbox" ${isSelected ? 'checked' : ''} />
        <div class="chaospace-item-body">
          <div class="chaospace-item-title">🔗 ${item.title}</div>
          <div class="chaospace-item-meta">
            ${item.quality ? `<span class="chaospace-badge">画质：${item.quality}</span>` : ''}
            ${item.subtitle ? `<span class="chaospace-badge">字幕：${item.subtitle}</span>` : ''}
          </div>
        </div>
      `;
      container.appendChild(row);
      requestAnimationFrame(() => {
        row.classList.add('is-visible');
        row.classList.toggle('is-muted', !isSelected);
      });
    });

    renderResourceSummary();
    updateTransferButton();
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
          pageTitle: state.pageTitle
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

    try {
      await loadSettings();
      applyPanelTheme();

      const data = collectLinks();
      if (!data.items || data.items.length === 0) {
        return;
      }

      state.pageTitle = data.title || '';
      state.origin = data.origin || window.location.origin;
      state.items = data.items.map((item, index) => ({
        ...item,
        order: typeof item.order === 'number' ? item.order : index
      }));
      state.selectedIds = new Set(state.items.map(item => item.id));
      state.lastResult = null;
      state.transferStatus = 'idle';
      state.statusMessage = '准备就绪 ✨';
      state.logExpanded = false;
      resetLogs();

      const panel = document.createElement('div');
      panel.className = `chaospace-float-panel chaospace-theme${state.theme === 'light' ? ' theme-light' : ''}`;
      panel.innerHTML = `
        <div class="chaospace-float-header">
          <div class="chaospace-header-text">
            <h2 class="chaospace-float-title">🚀 CHAOSPACE 转存助手</h2>
            <p class="chaospace-float-subtitle">${state.pageTitle ? `🎬 ${state.pageTitle}` : '等待选择剧集'}</p>
          </div>
          <div class="chaospace-float-controls">
            <button type="button" class="chaospace-theme-toggle" data-role="theme-toggle">切换浅色 ☀️</button>
            <button type="button" class="chaospace-float-minimize" data-role="minimize" title="折叠">折叠</button>
          </div>
        </div>
        <div class="chaospace-float-body">
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
                <div class="chaospace-card-title">🧠 转存状态</div>
                <div class="chaospace-status-line" data-role="status"></div>
                <div class="chaospace-log-header">
                  <span>📜 日志</span>
                  <button type="button" data-role="toggle-log">展开</button>
                </div>
                <div class="chaospace-log-container" data-role="log-container">
                  <ul class="chaospace-log-list" data-role="log-list"></ul>
                </div>
                <div class="chaospace-result-summary is-empty" data-role="result-summary"></div>
              </div>
              <div class="chaospace-card chaospace-transfer-card">
                <button class="chaospace-float-btn" data-role="transfer-btn">
                  <span class="chaospace-btn-spinner" data-role="transfer-spinner"></span>
                  <span data-role="transfer-label">开始转存</span>
                  <span class="chaospace-btn-icon">🚀</span>
                </button>
              </div>
            </section>
          </div>
        </div>
        <div class="chaospace-float-mini">
          <div class="chaospace-mini-title">🚀 CHAOSPACE</div>
          <div class="chaospace-mini-status" data-role="mini-status"></div>
          <button type="button" class="chaospace-mini-expand">展开</button>
        </div>
      `;

      document.body.appendChild(panel);
      floatingPanel = panel;

      const clamp = (value, min, max) => {
        return Math.min(Math.max(value, min), max);
      };

      const PANEL_MARGIN = 16;

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

      let lastKnownPosition = applyPanelPosition();

      panelDom.baseDirInput = panel.querySelector('[data-role="base-dir"]');
      panelDom.useTitleCheckbox = panel.querySelector('[data-role="use-title"]');
      panelDom.pathPreview = panel.querySelector('[data-role="path-preview"]');
      panelDom.presetList = panel.querySelector('[data-role="preset-list"]');
      panelDom.addPresetButton = panel.querySelector('[data-role="add-preset"]');
      panelDom.themeToggle = panel.querySelector('[data-role="theme-toggle"]');
      panelDom.minimizeBtn = panel.querySelector('[data-role="minimize"]');
      panelDom.toggleLogButton = panel.querySelector('[data-role="toggle-log"]');
      panelDom.logContainer = panel.querySelector('[data-role="log-container"]');
      panelDom.logList = panel.querySelector('[data-role="log-list"]');
      panelDom.resultSummary = panel.querySelector('[data-role="result-summary"]');
      panelDom.itemsContainer = panel.querySelector('[data-role="items"]');
      panelDom.sortKeySelect = panel.querySelector('[data-role="sort-key"]');
      panelDom.sortOrderButton = panel.querySelector('[data-role="sort-order"]');
      panelDom.resourceSummary = panel.querySelector('[data-role="resource-summary"]');
      panelDom.resourceTitle = panel.querySelector('[data-role="resource-title"]');
      panelDom.transferBtn = panel.querySelector('[data-role="transfer-btn"]');
      panelDom.transferLabel = panel.querySelector('[data-role="transfer-label"]');
      panelDom.transferSpinner = panel.querySelector('[data-role="transfer-spinner"]');
      panelDom.miniStatus = panel.querySelector('[data-role="mini-status"]');
      panelDom.statusText = panel.querySelector('[data-role="status"]');

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
          }
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

      if (panelDom.toggleLogButton) {
        panelDom.toggleLogButton.addEventListener('click', () => {
          state.logExpanded = !state.logExpanded;
          panelDom.logContainer?.classList.toggle('is-expanded', state.logExpanded);
          renderLogs();
        });
      }

      const miniExpand = panel.querySelector('.chaospace-mini-expand');
      if (miniExpand) {
        miniExpand.addEventListener('click', () => {
          isMinimized = false;
          panel.classList.remove('minimized');
          updateMinimizeButton();
        });
      }

      const header = panel.querySelector('.chaospace-float-header');
      let isDragging = false;
      let currentX = 0;
      let currentY = 0;
      let initialX = 0;
      let initialY = 0;

      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.chaospace-float-minimize') || e.target.closest('.chaospace-theme-toggle')) {
          return;
        }
        isDragging = true;
        const rect = panel.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
        panel.style.transition = 'none';
        header.style.cursor = 'grabbing';
      });

      document.addEventListener('mousemove', (e) => {
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
        panel.style.transform = 'none';
        lastKnownPosition = { left: currentX, top: currentY };
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          panel.style.transition = '';
          header.style.cursor = 'move';
          chrome.storage.local.set({
            [POSITION_KEY]: lastKnownPosition
          });
        }
      });

      if (panelDom.transferBtn) {
        panelDom.transferBtn.addEventListener('click', handleTransfer);
      }

      if (panelDom.minimizeBtn) {
        panelDom.minimizeBtn.addEventListener('click', () => {
          isMinimized = !isMinimized;
          panel.classList.toggle('minimized', isMinimized);
          updateMinimizeButton();
        });
      }

      const savedPosition = await chrome.storage.local.get(POSITION_KEY);
      if (savedPosition[POSITION_KEY]) {
        const pos = savedPosition[POSITION_KEY];
        lastKnownPosition = applyPanelPosition(pos.left, pos.top);
      }

      renderPresets();
      renderPathPreview();
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
      floatingPanel.remove();
      floatingPanel = null;
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
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'chaospace:collect-links') {
      try {
        sendResponse(collectLinks());
      } catch (error) {
        console.error('[Chaospace] Message handler error:', error);
        sendResponse({ items: [], url: '', origin: '', title: '' });
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
