import { DIRECTORY_LIST_PAGE_SIZE, PAN_BASE_HEADERS, TOKEN_TTL } from '../common/constants'
import {
  createLoginRequiredError,
  maybeHandleLoginRequired,
  redirectToBaiduLogin,
} from '../common/errors'
import {
  ensureCacheLoaded,
  getCachedDirectoryEntries,
  recordDirectoryCache,
  markDirectoryEnsured,
  isDirectoryEnsured,
} from '../storage/cache-store'
import { normalizePath } from '../utils/path'
import { buildSurl } from '../utils/share'
import type { TransferRuntimeOptions } from '../types'

interface VerifyShareResult {
  errno: number
  message?: string
}

export interface ShareMetadataSuccess {
  shareId: string
  userId: string
  fsIds: number[]
  fileNames: string[]
  entries: ShareFileEntry[]
}

export type ShareMetadata = ShareMetadataSuccess | { error: number | string }

export interface ShareFileEntry {
  fsId: number
  serverFilename: string
  isDir: boolean
  size: number
  path: string
}

interface DirectoryEntry {
  server_filename?: string
}

interface ShareMetadataPayload {
  shareid?: string | number
  share_uk?: string | number
  file_list?: Array<{
    fs_id?: number | string
    server_filename?: string
    isdir?: number
    size?: number
    path?: string
  }>
}

interface ShareListEntryPayload {
  fs_id?: number | string
  server_filename?: string
  isdir?: number | string
  size?: number | string
  path?: string
}

interface ShareListResponse {
  errno?: number
  list?: ShareListEntryPayload[]
  has_more?: number | string | boolean
}

export interface TransferShareMeta {
  shareId: string
  userId: string
  fsIds: number[]
}

interface ListResponse {
  errno: number
  list?: DirectoryEntry[]
  has_more?: number | string
}

interface VerifyResponse {
  errno?: number
  show_msg?: string
  msg?: string
  tip?: string
  randsk?: string
}

type FetchJsonOptions = RequestInit & {
  headers?: Record<string, string>
}

let cachedBdstoken: string | null = null
let cachedBdstokenAt = 0
const SHARE_LIST_PAGE_SIZE = 100

function withPanHeaders(
  headers: Record<string, string> = {},
  referer = 'https://pan.baidu.com/',
): Record<string, string> {
  return {
    ...PAN_BASE_HEADERS,
    Referer: referer,
    ...headers,
  }
}

