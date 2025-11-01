const STORAGE_KEY = 'chaospace-transfer-settings';

const dom = {
  baseDir: document.getElementById('base-dir'),
  useTitleSubdir: document.getElementById('use-title-subdir'),
  itemsContainer: document.getElementById('items-container'),
  refreshButton: document.getElementById('refresh-btn'),
  selectAll: document.getElementById('select-all'),
  selectNone: document.getElementById('select-none'),
  transferButton: document.getElementById('transfer-btn'),
  pageInfo: document.getElementById('page-info'),
  resultSection: document.getElementById('result'),
  resultSummary: document.getElementById('result-summary'),
  resultList: document.getElementById('result-list'),
  messages: document.getElementById('messages')
};

const state = {
  tabId: null,
  origin: '',
  pageTitle: '',
  items: [],
  baseDir: '/',
  useTitleSubdir: true,
  loading: false
};

function sanitizeSubdir(value) {
  if (!value) {
    return '';
  }
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureSubdir(value, fallback) {
  const sanitized = sanitizeSubdir(value);
  if (sanitized) {
    return sanitized;
  }
  const fallbackValue = sanitizeSubdir(fallback);
  return fallbackValue || '未命名资源';
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

function joinPath(base, subdir) {
  const normalizedBase = normalizeDir(base);
  if (!subdir) {
    return normalizedBase;
  }
  const sanitizedSubdir = sanitizeSubdir(subdir);
  if (!sanitizedSubdir) {
    return normalizedBase;
  }
  if (normalizedBase === '/') {
    return `/${sanitizedSubdir}`;
  }
  return `${normalizedBase}/${sanitizedSubdir}`;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] || {};
  if (typeof settings.baseDir === 'string') {
    state.baseDir = normalizeDir(settings.baseDir);
  }
  if (typeof settings.useTitleSubdir === 'boolean') {
    state.useTitleSubdir = settings.useTitleSubdir;
  }
}

async function saveSettings() {
  const payload = {
    baseDir: state.baseDir,
    useTitleSubdir: state.useTitleSubdir
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: payload
  });
}

function setLoading(isLoading) {
  state.loading = isLoading;
  dom.refreshButton.disabled = isLoading;
  dom.transferButton.disabled = isLoading;
  dom.selectAll.disabled = isLoading;
  dom.selectNone.disabled = isLoading;
  dom.baseDir.disabled = isLoading;
  dom.useTitleSubdir.disabled = isLoading;
  if (isLoading) {
    dom.transferButton.textContent = '处理中...';
  } else {
    dom.transferButton.textContent = '转存选中资源';
  }
}

function clearMessages() {
  dom.messages.innerHTML = '';
}

function showMessage(text, type = 'error') {
  dom.messages.innerHTML = '';
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = text;
  dom.messages.appendChild(div);
}

function renderPageInfo() {
  if (!state.origin) {
    dom.pageInfo.textContent = '未检测到 CHAOSPACE 页面';
    return;
  }
  const title = state.pageTitle || '当前页面';
  dom.pageInfo.textContent = `${title} · ${state.origin}`;
}

