import {
  ensureBdstoken,
  fetchShareMetadata,
  ensureDirectoryExists,
  fetchDirectoryFileNames,
  transferShare,
  fetchShareDirectoryEntries,
  renameEntry,
} from '../api/baidu-pan'
import { fetchLinkDetail } from '../api/chaospace'
import type { LinkDetailResult } from '../api/chaospace'
import {
  ensureCacheLoaded,
  persistCacheNow,
  hasCompletedShare,
  recordCompletedShare,
  invalidateDirectoryCaches,
} from '../storage/cache-store'
import { recordTransferHistory } from '../storage/history-store'
import { mapErrorMessage } from '../common/errors'
import { MAX_TRANSFER_ATTEMPTS, TRANSFER_RETRYABLE_ERRNOS } from '../common/constants'
import { normalizePath } from '../utils/path'
import { sanitizeLink } from '@/shared/utils/sanitizers'
import { buildSurl } from '../utils/share'
import type { ShareMetadataSuccess, TransferShareMeta, ShareFileEntry } from '../api/baidu-pan'
import type { TransferRuntimeOptions, ProgressLogger } from '../types'
import type {
  TransferRequestPayload,
  TransferResponsePayload,
  TransferResultEntry,
  RenameResultDetail,
} from '@/shared/types/transfer'
import {
  applyFileFilters,
  buildRenamePlan,
  loadProcessingSettings,
  type FilterSkipInfo,
  type RenamePlanEntry,
} from './file-rules'

type ProgressPayload = Record<string, unknown>

interface ProgressHandlers {
  emitProgress: (jobId: string | undefined, data: ProgressPayload) => void
  logStage: ProgressLogger
}

interface FilteredTransferMeta {
  fsIds: number[]
  fileNames: string[]
  skippedFiles: string[]
  existingNames: Set<string>
}

interface RenameExecutionResult {
  finalNames: string[]
  details: RenameResultDetail[]
}

const FILTER_RULE_SUMMARY_LIMIT = 5
const FILTER_RULE_SAMPLE_LIMIT = 4
const RENAME_RULE_SUMMARY_LIMIT = 6
const RENAME_RULE_SAMPLE_LIMIT = 4

let progressHandlers: ProgressHandlers = {
  emitProgress: () => {
    /* noop */
  },
  logStage: () => {
    /* noop */
  },
}

export function setProgressHandlers(handlers: Partial<ProgressHandlers> = {}): void {
  progressHandlers = {
    emitProgress: handlers.emitProgress ?? progressHandlers.emitProgress,
    logStage: handlers.logStage ?? progressHandlers.logStage,
  }
}

function emitProgress(jobId: string | undefined, data: ProgressPayload): void {
  progressHandlers.emitProgress(jobId, data)
}

function logStage(
  jobId: string | undefined,
  stage: string,
  message: string,
  extra?: Parameters<ProgressLogger>[3],
): void {
  progressHandlers.logStage(jobId, stage, message, extra)
}

