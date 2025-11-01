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

async function verifySharePassword(linkUrl, passCode, bdstoken) {
  if (!passCode) {
    return { errno: 0 };
  }
  const surl = buildSurl(linkUrl);
  if (!surl) {
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
  return { errno: 0 };
}

async function fetchShareMetadata(linkUrl, passCode, bdstoken) {
  // 如果有提取码,必须先验证并等待 Cookie 设置完成
  if (passCode) {
    const verifyResult = await verifySharePassword(linkUrl, passCode, bdstoken);
    if (verifyResult.errno && verifyResult.errno !== 0) {
      console.warn('[Chaospace Transfer] verify password failed', linkUrl, verifyResult.errno);
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

  const response = await fetch(linkToFetch, {
    credentials: 'include',
    headers: withPanHeaders({}, linkToFetch)
  });
  if (!response.ok) {
    const message = `访问分享链接失败：${response.status}`;
    console.warn('[Chaospace Transfer] fetch share page failed', linkUrl, message);
    return { error: message };
  }
  const html = await response.text();
  const match = html.match(/locals\.mset\((\{[\s\S]*?\})\);/);
  if (!match) {
    console.warn('[Chaospace Transfer] locals.mset missing', linkUrl);
    return { error: '未解析到分享元数据' };
  }

  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch (error) {
    console.error('[Chaospace Transfer] share metadata json parse failed', linkUrl, error);
    return { error: `解析分享元数据失败：${error.message}` };
  }

  const shareId = meta.shareid;
  const userId = meta.share_uk;
  const fileList = Array.isArray(meta.file_list) ? meta.file_list : [];

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
    return { error: -1 };
  }
  if (!userId) {
    return { error: -2 };
  }
  if (!fsIds.length) {
    return { error: -3 };
  }

  return {
    shareId: String(shareId),
    userId: String(userId),
    fsIds,
    fileNames
  };
}

async function ensureDirectoryExists(path, bdstoken) {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return normalized;
  }

  if (ensuredDirectories.has(normalized)) {
    return normalized;
  }

  const segments = normalized.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    if (ensuredDirectories.has(current)) {
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

    const data = await response.json();
    if (data.errno !== 0 && data.errno !== -8 && data.errno !== 31039) {
      throw new Error(`创建目录失败(${current})：${data.errno}`);
    }
    ensuredDirectories.add(current);
  }
  return normalized;
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

async function fetchLinkDetail(origin, id) {
  const url = `${origin.replace(/\/$/, '')}/links/${id}.html`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    return { error: `获取资源链接失败：${response.status}` };
  }
  const html = await response.text();
  const parsed = parseLinkPage(html);
  if (!parsed) {
    return { error: '页面中未找到百度网盘链接' };
  }
  return parsed;
}

async function handleTransfer(request) {
  const { origin, items, targetDirectory } = request.payload;
  if (!Array.isArray(items) || !items.length) {
    return { results: [], summary: '没有可处理的条目' };
  }

  const bdstoken = await ensureBdstoken();
  const normalizedBaseDir = normalizePath(targetDirectory || '/');
  await ensureDirectoryExists(normalizedBaseDir, bdstoken);

  const results = [];

  for (const item of items) {
    const detail = await fetchLinkDetail(origin, item.id);
    if (detail.error) {
      console.log('[Chaospace Transfer] link detail failed', item.id, detail.error);
      results.push({
        id: item.id,
        title: item.title,
        status: 'failed',
        message: detail.error
      });
      continue;
    }

    try {
      const meta = await fetchShareMetadata(detail.linkUrl, detail.passCode, bdstoken);
      if (meta.error) {
        const errno = typeof meta.error === 'number' ? meta.error : -9999;
        const message = mapErrorMessage(errno, typeof meta.error === 'string' ? meta.error : '');
        console.log('[Chaospace Transfer] metadata error', item.id, errno, message);
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
      await ensureDirectoryExists(targetPath, bdstoken);
      const referer = detail.linkUrl ? detail.linkUrl : 'https://pan.baidu.com/disk/home';
      const errno = await transferShare(meta, targetPath, bdstoken, referer);
      if (errno === 0 || errno === 666) {
        results.push({
          id: item.id,
          title: item.title,
          status: errno === 0 ? 'success' : 'skipped',
          message: mapErrorMessage(errno, '操作成功'),
          files: meta.fileNames,
          linkUrl: detail.linkUrl,
          passCode: detail.passCode
        });
      } else {
        const message = mapErrorMessage(errno);
        console.log('[Chaospace Transfer] transfer failed', item.id, errno, message);
        results.push({
          id: item.id,
          title: item.title,
          status: 'failed',
          message,
          errno
        });
      }
    } catch (error) {
      console.error('[Chaospace Transfer] unexpected error', item.id, error);
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

  return { results, summary };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'chaospace:transfer') {
    handleTransfer(message)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
