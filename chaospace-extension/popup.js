const STORAGE_KEY = 'chaospace-transfer-settings';
const DEFAULT_PRESETS = ['/视频/番剧', '/视频/影视', '/视频/电影'];
const MAX_LOG_ENTRIES = 80;
const LOG_COLLAPSED_COUNT = 4;

const dom = {
  pageInfo: document.getElementById('page-info'),
  itemsTitle: document.getElementById('items-title'),
  selectionSummary: document.getElementById('selection-summary'),
  itemsContainer: document.getElementById('items-container'),
  sortKey: document.getElementById('sort-key'),
  sortOrder: document.getElementById('sort-order'),
  selectAll: document.getElementById('select-all'),
  selectInvert: document.getElementById('select-invert'),
  presetList: document.getElementById('preset-list'),
  baseDir: document.getElementById('base-dir'),
  addPreset: document.getElementById('add-preset'),
  useTitleSubdir: document.getElementById('use-title-subdir'),
  pathPreview: document.getElementById('path-preview'),
  statusLine: document.getElementById('status-line'),
  toggleLog: document.getElementById('toggle-log'),
  logContainer: document.getElementById('log-container'),
  logList: document.getElementById('log-list'),
  resultSummary: document.getElementById('result-summary'),
  transferButton: document.getElementById('transfer-btn'),
  transferLabel: document.getElementById('transfer-label'),
  transferSpinner: document.getElementById('transfer-spinner'),
  messages: document.getElementById('messages'),
  refreshButton: document.getElementById('refresh-btn'),
  themeToggle: document.getElementById('theme-toggle')
};

const state = {
  tabId: null,
  origin: '',
  pageTitle: '',
  items: [],
  baseDir: '/',
  useTitleSubdir: true,
  presets: [...DEFAULT_PRESETS],
  selectedIds: new Set(),
  sortKey: 'page',
  sortOrder: 'asc',
  logs: [],
  logExpanded: false,
  transferStatus: 'idle',
  statusMessage: '准备就绪 ✨',
  jobId: null,
  lastResult: null,
  theme: 'dark'
};

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
      state.presets = Array.from(new Set(merged));
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
  const beforeSize = state.presets.length;
  state.presets = state.presets.filter(item => item !== preset);
  if (state.presets.length === beforeSize) {
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

function formatTime(date) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  } catch (_error) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  }
}

function formatStageLabel(stage) {
  if (!stage) {
    return '—';
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

function clearMessages() {
  if (dom.messages) {
    dom.messages.innerHTML = '';
  }
}

function applyTheme() {
  const isLight = state.theme === 'light';
  document.body.classList.toggle('theme-light', isLight);
  if (dom.themeToggle) {
    dom.themeToggle.textContent = isLight ? '切换深色 🌙' : '切换浅色 ☀️';
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
  applyTheme();
  saveSettings();
}

function showMessage(text, type = 'error') {
  if (!dom.messages) {
    return;
  }
  dom.messages.innerHTML = '';
  const div = document.createElement('div');
  div.className = `popup-message ${type}`;
  div.textContent = text;
  dom.messages.appendChild(div);
}

function renderPageInfo() {
  if (!dom.pageInfo) {
    return;
  }
  if (!state.origin) {
    dom.pageInfo.textContent = '未检测到 CHAOSPACE 页面';
    return;
  }
  const title = state.pageTitle || '当前页面';
  dom.pageInfo.textContent = `${title} · ${state.origin}`;
}

function renderPresets() {
  if (!dom.presetList) {
    return;
  }
  dom.presetList.innerHTML = '';
  const presets = Array.from(new Set(['/', ...state.presets]));
  presets.forEach(preset => {
    const group = document.createElement('div');
    group.className = 'popup-chip-group';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = `popup-chip-button${preset === state.baseDir ? ' is-active' : ''}`;
    selectBtn.textContent = preset;
    selectBtn.dataset.value = preset;
    selectBtn.dataset.action = 'select';
    group.appendChild(selectBtn);

    const isRemovable = preset !== '/' && !DEFAULT_PRESETS.includes(preset);
    if (isRemovable) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'popup-chip-remove';
      removeBtn.dataset.value = preset;
      removeBtn.dataset.action = 'remove';
      removeBtn.setAttribute('aria-label', `移除 ${preset}`);
      removeBtn.textContent = '×';
      group.appendChild(removeBtn);
    }

    dom.presetList.appendChild(group);
  });
}

function getTargetPath(baseDir, useTitleSubdir, pageTitle) {
  const normalizedBase = normalizeDir(baseDir);
  if (!useTitleSubdir) {
    return normalizedBase;
  }
  const title = (pageTitle || '').trim();
  if (!title) {
    return normalizedBase;
  }
  return normalizedBase === '/' ? `/${title}` : `${normalizedBase}/${title}`;
}

function renderPathPreview() {
  if (!dom.pathPreview) {
    return;
  }
  const path = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle);
  dom.pathPreview.textContent = `📂 将保存到：${path}`;
}

function renderSelectionSummary() {
  if (!dom.selectionSummary) {
    return;
  }
  const total = state.items.length;
  const selected = state.selectedIds.size;
  dom.selectionSummary.textContent = `🧾 已选 ${selected} / ${total}`;
  if (dom.itemsTitle) {
    dom.itemsTitle.textContent = `🔍 找到 ${total} 个百度网盘资源`;
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
      const compare = (a.order ?? 0) - (b.order ?? 0);
      return state.sortOrder === 'asc' ? compare : -compare;
    });
  }
  return sorted;
}