function renderItems() {
  const container = dom.itemsContainer;
  container.innerHTML = '';

  if (!state.items.length) {
    const empty = document.createElement('div');
    empty.className = 'message info';
    empty.textContent = '未找到可用的资源链接。请确认页面是 CHAOSPACE 的剧集页面。';
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `item-card${item.selected ? '' : ' disabled'}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.selected;
    checkbox.addEventListener('change', () => {
      item.selected = checkbox.checked;
      card.classList.toggle('disabled', !item.selected);
    });

    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'selector';
    checkboxWrapper.appendChild(checkbox);
    card.appendChild(checkboxWrapper);

    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = item.title;
    card.appendChild(titleEl);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const quality = item.quality ? `质量：${item.quality}` : '';
    const subtitle = item.subtitle ? `字幕：${item.subtitle}` : '';
    const date = item.date ? `更新：${item.date}` : '';
    [quality, subtitle, date].filter(Boolean).forEach(text => {
      const span = document.createElement('span');
      span.textContent = text;
      meta.appendChild(span);
    });
    card.appendChild(meta);

    const pathPreview = document.createElement('div');
    pathPreview.className = 'meta path-preview';
    const pathLabel = document.createElement('span');
    pathPreview.appendChild(pathLabel);

    if (state.useTitleSubdir) {
      const subdirLabel = document.createElement('label');
      subdirLabel.className = 'subdir';
      subdirLabel.innerHTML = '<span>子目录名称</span>';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.subdir;
      input.addEventListener('input', () => {
        item.subdir = input.value;
        pathLabel.textContent = `目标目录：${computeTargetPath(item)}`;
      });
      subdirLabel.appendChild(input);
      card.appendChild(subdirLabel);
    }

    pathLabel.textContent = `目标目录：${computeTargetPath(item)}`;
    card.appendChild(pathPreview);

    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}

function computeTargetPath(item) {
  if (!state.useTitleSubdir) {
    return normalizeDir(state.baseDir);
  }
  const subdir = ensureSubdir(item.subdir, item.title);
  return joinPath(state.baseDir, subdir);
}

function setResult(result) {
  if (!result) {
    dom.resultSection.classList.add('hidden');
    return;
  }
  dom.resultSection.classList.remove('hidden');
  dom.resultSummary.textContent = result.summary || '';
  dom.resultList.innerHTML = '';

  result.results.forEach(item => {
    const li = document.createElement('li');
    li.className = item.status || '';
    const message = item.message && String(item.message).trim() ? item.message : '无详细错误信息';
    const detail = item.errno !== undefined ? `（代码：${item.errno}）` : '';
    li.innerHTML = `<span>${item.title}</span><span>${message}${detail}</span>`;
    dom.resultList.appendChild(li);
  });
}

function selectAll(selected) {
  state.items.forEach(item => {
    item.selected = selected;
  });
  renderItems();
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

async function refreshItems() {
  clearMessages();
  dom.resultSection.classList.add('hidden');
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    showMessage('未找到活动标签页。');
    return;
  }

  state.tabId = tab.id;

  try {
    const response = await sendMessageToTab(tab.id, { type: 'chaospace:collect-links' });
    if (!response || !Array.isArray(response.items) || !response.items.length) {
      state.items = [];
      let origin = '';
      try {
        origin = response?.origin || new URL(tab.url).origin;
      } catch (_error) {
        origin = '';
      }
      state.origin = origin;
      state.pageTitle = response?.title || tab.title;
      renderPageInfo();
      renderItems();
      showMessage('未从页面中解析到资源链接。', 'info');
      return;
    }

    let origin = '';
    try {
      origin = response.origin || new URL(tab.url).origin;
    } catch (_error) {
      origin = '';
    }
    state.origin = origin;
    state.pageTitle = response.title || tab.title;
    state.items = response.items.map(item => ({
      ...item,
      selected: true,
      subdir: ensureSubdir('', item.title)
    }));

    renderPageInfo();
    renderItems();
  } catch (error) {
    state.items = [];
    state.pageTitle = tab?.title || '';
    try {
      state.origin = new URL(tab?.url || '').origin;
    } catch (_error) {
      state.origin = '';
    }
    renderPageInfo();
    renderItems();
    showMessage(`无法在当前页面使用：${error.message}`);
  }
}

async function handleTransfer() {
  clearMessages();
  dom.resultSection.classList.add('hidden');

  const baseDir = normalizeDir(dom.baseDir.value);
  state.baseDir = baseDir;
  await saveSettings();

  const selectedItems = state.items.filter(item => item.selected);
  if (!selectedItems.length) {
    showMessage('请至少选择一条资源。', 'info');
    return;
  }

  const payloadItems = selectedItems.map(item => ({
    id: item.id,
    title: item.title,
    targetPath: computeTargetPath(item)
  }));

  setLoading(true);
  try {
    const response = await sendRuntimeMessage({
      type: 'chaospace:transfer',
      payload: {
        origin: state.origin,
        items: payloadItems,
        targetDirectory: baseDir
      }
    });

    if (!response?.ok) {
      const message = response?.error || '未知错误';
      showMessage(`转存失败：${message}`);
      setLoading(false);
      return;
    }

    setResult(response);
  } catch (error) {
    showMessage(`转存失败：${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function init() {
  await loadSettings();
  dom.baseDir.value = state.baseDir;
  dom.useTitleSubdir.checked = state.useTitleSubdir;

  dom.baseDir.addEventListener('change', () => {
    state.baseDir = normalizeDir(dom.baseDir.value);
    dom.baseDir.value = state.baseDir;
    saveSettings();
    renderItems();
  });

  dom.useTitleSubdir.addEventListener('change', () => {
    state.useTitleSubdir = dom.useTitleSubdir.checked;
    saveSettings();
    renderItems();
  });

  dom.refreshButton.addEventListener('click', refreshItems);
  dom.transferButton.addEventListener('click', handleTransfer);
  dom.selectAll.addEventListener('click', () => selectAll(true));
  dom.selectNone.addEventListener('click', () => selectAll(false));

  await refreshItems();
}

init();
