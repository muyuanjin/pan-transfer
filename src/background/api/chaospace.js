import { parseLinkPage } from '../services/parser-service.js';

export async function fetchLinkDetail(origin, id, options = {}) {
  const { jobId, context = '', logStage } = options;
  const titleLabel = context ? `《${context}》` : `资源 ${id}`;
  const url = `${origin.replace(/\/$/, '')}/links/${id}.html`;
  logStage?.(jobId, 'list', `${titleLabel}请求详情页`);
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    logStage?.(jobId, 'list', `${titleLabel}详情页请求失败（${response.status}）`, { level: 'error' });
    return { error: `获取资源链接失败：${response.status}` };
  }
  const html = await response.text();
  const parsed = parseLinkPage(html);
  if (!parsed) {
    logStage?.(jobId, 'list', `${titleLabel}页面未发现百度网盘链接`, { level: 'error' });
    return { error: '页面中未找到百度网盘链接' };
  }
  logStage?.(jobId, 'list', `${titleLabel}解析详情页成功`);
  return parsed;
}