function renderItems() {
  if (!dom.itemsContainer) {
    return;
  }
  dom.itemsContainer.innerHTML = '';

  if (!state.items.length) {
    const empty = document.createElement('div');
    empty.className = 'popup-items-empty';
    empty.textContent = '😅 当前页面没有解析到百度网盘资源';
    dom.itemsContainer.appendChild(empty);
    renderSelectionSummary();
    updateTransferButton();
    return;
  }

  const sortedItems = sortItems(state.items);
  sortedItems.forEach(item => {
    const isSelected = state.selectedIds.has(item.id);
    const row = document.createElement('label');
    row.className = 'popup-item';
    row.dataset.id = item.id;
    row.innerHTML = `
      <input type="checkbox" ${isSelected ? 'checked' : ''} />
      <div class="popup-item-body">
        <div class="popup-item-title">🔗 ${item.title}</div>
        <div class="popup-item-meta">
          ${item.quality ? `<span class="popup-badge">画质：${item.quality}</span>` : ''}
          ${item.subtitle ? `<span class="popup-badge">字幕：${item.subtitle}</span>` : ''}
        </div>
      </div>
    `;
    dom.itemsContainer.appendChild(row);
    requestAnimationFrame(() => {
      row.classList.add('is-visible');
      row.classList.toggle('is-muted', !isSelected);
    });
  });

  renderSelectionSummary();
  updateTransferButton();
}

function setSelectionAll(selected) {
  state.selectedIds = selected ? new Set(state.items.map(item => item.id)) : new Set();
  renderItems();
}