const normalizeShareDirPath = (dir: string): string => {
  if (!dir || typeof dir !== 'string') {
    return '/'
  }
  const trimmed = dir.trim()
  if (!trimmed) {
    return '/'
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function fetchJson<T = any>(
  url: string,
  options: FetchJsonOptions = {},
  referer = 'https://pan.baidu.com/',
): Promise<T> {
  const { headers, ...rest } = options
  const response = await fetch(url, {
    credentials: 'include',
    headers: withPanHeaders(headers, referer),
    ...rest,
  })
  if (!response.ok) {
    throw new Error(`请求失败：${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export function getCookie(
  details: chrome.cookies.CookieDetails,
): Promise<chrome.cookies.Cookie | null> {
  return new Promise((resolve) => {
    try {
      chrome.cookies.get(details, (cookie) => {
        if (chrome.runtime.lastError) {
          console.warn('[Chaospace Transfer] cookies.get failed', chrome.runtime.lastError.message)
          resolve(null)
          return
        }
        resolve(cookie || null)
      })
    } catch (error) {
      console.warn('[Chaospace Transfer] cookies.get threw error', error)
      resolve(null)
    }
  })
}

export async function hasPanLoginCookie(): Promise<boolean> {
  const cookie = await getCookie({ url: 'https://pan.baidu.com/', name: 'BDUSS' })
  return Boolean(cookie && typeof cookie.value === 'string' && cookie.value)
}

export async function ensurePanSessionAvailable(context = ''): Promise<void> {
  const hasLogin = await hasPanLoginCookie()
  if (!hasLogin) {
    redirectToBaiduLogin(context)
    throw createLoginRequiredError()
  }
}

export async function ensureBdstoken(force = false): Promise<string> {
  const now = Date.now()
  if (!force && cachedBdstoken && now - cachedBdstokenAt < TOKEN_TTL) {
    return cachedBdstoken
  }
  await ensurePanSessionAvailable('ensure-bdstoken')
  const response = await fetch('https://pan.baidu.com/disk/home', {
    credentials: 'include',
    headers: withPanHeaders(),
  })
  if (!response.ok) {
    throw new Error(`获取网盘页面失败：${response.status}`)
  }
  const html = await response.text()
  const match = html.match(/"bdstoken"\s*:\s*"([^"]+)"/)
  const token = match?.[1]
  if (!token) {
    throw new Error('未获取到 bdstoken，请确认已登录百度网盘')
  }
  cachedBdstoken = token
  cachedBdstokenAt = now
  return token
}

export async function verifySharePassword(
  linkUrl: string,
  passCode: string,
  bdstoken: string,
  options: TransferRuntimeOptions = {},
): Promise<VerifyShareResult> {
  const { jobId, context = '', logStage } = options
  const titleLabel = context ? `《${context}》` : '资源'
  if (!passCode) {
    return { errno: 0 }
  }

  const surl = buildSurl(linkUrl)
  if (!surl) {
    logStage?.(jobId, 'verify', `${titleLabel}无法解析分享标识，跳过验证`, { level: 'error' })
    return { errno: -1 }
  }

  console.log('[Chaospace Transfer] verifySharePassword params', {
    linkUrl,
    passCode,
    surl,
    surlLength: surl.length,
  })

  logStage?.(jobId, 'verify', `${titleLabel}校验提取码`, { detail: `surl=${surl}` })

  const url = `https://pan.baidu.com/share/verify?surl=${encodeURIComponent(surl)}&bdstoken=${encodeURIComponent(bdstoken)}&t=${Date.now()}&channel=chunlei&web=1&clienttype=0`
  const body = new URLSearchParams({
    pwd: passCode,
    vcode: '',
    vcode_str: '',
  })
  console.log('[Chaospace Transfer] verify request', {
    url,
    referer: 'https://pan.baidu.com',
    body: body.toString(),
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: withPanHeaders(
      {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      'https://pan.baidu.com',
    ),
    body: body.toString(),
    credentials: 'include',
  })
  const data = (await response.json()) as VerifyResponse
  if (typeof data.errno === 'number' && data.errno !== 0) {
    maybeHandleLoginRequired(data.errno, 'verify-share')
    const message = data.show_msg || data.msg || data.tip || ''
    logStage?.(
      jobId,
      'verify',
      `${titleLabel}提取码验证失败（errno ${data.errno}）${message ? `：${message}` : ''}`,
      {
        level: 'error',
        detail: message,
      },
    )
    console.warn('[Chaospace Transfer] verify share failed', {
      linkUrl,
      surl,
      errno: data.errno,
      message,
      raw: data,
    })
    return { errno: data.errno, message }
  }
  if (data.randsk) {
    await new Promise<void>((resolve) => {
      chrome.cookies.set(
        {
          url: 'https://pan.baidu.com/',
          name: 'BDCLND',
          value: data.randsk,
          domain: 'pan.baidu.com',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'no_restriction',
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn('设置 BDCLND Cookie 失败：', chrome.runtime.lastError.message)
          }
          resolve()
        },
      )
    })
  }
  logStage?.(jobId, 'verify', `${titleLabel}提取码验证通过`, { level: 'success' })
  return { errno: 0 }
}

export async function fetchShareMetadata(
  linkUrl: string,
  passCode: string,
  bdstoken: string,
  options: TransferRuntimeOptions = {},
): Promise<ShareMetadata> {
  const { jobId, context = '', logStage } = options
  const titleLabel = context ? `《${context}》` : '资源'
  if (passCode) {
    const verifyResult = await verifySharePassword(linkUrl, passCode, bdstoken, options)
    if (verifyResult.errno && verifyResult.errno !== 0) {
      console.warn('[Chaospace Transfer] verify password failed', linkUrl, verifyResult.errno)
      logStage?.(jobId, 'verify', `${titleLabel}提取码验证失败（errno ${verifyResult.errno}）`, {
        level: 'error',
      })
      return { error: verifyResult.errno }
    }
    await delay(100)
  }

  let linkToFetch = linkUrl
  try {
    const shareUrl = new URL(linkUrl)
    if (passCode && !shareUrl.searchParams.get('pwd')) {
      shareUrl.searchParams.set('pwd', passCode)
    }
    linkToFetch = shareUrl.toString()
  } catch (_error) {
    linkToFetch = linkUrl
  }

  logStage?.(jobId, 'list', `${titleLabel}请求分享页面`)
  const response = await fetch(linkToFetch, {
    credentials: 'include',
    headers: withPanHeaders({}, linkToFetch),
  })
  if (!response.ok) {
    const message = `访问分享链接失败：${response.status}`
    console.warn('[Chaospace Transfer] fetch share page failed', linkUrl, message)
    logStage?.(jobId, 'list', `${titleLabel}访问分享页失败（${response.status}）`, {
      level: 'error',
      detail: message,
    })
    return { error: message }
  }
  logStage?.(jobId, 'list', `${titleLabel}获取分享页面成功，开始解析`)
  const html = await response.text()
  const match = html.match(/locals\.mset\((\{[\s\S]*?\})\);/)
  if (!match) {
    console.warn('[Chaospace Transfer] locals.mset missing', linkUrl)
    logStage?.(jobId, 'list', `${titleLabel}未解析到分享元数据`, { level: 'error' })
    return { error: '未解析到分享元数据' }
  }

  const rawMeta = match[1]
  if (!rawMeta) {
    logStage?.(jobId, 'list', `${titleLabel}未解析到分享元数据内容`, { level: 'error' })
    return { error: '未解析到分享元数据' }
  }

  let meta: ShareMetadataPayload
  try {
    meta = JSON.parse(rawMeta) as ShareMetadataPayload
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Chaospace Transfer] share metadata json parse failed', linkUrl, error)
    logStage?.(jobId, 'list', `${titleLabel}解析分享元数据失败：${message}`, { level: 'error' })
    return { error: `解析分享元数据失败：${message}` }
  }

  const shareId = meta.shareid
  const userId = meta.share_uk
  const fileList = Array.isArray(meta.file_list) ? meta.file_list : []

  logStage?.(jobId, 'list', `${titleLabel}解析文件列表，共 ${fileList.length} 项`)
  const fsIds: number[] = []
  const fileNames: string[] = []
  const entries: ShareFileEntry[] = []
  for (const entry of fileList) {
    if (!entry) continue
    if (entry.isdir === 0 && entry.size === 0) {
      continue
    }
    const numericId = Number(entry.fs_id)
    if (!Number.isFinite(numericId)) {
      continue
    }
    fsIds.push(numericId)
    const serverFilename =
      typeof entry.server_filename === 'string' ? entry.server_filename : String(entry.fs_id ?? '')
    fileNames.push(serverFilename)
    const rawPath = typeof entry.path === 'string' ? entry.path : ''
    entries.push({
      fsId: numericId,
      serverFilename,
      isDir: Number(entry.isdir) === 1,
      size: typeof entry.size === 'number' ? entry.size : Number(entry.size) || 0,
      path: rawPath && rawPath.trim() ? rawPath : `/${serverFilename}`,
    })
  }

  if (!shareId) {
    logStage?.(jobId, 'list', `${titleLabel}缺少 shareId`, { level: 'error' })
    return { error: -1 }
  }
  if (!userId) {
    logStage?.(jobId, 'list', `${titleLabel}缺少 userId`, { level: 'error' })
    return { error: -2 }
  }
  if (!fsIds.length) {
    logStage?.(jobId, 'list', `${titleLabel}未找到有效文件`, { level: 'error' })
    return { error: -3 }
  }

  logStage?.(jobId, 'list', `${titleLabel}元数据准备完成`)
  return {
    shareId: String(shareId),
    userId: String(userId),
    fsIds,
    fileNames,
    entries,
  }
}

export async function checkDirectoryExists(
  path: string,
  bdstoken: string,
  options: TransferRuntimeOptions = {},
): Promise<boolean> {
  const { jobId, context = '', logStage } = options
  const normalized = normalizePath(path)
  if (normalized === '/') {
    logStage?.(jobId, 'list', '根目录已存在')
    return true
  }

  await ensureCacheLoaded()

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
    channel: 'web',
  })

  const url = `https://pan.baidu.com/api/list?${params.toString()}`
  const contextLabel = context ? `（${context}）` : ''
  logStage?.(jobId, 'list', `请求目录列表：${normalized}${contextLabel}`)
  const data = await fetchJson<ListResponse>(url, {}, 'https://pan.baidu.com/disk/home')
  if (data.errno === 0) {
    logStage?.(jobId, 'list', `目录已就绪：${normalized}${contextLabel}`)
    return true
  }

  if (data.errno === -9 || data.errno === 2 || data.errno === 12 || data.errno === 31066) {
    console.log('[Chaospace Transfer] directory missing, preparing to create', {
      path: normalized,
      errno: data.errno,
    })
    logStage?.(
      jobId,
      'list',
      `目录缺失：${normalized}${contextLabel}（errno ${data.errno}），准备创建`,
      { level: 'warning' },
    )
    return false
  }

  if (maybeHandleLoginRequired(data.errno, 'list-directory')) {
    throw createLoginRequiredError()
  }

  console.warn('[Chaospace Transfer] directory existence check failed', {
    path: normalized,
    errno: data.errno,
    raw: data,
  })
  logStage?.(jobId, 'list', `查询目录失败：${normalized}${contextLabel}（errno ${data.errno}）`, {
    level: 'error',
  })
  throw new Error(`查询目录失败(${normalized})：${data.errno}`)
}

export async function fetchDirectoryFileNames(
  path: string,
  bdstoken: string,
  options: TransferRuntimeOptions = {},
): Promise<Set<string>> {
  const { jobId, context = '', logStage } = options
  const normalized = normalizePath(path)
  if (normalized === '/') {
    logStage?.(jobId, 'list', '根目录不缓存文件清单')
    return new Set()
  }

  await ensureCacheLoaded()

  const cached = getCachedDirectoryEntries(normalized)
  if (cached) {
    logStage?.(jobId, 'list', `使用目录缓存：${normalized}（${cached.size} 项）`)
    return cached
  }

  const collected = new Set<string>()
  let start = 0
  const contextLabel = context ? `（${context}）` : ''
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
      channel: 'web',
    })

    const url = `https://pan.baidu.com/api/list?${params.toString()}`
    logStage?.(jobId, 'list', `拉取目录条目：${normalized}${contextLabel} · 起始 ${start}`)
    const data = await fetchJson<ListResponse & { list?: DirectoryEntry[] }>(
      url,
      {},
      'https://pan.baidu.com/disk/home',
    )
    if (data.errno !== 0) {
      if (maybeHandleLoginRequired(data.errno, 'list-directory')) {
        throw createLoginRequiredError()
      }
      logStage?.(
        jobId,
        'list',
        `目录枚举失败：${normalized}${contextLabel}（errno ${data.errno}）`,
        { level: 'error' },
      )
      throw new Error(`查询目录内容失败(${normalized})：${data.errno}`)
    }

    const entries = Array.isArray(data.list) ? data.list : []
    logStage?.(
      jobId,
      'list',
      `目录返回 ${entries.length} 项：${normalized}${contextLabel}（has_more=${data.has_more}）`,
    )
    for (const entry of entries) {
      if (!entry || typeof entry.server_filename !== 'string') {
        continue
      }
      collected.add(entry.server_filename)
    }

    const hasMore = Number(data.has_more) === 1
    if (!hasMore || !entries.length) {
      break
    }
    start += entries.length
  }

  recordDirectoryCache(normalized, collected)
  logStage?.(jobId, 'list', `目录缓存完成：${normalized}${contextLabel}（共 ${collected.size} 项）`)
  return new Set(collected)
}

