import {
  ensureBdstoken,
  fetchShareMetadata,
  ensureDirectoryExists,
  fetchDirectoryFileNames,
  transferShare
} from '../api/baidu-pan.js';
import { fetchLinkDetail } from '../api/chaospace.js';
import {
  ensureCacheLoaded,
  persistCacheNow,
  hasCompletedShare,
  recordCompletedShare
} from '../storage/cache-store.js';
import { recordTransferHistory } from '../storage/history-store.js';
import {
  mapErrorMessage
} from '../common/errors.js';
import {
  MAX_TRANSFER_ATTEMPTS,
  TRANSFER_RETRYABLE_ERRNOS
} from '../common/constants.js';
import { normalizePath } from '../utils/path.js';
import { sanitizeLink } from '../../shared/utils/sanitizers.js';
import { buildSurl } from '../utils/share.js';

let progressHandlers = {
  emitProgress: () => {},
  logStage: () => {}
};

export function setProgressHandlers(handlers = {}) {
  progressHandlers = {
    emitProgress: handlers.emitProgress || progressHandlers.emitProgress,
    logStage: handlers.logStage || progressHandlers.logStage
  };
}

function emitProgress(jobId, data) {
  progressHandlers.emitProgress(jobId, data);
}

function logStage(jobId, stage, message, extra) {
  progressHandlers.logStage(jobId, stage, message, extra);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function filterAlreadyTransferred(meta, targetPath, bdstoken, options = {}) {
  const { jobId, context = '' } = options;
  if (!Array.isArray(meta.fsIds) || !meta.fsIds.length) {
    return { fsIds: [], fileNames: [], skippedFiles: [] };
  }

  try {
    logStage(jobId, 'list', `过滤已存在文件：${targetPath}${context ? `（${context}）` : ''}`);
    const existingNames = await fetchDirectoryFileNames(targetPath, bdstoken, {
      jobId,
      context,
      logStage
    });
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
    if (error && error.code === 'PAN_LOGIN_REQUIRED') {
      throw error;
    }
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

export async function handleTransfer(payload) {
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
      context: '全局目标目录',
      logStage
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
        detail = await fetchLinkDetail(origin, item.id, { jobId, context: item.title, logStage });
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

        let meta = await fetchShareMetadata(detail.linkUrl, detail.passCode, bdstoken, {
          jobId,
          context: item.title,
          logStage
        });
        if (usedCachedDetail && meta.error) {
          const refreshedDetail = await fetchLinkDetail(origin, item.id, { jobId, context: item.title, logStage });
          if (!refreshedDetail.error) {
            detail = refreshedDetail;
            meta = await fetchShareMetadata(detail.linkUrl, detail.passCode, bdstoken, {
              jobId,
              context: item.title,
              logStage
            });
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
          context: item.title,
          logStage
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
        const { errno, attempts } = await transferWithRetry(
          transferMeta,
          targetPath,
          bdstoken,
          referer,
          undefined,
          { jobId, context: item.title }
        );

        if (errno === 0 || errno === 666) {
          if (surl) {
            recordCompletedShare(surl);
          }
          emitProgress(jobId, {
            stage: 'item:success',
            message: `《${item.title}》转存完成（尝试 ${attempts} 次）`,
            current: index,
            total,
            level: errno === 666 ? 'warning' : 'success'
          });
          results.push({
            id: item.id,
            title: item.title,
            status: errno === 666 ? 'skipped' : 'success',
            message: errno === 666 ? mapErrorMessage(666) : '转存成功',
            files: filtered.fileNames,
            skippedFiles: filtered.skippedFiles,
            linkUrl: detail.linkUrl,
            passCode: detail.passCode
          });
        } else {
          const message = mapErrorMessage(errno, `错误码：${errno}`);
          emitProgress(jobId, {
            stage: 'item:error',
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
            errno
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