function invertSelection() {
  const next = new Set();
  state.items.forEach(item => {
    if (!state.selectedIds.has(item.id)) {
      next.add(item.id);
    }
  });
  state.selectedIds = next;
  renderItems();
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
  if (!dom.logList) {
    return;
  }
  dom.logList.innerHTML = '';
  const entries = state.logExpanded ? state.logs : state.logs.slice(-LOG_COLLAPSED_COUNT);
  if (!entries.length) {
    dom.logContainer?.classList.add('is-empty');
    if (dom.toggleLog) {
      dom.toggleLog.textContent = state.logExpanded ? '折叠日志' : '展开日志';
    }
    return;
  }
  dom.logContainer?.classList.remove('is-empty');
  entries.forEach(entry => {
    const li = document.createElement('li');
    li.className = `popup-log-item popup-log-${entry.level}`;
    li.dataset.logId = entry.id;
    li.dataset.stage = entry.stage || '';
    li.innerHTML = `
      <span class="popup-log-time">${formatTime(entry.time)}</span>
      <span class="popup-log-stage">${formatStageLabel(entry.stage)}</span>
      <span class="popup-log-message">${entry.message}</span>
      ${entry.detail ? `<span class="popup-log-detail">${entry.detail}</span>` : ''}
    `;
    dom.logList.appendChild(li);
    requestAnimationFrame(() => {
      li.classList.add('is-visible');
    });
  });
  if (dom.toggleLog) {
    dom.toggleLog.textContent = state.logExpanded ? '折叠日志' : '展开日志';
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
  if (!dom.statusLine) {
    return;
  }
  const emojiMap = {
    idle: '🌙',
    running: '⚙️',
    success: '🎉',
    error: '⚠️'
  };
  const emoji = emojiMap[state.transferStatus] || 'ℹ️';
  dom.statusLine.innerHTML = `<span>${emoji}</span>${state.statusMessage}`;

  if (dom.resultSummary) {
    if (!state.lastResult) {
      dom.resultSummary.classList.add('is-empty');
      dom.resultSummary.innerHTML = '';
    } else {
      dom.resultSummary.classList.remove('is-empty');
      dom.resultSummary.innerHTML = `
        <div class="popup-result-heading">${state.lastResult.title}</div>
        <div class="popup-result-detail">${state.lastResult.detail}</div>
      `;
    }
  }
}

function updateTransferButton() {
  if (!dom.transferButton || !dom.transferLabel) {
    return;
  }
  const count = state.selectedIds.size;
  const isRunning = state.transferStatus === 'running';
  dom.transferButton.disabled = isRunning || count === 0;
  dom.transferButton.classList.toggle('is-loading', isRunning);
  if (dom.transferSpinner) {
    dom.transferSpinner.classList.toggle('is-visible', isRunning);
  }
  dom.transferLabel.textContent = isRunning ? '正在转存...' : (count > 0 ? `转存选中 ${count} 项` : '请选择资源');
}

function setBaseDir(value, { fromPreset = false } = {}) {
  const normalized = normalizeDir(value);
  state.baseDir = normalized;
  if (dom.baseDir && dom.baseDir.value !== normalized) {
    dom.baseDir.value = normalized;
  }
  if (fromPreset) {
    ensurePreset(normalized);
  }
  saveSettings();
  renderPresets();
  renderPathPreview();
}

function setControlsDisabled(disabled) {
  if (dom.baseDir) dom.baseDir.disabled = disabled;
  if (dom.addPreset) dom.addPreset.disabled = disabled;
  if (dom.useTitleSubdir) dom.useTitleSubdir.disabled = disabled;
  if (dom.sortKey) dom.sortKey.disabled = disabled;
  if (dom.sortOrder) dom.sortOrder.disabled = disabled;
  if (dom.selectAll) dom.selectAll.disabled = disabled;
  if (dom.selectInvert) dom.selectInvert.disabled = disabled;
  if (dom.presetList) dom.presetList.classList.toggle('is-disabled', disabled);
}

function computeTargetDirectory() {
  return getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendMessageToTab(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function clearLogs() {
  state.logs = [];
  renderLogs();
}

function showToast(type, title, message, stats = null) {
  try {
    document.querySelectorAll('.chaospace-toast').forEach(node => node.remove());
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
    setTimeout(() => {
      toast.remove();
    }, 4200);
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to show toast', error);
  }
}

async function refreshItems() {
  clearMessages();
  if (dom.refreshButton) {
    dom.refreshButton.disabled = true;
    dom.refreshButton.textContent = '刷新中...';
  }

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      showMessage('未找到活动标签页。');
      return;
    }

    state.tabId = tab.id;
    const response = await sendMessageToTab(tab.id, { type: 'chaospace:collect-links' });

    if (!response || !Array.isArray(response.items) || !response.items.length) {
      state.items = [];
      state.selectedIds = new Set();
      state.origin = response?.origin || new URL(tab.url || '').origin;
      state.pageTitle = response?.title || tab.title || '';
      renderPageInfo();
      renderItems();
      showMessage('未从页面中解析到资源链接。', 'info');
      return;
    }

    state.origin = response.origin || new URL(tab.url || '').origin;
    state.pageTitle = response.title || tab.title || '';
    state.items = response.items.map((item, index) => ({
      ...item,
      order: typeof item.order === 'number' ? item.order : index
    }));
    state.selectedIds = new Set(state.items.map(item => item.id));

    renderPageInfo();
    renderItems();
    renderPathPreview();
  } catch (error) {
    console.error('[Chaospace Transfer] refresh error', error);
    state.items = [];
    state.selectedIds = new Set();
    renderItems();
    showMessage(`无法获取页面资源：${error.message}`);
  } finally {
    if (dom.refreshButton) {
      dom.refreshButton.disabled = false;
      dom.refreshButton.textContent = '刷新';
    }
  }
}

async function handleTransfer() {
  if (state.transferStatus === 'running') {
    return;
  }

  clearMessages();

  const selectedItems = state.items.filter(item => state.selectedIds.has(item.id));
  if (!selectedItems.length) {
    showMessage('请至少选择一条资源。', 'info');
    return;
  }

  if (dom.baseDir) {
    setBaseDir(dom.baseDir.value);
  }
  if (dom.useTitleSubdir) {
    state.useTitleSubdir = dom.useTitleSubdir.checked;
    saveSettings();
  }

  const targetDirectory = computeTargetDirectory();

  state.jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  state.lastResult = null;
  state.transferStatus = 'running';
  state.statusMessage = '正在准备转存...';
  state.logExpanded = false;
  dom.logContainer?.classList.remove('is-expanded');
  clearLogs();
  pushLog('已准备好资源清单，开始请求后台任务', { stage: 'init' });
  renderStatus();
  updateTransferButton();
  setControlsDisabled(true);

  try {
    const payload = {
      jobId: state.jobId,
      origin: state.origin,
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

    pushLog(`向后台发送 ${selectedItems.length} 条转存请求`, { stage: 'dispatch' });

    const response = await sendRuntimeMessage({
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
    console.error('[Chaospace Transfer] transfer error', error);
    pushLog(error.message || '后台执行发生未知错误', { level: 'error', stage: 'error' });
    setStatus('error', `转存失败：${error.message || '未知错误'}`);
    showToast('error', '转存失败', error.message || '发生未知错误');
  } finally {
    if (state.transferStatus === 'running') {
      setStatus('idle', '准备就绪 ✨');
    }
    updateTransferButton();
    setControlsDisabled(false);
    state.jobId = null;
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

function registerEventListeners() {
  if (dom.refreshButton) {
    dom.refreshButton.addEventListener('click', refreshItems);
  }

  if (dom.selectAll) {
    dom.selectAll.addEventListener('click', () => setSelectionAll(true));
  }

  if (dom.selectInvert) {
    dom.selectInvert.addEventListener('click', () => invertSelection());
  }

  if (dom.themeToggle) {
    dom.themeToggle.addEventListener('click', () => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme);
    });
  }

  if (dom.sortKey) {
    dom.sortKey.addEventListener('change', () => {
      state.sortKey = dom.sortKey.value;
      renderItems();
    });
  }

  if (dom.sortOrder) {
    dom.sortOrder.textContent = state.sortOrder === 'asc' ? '正序' : '倒序';
    dom.sortOrder.addEventListener('click', () => {
      state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
      dom.sortOrder.textContent = state.sortOrder === 'asc' ? '正序' : '倒序';
      renderItems();
    });
  }

  if (dom.itemsContainer) {
    dom.itemsContainer.addEventListener('change', event => {
      const checkbox = event.target.closest('input[type="checkbox"]');
      if (!checkbox) return;
      const row = checkbox.closest('.popup-item');
      if (!row) return;
      const id = row.dataset.id;
      if (!id) return;
      if (checkbox.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      row.classList.toggle('is-muted', !checkbox.checked);
      renderSelectionSummary();
      updateTransferButton();
    });
  }

  if (dom.presetList) {
    dom.presetList.addEventListener('click', event => {
      if (state.transferStatus === 'running') {
        return;
      }
      const button = event.target.closest('button[data-action][data-value]');
      if (!button) return;
      const { action, value } = button.dataset;
      if (action === 'select') {
        setBaseDir(value, { fromPreset: true });
      } else if (action === 'remove') {
        removePreset(value);
      }
    });
  }

  if (dom.baseDir) {
    dom.baseDir.value = state.baseDir;
    dom.baseDir.addEventListener('change', () => setBaseDir(dom.baseDir.value));
    dom.baseDir.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        setBaseDir(dom.baseDir.value);
      }
    });
    dom.baseDir.addEventListener('input', () => {
      state.baseDir = normalizeDir(dom.baseDir.value);
      renderPathPreview();
    });
  }

  if (dom.addPreset) {
    dom.addPreset.addEventListener('click', () => {
      const preset = ensurePreset(dom.baseDir ? dom.baseDir.value : state.baseDir);
      if (preset) {
        setBaseDir(preset, { fromPreset: true });
        showToast('success', '已收藏路径', `${preset} 已加入候选列表`);
      }
    });
  }

  if (dom.useTitleSubdir) {
    dom.useTitleSubdir.checked = state.useTitleSubdir;
    dom.useTitleSubdir.addEventListener('change', () => {
      state.useTitleSubdir = dom.useTitleSubdir.checked;
      saveSettings();
      renderPathPreview();
    });
  }

  if (dom.toggleLog) {
    dom.toggleLog.addEventListener('click', () => {
      state.logExpanded = !state.logExpanded;
      dom.logContainer?.classList.toggle('is-expanded', state.logExpanded);
      renderLogs();
    });
  }

  if (dom.transferButton) {
    dom.transferButton.addEventListener('click', handleTransfer);
  }
}

function registerMessageListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'chaospace:transfer-progress') {
      handleProgressEvent(message);
    }
  });
}

function registerStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    const settingsChange = changes[STORAGE_KEY];
    if (settingsChange?.newValue) {
      const nextTheme = settingsChange.newValue.theme;
      if ((nextTheme === 'light' || nextTheme === 'dark') && nextTheme !== state.theme) {
        state.theme = nextTheme;
        applyTheme();
      }
    }
  });
}

async function init() {
  await loadSettings();
  applyTheme();
  renderPresets();
  renderPathPreview();
  renderStatus();
  renderItems();
  updateTransferButton();
  registerEventListeners();
  registerMessageListener();
  registerStorageListener();
  await refreshItems();
}

init();
