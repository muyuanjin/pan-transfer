import { parseLinkPage } from '../services/parser-service';
import type { TransferRuntimeOptions } from '../types';

export interface LinkDetailResult {
  linkUrl: string;
  passCode: string;
  error?: string | number;
}

export async function fetchLinkDetail(
  origin: string,
  id: string | number,
  options: TransferRuntimeOptions = {}
): Promise<LinkDetailResult> {
  const { jobId, context = '', logStage } = options;
  const titleLabel = context ? `《${context}》` : `资源 ${id}`;
  const base = typeof origin === 'string' ? origin : '';
  const normalizedOrigin = base.replace(/\/$/, '');
  const url = `${normalizedOrigin}/links/${id}.html`;
  logStage?.(jobId, 'list', `${titleLabel}请求详情页`);
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    logStage?.(jobId, 'list', `${titleLabel}详情页请求失败（${response.status}）`, { level: 'error' });
    return { linkUrl: '', passCode: '', error: `获取资源链接失败：${response.status}` };
  }
  const html = await response.text();
  const parsed = parseLinkPage(html);
  if (!parsed) {
    logStage?.(jobId, 'list', `${titleLabel}页面未发现百度网盘链接`, { level: 'error' });
    return { linkUrl: '', passCode: '', error: '页面中未找到百度网盘链接' };
  }
  logStage?.(jobId, 'list', `${titleLabel}解析详情页成功`);
  return parsed;
}
