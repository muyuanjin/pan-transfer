const ERROR_MESSAGES = {
  [-1]: '链接失效：未获取到 shareid',
  [-2]: '链接失效：未获取到 user_id',
  [-3]: '链接失效：未获取到 fs_id',
  [-4]: '转存失败：无效登录',
  [-6]: '转存失败：请使用无痕模式获取 Cookie',
  [-7]: '转存失败：文件名含非法字符',
  [-8]: '转存失败：已存在同名文件或文件夹',
  [-9]: '链接错误：提取码错误或验证过期',
  [-10]: '转存失败：容量不足',
  [-62]: '链接错误次数过多，请稍后再试',
  [12]: '转存失败：文件数超过限制',
  [20]: '转存失败：容量不足',
  [105]: '转存失败：链接格式不正确',
  [2]: '提取码验证失败或需要验证码',
  [404]: '转存失败：秒传无效',
  [9019]: '转存失败：Access Token 无效',
  [20010]: '转存失败：应用授权失败',
  [31039]: '转存失败：文件名冲突',
  [31190]: '转存失败：秒传未生效',
  [666]: '已跳过：文件已存在'
};

const TOKEN_TTL = 10 * 60 * 1000;
let cachedBdstoken = null;
let cachedBdstokenAt = 0;
const ensuredDirectories = new Set();
ensuredDirectories.add('/');
const MAX_TRANSFER_ATTEMPTS = 3;
const TRANSFER_RETRYABLE_ERRNOS = new Set([4]);
const DIRECTORY_LIST_PAGE_SIZE = 200;
const directoryFileCache = new Map();
const completedShareCache = new Map();
const jobContexts = new Map();

const STORAGE_KEYS = {
  cache: 'chaospace-transfer-cache',
  history: 'chaospace-transfer-history'
};
const CACHE_VERSION = 1;
const HISTORY_VERSION = 1;
const MAX_DIRECTORY_CACHE_ENTRIES = 100000;
const MAX_SHARE_CACHE_ENTRIES = 400000;
const MAX_HISTORY_RECORDS = 200000;

let persistentCacheState = null;
let historyState = null;
const historyIndexByUrl = new Map();
let cacheLoadPromise = null;
let historyLoadPromise = null;

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result || {});
    });
  });
}

function storageSet(entries) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(entries, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function nowTs() {
  return Date.now();
}

function createDefaultCacheState() {
  return {
    version: CACHE_VERSION,
    directories: {},
    ensured: { '/': nowTs() },
    completedShares: {}
  };
}

function createDefaultHistoryState() {
  return {
    version: HISTORY_VERSION,
    records: []
  };
}

async function ensureCacheLoaded() {
  if (cacheLoadPromise) {
    await cacheLoadPromise;
    return;
  }
  cacheLoadPromise = (async () => {
    try {
      const stored = await storageGet([STORAGE_KEYS.cache]);
      const raw = stored[STORAGE_KEYS.cache];
      if (raw && raw.version === CACHE_VERSION && raw.directories && raw.ensured) {
        persistentCacheState = {
          version: CACHE_VERSION,
          directories: raw.directories || {},
          ensured: { ...raw.ensured },
          completedShares: raw.completedShares || {}
        };
      } else {
        persistentCacheState = createDefaultCacheState();
      }
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to load persistent cache', error);
      persistentCacheState = createDefaultCacheState();
    }

    ensuredDirectories.clear();
    ensuredDirectories.add('/');
    if (persistentCacheState && persistentCacheState.ensured) {
      Object.keys(persistentCacheState.ensured).forEach(path => {
        if (path) {
          ensuredDirectories.add(path);
        }
      });
    }

    directoryFileCache.clear();
    if (persistentCacheState && persistentCacheState.directories) {
      Object.entries(persistentCacheState.directories).forEach(([path, entry]) => {
        if (!path || !entry || !Array.isArray(entry.files)) {
          return;
        }
        directoryFileCache.set(path, new Set(entry.files));
      });
    }

    completedShareCache.clear();
    if (persistentCacheState && persistentCacheState.completedShares) {
      Object.entries(persistentCacheState.completedShares).forEach(([surl, ts]) => {
        if (surl) {
          completedShareCache.set(surl, ts || 0);
        }
      });
    }
  })();
  await cacheLoadPromise;
}

function rebuildHistoryIndex() {
  historyIndexByUrl.clear();
  if (!historyState || !Array.isArray(historyState.records)) {
    return;
  }
  historyState.records.forEach((record, index) => {
    if (record && typeof record.pageUrl === 'string' && record.pageUrl) {
      historyIndexByUrl.set(record.pageUrl, { index, record });
    }
  });
}

async function ensureHistoryLoaded() {
  if (historyLoadPromise) {
    await historyLoadPromise;
    return;
  }
  historyLoadPromise = (async () => {
    try {
      const stored = await storageGet([STORAGE_KEYS.history]);
      const raw = stored[STORAGE_KEYS.history];
      if (raw && raw.version === HISTORY_VERSION && Array.isArray(raw.records)) {
        historyState = {
          version: HISTORY_VERSION,
          records: raw.records.map(record => {
            const safeRecord = record || {};
            if (!safeRecord.items || typeof safeRecord.items !== 'object') {
              safeRecord.items = {};
            }
            if (!Array.isArray(safeRecord.itemOrder)) {
              safeRecord.itemOrder = Object.keys(safeRecord.items);
            }
            return safeRecord;
          })
        };
      } else {
        historyState = createDefaultHistoryState();
      }
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to load transfer history', error);
      historyState = createDefaultHistoryState();
    }
    rebuildHistoryIndex();
  })();
  await historyLoadPromise;
}

async function persistCacheNow() {
  await ensureCacheLoaded();
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  try {
    await storageSet({
      [STORAGE_KEYS.cache]: {
        version: CACHE_VERSION,
        directories: persistentCacheState.directories,
        ensured: persistentCacheState.ensured,
        completedShares: persistentCacheState.completedShares || {}
      }
    });
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to persist directory cache', error);
  }
}

async function persistHistoryNow() {
  await ensureHistoryLoaded();
  if (!historyState) {
    historyState = createDefaultHistoryState();
  }
  try {
    await storageSet({
      [STORAGE_KEYS.history]: historyState
    });
  } catch (error) {
    console.warn('[Chaospace Transfer] Failed to persist history', error);
  }
}

function markDirectoryEnsured(path) {
  if (!path) {
    return;
  }
  ensuredDirectories.add(path);
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  persistentCacheState.ensured[path] = nowTs();
}

function pruneDirectoryCacheIfNeeded() {
  if (!persistentCacheState) {
    return;
  }
  const entries = Object.entries(persistentCacheState.directories || {});
  if (entries.length <= MAX_DIRECTORY_CACHE_ENTRIES) {
    return;
  }
  entries
    .sort((a, b) => {
      const tsA = a[1]?.updatedAt || 0;
      const tsB = b[1]?.updatedAt || 0;
      return tsA - tsB;
    })
    .slice(0, Math.max(0, entries.length - MAX_DIRECTORY_CACHE_ENTRIES))
    .forEach(([path]) => {
      delete persistentCacheState.directories[path];
      directoryFileCache.delete(path);
    });
}

function recordDirectoryCache(path, names) {
  if (!path) {
    return;
  }
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  const files = Array.from(names || []).filter(name => typeof name === 'string' && name);
  persistentCacheState.directories[path] = {
    files,
    updatedAt: nowTs()
  };
  pruneDirectoryCacheIfNeeded();
}

function pruneCompletedShareCacheIfNeeded() {
  if (!persistentCacheState || !persistentCacheState.completedShares) {
    return;
  }
  const entries = Object.entries(persistentCacheState.completedShares);
  if (entries.length <= MAX_SHARE_CACHE_ENTRIES) {
    return;
  }
  entries
    .sort((a, b) => {
      const tsA = a[1] || 0;
      const tsB = b[1] || 0;
      return tsA - tsB;
    })
    .slice(0, Math.max(0, entries.length - MAX_SHARE_CACHE_ENTRIES))
    .forEach(([surl]) => {
      delete persistentCacheState.completedShares[surl];
      completedShareCache.delete(surl);
    });
}

function hasCompletedShare(surl) {
  if (!surl) {
    return false;
  }
  return completedShareCache.has(surl);
}

function recordCompletedShare(surl) {
  if (!surl) {
    return;
  }
  const timestamp = nowTs();
  completedShareCache.set(surl, timestamp);
  if (!persistentCacheState) {
    persistentCacheState = createDefaultCacheState();
  }
  if (!persistentCacheState.completedShares) {
    persistentCacheState.completedShares = {};
  }
  persistentCacheState.completedShares[surl] = timestamp;
  pruneCompletedShareCacheIfNeeded();
}

ensureCacheLoaded();
ensureHistoryLoaded();

function isIgnorableMessageError(error) {
  if (!error) {
    return true;
  }
  const message = typeof error === 'string' ? error : error.message;
  if (!message) {
    return false;
  }
  return message.includes('Receiving end does not exist') ||
    message.includes('The message port closed before a response was received.');
}

function emitProgress(jobId, data = {}) {
  if (!jobId) {
    return;
  }
  const message = {
    type: 'chaospace:transfer-progress',
    jobId,
    ...data
  };
  const context = jobContexts.get(jobId);

  if (context && typeof context.tabId === 'number') {
    const args = [context.tabId, message];
    if (typeof context.frameId === 'number') {
      args.push({ frameId: context.frameId });
    }
    args.push(() => {
      const error = chrome.runtime.lastError;
      if (error && !isIgnorableMessageError(error)) {
        console.warn('[Chaospace Transfer] Failed to post progress to tab', {
          jobId,
          tabId: context.tabId,
          message: error.message
        });
      }
      if (error && error.message && error.message.includes('No tab with id')) {
        jobContexts.delete(jobId);
      }
    });
    try {
      chrome.tabs.sendMessage(...args);
    } catch (error) {
      console.warn('[Chaospace Transfer] tabs.sendMessage threw', {
        jobId,
        tabId: context.tabId,
        message: error.message
      });
    }
  }

  chrome.runtime.sendMessage(message, () => {
    const error = chrome.runtime.lastError;
    if (error && !isIgnorableMessageError(error)) {
      console.warn('[Chaospace Transfer] Failed to post progress via runtime message', {
        jobId,
        message: error.message
      });
    }
  });
}

function logStage(jobId, stage, message, extra = {}) {
  if (!jobId) {
    return;
  }
  emitProgress(jobId, {
    stage,
    message,
    ...extra
  });
}

// 初始化时设置请求头修改规则
chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: 'https://pan.baidu.com' },
          { header: 'Origin', operation: 'set', value: 'https://pan.baidu.com' }
        ]
      },
      condition: {
        urlFilter: 'pan.baidu.com/*',
        resourceTypes: ['xmlhttprequest']
      }
    }]
  });
});

