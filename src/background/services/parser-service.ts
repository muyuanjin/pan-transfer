// @ts-nocheck

import {
  sanitizeLink,
  stripHtmlTags,
  extractCleanTitle,
  decodeHtmlEntities,
  type PosterInfo
} from '../../shared/utils/sanitizers';
import {
  createCompletionStatus,
  isDateLikeLabel,
  type CompletionStatus
} from '../../shared/utils/completion-status';

export interface LinkParseResult {
  linkUrl: string;
  passCode: string;
}

const safeGroup = (match: RegExpExecArray | RegExpMatchArray | null | undefined, index = 1): string => {
  if (!match) {
    return '';
  }
  const value = match[index];
  return typeof value === 'string' ? value : '';
};

export interface RatingInfo {
  value: string;
  votes: string;
  label: string;
  scale: number;
}

export interface HistoryInfoEntry {
  label: string;
  value: string;
}

export interface HistoryStillEntry {
  url: string;
  full: string;
  thumb: string;
  alt: string;
}

export interface HistoryDetail {
  pageUrl: string;
  title: string;
  poster: PosterInfo | null;
  releaseDate: string;
  country: string;
  runtime: string;
  rating: RatingInfo | null;
  genres: string[];
  info: HistoryInfoEntry[];
  synopsis: string;
  stills: HistoryStillEntry[];
  completion: CompletionStatus | null;
}

export interface SeasonEntrySummary {
  seasonId: string;
  url: string;
  label: string;
  seasonIndex: number;
  poster: PosterInfo | null;
  completion?: CompletionStatus | null;
}

export function parseLinkPage(html: string | null | undefined): LinkParseResult | null {
  if (!html) {
    return null;
  }

  let href = '';

  const clipboardMatch = html.match(/data-clipboard-text=["']([^"']+pan\.baidu\.com[^"']*)["']/i);
  if (clipboardMatch) {
    href = clipboardMatch[1] ?? '';
  }

  if (!href) {
    const anchorMatch = html.match(/<a[^>]+href=["']([^"']*pan\.baidu\.com[^"']*)["'][^>]*>/i);
    if (anchorMatch) {
      href = anchorMatch[1] ?? '';
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
      passCode = textMatch[1] ?? '';
    }
  }

  return {
    linkUrl: href,
    passCode: passCode || ''
  };
}

export function parsePageTitleFromHtml(html: string | null | undefined): string {
  const match = html?.match(/<title>([\s\S]*?)<\/title>/i);
  if (!match) {
    return '';
  }
  let title = stripHtmlTags(match[1]);
  title = title.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, '');
  return extractCleanTitle(title);
}

export function extractSectionById(html: string | null | undefined, id: string): string {
  if (!html) {
    return '';
  }
  const openPattern = new RegExp(`<div[^>]+id\\s*=\\s*['"]${id}['"][^>]*>`, 'i');
  const match = openPattern.exec(html);
  if (!match) {
    return '';
  }
  const startIndex = match.index;
  const searchStart = match.index + match[0].length;
  const divPattern = /<div\b[^>]*>|<\/div>/gi;
  divPattern.lastIndex = searchStart;
  let depth = 1;
  let resultEnd = html.length;
  let token: RegExpExecArray | null;
  while ((token = divPattern.exec(html))) {
    if (token.index < searchStart) {
      continue;
    }
    if (token[0][1] === '/') {
      depth -= 1;
      if (depth === 0) {
        resultEnd = divPattern.lastIndex;
        break;
      }
    } else {
      depth += 1;
    }
  }
  return html.slice(startIndex, resultEnd);
}

export function extractSectionByClass(html: string | null | undefined, className: string): string {
  if (!html || !className) {
    return '';
  }
  const normalizedClass = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openPattern = new RegExp(`<([a-zA-Z0-9]+)([^>]*class\\s*=\\s*['"][^'"]*\\b${normalizedClass}\\b[^'"]*['"][^>]*)>`, 'i');
  const match = openPattern.exec(html);
  if (!match) {
    return '';
  }
  const tagName = match[1];
  const startIndex = match.index;
  const searchStart = startIndex + match[0].length;
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'gi');
  tagPattern.lastIndex = searchStart;
  let depth = 1;
  let token: RegExpExecArray | null;
  let resultEnd = html.length;
  while ((token = tagPattern.exec(html))) {
    if (token.index < searchStart) {
      continue;
    }
    if (token[0][1] === '/') {
      depth -= 1;
      if (depth === 0) {
        resultEnd = tagPattern.lastIndex;
        break;
      }
    } else {
      depth += 1;
    }
  }
  return html.slice(startIndex, resultEnd);
}