export async function fetchShareDirectoryEntries(
  shareId: string,
  userId: string,
  dir: string,
  bdstoken: string,
  passCode: string,
  referer: string,
  options: TransferRuntimeOptions = {},
): Promise<ShareFileEntry[]> {
  const { jobId, context = '', logStage } = options
  const normalizedDir = normalizeShareDirPath(dir)
  const entries: ShareFileEntry[] = []
  let start = 0
  const contextLabel = context ? `（${context}）` : ''

  while (true) {
    const params = new URLSearchParams({
      shareid: shareId,
      uk: userId,
      dir: normalizedDir,
      start: String(start),
      limit: String(SHARE_LIST_PAGE_SIZE),
      order: 'name',
      desc: '0',
      web: '1',
      channel: 'chunlei',
      clienttype: '0',
      app_id: '250528',
    })
    if (passCode) {
      params.set('pwd', passCode)
    }
    if (bdstoken) {
      params.set('bdstoken', bdstoken)
    }

    const url = `https://pan.baidu.com/share/list?${params.toString()}`
    logStage?.(jobId, 'list', `枚举分享目录：${normalizedDir}${contextLabel} · 起始 ${start}`)
    const response = await fetch(url, {
      credentials: 'include',
      headers: withPanHeaders({}, referer || 'https://pan.baidu.com/disk/home'),
    })

    const data = (await response.json()) as ShareListResponse
    const errno = typeof data.errno === 'number' ? data.errno : -1
    if (errno !== 0) {
      if (maybeHandleLoginRequired(errno, 'share-list')) {
        throw createLoginRequiredError()
      }
      logStage?.(
        jobId,
        'list',
        `分享目录枚举失败：${normalizedDir}${contextLabel}（errno ${errno}）`,
        {
          level: 'error',
        },
      )
      throw new Error(`分享目录枚举失败(${normalizedDir})：${errno}`)
    }

    const list = Array.isArray(data.list) ? data.list : []
    for (const entry of list) {
      if (!entry) {
        continue
      }
      const numericId = Number(entry.fs_id)
      if (!Number.isFinite(numericId)) {
        continue
      }
      const serverFilename =
        typeof entry.server_filename === 'string'
          ? entry.server_filename
          : String(entry.fs_id ?? '')
      const rawPath = typeof entry.path === 'string' ? entry.path : ''
      entries.push({
        fsId: numericId,
        serverFilename,
        isDir: Number(entry.isdir) === 1,
        size: typeof entry.size === 'number' ? entry.size : Number(entry.size) || 0,
        path: rawPath && rawPath.trim() ? rawPath : `${normalizedDir}/${serverFilename}`,
      })
    }

    const hasMore =
      data.has_more === true ||
      data.has_more === 1 ||
      data.has_more === '1' ||
      (typeof data.has_more === 'string' && data.has_more !== '0')
    if (!hasMore || !list.length) {
      break
    }
    start += list.length
  }

  logStage?.(
    jobId,
    'list',
    `分享目录枚举完成：${normalizedDir}${contextLabel}（${entries.length} 项）`,
  )
  return entries
}