const PAN_BASE_HEADERS = {
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'X-Requested-With': 'XMLHttpRequest'
};

function withPanHeaders(headers = {}, referer = 'https://pan.baidu.com/') {
  return {
    ...PAN_BASE_HEADERS,
    Referer: referer,
    ...headers
  };
}

function normalizePath(input) {
  if (!input) {
    return '/';
  }
  let normalized = input.trim();
  normalized = normalized.replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, referer = 'https://pan.baidu.com/') {
  const { headers, ...rest } = options;
  const response = await fetch(url, {
    credentials: 'include',
    headers: withPanHeaders(headers, referer),
    ...rest
  });
  if (!response.ok) {
    throw new Error(`请求失败：${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function ensureBdstoken(force = false) {
  const now = Date.now();
  if (!force && cachedBdstoken && now - cachedBdstokenAt < TOKEN_TTL) {
    return cachedBdstoken;
  }

  chrome.cookies.getAll({ domain: 'pan.baidu.com' }, (cookies) => {
    const names = cookies ? cookies.map(cookie => cookie.name) : [];
    console.log('[Chaospace Transfer] cookies before bdstoken', names);
  });

  const url = 'https://pan.baidu.com/api/gettemplatevariable?clienttype=0&app_id=38824127&web=1&fields=%5B%22bdstoken%22,%22token%22,%22uk%22,%22isdocuser%22,%22servertime%22%5D';
  const data = await fetchJson(url);
  console.log('[Chaospace Transfer] bdstoken response', data);
  if (data.errno !== 0) {
    throw new Error(`获取 bdstoken 失败：${data.errno}`);
  }
  cachedBdstoken = data.result.bdstoken;
  cachedBdstokenAt = now;
  return cachedBdstoken;
}

function buildSurl(linkUrl) {
  try {
    const url = new URL(linkUrl);
    if (url.pathname.startsWith('/s/')) {
      // 提取 /s/ 后面的部分，并去掉开头的 '1'
      // 例如：/s/1XxvgONnZLWngbROsz4DwSg -> XxvgONnZLWngbROsz4DwSg
      let segment = url.pathname.replace('/s/', '');
      if (segment.startsWith('1')) {
        segment = segment.substring(1);
      }
      return segment;
    }
    if (url.pathname.startsWith('/share/init')) {
      const surl = url.searchParams.get('surl');
      if (surl) {
        return surl;
      }
    }
  } catch (error) {
    console.warn('无法解析 surl', linkUrl, error);
  }
  return '';
}

function extractPassCodeFromText(text) {
  if (!text) {
    return '';
  }
  const match = text.match(/提取码[：:]*\s*([0-9a-zA-Z]+)/);
  return match ? match[1] : '';
}

async function verifySharePassword(linkUrl, passCode, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  const titleLabel = context ? `《${context}》` : '资源';
  if (!passCode) {
    return { errno: 0 };
  }
  const surl = buildSurl(linkUrl);
  if (!surl) {
    logStage(jobId, 'verify', `${titleLabel}无法解析分享标识，跳过验证`, { level: 'error' });
    return { errno: -1 };
  }

  console.log('[Chaospace Transfer] verifySharePassword params', {
    linkUrl,
    passCode,
    surl,
    surlLength: surl.length
  });

  const url = `https://pan.baidu.com/share/verify?surl=${encodeURIComponent(surl)}&bdstoken=${encodeURIComponent(bdstoken)}&t=${Date.now()}&channel=chunlei&web=1&clienttype=0`;
  const body = new URLSearchParams({
    pwd: passCode,
    vcode: '',
    vcode_str: ''
  });

  // Python 版本使用固定的 Referer: https://pan.baidu.com
  const referer = 'https://pan.baidu.com';

  console.log('[Chaospace Transfer] verify request', {
    url,
    referer,
    body: body.toString()
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: withPanHeaders({
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    }, referer),
    body: body.toString(),
    credentials: 'include'
  });

  const data = await response.json();
  if (typeof data.errno === 'number' && data.errno !== 0) {
    const message = data.show_msg || data.msg || data.tip || '';
    logStage(jobId, 'verify', `${titleLabel}提取码验证失败（errno ${data.errno}）${message ? `：${message}` : ''}`, {
      level: 'error',
      detail: message
    });
    console.warn('[Chaospace Transfer] verify share failed', {
      linkUrl,
      surl,
      errno: data.errno,
      message,
      raw: data
    });
    return { errno: data.errno, message };
  }
  if (data.randsk) {
    await new Promise((resolve) => {
      chrome.cookies.set(
        {
          url: 'https://pan.baidu.com/',
          name: 'BDCLND',
          value: data.randsk,
          domain: 'pan.baidu.com',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'no_restriction'
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn('设置 BDCLND Cookie 失败：', chrome.runtime.lastError.message);
          }
          resolve();
        }
      );
    });
  }
  logStage(jobId, 'verify', `${titleLabel}提取码验证通过`, { level: 'success' });
  return { errno: 0 };
}

async function fetchShareMetadata(linkUrl, passCode, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  const titleLabel = context ? `《${context}》` : '资源';
  // 如果有提取码,必须先验证并等待 Cookie 设置完成
  if (passCode) {
    const verifyResult = await verifySharePassword(linkUrl, passCode, bdstoken, { jobId, context });
    if (verifyResult.errno && verifyResult.errno !== 0) {
      console.warn('[Chaospace Transfer] verify password failed', linkUrl, verifyResult.errno);
      logStage(jobId, 'verify', `${titleLabel}提取码验证失败（errno ${verifyResult.errno}）`, { level: 'error' });
      return { error: verifyResult.errno };
    }
    // 确保 Cookie 已设置完成,添加短暂延迟
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  let linkToFetch = linkUrl;
  try {
    const shareUrl = new URL(linkUrl);
    if (passCode && !shareUrl.searchParams.get('pwd')) {
      shareUrl.searchParams.set('pwd', passCode);
    }
    linkToFetch = shareUrl.toString();
  } catch (_error) {
    linkToFetch = linkUrl;
  }

  logStage(jobId, 'list', `${titleLabel}请求分享页面`);
  const response = await fetch(linkToFetch, {
    credentials: 'include',
    headers: withPanHeaders({}, linkToFetch)
  });
  if (!response.ok) {
    const message = `访问分享链接失败：${response.status}`;
    console.warn('[Chaospace Transfer] fetch share page failed', linkUrl, message);
    logStage(jobId, 'list', `${titleLabel}访问分享页失败（${response.status}）`, { level: 'error', detail: message });
    return { error: message };
  }
  logStage(jobId, 'list', `${titleLabel}获取分享页面成功，开始解析`);
  const html = await response.text();
  const match = html.match(/locals\.mset\((\{[\s\S]*?\})\);/);
  if (!match) {
    console.warn('[Chaospace Transfer] locals.mset missing', linkUrl);
    logStage(jobId, 'list', `${titleLabel}未解析到分享元数据`, { level: 'error' });
    return { error: '未解析到分享元数据' };
  }

  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch (error) {
    console.error('[Chaospace Transfer] share metadata json parse failed', linkUrl, error);
    logStage(jobId, 'list', `${titleLabel}解析分享元数据失败：${error.message}`, { level: 'error' });
    return { error: `解析分享元数据失败：${error.message}` };
  }

  const shareId = meta.shareid;
  const userId = meta.share_uk;
  const fileList = Array.isArray(meta.file_list) ? meta.file_list : [];

  logStage(jobId, 'list', `${titleLabel}解析文件列表，共 ${fileList.length} 项`);
  const fsIds = [];
  const fileNames = [];
  for (const entry of fileList) {
    if (!entry) continue;
    if (entry.isdir === 0 && entry.size === 0) {
      continue;
    }
    const numericId = Number(entry.fs_id);
    if (!Number.isFinite(numericId)) {
      continue;
    }
    fsIds.push(numericId);
    fileNames.push(entry.server_filename);
  }

  if (!shareId) {
    logStage(jobId, 'list', `${titleLabel}缺少 shareId`, { level: 'error' });
    return { error: -1 };
  }
  if (!userId) {
    logStage(jobId, 'list', `${titleLabel}缺少 userId`, { level: 'error' });
    return { error: -2 };
  }
  if (!fsIds.length) {
    logStage(jobId, 'list', `${titleLabel}未找到有效文件`, { level: 'error' });
    return { error: -3 };
  }

  logStage(jobId, 'list', `${titleLabel}元数据准备完成`);
  return {
    shareId: String(shareId),
    userId: String(userId),
    fsIds,
    fileNames
  };
}

async function checkDirectoryExists(path, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  const normalized = normalizePath(path);
  if (normalized === '/') {
    logStage(jobId, 'list', '根目录已存在');
    return true;
  }

  await ensureCacheLoaded();

  const params = new URLSearchParams({
    dir: normalized,
    bdstoken,
    order: 'name',
    desc: '0',
    limit: '1',
    start: '0',
    web: '1',
    folder: '0',
    showempty: '0',
    clienttype: '0',
    channel: 'web'
  });

  const url = `https://pan.baidu.com/api/list?${params.toString()}`;
  const contextLabel = context ? `（${context}）` : '';
  logStage(jobId, 'list', `请求目录列表：${normalized}${contextLabel}`);
  const data = await fetchJson(url, {}, 'https://pan.baidu.com/disk/home');
  if (data.errno === 0) {
    logStage(jobId, 'list', `目录已就绪：${normalized}${contextLabel}`);
    return true;
  }

  if (data.errno === -9 || data.errno === 2 || data.errno === 12 || data.errno === 31066) {
    console.log('[Chaospace Transfer] directory missing, preparing to create', {
      path: normalized,
      errno: data.errno
    });
    logStage(jobId, 'list', `目录缺失：${normalized}${contextLabel}（errno ${data.errno}），准备创建`, { level: 'warning' });
    return false;
  }

  console.warn('[Chaospace Transfer] directory existence check failed', {
    path: normalized,
    errno: data.errno,
    raw: data
  });
  logStage(jobId, 'list', `查询目录失败：${normalized}${contextLabel}（errno ${data.errno}）`, { level: 'error' });
  throw new Error(`查询目录失败(${normalized})：${data.errno}`);
}

async function fetchDirectoryFileNames(path, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  const normalized = normalizePath(path);
  if (normalized === '/') {
    logStage(jobId, 'list', '根目录不缓存文件清单');
    return new Set();
  }

  await ensureCacheLoaded();

  const cached = directoryFileCache.get(normalized);
  if (cached) {
    logStage(jobId, 'list', `使用目录缓存：${normalized}（${cached.size} 项）`);
    return cached;
  }

  const collected = new Set();
  let start = 0;
  const contextLabel = context ? `（${context}）` : '';
  while (true) {
    const params = new URLSearchParams({
      dir: normalized,
      bdstoken,
      order: 'name',
      desc: '0',
      limit: String(DIRECTORY_LIST_PAGE_SIZE),
      start: String(start),
      web: '1',
      folder: '0',
      showempty: '0',
      clienttype: '0',
      channel: 'web'
    });

    const url = `https://pan.baidu.com/api/list?${params.toString()}`;
    logStage(jobId, 'list', `拉取目录条目：${normalized}${contextLabel} · 起始 ${start}`);
    const data = await fetchJson(url, {}, 'https://pan.baidu.com/disk/home');
    if (data.errno !== 0) {
      logStage(jobId, 'list', `目录枚举失败：${normalized}${contextLabel}（errno ${data.errno}）`, { level: 'error' });
      throw new Error(`查询目录内容失败(${normalized})：${data.errno}`);
    }

    const entries = Array.isArray(data.list) ? data.list : [];
    logStage(jobId, 'list', `目录返回 ${entries.length} 项：${normalized}${contextLabel}（has_more=${data.has_more}）`);
    for (const entry of entries) {
      if (!entry || typeof entry.server_filename !== 'string') {
        continue;
      }
      collected.add(entry.server_filename);
    }

    const hasMore = Number(data.has_more) === 1;
    if (!hasMore || !entries.length) {
      break;
    }
    start += entries.length;
  }

  directoryFileCache.set(normalized, collected);
  recordDirectoryCache(normalized, collected);
  logStage(jobId, 'list', `目录缓存完成：${normalized}${contextLabel}（共 ${collected.size} 项）`);
  return collected;
}

async function ensureDirectoryExists(path, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  const normalized = normalizePath(path);
  if (normalized === '/') {
    logStage(jobId, 'list', '根目录无需创建');
    markDirectoryEnsured('/');
    return normalized;
  }

  await ensureCacheLoaded();

  if (ensuredDirectories.has(normalized)) {
    logStage(jobId, 'list', `目录已缓存：${normalized}`);
    return normalized;
  }

  const segments = normalized.split('/').filter(Boolean);
  let current = '';
  const contextLabel = context ? `（${context}）` : '';
  logStage(jobId, 'list', `确认目录链：${normalized}${contextLabel}`);
  for (const segment of segments) {
    current += `/${segment}`;
    if (ensuredDirectories.has(current)) {
      continue;
    }
    const exists = await checkDirectoryExists(current, bdstoken, { jobId, context });
    if (exists) {
      markDirectoryEnsured(current);
      continue;
    }
    const url = `https://pan.baidu.com/api/create?a=commit&bdstoken=${encodeURIComponent(bdstoken)}`;
    const body = new URLSearchParams({
      path: current,
      isdir: '1',
      size: '0',
      block_list: '[]'
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: withPanHeaders({
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      }, 'https://pan.baidu.com/disk/home'),
      credentials: 'include',
      body: body.toString()
    });

    logStage(jobId, 'list', `创建目录：${current}${contextLabel}`);
    const data = await response.json();
    if (data.errno !== 0 && data.errno !== -8 && data.errno !== 31039) {
      logStage(jobId, 'list', `创建目录失败：${current}${contextLabel}（errno ${data.errno}）`, { level: 'error' });
      throw new Error(`创建目录失败(${current})：${data.errno}`);
    }
    logStage(jobId, 'list', `目录创建完成：${current}${contextLabel}${data.errno === -8 || data.errno === 31039 ? '（已存在）' : ''}`, {
      level: data.errno === 0 ? 'success' : 'warning'
    });
    markDirectoryEnsured(current);
  }
  logStage(jobId, 'list', `目录准备就绪：${normalized}${contextLabel}`, { level: 'success' });
  return normalized;
}

async function filterAlreadyTransferred(meta, targetPath, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  if (!Array.isArray(meta.fsIds) || !meta.fsIds.length) {
    return { fsIds: [], fileNames: [], skippedFiles: [] };
  }

  try {
    logStage(jobId, 'list', `过滤已存在文件：${targetPath}${context ? `（${context}）` : ''}`);
    const existingNames = await fetchDirectoryFileNames(targetPath, bdstoken, { jobId, context });
    if (!existingNames.size) {
      logStage(jobId, 'list', `目录为空：${targetPath}${context ? `（${context}）` : ''}`);
      return {
        fsIds: meta.fsIds.slice(),
        fileNames: Array.isArray(meta.fileNames) ? meta.fileNames.slice() : [],
        skippedFiles: []
      };
    }

    const filteredFsIds = [];
    const filteredFileNames = [];
    const skippedFiles = [];

    const names = Array.isArray(meta.fileNames) ? meta.fileNames : [];
    let skippedCount = 0;
    meta.fsIds.forEach((fsId, index) => {
      const name = names[index];
      if (typeof name === 'string' && existingNames.has(name)) {
        skippedFiles.push(name);
        skippedCount += 1;
        return;
      }
      filteredFsIds.push(fsId);
      if (typeof name === 'string') {
        filteredFileNames.push(name);
      }
    });

    if (skippedCount) {
      logStage(jobId, 'list', `检测到已转存文件：跳过 ${skippedCount} 项`, { level: 'warning' });
    } else {
      logStage(jobId, 'list', '未发现已存在的文件');
    }

    return { fsIds: filteredFsIds, fileNames: filteredFileNames, skippedFiles };
  } catch (error) {
    console.warn('[Chaospace Transfer] directory listing failed, proceeding without skip filter', {
      path: targetPath,
      error: error.message
    });
    logStage(jobId, 'list', `目录检查失败，跳过去重：${targetPath}${context ? `（${context}）` : ''}`, {
      level: 'warning',
      detail: error.message
    });
    return {
      fsIds: meta.fsIds.slice(),
      fileNames: Array.isArray(meta.fileNames) ? meta.fileNames.slice() : [],
      skippedFiles: []
    };
  }
}

async function transferShare(meta, targetPath, bdstoken, referer) {
  const url = `https://pan.baidu.com/share/transfer?shareid=${encodeURIComponent(meta.shareId)}&from=${encodeURIComponent(meta.userId)}&bdstoken=${encodeURIComponent(bdstoken)}&channel=chunlei&web=1&clienttype=0`;
  const body = new URLSearchParams({
    fsidlist: JSON.stringify(meta.fsIds),
    path: targetPath
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: withPanHeaders({
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    }, referer || 'https://pan.baidu.com/disk/home'),
    credentials: 'include',
    body: body.toString()
  });

  const data = await response.json();
  return typeof data.errno === 'number' ? data.errno : -999;
}

async function transferWithRetry(meta, targetPath, bdstoken, referer, maxAttempts = MAX_TRANSFER_ATTEMPTS, options = {}) {
  const { jobId, context = '' } = options;
  const titleLabel = context ? `《${context}》` : '资源';
  const detail = `目标：${targetPath}`;
  let attempt = 0;
  let errno = -999;

  while (attempt < maxAttempts) {
    attempt += 1;
    logStage(jobId, 'transfer', `${titleLabel}第 ${attempt} 次发送转存请求`, {
      detail
    });
    errno = await transferShare(meta, targetPath, bdstoken, referer);
    if (errno === 0 || errno === 666) {
      logStage(jobId, 'transfer', `${titleLabel}转存成功（第 ${attempt} 次尝试${errno === 666 ? ' · 存在重复文件' : ''}）`, {
        level: 'success',
        detail
      });
      return { errno, attempts: attempt };
    }
    const shouldRetry = TRANSFER_RETRYABLE_ERRNOS.has(errno) && attempt < maxAttempts;
    logStage(jobId, 'transfer', `${titleLabel}转存失败（第 ${attempt} 次，errno ${errno}）${shouldRetry ? '，准备重试' : ''}`, {
      level: shouldRetry ? 'warning' : 'error',
      detail
    });
    if (!TRANSFER_RETRYABLE_ERRNOS.has(errno)) {
      break;
    }
    console.log('[Chaospace Transfer] transfer retry scheduled', {
      path: targetPath,
      errno,
      attempt
    });
    await delay(500 * attempt);
  }

  logStage(jobId, 'transfer', `${titleLabel}转存最终失败（errno ${errno}）`, {
    level: 'error',
    detail
  });
  return { errno, attempts: attempt };
}

function mapErrorMessage(errno, fallback) {
  if (errno in ERROR_MESSAGES) {
    return ERROR_MESSAGES[errno];
  }
  return fallback || `错误码：${errno}`;
}

function sanitizeLink(href) {
  if (!href) {
    return '';
  }
  let link = href.trim();
  link = link.replace(/^http:\/\//i, 'https://');
  link = link.replace('https://pan.baidu.com/share/init?surl=', 'https://pan.baidu.com/s/1');
  return link;
}

function parseLinkPage(html) {
  if (!html) {
    return null;
  }

  let href = null;

  const clipboardMatch = html.match(/data-clipboard-text=["']([^"']+pan\.baidu\.com[^"']*)["']/i);
  if (clipboardMatch) {
    href = clipboardMatch[1];
  }

  if (!href) {
    const anchorMatch = html.match(/<a[^>]+href=["']([^"']*pan\.baidu\.com[^"']*)["'][^>]*>/i);
    if (anchorMatch) {
      href = anchorMatch[1];
    }
  }

  if (!href) {
    return null;
  }

  href = sanitizeLink(href);

  let passCode = '';
  try {
    const url = new URL(href);
    passCode = url.searchParams.get('pwd') || url.searchParams.get('password') || '';
  } catch (_error) {
    passCode = '';
  }

  if (!passCode) {
    const textMatch = html.match(/提取码[：:]*\s*([0-9a-zA-Z]+)/);
    if (textMatch) {
      passCode = textMatch[1];
    }
  }

  return {
    linkUrl: href,
    passCode: passCode || ''
  };
}

async function fetchLinkDetail(origin, id, options = {}) {
  const { jobId, context = '' } = options;
  const titleLabel = context ? `《${context}》` : `资源 ${id}`;
  const url = `${origin.replace(/\/$/, '')}/links/${id}.html`;
  logStage(jobId, 'list', `${titleLabel}请求详情页`);
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    logStage(jobId, 'list', `${titleLabel}详情页请求失败（${response.status}）`, { level: 'error' });
    return { error: `获取资源链接失败：${response.status}` };
  }
  const html = await response.text();
  const parsed = parseLinkPage(html);
  if (!parsed) {
    logStage(jobId, 'list', `${titleLabel}页面未发现百度网盘链接`, { level: 'error' });
    return { error: '页面中未找到百度网盘链接' };
  }
  logStage(jobId, 'list', `${titleLabel}解析详情页成功`);
  return parsed;
}

function sanitizePosterInfo(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }
  if (typeof input.src !== 'string' || !input.src) {
    return null;
  }
  return {
    src: input.src,
    alt: typeof input.alt === 'string' ? input.alt : ''
  };
}

function ensureHistoryRecordStructure(record) {
  if (!record.items || typeof record.items !== 'object') {
    record.items = {};
  }
  if (!Array.isArray(record.itemOrder)) {
    record.itemOrder = Object.keys(record.items);
  }
  return record;
}

function upsertHistoryRecord(pageUrl) {
  if (!historyState) {
    historyState = createDefaultHistoryState();
  }
  let entry = historyIndexByUrl.get(pageUrl);
  if (entry) {
    return { record: ensureHistoryRecordStructure(entry.record), index: entry.index };
  }
  const record = ensureHistoryRecordStructure({
    pageUrl,
    pageTitle: '',
    pageType: 'unknown',
    origin: '',
    poster: null,
    targetDirectory: '/',
    baseDir: '/',
    useTitleSubdir: true,
    lastTransferredAt: 0,
    lastCheckedAt: 0,
    totalTransferred: 0,
    items: {},
    itemOrder: [],
    lastResult: null
  });
  historyState.records.push(record);
  rebuildHistoryIndex();
  const index = historyState.records.length - 1;
  historyIndexByUrl.set(pageUrl, { index, record });
  return { record, index };
}

function normalizeHistoryPath(value, fallback = '/') {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  return normalizePath(value);
}

function applyResultToHistoryRecord(record, result, timestamp) {
  if (!result || typeof result.id === 'undefined') {
    return;
  }
  const itemId = String(result.id);
  if (!itemId) {
    return;
  }
  const existing = record.items[itemId] || {};
  const next = {
    id: itemId,
    title: typeof result.title === 'string' && result.title ? result.title : (existing.title || ''),
    lastStatus: result.status || existing.lastStatus || 'unknown',
    lastTransferredAt: result.status === 'success' ? timestamp : (existing.lastTransferredAt || timestamp),
    files: Array.isArray(result.files) ? result.files.slice() : (existing.files || []),
    linkUrl: result.linkUrl || existing.linkUrl || '',
    passCode: result.passCode || existing.passCode || '',
    skippedFiles: Array.isArray(result.skippedFiles) ? result.skippedFiles.slice() : (existing.skippedFiles || []),
    message: result.message || existing.message || '',
    attempts: typeof existing.attempts === 'number' ? existing.attempts + 1 : 1,
    totalSuccess: (result.status === 'success')
      ? (typeof existing.totalSuccess === 'number' ? existing.totalSuccess + 1 : 1)
      : (existing.totalSuccess || 0),
    lastUpdatedAt: timestamp
  };
  if (result.status === 'skipped' && !existing.lastTransferredAt) {
    next.lastTransferredAt = timestamp;
  }
  record.items[itemId] = next;
  if (!record.itemOrder.includes(itemId)) {
    record.itemOrder.push(itemId);
  }
}

async function recordTransferHistory(payload, outcome) {
  if (!payload || !payload.meta) {
    return;
  }
  await ensureHistoryLoaded();
  const { meta } = payload;
  const pageUrl = typeof meta.pageUrl === 'string' && meta.pageUrl ? meta.pageUrl : '';
  if (!pageUrl) {
    return;
  }

  const timestamp = nowTs();
  const { record } = upsertHistoryRecord(pageUrl);
  const origin = payload.origin || record.origin || '';
  record.pageTitle = typeof meta.pageTitle === 'string' && meta.pageTitle ? meta.pageTitle : (record.pageTitle || '');
  record.origin = origin;
  record.pageType = typeof meta.pageType === 'string' && meta.pageType ? meta.pageType : (record.pageType || 'unknown');
  record.poster = sanitizePosterInfo(meta.poster) || record.poster || null;
  record.targetDirectory = normalizeHistoryPath(meta.targetDirectory || payload.targetDirectory || record.targetDirectory, record.targetDirectory || '/');
  record.baseDir = normalizeHistoryPath(meta.baseDir || record.baseDir || record.targetDirectory, record.baseDir || '/');
  record.useTitleSubdir = typeof meta.useTitleSubdir === 'boolean' ? meta.useTitleSubdir : Boolean(record.useTitleSubdir);
  record.lastCheckedAt = timestamp;

  const results = Array.isArray(outcome?.results) ? outcome.results : [];
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const res of results) {
    if (!res || typeof res.id === 'undefined') {
      continue;
    }
    if (res.status === 'failed') {
      failedCount += 1;
      continue;
    }
    applyResultToHistoryRecord(record, res, timestamp);
    if (res.status === 'success') {
      successCount += 1;
    } else if (res.status === 'skipped') {
      skippedCount += 1;
    }
  }

  record.totalTransferred = Object.keys(record.items).length;
  if (successCount > 0) {
    record.lastTransferredAt = timestamp;
  }
  const summary = typeof outcome?.summary === 'string' ? outcome.summary : '';
  record.lastResult = {
    summary,
    updatedAt: timestamp,
    success: successCount,
    skipped: skippedCount,
    failed: failedCount
  };

  historyState.records.sort((a, b) => {
    const tsA = a.lastTransferredAt || a.lastCheckedAt || 0;
    const tsB = b.lastTransferredAt || b.lastCheckedAt || 0;
    return tsB - tsA;
  });

  if (historyState.records.length > MAX_HISTORY_RECORDS) {
    historyState.records = historyState.records.slice(0, MAX_HISTORY_RECORDS);
  }

  rebuildHistoryIndex();
  await persistHistoryNow();
}

function decodeHtmlEntities(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&#x27;/gi, '\'')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_m, code) => {
      const num = parseInt(code, 10);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const num = parseInt(hex, 16);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    });
}

