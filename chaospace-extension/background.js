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
const jobContexts = new Map();

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
  logStage(jobId, 'list', `目录缓存完成：${normalized}${contextLabel}（共 ${collected.size} 项）`);
  return collected;
}

async function ensureDirectoryExists(path, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  const normalized = normalizePath(path);
  if (normalized === '/') {
    logStage(jobId, 'list', '根目录无需创建');
    return normalized;
  }

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
      ensuredDirectories.add(current);
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
    ensuredDirectories.add(current);
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

      const detail = await fetchLinkDetail(origin, item.id, { jobId, context: item.title });
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

      try {
        emitProgress(jobId, {
          stage: 'item:meta',
          message: `解析分享信息《${item.title}》`,
          current: index,
          total
        });

        const meta = await fetchShareMetadata(detail.linkUrl, detail.passCode, bdstoken, { jobId, context: item.title });
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