export async function ensureDirectoryExists(
  path: string,
  bdstoken: string,
  options: TransferRuntimeOptions = {},
): Promise<string> {
  const { jobId, context = '', logStage } = options
  const normalized = normalizePath(path)
  if (normalized === '/') {
    logStage?.(jobId, 'list', '根目录无需创建')
    markDirectoryEnsured('/')
    return normalized
  }

  await ensureCacheLoaded()

  if (isDirectoryEnsured(normalized)) {
    logStage?.(jobId, 'list', `目录已缓存：${normalized}`)
    return normalized
  }

  const segments = normalized.split('/').filter(Boolean)
  let current = ''
  const contextLabel = context ? `（${context}）` : ''
  logStage?.(jobId, 'list', `确认目录链：${normalized}${contextLabel}`)
  for (const segment of segments) {
    current += `/${segment}`
    if (isDirectoryEnsured(current)) {
      continue
    }
    const exists = await checkDirectoryExists(current, bdstoken, options)
    if (exists) {
      markDirectoryEnsured(current)
      continue
    }
    const url = `https://pan.baidu.com/api/create?a=commit&bdstoken=${encodeURIComponent(bdstoken)}`
    const body = new URLSearchParams({
      path: current,
      isdir: '1',
      size: '0',
      block_list: '[]',
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: withPanHeaders(
        {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        'https://pan.baidu.com/disk/home',
      ),
      credentials: 'include',
      body: body.toString(),
    })

    logStage?.(jobId, 'list', `创建目录：${current}${contextLabel}`)
    const data = await response.json()
    if (maybeHandleLoginRequired(data.errno, 'create-directory')) {
      throw createLoginRequiredError()
    }
    if (data.errno !== 0 && data.errno !== -8 && data.errno !== 31039) {
      logStage?.(jobId, 'list', `创建目录失败：${current}${contextLabel}（errno ${data.errno}）`, {
        level: 'error',
      })
      throw new Error(`创建目录失败(${current})：${data.errno}`)
    }
    logStage?.(
      jobId,
      'list',
      `目录创建完成：${current}${contextLabel}${data.errno === -8 || data.errno === 31039 ? '（已存在）' : ''}`,
      {
        level: 'success',
      },
    )
    markDirectoryEnsured(current)
    await delay(100)
  }

  return normalized
}

export async function transferShare(
  meta: TransferShareMeta,
  targetPath: string,
  bdstoken: string,
  referer = 'https://pan.baidu.com/disk/home',
): Promise<number> {
  const url = `https://pan.baidu.com/share/transfer?shareid=${encodeURIComponent(meta.shareId)}&from=${encodeURIComponent(meta.userId)}&bdstoken=${encodeURIComponent(bdstoken)}&channel=chunlei&web=1&clienttype=0`
  const body = new URLSearchParams({
    fsidlist: JSON.stringify(meta.fsIds),
    path: targetPath,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: withPanHeaders(
      {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      referer,
    ),
    credentials: 'include',
    body: body.toString(),
  })

  const data = await response.json()
  maybeHandleLoginRequired(data.errno, 'transfer-share')
  return typeof data.errno === 'number' ? data.errno : -999
}