export function parseHistoryDetailFromHtml(
  html: string | null | undefined,
  pageUrl = ''
): HistoryDetail {
  const normalizedHtml = (html ?? '').replace(/\r/g, '');
  const detail: HistoryDetail = {
    pageUrl,
    title: '',
    poster: null,
    releaseDate: '',
    country: '',
    runtime: '',
    rating: null,
    genres: [],
    info: [],
    synopsis: '',
    stills: [],
    completion: null
  };

  const cleanText = (value: unknown): string => stripHtmlTags(typeof value === 'string' ? value : '').trim();
  const cleanMeta = (value: unknown): string => cleanText(value).replace(/[。．\\.]+$/g, '').trim();
  const baseUrl = pageUrl || '';

  const headerHtml = extractSectionByClass(normalizedHtml, 'sheader');
  if (headerHtml) {
    const titleMatch = headerHtml.match(/<div[^>]*class=['"]data['"][^>]*>[\s\S]*?<h1>([\s\S]*?)<\/h1>/i);
    if (titleMatch) {
      detail.title = cleanText(titleMatch[1] ?? '');
    }

    const posterMatch = headerHtml.match(/<div[^>]*class=['"]poster['"][^>]*>[\s\S]*?<img[^>]*>/i);
    if (posterMatch) {
      const imgTag = posterMatch[0].match(/<img[^>]*>/i)?.[0] || '';
      const srcMatch = imgTag.match(/src=['"]([^'"]+)['"]/i);
      const altMatch = imgTag.match(/alt=['"]([^'"]*)['"]/i);
      if (srcMatch) {
        const src = resolveSeasonUrl(srcMatch[1], baseUrl);
        if (src) {
          const rawAlt = altMatch ? altMatch[1] : '';
          detail.poster = {
            src,
            alt: extractCleanTitle(decodeHtmlEntities(rawAlt || detail.title || ''))
          };
        }
      }
    }

    const extraMatch = headerHtml.match(/<div[^>]*class=['"]extra['"][^>]*>([\s\S]*?)<\/div>/i);
    if (extraMatch) {
      const extraHtml = extraMatch[1] ?? '';
      const dateMatch = extraHtml.match(/<span[^>]*class=['"]date['"][^>]*>([\s\S]*?)<\/span>/i);
      const countryMatch = extraHtml.match(/<span[^>]*class=['"]country['"][^>]*>([\s\S]*?)<\/span>/i);
      const runtimeMatch = extraHtml.match(/<span[^>]*class=['"]runtime['"][^>]*>([\s\S]*?)<\/span>/i);
      if (dateMatch) {
        detail.releaseDate = cleanMeta(dateMatch[1] ?? '');
      }
      if (countryMatch) {
        detail.country = cleanMeta(countryMatch[1] ?? '');
      }
      if (runtimeMatch) {
        detail.runtime = cleanMeta(runtimeMatch[1] ?? '');
      }
    }

    const ratingValueMatch = headerHtml.match(/<span[^>]*class=['"]dt_rating_vgs['"][^>]*>([\s\S]*?)<\/span>/i);
    const ratingCountMatch = headerHtml.match(/<span[^>]*class=['"]rating-count['"][^>]*>([\s\S]*?)<\/span>/i);
    const ratingTextMatch = headerHtml.match(/<span[^>]*class=['"]rating-text['"][^>]*>([\s\S]*?)<\/span>/i);
    const ratingValue = ratingValueMatch ? cleanText(ratingValueMatch[1]) : '';
    if (ratingValue) {
      detail.rating = {
        value: ratingValue,
        votes: ratingCountMatch ? cleanText(ratingCountMatch[1]) : '',
        label: ratingTextMatch ? cleanText(ratingTextMatch[1]) : '',
        scale: 10
      };
    }

    const genresMatch = headerHtml.match(/<div[^>]*class=['"]sgeneros['"][^>]*>([\s\S]*?)<\/div>/i);
    if (genresMatch) {
      const genreBlock = genresMatch[1];
      const genreRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
      let genreMatch: RegExpExecArray | null;
      while ((genreMatch = genreRegex.exec(genreBlock))) {
        const label = cleanText(safeGroup(genreMatch, 1));
        if (label) {
          detail.genres.push(label);
        }
      }
    }
  }

  const infoSection = extractSectionById(normalizedHtml, 'info');
  if (infoSection) {
    const descriptionSection = extractSectionByClass(infoSection, 'wp-content');
    if (descriptionSection) {
      const descriptionHtml = descriptionSection
        .replace(/^<div[^>]*>/i, '')
        .replace(/<\/div>\s*$/i, '');
      const gallerySection = extractSectionById(descriptionHtml, 'dt_galery');
      const galleryRemoved = gallerySection ? descriptionHtml.replace(gallerySection, '') : descriptionHtml;
      const synopsis = cleanText(galleryRemoved);
      if (synopsis) {
        detail.synopsis = synopsis;
      }

      if (gallerySection) {
        const itemRegex = /<div[^>]*class=['"]g-item['"][^>]*>([\s\S]*?)<\/div>/gi;
        let itemMatch: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((itemMatch = itemRegex.exec(gallerySection))) {
          const itemHtml = itemMatch[1] || '';
          const anchorMatch = itemHtml.match(/<a[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
          if (!anchorMatch) {
            continue;
          }
          const fullUrl = resolveSeasonUrl(safeGroup(anchorMatch, 1), baseUrl);
          const imgMatch = anchorMatch[2].match(/<img[^>]+src=['"]([^'"]+)['"][^>]*?(?:alt=['"]([^'"]*)['"][^>]*)?/i);
          const thumbUrl = resolveSeasonUrl(imgMatch ? safeGroup(imgMatch, 1) : '', baseUrl);
          const altRaw = imgMatch ? safeGroup(imgMatch, 2) : '';
          if (!fullUrl && !thumbUrl) {
            continue;
          }
          const key = fullUrl || thumbUrl;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const altText = extractCleanTitle(decodeHtmlEntities(altRaw || detail.title || ''));
          const resolvedFull = fullUrl || thumbUrl;
          const resolvedThumb = thumbUrl || fullUrl;
          detail.stills.push({
            url: resolvedFull,
            full: resolvedFull,
            thumb: resolvedThumb,
            alt: altText
          });
        }
      }
    }
  }

  const tableSection = extractSectionById(normalizedHtml, 'info');
  if (tableSection) {
    const infoRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let infoMatch: RegExpExecArray | null;
    while ((infoMatch = infoRegex.exec(tableSection))) {
      const rowHtml = infoMatch?.[1] ?? '';
      if (!rowHtml) {
        continue;
      }
      const labelMatch = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
      const valueMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (!labelMatch || !valueMatch) {
        continue;
      }
      const label = cleanText(labelMatch[1]);
      const value = cleanText(valueMatch[1]);
      if (label && value) {
        detail.info.push({ label, value });
      }
    }
  }

  const completion = parseCompletionFromHtml(normalizedHtml, 'detail-meta');
  if (completion) {
    detail.completion = completion;
  }

  return detail;
}

export function extractDownloadTableHtml(html: string | null | undefined): string {
  const section = extractSectionById(html, 'download');
  if (!section) {
    return '';
  }
  const tbodyMatches = section.match(/<tbody[\s\S]*?<\/tbody>/gi);
  if (!tbodyMatches) {
    return '';
  }
  return tbodyMatches.join('\n');
}

export function isSeasonUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /\/seasons\/\d+\.html/.test(url);
}

export function isTvShowUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /\/tvshows\/\d+\.html/.test(url);
}

export function parseCompletionFromHtml(
  html: string | null | undefined,
  source = 'season-meta'
): CompletionStatus | null {
  if (!html || typeof html !== 'string') {
    return null;
  }
  const extraMatch = html.match(/<div[^>]*class=['"]extra['"][^>]*>([\s\S]*?)<\/div>/i);
  if (!extraMatch) {
    return null;
  }
  const spanRegex = /<span[^>]*class=['"]date['"][^>]*>([\s\S]*?)<\/span>/gi;
  const spans: string[] = [];
  let spanMatch: RegExpExecArray | null;
  while ((spanMatch = spanRegex.exec(extraMatch[1]))) {
    spans.push(spanMatch[1]);
  }
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const text = stripHtmlTags(spans[i]);
    if (!text || isDateLikeLabel(text)) {
      continue;
    }
    const completion = createCompletionStatus(text, source);
    if (completion) {
      return completion;
    }
  }
  return null;
}

export function parseTvShowSeasonCompletionFromHtml(html: string | null | undefined): Record<string, CompletionStatus> {
  const map: Record<string, CompletionStatus> = {};
  if (!html || typeof html !== 'string') {
    return map;
  }
  const seasonsSection = extractSectionById(html, 'seasons');
  if (!seasonsSection) {
    return map;
  }
  const seasonRegex = /<div[^>]*class=['"]se-c['"][^>]*>[\s\S]*?<div[^>]*class=['"]se-q['"][^>]*>[\s\S]*?<a[^>]+href=['"]([^'"]+)['"][^>]*>[\s\S]*?<span[^>]*class=['"]title['"][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>[\s\S]*?<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = seasonRegex.exec(seasonsSection))) {
    const href = match[1];
    const titleHtml = match[2];
    if (!href || !titleHtml) {
      continue;
    }
    const idMatch = href.match(/\/seasons\/(\d+)\.html/);
    if (!idMatch) {
      continue;
    }
    const seasonId = idMatch[1];
    const inlineTexts = [];
    const inlineRegex = /<i[^>]*>([\s\S]*?)<\/i>/gi;
    let inlineMatch;
    while ((inlineMatch = inlineRegex.exec(titleHtml))) {
      const text = stripHtmlTags(inlineMatch[1]);
      if (text) {
        inlineTexts.push(text);
      }
    }
    let statusLabel = null;
    for (let i = inlineTexts.length - 1; i >= 0; i -= 1) {
      const text = inlineTexts[i];
      if (text && !isDateLikeLabel(text)) {
        statusLabel = text;
        break;
      }
    }
    if (!statusLabel) {
      const textContent = stripHtmlTags(titleHtml);
      const parts = textContent.split(/\s+/).filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const part = parts[i];
        if (part && !isDateLikeLabel(part)) {
          statusLabel = part;
          break;
        }
      }
    }
    if (statusLabel) {
      const completion = createCompletionStatus(statusLabel, 'season-list');
      if (completion) {
        map[seasonId] = completion;
      }
    }
  }
  return map;
}

export function resolveSeasonUrl(href: string | null | undefined, baseUrl: string): string {
  if (!href) {
    return '';
  }
  try {
    const normalizedHref = typeof href === 'string' ? href.trim() : href;
    if (!normalizedHref) {
      return '';
    }
    const url = new URL(normalizedHref, baseUrl);
    url.hash = '';
    return url.toString();
  } catch (_error) {
    return '';
  }
}

export function extractPosterFromBlockHtml(blockHtml: string | null | undefined, baseUrl: string): PosterInfo | null {
  if (!blockHtml) {
    return null;
  }
  const imgMatch = blockHtml.match(/<img[^>]*>/i);
  if (!imgMatch) {
    return null;
  }
  const imgTag = imgMatch[0];
  const srcsetMatch = imgTag.match(/(?:data-srcset|srcset)=['"]([^'"]+)['"]/i);
  let src = '';
  if (srcsetMatch) {
    const candidates = srcsetMatch[1]
      .split(',')
      .map(entry => entry.trim())
      .map(entry => entry.split(/\s+/)[0])
      .filter(Boolean);
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate = resolveSeasonUrl(candidates[i], baseUrl);
      if (candidate) {
        src = candidate;
        break;
      }
    }
  }
  if (!src) {
    const attrRegex = /(data-original|data-src|data-lazy-src|data-medium-file|data-large-file|src)=['"]([^'"]+)['"]/gi;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(imgTag))) {
      const candidate = resolveSeasonUrl(attrMatch[2], baseUrl);
      if (candidate) {
        src = candidate;
        break;
      }
    }
  }
  if (!src) {
    return null;
  }
  const altMatch = imgTag.match(/alt=['"]([^'"]*)['"]/i);
  const alt = altMatch ? altMatch[1].trim() : '';
  return {
    src,
    alt
  };
}

export function parseTvShowSeasonEntriesFromHtml(
  html: string | null | undefined,
  baseUrl: string
): SeasonEntrySummary[] {
  const entries: SeasonEntrySummary[] = [];
  if (!html || typeof html !== 'string') {
    return entries;
  }
  const seasonsSection = extractSectionById(html, 'seasons');
  if (!seasonsSection) {
    return entries;
  }
  const blockRegex = /<div[^>]*class=['"]se-c['"][^>]*>([\s\S]*?)<\/div>/gi;
  let blockMatch: RegExpExecArray | null;
  let index = 0;
  while ((blockMatch = blockRegex.exec(seasonsSection))) {
    const blockHtml = blockMatch[1];
    if (!blockHtml) {
      continue;
    }
        const anchorMatch = blockHtml.match(/<a[^>]+href=['"]([^'"]+)['"][^>]*>[\s\S]*?<span[^>]*class=['"]title['"][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>/i);
        if (!anchorMatch) {
          continue;
        }
        const href = safeGroup(anchorMatch, 1);
        const url = resolveSeasonUrl(href, baseUrl);
        if (!url) {
          continue;
        }
        const idMatch = url.match(/\/seasons\/(\d+)\.html/);
        const seasonId = safeGroup(idMatch, 1) || `season-${index + 1}`;
        const titleHtml = anchorMatch[2] || '';
        const textContent = stripHtmlTags(titleHtml);
        const label = extractCleanTitle(textContent) || `季 ${index + 1}`;
        const poster = extractPosterFromBlockHtml(blockHtml, baseUrl);
    entries.push({
      seasonId,
      url,
      label,
      seasonIndex: index,
      poster
    });
    index += 1;
  }
  return entries;
}

export interface ParsedItem {
  id: string;
  title: string;
  linkUrl: string;
  passCode: string;
}

export function parseItemsFromHtml(
  html: string | null | undefined,
  historyItems: Record<string, { linkUrl?: string; passCode?: string }> = {}
): ParsedItem[] {
  const sectionHtml = extractDownloadTableHtml(html);
  if (!sectionHtml) {
    return [];
  }
  const items: ParsedItem[] = [];
  const seenIds = new Set<string>();
  const rowRegex = /<tr[^>]*id=["']link-(\d+)["'][\s\S]*?<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(sectionHtml))) {
    const id = safeGroup(match, 1);
    if (!id || seenIds.has(id)) {
      continue;
    }
    const rowHtml = match[0];
    const anchorMatch = rowHtml.match(/<a[^>]+href=["'][^"']*\/links\/\d+\.html[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const rawTitle = anchorMatch ? stripHtmlTags(safeGroup(anchorMatch, 1)) : '';
    const title = extractCleanTitle(rawTitle || '');
    const historyItem = historyItems[id];
    items.push({
      id,
      title: title || `资源 ${id}`,
      linkUrl: historyItem?.linkUrl || '',
      passCode: historyItem?.passCode || ''
    });
    seenIds.add(id);
  }
  return items;
}