function buildInfoExtra(detail?: string): Parameters<ProgressLogger>[3] {
  if (typeof detail === 'string' && detail.length) {
    return { level: 'info', detail }
  }
  return { level: 'info' }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const PATH_MISSING_REGEX = /(路径|目录).*(不存在)|path\s+does\s+not\s+exist/i

function isTransferPathMissing(errno: number, showMsg: string | undefined): boolean {
  if (errno !== 2) {
    return false
  }
  if (!showMsg) {
    return false
  }
  return PATH_MISSING_REGEX.test(showMsg)
}

type ShareEntry = ShareMetadataSuccess['entries'] extends Array<infer Item> ? Item : never

function getSingleRootDirectoryEntry(meta: ShareMetadataSuccess | null): ShareEntry | null {
  if (!meta || !Array.isArray(meta.entries) || meta.entries.length !== 1) {
    return null
  }
  const [entry] = meta.entries
  if (!entry || !entry.isDir) {
    return null
  }
  const hasName = typeof entry.serverFilename === 'string' && entry.serverFilename.trim()
  if (!hasName) {
    return null
  }
  const rawPath = typeof entry.path === 'string' ? entry.path.trim() : ''
  const normalizedPath = rawPath
    ? rawPath.startsWith('/')
      ? rawPath
      : `/${rawPath}`
    : `/${entry.serverFilename}`
  return { ...entry, path: normalizedPath }
}

async function maybeStripShareRootDirectory(
  meta: ShareMetadataSuccess,
  detail: LinkDetailResult,
  bdstoken: string,
  options: TransferRuntimeOptions,
): Promise<void> {
  const candidate = getSingleRootDirectoryEntry(meta)
  if (!candidate) {
    return
  }
  const referer = detail.linkUrl || 'https://pan.baidu.com/disk/home'
  const dirPath = candidate.path || `/${candidate.serverFilename}`
  const { jobId, context = '' } = options
  const titleLabel = context ? `《${context}》` : '资源'
  logStage(jobId, 'list', `${titleLabel}检测到独立根目录：${candidate.serverFilename}，准备剥离`)
  try {
    const entries = await fetchShareDirectoryEntries(
      meta.shareId,
      meta.userId,
      dirPath,
      bdstoken,
      detail.passCode,
      referer,
      meta.seKey,
      options,
    )
    if (!entries.length) {
      logStage(jobId, 'list', `${titleLabel}根目录为空：${candidate.serverFilename}`)
      return
    }
    meta.fsIds = entries.map((entry) => entry.fsId)
    meta.fileNames = entries.map((entry) => entry.serverFilename)
    meta.entries = entries
    logStage(
      jobId,
      'list',
      `${titleLabel}根目录已剥离：${candidate.serverFilename}（${entries.length} 项）`,
      {
        level: 'success',
      },
    )
  } catch (error) {
    const err = error as Error
    console.warn('[Chaospace Transfer] strip root directory failed', {
      shareId: meta.shareId,
      dir: dirPath,
      error: err?.message,
    })
    logStage(
      jobId,
      'list',
      `${titleLabel}剥离根目录失败：${candidate.serverFilename}，将按原结构转存`,
      {
        level: 'warning',
        detail: err?.message,
      },
    )
  }
}

async function filterAlreadyTransferred(
  meta: ShareMetadataSuccess,
  targetPath: string,
  bdstoken: string,
  options: TransferRuntimeOptions = {},
): Promise<FilteredTransferMeta> {
  const { jobId, context = '' } = options
  if (!Array.isArray(meta.fsIds) || !meta.fsIds.length) {
    return { fsIds: [], fileNames: [], skippedFiles: [], existingNames: new Set<string>() }
  }

  try {
    logStage(jobId, 'list', `过滤已存在文件：${targetPath}${context ? `（${context}）` : ''}`)
    const directoryOptions: TransferRuntimeOptions = { context }
    if (jobId) {
      directoryOptions.jobId = jobId
    }
    const existingNames = await fetchDirectoryFileNames(targetPath, bdstoken, directoryOptions)
    if (!existingNames.size) {
      logStage(jobId, 'list', `目录为空：${targetPath}${context ? `（${context}）` : ''}`)
      return {
        fsIds: meta.fsIds.slice(),
        fileNames: Array.isArray(meta.fileNames) ? meta.fileNames.slice() : [],
        skippedFiles: [],
        existingNames,
      }
    }

    const filteredFsIds: number[] = []
    const filteredFileNames: string[] = []
    const skippedFiles: string[] = []

    const names = Array.isArray(meta.fileNames) ? meta.fileNames : []
    let skippedCount = 0
    meta.fsIds.forEach((fsId, index) => {
      const name = names[index]
      if (typeof name === 'string' && existingNames.has(name)) {
        skippedFiles.push(name)
        skippedCount += 1
        return
      }
      filteredFsIds.push(fsId)
      if (typeof name === 'string') {
        filteredFileNames.push(name)
      }
    })

    if (skippedCount) {
      logStage(jobId, 'list', `检测到已转存文件：跳过 ${skippedCount} 项`, { level: 'warning' })
    } else {
      logStage(jobId, 'list', '未发现已存在的文件')
    }

    return {
      fsIds: filteredFsIds,
      fileNames: filteredFileNames,
      skippedFiles,
      existingNames,
    }
  } catch (error) {
    const err = error as Error & { code?: string }
    if (err?.code === 'PAN_LOGIN_REQUIRED') {
      throw err
    }
    console.warn('[Chaospace Transfer] directory listing failed, proceeding without skip filter', {
      path: targetPath,
      error: err?.message,
    })
    logStage(
      jobId,
      'list',
      `目录检查失败，跳过去重：${targetPath}${context ? `（${context}）` : ''}`,
      {
        level: 'warning',
        detail: err?.message,
      },
    )
    return {
      fsIds: meta.fsIds.slice(),
      fileNames: Array.isArray(meta.fileNames) ? meta.fileNames.slice() : [],
      skippedFiles: [],
      existingNames: new Set<string>(),
    }
  }
}

async function transferWithRetry(
  meta: TransferShareMeta,
  targetPath: string,
  bdstoken: string,
  referer: string,
  maxAttempts = MAX_TRANSFER_ATTEMPTS,
  options: TransferRuntimeOptions = {},
): Promise<{ errno: number; attempts: number; showMsg?: string; pathMissing?: boolean }> {
  const { jobId, context = '' } = options
  const titleLabel = context ? `《${context}》` : '资源'
  const detail = `目标：${targetPath}`
  let attempt = 0
  let errno = -999
  let lastShowMsg: string | undefined
  let lastPathMissing = false

  const ensureOptions: TransferRuntimeOptions = { context, logStage }
  if (jobId) {
    ensureOptions.jobId = jobId
  }

  while (attempt < maxAttempts) {
    attempt += 1
    logStage(jobId, 'transfer', `${titleLabel}第 ${attempt} 次发送转存请求`, {
      detail,
    })
    const transferResult = await transferShare(meta, targetPath, bdstoken, referer)
    errno = transferResult.errno
    lastShowMsg = transferResult.showMsg
    lastPathMissing = isTransferPathMissing(errno, transferResult.showMsg)
    if (errno === 0 || errno === 666) {
      logStage(
        jobId,
        'transfer',
        `${titleLabel}转存成功（第 ${attempt} 次尝试${errno === 666 ? ' · 存在重复文件' : ''}）`,
        {
          level: 'success',
          detail,
        },
      )
      const successResult: {
        errno: number
        attempts: number
        showMsg?: string
        pathMissing?: boolean
      } = {
        errno,
        attempts: attempt,
      }
      if (transferResult.showMsg) {
        successResult.showMsg = transferResult.showMsg
      }
      return successResult
    }
    const shouldRetryBase = TRANSFER_RETRYABLE_ERRNOS.has(errno) && attempt < maxAttempts
    const shouldRetryForPath = lastPathMissing && attempt < maxAttempts
    const shouldRetry = shouldRetryBase || shouldRetryForPath
    logStage(
      jobId,
      'transfer',
      `${titleLabel}转存失败（第 ${attempt} 次，errno ${errno}）${shouldRetry ? '，准备重试' : ''}`,
      {
        level: shouldRetry ? 'warning' : 'error',
        detail: lastShowMsg ? `${detail} · ${lastShowMsg}` : detail,
      },
    )
    if (lastPathMissing) {
      logStage(jobId, 'list', `${titleLabel}检测到目标目录缺失，尝试重新创建`, {
        level: 'warning',
        detail,
      })
      try {
        await invalidateDirectoryCaches([targetPath])
      } catch (cacheError) {
        console.warn('[Chaospace Transfer] invalidate directory cache failed', {
          path: targetPath,
          error: (cacheError as Error)?.message,
        })
      }
      await ensureDirectoryExists(targetPath, bdstoken, ensureOptions)
      continue
    }
    if (!shouldRetry) {
      break
    }
    console.log('[Chaospace Transfer] transfer retry scheduled', {
      path: targetPath,
      errno,
      attempt,
    })
    await delay(500 * attempt)
  }

  logStage(jobId, 'transfer', `${titleLabel}转存最终失败（errno ${errno}）`, {
    level: 'error',
    detail: lastShowMsg ? `${detail} · ${lastShowMsg}` : detail,
  })
  const failureResult: {
    errno: number
    attempts: number
    showMsg?: string
    pathMissing?: boolean
  } = {
    errno,
    attempts: attempt,
    pathMissing: lastPathMissing,
  }
  if (lastShowMsg) {
    failureResult.showMsg = lastShowMsg
  }
  return failureResult
}

async function executeRenamePlan(
  plan: RenamePlanEntry[],
  targetPath: string,
  bdstoken: string,
  options: TransferRuntimeOptions = {},
): Promise<RenameExecutionResult> {
  const { jobId, context = '' } = options
  if (!Array.isArray(plan) || !plan.length) {
    return { finalNames: [], details: [] }
  }
  const normalizedTarget = normalizePath(targetPath)
  const details: RenameResultDetail[] = []
  const finalNames: string[] = []
  const changedCount = plan.filter((entry) => entry.changed).length
  const renameRuleSummaries = new Map<string, { count: number; samples: string[] }>()

  if (!changedCount) {
    plan.forEach((entry) => {
      finalNames.push(entry.originalName)
      details.push({
        from: entry.originalName,
        to: entry.finalName,
        status: 'unchanged',
        rules: entry.appliedRules.slice(),
      })
    })
    return { finalNames, details }
  }

  const titleLabel = context ? `《${context}》` : '资源'

  let successCount = 0
  let failureCount = 0

  for (const entry of plan) {
    const originalName = entry.originalName
    if (!entry.changed) {
      finalNames.push(originalName)
      details.push({
        from: originalName,
        to: entry.finalName,
        status: 'unchanged',
        rules: entry.appliedRules.slice(),
      })
      continue
    }
    const combinedPath = normalizePath(`${normalizedTarget}/${originalName}`)
    try {
      const result = await renameEntry(combinedPath, entry.finalName, bdstoken)
      if (result.errno === 0) {
        successCount += 1
        finalNames.push(entry.finalName)
        details.push({
          from: originalName,
          to: entry.finalName,
          status: 'success',
          rules: entry.appliedRules.slice(),
        })
        if (entry.appliedRules.length) {
          entry.appliedRules.forEach((ruleLabel) => {
            const label = ruleLabel?.trim() || '重命名规则'
            const summary = renameRuleSummaries.get(label) ?? { count: 0, samples: [] }
            summary.count += 1
            if (summary.samples.length < RENAME_RULE_SAMPLE_LIMIT) {
              summary.samples.push(`${originalName} → ${entry.finalName}`)
            }
            renameRuleSummaries.set(label, summary)
          })
        }
      } else {
        failureCount += 1
        const message = mapErrorMessage(result.errno, result.showMsg || '')
        finalNames.push(originalName)
        details.push({
          from: originalName,
          to: entry.finalName,
          status: 'failed',
          errno: result.errno,
          message,
          rules: entry.appliedRules.slice(),
        })
        logStage(jobId, 'rename', `${titleLabel}重命名失败：${originalName}`, {
          level: 'warning',
          detail: entry.appliedRules.length
            ? `规则：${entry.appliedRules.join('、')}｜${message || combinedPath}`
            : message || `${combinedPath}`,
        })
      }
    } catch (error) {
      failureCount += 1
      const err = error as Error
      finalNames.push(originalName)
      details.push({
        from: originalName,
        to: entry.finalName,
        status: 'failed',
        message: err.message || '重命名失败',
        rules: entry.appliedRules.slice(),
      })
      logStage(jobId, 'rename', `${titleLabel}重命名异常：${originalName}`, {
        level: 'warning',
        detail: entry.appliedRules.length
          ? `规则：${entry.appliedRules.join('、')}｜${err.message || combinedPath}`
          : err.message || `${combinedPath}`,
      })
    }
    await delay(120)
  }

  let renameRuleDetailText: string | undefined
  if (renameRuleSummaries.size) {
    const summaryEntries = Array.from(renameRuleSummaries.entries())
    const detailParts: string[] = []
    summaryEntries.slice(0, RENAME_RULE_SUMMARY_LIMIT).forEach(([ruleLabel, summary]) => {
      const sampleDetail = summary.samples.length ? `（${summary.samples.join('、')}）` : ''
      detailParts.push(`规则「${ruleLabel}」命中 ${summary.count} 项${sampleDetail}`)
    })
    if (summaryEntries.length > RENAME_RULE_SUMMARY_LIMIT) {
      const remainingRules = summaryEntries.length - RENAME_RULE_SUMMARY_LIMIT
      detailParts.push(`另有 ${remainingRules} 条规则命中`)
    }
    renameRuleDetailText = detailParts.join(' ｜ ')
  }

  if (successCount || failureCount) {
    const summaryDetail =
      failureCount > 0
        ? `成功 ${successCount} 项，失败 ${failureCount} 项`
        : `成功 ${successCount} 项`
    const detailParts: string[] = []
    if (renameRuleDetailText) {
      detailParts.push(renameRuleDetailText)
    }
    const logDetail = detailParts.length ? detailParts.join(' ｜ ') : undefined
    const logLevel = failureCount ? 'warning' : 'success'
    if (logDetail) {
      logStage(jobId, 'rename', `${titleLabel}重命名完成：${summaryDetail}`, {
        level: logLevel,
        detail: logDetail,
      })
    } else {
      logStage(jobId, 'rename', `${titleLabel}重命名完成：${summaryDetail}`, {
        level: logLevel,
      })
    }
  }

  return { finalNames, details }
}

export async function handleTransfer(
  payload: TransferRequestPayload,
): Promise<TransferResponsePayload> {
  const { origin, items, targetDirectory, jobId } = payload
  if (!Array.isArray(items) || !items.length) {
    emitProgress(jobId, {
      stage: 'idle',
      message: '没有可处理的条目',
      level: 'warning',
      statusMessage: '等待任务',
    })
    const emptyResponse: TransferResponsePayload = {
      results: [],
      summary: '没有可处理的条目',
    }
    if (jobId) {
      emptyResponse.jobId = jobId
    }
    return emptyResponse
  }

  const total = items.length

  try {
    emitProgress(jobId, {
      stage: 'bootstrap',
      message: '正在获取授权信息...',
      statusMessage: '正在获取授权信息...',
    })

    logStage(jobId, 'bstToken', '准备请求 bdstoken')
    let bdstoken: string
    try {
      bdstoken = await ensureBdstoken()
      logStage(jobId, 'bstToken', 'bdstoken 获取成功', { level: 'success' })
    } catch (error) {
      const err = error as Error
      logStage(jobId, 'bstToken', `bdstoken 获取失败：${err.message || '未知错误'}`, {
        level: 'error',
      })
      throw err
    }
    await ensureCacheLoaded()
    const normalizedBaseDir = normalizePath(targetDirectory || '/')

    emitProgress(jobId, {
      stage: 'prepare',
      message: `检查目标目录 ${normalizedBaseDir}`,
      statusMessage: `准备目录 ${normalizedBaseDir}`,
    })

    const baseDirOptions: TransferRuntimeOptions = {
      context: '全局目标目录',
      logStage,
    }
    if (jobId) {
      baseDirOptions.jobId = jobId
    }

    await ensureDirectoryExists(normalizedBaseDir, bdstoken, baseDirOptions)

    const processingSettings = await loadProcessingSettings()

    const results: TransferResultEntry[] = []
    let index = 0

    for (const item of items) {
      index += 1

      emitProgress(jobId, {
        stage: 'item:start',
        message: `检索资源《${item.title}》`,
        current: index,
        total,
      })

      const itemLabel = item.title ? `《${item.title}》` : '资源'

      let detail: LinkDetailResult | null = null
      let usedCachedDetail = false
      let filteredByRules: FilterSkipInfo[] = []
      let renamePlan: RenamePlanEntry[] = []
      let renameResults: RenameResultDetail[] = []

      if (item.linkUrl) {
        detail = {
          linkUrl: sanitizeLink(item.linkUrl),
          passCode: item.passCode || '',
        }
        if (detail.linkUrl) {
          usedCachedDetail = true
        } else {
          detail = null
        }
      }

      if (!detail) {
        const linkOptions: TransferRuntimeOptions = { context: item.title, logStage }
        if (jobId) {
          linkOptions.jobId = jobId
        }
        detail = await fetchLinkDetail(origin || '', item.id, linkOptions)
        if (detail.error) {
          const message =
            typeof detail.error === 'string' ? detail.error : `错误码：${detail.error}`
          emitProgress(jobId, {
            stage: 'item:error',
            message: `《${item.title}》链接解析失败：${message}`,
            current: index,
            total,
            level: 'error',
          })
          results.push({
            id: item.id,
            title: item.title,
            status: 'failed',
            message,
          })
          continue
        }
      }

      if (!detail) {
        continue
      }

      const surl = buildSurl(detail.linkUrl)
      if (surl && hasCompletedShare(surl)) {
        const message = '已跳过：历史记录显示已转存'
        emitProgress(jobId, {
          stage: 'item:skip',
          message: `《${item.title}》${message}`,
          current: index,
          total,
          level: 'warning',
        })
        results.push({
          id: item.id,
          title: item.title,
          status: 'skipped',
          message,
          files: [],
          skippedFiles: [],
          linkUrl: detail.linkUrl,
          passCode: detail.passCode,
        })
        continue
      }

      try {
        emitProgress(jobId, {
          stage: 'item:meta',
          message: `解析分享信息《${item.title}》`,
          current: index,
          total,
        })

        const metaOptions: TransferRuntimeOptions = { context: item.title, logStage }
        if (jobId) {
          metaOptions.jobId = jobId
        }

        let metaResult = await fetchShareMetadata(
          detail.linkUrl,
          detail.passCode,
          bdstoken,
          metaOptions,
        )
        if (usedCachedDetail && 'error' in metaResult) {
          const refreshedDetail = await fetchLinkDetail(origin || '', item.id, metaOptions)
          if (!refreshedDetail.error) {
            detail = refreshedDetail
            metaResult = await fetchShareMetadata(
              detail.linkUrl,
              detail.passCode,
              bdstoken,
              metaOptions,
            )
          }
        }
        if ('error' in metaResult) {
          const errno = typeof metaResult.error === 'number' ? metaResult.error : -9999
          const message = mapErrorMessage(
            errno,
            typeof metaResult.error === 'string' ? metaResult.error : '',
          )
          emitProgress(jobId, {
            stage: 'item:error',
            message: `《${item.title}》元数据异常：${message}`,
            current: index,
            total,
            level: 'error',
          })
          results.push({
            id: item.id,
            title: item.title,
            status: 'failed',
            message,
            errno,
          })
          continue
        }
        const meta = metaResult

        await maybeStripShareRootDirectory(meta, detail, bdstoken, metaOptions)

        if (processingSettings.filterRules.length) {
          const filterResult = applyFileFilters(
            Array.isArray(meta.entries) ? meta.entries : [],
            processingSettings.filterRules,
            processingSettings.mode,
          )
          filteredByRules = filterResult.skipped
          if (filterResult.entries.length !== meta.entries.length && filteredByRules.length) {
            const ruleSummaryMap = new Map<
              string,
              { count: number; samples: string[]; action: FilterSkipInfo['action'] }
            >()
            filteredByRules.forEach((skip) => {
              const label = skip.ruleName?.trim() || '未命名规则'
              const summary = ruleSummaryMap.get(label) ?? {
                count: 0,
                samples: [],
                action: skip.action,
              }
              summary.count += 1
              if (summary.samples.length < FILTER_RULE_SAMPLE_LIMIT) {
                summary.samples.push(skip.name)
              }
              summary.action = skip.action
              ruleSummaryMap.set(label, summary)
            })
            const summaryEntries = Array.from(ruleSummaryMap.entries())
            const detailParts: string[] = []
            summaryEntries.slice(0, FILTER_RULE_SUMMARY_LIMIT).forEach(([ruleLabel, summary]) => {
              const actionLabel = summary.action === 'exclude' ? '剔除' : '保留'
              const sampleDetail = summary.samples.length
                ? `（${summary.samples.join('、')}）`
                : ''
              const entryDetail = `规则「${ruleLabel}」${actionLabel} ${summary.count} 项${sampleDetail}`
              detailParts.push(entryDetail)
            })
            if (summaryEntries.length > FILTER_RULE_SUMMARY_LIMIT) {
              const remainingRules = summaryEntries.length - FILTER_RULE_SUMMARY_LIMIT
              detailParts.push(`另有 ${remainingRules} 条规则命中`)
            }
            const detailText = detailParts.length ? detailParts.join(' ｜ ') : undefined
            logStage(
              jobId,
              'filter',
              `${itemLabel}过滤命中：跳过 ${filteredByRules.length} 项`,
              buildInfoExtra(detailText),
            )
          }
          meta.entries = filterResult.entries
          meta.fsIds = filterResult.entries.map((entry) => entry.fsId)
          meta.fileNames = filterResult.entries.map((entry) => entry.serverFilename)
        }

        const filteredOutNames = filteredByRules.map((entry) => entry.name)
        if (!meta.fsIds.length) {
          const message =
            filteredOutNames.length > 0
              ? `已跳过：过滤规则命中（${filteredOutNames.length} 项）`
              : '已跳过：过滤规则命中'
          emitProgress(jobId, {
            stage: 'item:skip',
            message: `${itemLabel}${message}`,
            current: index,
            total,
            level: 'warning',
          })
          const skippedEntry: TransferResultEntry = {
            id: item.id,
            title: item.title,
            status: 'skipped',
            message,
            files: [],
            skippedFiles: [],
            linkUrl: detail.linkUrl,
            passCode: detail.passCode,
          }
          if (filteredOutNames.length) {
            skippedEntry.filteredFiles = filteredOutNames.slice()
          }
          results.push(skippedEntry)
          continue
        }

        const targetPath = normalizePath(item.targetPath || normalizedBaseDir)
        emitProgress(jobId, {
          stage: 'item:directory',
          message: `确认目录 ${targetPath}`,
          current: index,
          total,
        })
        const ensureOptions: TransferRuntimeOptions = { context: item.title, logStage }
        if (jobId) {
          ensureOptions.jobId = jobId
        }
        await ensureDirectoryExists(targetPath, bdstoken, ensureOptions)

        const entryByFsId = new Map<number, ShareFileEntry>()
        meta.fsIds.forEach((fsId, idx) => {
          const entry = meta.entries[idx]
          if (entry && typeof entry.serverFilename === 'string') {
            entryByFsId.set(fsId, entry)
          }
        })

        const filterOptions: TransferRuntimeOptions = { context: item.title }
        if (jobId) {
          filterOptions.jobId = jobId
        }
        const filtered = await filterAlreadyTransferred(meta, targetPath, bdstoken, filterOptions)
        if (!filtered.fsIds.length) {
          const skipReasons: string[] = []
          if (filtered.skippedFiles.length) {
            skipReasons.push(`文件已存在（${filtered.skippedFiles.length} 项）`)
          }
          if (filteredOutNames.length) {
            skipReasons.push(`过滤规则排除 ${filteredOutNames.length} 项`)
          }
          const message = skipReasons.length
            ? `已跳过：${skipReasons.join('；')}`
            : mapErrorMessage(666)
          emitProgress(jobId, {
            stage: 'item:skip',
            message: `${itemLabel}${message}`,
            current: index,
            total,
            level: 'warning',
          })
          if (surl) {
            recordCompletedShare(surl)
          }
          const skippedEntry: TransferResultEntry = {
            id: item.id,
            title: item.title,
            status: 'skipped',
            message,
            files: [],
            skippedFiles: filtered.skippedFiles,
            linkUrl: detail.linkUrl,
            passCode: detail.passCode,
          }
          if (filteredOutNames.length) {
            skippedEntry.filteredFiles = filteredOutNames.slice()
          }
          results.push(skippedEntry)
          continue
        }

        const finalEntries = filtered.fsIds
          .map((fsId) => entryByFsId.get(fsId))
          .filter((entry): entry is ShareFileEntry => Boolean(entry))
        renamePlan = finalEntries.length
          ? buildRenamePlan(finalEntries, processingSettings.renameRules, filtered.existingNames)
          : []

        emitProgress(jobId, {
          stage: 'item:transfer',
          message: `正在转存《${item.title}》`,
          current: index,
          total,
          statusMessage: `转存进度 ${index}/${total}`,
        })

        const transferMeta: TransferShareMeta = {
          shareId: meta.shareId,
          userId: meta.userId,
          fsIds: filtered.fsIds,
        }
        if (meta.seKey) {
          transferMeta.seKey = meta.seKey
        }

        const referer = detail.linkUrl ? detail.linkUrl : 'https://pan.baidu.com/disk/home'
        const transferOptions: TransferRuntimeOptions = { context: item.title, logStage }
        if (jobId) {
          transferOptions.jobId = jobId
        }
        const { errno, attempts, showMsg, pathMissing } = await transferWithRetry(
          transferMeta,
          targetPath,
          bdstoken,
          referer,
          MAX_TRANSFER_ATTEMPTS,
          transferOptions,
        )

        if (errno === 0 || errno === 666) {
          if (surl) {
            recordCompletedShare(surl)
          }
          let finalFileNames = filtered.fileNames.slice()
          if (errno === 0 && renamePlan.length) {
            const renameOptions: TransferRuntimeOptions = { context: item.title, logStage }
            if (jobId) {
              renameOptions.jobId = jobId
            }
            const renameExecution = await executeRenamePlan(
              renamePlan,
              targetPath,
              bdstoken,
              renameOptions,
            )
            renameResults = renameExecution.details
            if (renameExecution.finalNames.length === renamePlan.length) {
              finalFileNames = renameExecution.finalNames
            }
            if (renameResults.some((entry) => entry.status === 'success')) {
              try {
                await invalidateDirectoryCaches([targetPath])
              } catch (cacheError) {
                console.warn(
                  '[Chaospace Transfer] Failed to refresh directory cache after rename',
                  cacheError,
                )
              }
            }
          } else if (renamePlan.length) {
            renameResults = renamePlan.map((entry) => ({
              from: entry.originalName,
              to: entry.finalName,
              status: 'unchanged',
              rules: entry.appliedRules.slice(),
            }))
          } else {
            renameResults = []
          }
          const hasRenameChange = renameResults.some(
            (entry) => entry.status === 'success' || entry.status === 'failed',
          )
          const renameResultsForRecord = hasRenameChange ? renameResults : []
          emitProgress(jobId, {
            stage: 'item:success',
            message: `《${item.title}》转存完成（尝试 ${attempts} 次）`,
            current: index,
            total,
            level: errno === 666 ? 'warning' : 'success',
          })
          const successEntry: TransferResultEntry = {
            id: item.id,
            title: item.title,
            status: errno === 666 ? 'skipped' : 'success',
            message: errno === 666 ? mapErrorMessage(666) : '转存成功',
            files: finalFileNames,
            skippedFiles: filtered.skippedFiles,
            linkUrl: detail.linkUrl,
            passCode: detail.passCode,
          }
          if (filteredOutNames.length) {
            successEntry.filteredFiles = filteredOutNames.slice()
          }
          if (renameResultsForRecord.length) {
            successEntry.renameResults = renameResultsForRecord
          }
          results.push(successEntry)
        } else {
          const fallbackMessage = showMsg || `错误码：${errno}`
          const message = pathMissing && showMsg ? showMsg : mapErrorMessage(errno, fallbackMessage)
          emitProgress(jobId, {
            stage: 'item:error',
            message: `《${item.title}》转存失败：${message}`,
            current: index,
            total,
            level: 'error',
          })
          const failedEntry: TransferResultEntry = {
            id: item.id,
            title: item.title,
            status: 'failed',
            message,
            errno,
            skippedFiles: filtered.skippedFiles,
          }
          if (filteredOutNames.length) {
            failedEntry.filteredFiles = filteredOutNames.slice()
          }
          results.push(failedEntry)
        }
      } catch (error) {
        const err = error as Error
        console.error('[Chaospace Transfer] unexpected error', item.id, err)
        emitProgress(jobId, {
          stage: 'item:error',
          message: `《${item.title}》出现异常：${err.message || '未知错误'}`,
          current: index,
          total,
          level: 'error',
        })
        results.push({
          id: item.id,
          title: item.title,
          status: 'failed',
          message: err.message || '未知错误',
        })
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length
    const skippedCount = results.filter((r) => r.status === 'skipped').length
    const failedCount = results.length - successCount - skippedCount

    const summary = `成功 ${successCount} 项，跳过 ${skippedCount} 项，失败 ${failedCount} 项`

    emitProgress(jobId, {
      stage: 'summary',
      message: summary,
      statusMessage: failedCount ? '部分转存完成' : '转存完成',
      level: failedCount ? 'warning' : 'success',
    })

    try {
      await recordTransferHistory(payload, { results, summary })
    } catch (historyError) {
      console.warn('[Chaospace Transfer] Failed to record transfer history', historyError)
    }

    try {
      await persistCacheNow()
    } catch (cacheError) {
      console.warn('[Chaospace Transfer] Failed to persist cache after transfer', cacheError)
    }

    const response: TransferResponsePayload = { results, summary }
    if (jobId) {
      response.jobId = jobId
    }
    return response
  } catch (error) {
    const err = error as Error
    emitProgress(jobId, {
      stage: 'fatal',
      message: err.message || '转存过程失败',
      level: 'error',
      statusMessage: '转存失败',
    })
    throw err
  }
}