function stripHtmlTags(input) {
  return decodeHtmlEntities((input || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractCleanTitle(rawTitle) {
  if (!rawTitle) return '未命名资源';

  let title = rawTitle.trim();

  title = title.replace(/\s*提取码\s+\S+\s*$/gi, '');
  title = title.replace(/[:：]\s*(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');
  title = title.replace(/\s+(第[0-9一二三四五六七八九十百]+季|[Ss]eason\s*\d+|S\d+)\s*$/gi, '');
  title = title.replace(/[:：]\s*$/, '');
  title = title.replace(/\s+/g, ' ').trim();

  return title || '未命名资源';
}

function parsePageTitleFromHtml(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!match) {
    return '';
  }
  let title = stripHtmlTags(match[1]);
  title = title.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, '');
  return extractCleanTitle(title);
}

function parseItemsFromHtml(html) {
  const items = [];
  const seenIds = new Set();
  const rowRegex = /<tr[^>]*id=["']link-(\d+)["'][\s\S]*?<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html))) {
    const id = match[1];
    if (!id || seenIds.has(id)) {
      continue;
    }
    const rowHtml = match[0];
    const anchorMatch = rowHtml.match(/<a[^>]+href=["'][^"']*\/links\/\d+\.html[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const rawTitle = anchorMatch ? stripHtmlTags(anchorMatch[1]) : '';
    const title = extractCleanTitle(rawTitle || '');
    items.push({
      id,
      title: title || `资源 ${id}`
    });
    seenIds.add(id);
  }
  return items;
}

async function collectPageSnapshot(pageUrl) {
  const response = await fetch(pageUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`获取页面失败：${response.status}`);
  }
  const html = await response.text();
  const items = parseItemsFromHtml(html);
  const pageTitle = parsePageTitleFromHtml(html);
  const pageType = items.length > 1 ? 'series' : 'movie';

  await ensureHistoryLoaded();
  const existing = historyIndexByUrl.get(pageUrl);
  const recordItems = existing?.record?.items || {};

  const normalizedItems = items.map(item => {
    const id = String(item.id);
    const historyItem = recordItems[id];
    return {
      ...item,
      linkUrl: historyItem?.linkUrl || '',
      passCode: historyItem?.passCode || ''
    };
  });

  return {
    pageUrl,
    pageTitle,
    pageType,
    total: normalizedItems.length,
    items: normalizedItems
  };
}

async function handleCheckUpdatesRequest(payload = {}) {
  const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
  if (!pageUrl) {
    throw new Error('缺少页面地址');
  }
  await ensureHistoryLoaded();
  const entry = historyIndexByUrl.get(pageUrl);
  if (!entry || !entry.record) {
    throw new Error('未找到该页面的历史记录');
  }
  const record = ensureHistoryRecordStructure(entry.record);
  const snapshot = await collectPageSnapshot(pageUrl);
  const knownIds = new Set(Object.keys(record.items || {}));
  const newItems = snapshot.items.filter(item => !knownIds.has(String(item.id)));

  if (!newItems.length) {
    record.lastCheckedAt = nowTs();
    await persistHistoryNow();
    return {
      ok: true,
      hasUpdates: false,
      pageUrl,
      pageTitle: snapshot.pageTitle || record.pageTitle || '',
      totalKnown: knownIds.size,
      latestCount: snapshot.items.length
    };
  }

  const targetDirectory = normalizeHistoryPath(record.targetDirectory || payload.targetDirectory || '/');
  let origin = record.origin;
  if (!origin) {
    try {
      const url = new URL(pageUrl);
      origin = `${url.protocol}//${url.host}`;
    } catch (_error) {
      origin = record.origin || '';
    }
  }

  const jobId = `update-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const meta = {
    baseDir: normalizeHistoryPath(record.baseDir || targetDirectory),
    useTitleSubdir: false,
    pageTitle: snapshot.pageTitle || record.pageTitle || '',
    pageUrl,
    pageType: record.pageType || snapshot.pageType || 'series',
    targetDirectory,
    poster: record.poster || null,
    trigger: 'history-update',
    total: newItems.length
  };

  const transferPayload = {
    jobId,
    origin: origin || '',
    items: newItems.map(item => ({
      id: item.id,
      title: item.title,
      targetPath: targetDirectory,
      linkUrl: item.linkUrl || record.items[String(item.id)]?.linkUrl || '',
      passCode: item.passCode || record.items[String(item.id)]?.passCode || ''
    })),
    targetDirectory,
    meta
  };

  const transferResult = await handleTransfer(transferPayload);

  return {
    ok: true,
    hasUpdates: true,
    pageUrl,
    pageTitle: meta.pageTitle,
    newItems: newItems.length,
    summary: transferResult.summary,
    results: transferResult.results || [],
    jobId: transferResult.jobId
  };
}

async function handleTransfer(payload) {
  const { origin, items, targetDirectory, jobId } = payload;
  if (!Array.isArray(items) || !items.length) {
    emitProgress(jobId, {
      stage: 'idle',
      message: '没有可处理的条目',
      level: 'warning',
      statusMessage: '等待任务'
    });
    return { jobId, results: [], summary: '没有可处理的条目' };
  }

  const total = items.length;

  try {
    emitProgress(jobId, {
      stage: 'bootstrap',
      message: '正在获取授权信息...',
      statusMessage: '正在获取授权信息...'
    });

    logStage(jobId, 'bstToken', '准备请求 bdstoken');
    let bdstoken;
    try {
      bdstoken = await ensureBdstoken();
      logStage(jobId, 'bstToken', 'bdstoken 获取成功', { level: 'success' });
    } catch (error) {
      logStage(jobId, 'bstToken', `bdstoken 获取失败：${error.message || '未知错误'}`, { level: 'error' });
      throw error;
    }
    await ensureCacheLoaded();
    const normalizedBaseDir = normalizePath(targetDirectory || '/');

    emitProgress(jobId, {
      stage: 'prepare',
      message: `检查目标目录 ${normalizedBaseDir}`,
      statusMessage: `准备目录 ${normalizedBaseDir}`
    });

    await ensureDirectoryExists(normalizedBaseDir, bdstoken, {
      jobId,
      context: '全局目标目录'
    });

    const results = [];
    let index = 0;

    for (const item of items) {
      index += 1;

      emitProgress(jobId, {
        stage: 'item:start',
        message: `检索资源《${item.title}》`,
        current: index,
        total
      });

      let detail = null;
      let usedCachedDetail = false;

      if (item.linkUrl) {
        detail = {
          linkUrl: sanitizeLink(item.linkUrl),
          passCode: item.passCode || ''
        };
        if (detail.linkUrl) {
          usedCachedDetail = true;
        } else {
          detail = null;
        }
      }

      if (!detail) {
        detail = await fetchLinkDetail(origin, item.id, { jobId, context: item.title });
        if (detail.error) {
          const message = detail.error || '获取链接失败';
          emitProgress(jobId, {
            stage: 'item:error',
            message: `《${item.title}》链接解析失败：${message}`,
            current: index,
            total,
            level: 'error'
          });
          results.push({
            id: item.id,
            title: item.title,
            status: 'failed',
            message
          });
          continue;
        }
      }

      const surl = buildSurl(detail.linkUrl);
      if (surl && hasCompletedShare(surl)) {
        const message = '已跳过：历史记录显示已转存';
        emitProgress(jobId, {
          stage: 'item:skip',
          message: `《${item.title}》${message}`,
          current: index,
          total,
          level: 'warning'
        });
        results.push({
          id: item.id,
          title: item.title,
          status: 'skipped',
          message,
          files: [],
          skippedFiles: [],
          linkUrl: detail.linkUrl,
          passCode: detail.passCode
        });
        continue;
      }

      try {
        emitProgress(jobId, {
          stage: 'item:meta',
          message: `解析分享信息《${item.title}》`,
          current: index,
          total
        });

        let meta = await fetchShareMetadata(detail.linkUrl, detail.passCode, bdstoken, { jobId, context: item.title });
        if (usedCachedDetail && meta.error) {
          const refreshedDetail = await fetchLinkDetail(origin, item.id, { jobId, context: item.title });
          if (!refreshedDetail.error) {
            detail = refreshedDetail;
            meta = await fetchShareMetadata(detail.linkUrl, detail.passCode, bdstoken, { jobId, context: item.title });
          }
        }
        if (meta.error) {
          const errno = typeof meta.error === 'number' ? meta.error : -9999;
          const message = mapErrorMessage(errno, typeof meta.error === 'string' ? meta.error : '');
          emitProgress(jobId, {
            stage: 'item:error',
            message: `《${item.title}》元数据异常：${message}`,
            current: index,
            total,
            level: 'error'
          });
          results.push({
            id: item.id,
            title: item.title,
            status: 'failed',
            message,
            errno
          });
          continue;
        }

        const targetPath = normalizePath(item.targetPath || normalizedBaseDir);
        emitProgress(jobId, {
          stage: 'item:directory',
          message: `确认目录 ${targetPath}`,
          current: index,
          total
        });
        await ensureDirectoryExists(targetPath, bdstoken, {
          jobId,
          context: item.title
        });

        const filtered = await filterAlreadyTransferred(meta, targetPath, bdstoken, {
          jobId,
          context: item.title
        });
        if (!filtered.fsIds.length) {
          const message = filtered.skippedFiles.length
            ? `已跳过：文件已存在（${filtered.skippedFiles.length} 项）`
            : mapErrorMessage(666);
          emitProgress(jobId, {
            stage: 'item:skip',
            message: `《${item.title}》${message}`,
            current: index,
            total,
            level: 'warning'
          });
          if (surl) {
            recordCompletedShare(surl);
          }
          results.push({
            id: item.id,
            title: item.title,
            status: 'skipped',
            message,
            files: [],
            skippedFiles: filtered.skippedFiles,
            linkUrl: detail.linkUrl,
            passCode: detail.passCode
          });
          continue;
        }

        emitProgress(jobId, {
          stage: 'item:transfer',
          message: `正在转存《${item.title}》`,
          current: index,
          total,
          statusMessage: `转存进度 ${index}/${total}`
        });

        const transferMeta = {
          shareId: meta.shareId,
          userId: meta.userId,
          fsIds: filtered.fsIds
        };

        const referer = detail.linkUrl ? detail.linkUrl : 'https://pan.baidu.com/disk/home';
        const { errno, attempts } = await transferWithRetry(transferMeta, targetPath, bdstoken, referer, undefined, {
          jobId,
          context: item.title
        });

        if (errno === 0 || errno === 666) {
          if (surl) {
            recordCompletedShare(surl);
          }
          let message = mapErrorMessage(errno, '操作成功');
          if (errno === 0 && attempts > 1) {
            message = `${message}（第 ${attempts} 次尝试成功）`;
          }
          if (filtered.skippedFiles.length) {
            message = `${message}，已有 ${filtered.skippedFiles.length} 项跳过`;
          }
          if (filtered.fileNames.length) {
            const normalizedTarget = normalizePath(targetPath);
            let cachedFiles = directoryFileCache.get(normalizedTarget);
            if (!cachedFiles) {
              cachedFiles = new Set();
              directoryFileCache.set(normalizedTarget, cachedFiles);
            }
            filtered.fileNames.forEach(name => {
              if (typeof name === 'string') {
                cachedFiles.add(name);
              }
            });
          }

          emitProgress(jobId, {
            stage: 'item:done',
            message: `《${item.title}》${message}`,
            current: index,
            total,
            level: errno === 0 ? 'success' : 'warning'
          });

          results.push({
            id: item.id,
            title: item.title,
            status: errno === 0 ? 'success' : 'skipped',
            message,
            files: filtered.fileNames,
            skippedFiles: filtered.skippedFiles,
            linkUrl: detail.linkUrl,
            passCode: detail.passCode
          });
        } else {
          let message = mapErrorMessage(errno);
          if (TRANSFER_RETRYABLE_ERRNOS.has(errno) && attempts > 1) {
            message = `${message}（已重试 ${attempts - 1} 次）`;
          }
          emitProgress(jobId, {
            stage: 'item:failed',
            message: `《${item.title}》转存失败：${message}`,
            current: index,
            total,
            level: 'error'
          });
          results.push({
            id: item.id,
            title: item.title,
            status: 'failed',
            message,
            errno,
            attempts,
            skippedFiles: filtered.skippedFiles
          });
        }
      } catch (error) {
        console.error('[Chaospace Transfer] unexpected error', item.id, error);
        emitProgress(jobId, {
          stage: 'item:error',
          message: `《${item.title}》出现异常：${error.message || '未知错误'}`,
          current: index,
          total,
          level: 'error'
        });
        results.push({
          id: item.id,
          title: item.title,
          status: 'failed',
          message: error.message || '未知错误'
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;
    const failedCount = results.length - successCount - skippedCount;

    const summary = `成功 ${successCount} 项，跳过 ${skippedCount} 项，失败 ${failedCount} 项`;

    emitProgress(jobId, {
      stage: 'summary',
      message: summary,
      statusMessage: failedCount ? '部分转存完成' : '转存完成',
      level: failedCount ? 'warning' : 'success'
    });

    try {
      await recordTransferHistory(payload, { results, summary });
    } catch (historyError) {
      console.warn('[Chaospace Transfer] Failed to record transfer history', historyError);
    }

    try {
      await persistCacheNow();
    } catch (cacheError) {
      console.warn('[Chaospace Transfer] Failed to persist cache after transfer', cacheError);
    }

    return { jobId, results, summary };
  } catch (error) {
    emitProgress(jobId, {
      stage: 'fatal',
      message: error.message || '转存过程失败',
      level: 'error',
      statusMessage: '转存失败'
    });
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'chaospace:check-updates') {
    handleCheckUpdatesRequest(message.payload || {})
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        sendResponse({ ok: false, error: error.message || '检测更新失败' });
      });
    return true;
  }

  if (message?.type === 'chaospace:transfer') {
    const payload = message.payload || {};
    if (payload.jobId) {
      jobContexts.set(payload.jobId, {
        tabId: sender?.tab?.id,
        frameId: typeof sender?.frameId === 'number' ? sender.frameId : undefined
      });
    }
    handleTransfer(payload)
      .then(result => {
        sendResponse({ ok: true, ...result });
      })
      .catch(error => {
        sendResponse({ ok: false, error: error.message });
      })
      .finally(() => {
        if (payload.jobId) {
          jobContexts.delete(payload.jobId);
        }
      });
    return true;
  }
  return false;
});
