import {
  sanitizeLink,
  stripHtmlTags,
  extractCleanTitle,
  decodeHtmlEntities,
  type PosterInfo,
} from '@/shared/utils/sanitizers'
import {
  createCompletionStatus,
  isDateLikeLabel,
  type CompletionStatus,
} from '@/shared/utils/completion-status'
import {
  extractPosterFromBlockHtml,
  extractSectionByClass,
  extractSectionById,
  resolveSeasonUrl,
  safeGroup,
} from './parser/html-helpers'

export interface LinkParseResult {
  linkUrl: string
  passCode: string
}

export interface RatingInfo {
  value: string
  votes: string
  label: string
  scale: number
}

export interface HistoryInfoEntry {
  label: string
  value: string
}

export interface HistoryStillEntry {
  url: string
  full: string
  thumb: string
  alt: string
}

export interface HistoryDetail {
  pageUrl: string
  title: string
  poster: PosterInfo | null
  releaseDate: string
  country: string
  runtime: string
  rating: RatingInfo | null
  genres: string[]
  info: HistoryInfoEntry[]
  synopsis: string
  stills: HistoryStillEntry[]
  completion: CompletionStatus | null
}

export interface SeasonEntrySummary {
  seasonId: string
  url: string
  label: string
  seasonIndex: number
  poster: PosterInfo | null
  completion?: CompletionStatus | null
}

const cleanText = (value: unknown): string =>
  stripHtmlTags(typeof value === 'string' ? value : '').trim()
const cleanMeta = (value: unknown): string =>
  cleanText(value)
    .replace(/[。．\\.]+$/g, '')
    .trim()

interface HistoryHeaderData {
  title: string
  poster: PosterInfo | null
  releaseDate: string
  country: string
  runtime: string
  rating: RatingInfo | null
  genres: string[]
}

const parseHistoryHeader = (headerHtml: string, baseUrl: string): HistoryHeaderData => {
  const header: HistoryHeaderData = {
    title: '',
    poster: null,
    releaseDate: '',
    country: '',
    runtime: '',
    rating: null,
    genres: [],
  }

  const titleMatch = headerHtml.match(
    /<div[^>]*class=['"]data['"][^>]*>[\s\S]*?<h1>([\s\S]*?)<\/h1>/i,
  )
  if (titleMatch) {
    const rawTitle = cleanText(safeGroup(titleMatch, 1))
    header.title = extractCleanTitle(rawTitle.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, ''))
  }

  const posterMatch = headerHtml.match(/<div[^>]*class=['"]poster['"][^>]*>[\s\S]*?<img[^>]*>/i)
  if (posterMatch) {
    const imgTag = posterMatch[0].match(/<img[^>]*>/i)?.[0] ?? ''
    const srcMatch = imgTag.match(/src=['"]([^'"]+)['"]/i)
    if (srcMatch) {
      const src = resolveSeasonUrl(safeGroup(srcMatch, 1), baseUrl)
      if (src) {
        const altMatch = imgTag.match(/alt=['"]([^'"]*)['"]/i)
        const rawAlt = altMatch ? safeGroup(altMatch, 1) : ''
        header.poster = {
          src,
          alt: extractCleanTitle(decodeHtmlEntities(rawAlt || header.title || '')),
        }
      }
    }
  }

  const extraMatch = headerHtml.match(/<div[^>]*class=['"]extra['"][^>]*>([\s\S]*?)<\/div>/i)
  if (extraMatch) {
    const extraHtml = safeGroup(extraMatch, 1)
    const dateMatch = extraHtml.match(/<span[^>]*class=['"]date['"][^>]*>([\s\S]*?)<\/span>/i)
    const countryMatch = extraHtml.match(/<span[^>]*class=['"]country['"][^>]*>([\s\S]*?)<\/span>/i)
    const runtimeMatch = extraHtml.match(/<span[^>]*class=['"]runtime['"][^>]*>([\s\S]*?)<\/span>/i)
    if (dateMatch) {
      header.releaseDate = cleanMeta(safeGroup(dateMatch, 1))
    }
    if (countryMatch) {
      header.country = cleanMeta(safeGroup(countryMatch, 1))
    }
    if (runtimeMatch) {
      header.runtime = cleanMeta(safeGroup(runtimeMatch, 1))
    }
  }

  const ratingValue = cleanText(
    safeGroup(
      headerHtml.match(/<span[^>]*class=['"]dt_rating_vgs['"][^>]*>([\s\S]*?)<\/span>/i),
      1,
    ),
  )
  if (ratingValue) {
    const votes = cleanText(
      safeGroup(
        headerHtml.match(/<span[^>]*class=['"]rating-count['"][^>]*>([\s\S]*?)<\/span>/i),
        1,
      ),
    )
    const label = cleanText(
      safeGroup(
        headerHtml.match(/<span[^>]*class=['"]rating-text['"][^>]*>([\s\S]*?)<\/span>/i),
        1,
      ),
    )
    header.rating = {
      value: ratingValue,
      votes,
      label,
      scale: 10,
    }
  }

  const genresMatch = headerHtml.match(/<div[^>]*class=['"]sgeneros['"][^>]*>([\s\S]*?)<\/div>/i)
  if (genresMatch) {
    const genreBlock = safeGroup(genresMatch, 1)
    const genreRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi
    const genres: string[] = []
    let genreMatch: RegExpExecArray | null
    while ((genreMatch = genreRegex.exec(genreBlock))) {
      const label = cleanText(safeGroup(genreMatch, 1))
      if (label) {
        genres.push(label)
      }
    }
    header.genres = genres
  }

  return header
}

interface SynopsisParseResult {
  synopsis: string
  stills: HistoryStillEntry[]
}

const parseSynopsisSection = (
  infoSection: string,
  baseUrl: string,
  fallbackTitle: string,
): SynopsisParseResult => {
  const result: SynopsisParseResult = {
    synopsis: '',
    stills: [],
  }
  if (!infoSection) {
    return result
  }
  const descriptionSection = extractSectionByClass(infoSection, 'wp-content')
  if (!descriptionSection) {
    return result
  }
  const descriptionHtml = descriptionSection.replace(/^<div[^>]*>/i, '').replace(/<\/div>\s*$/i, '')
  const gallerySection = extractSectionById(descriptionHtml, 'dt_galery')
  const galleryRemoved = gallerySection
    ? descriptionHtml.replace(gallerySection, '')
    : descriptionHtml
  const synopsis = cleanText(galleryRemoved)
  if (synopsis) {
    result.synopsis = synopsis
  }
  if (!gallerySection) {
    return result
  }
  const itemRegex = /<div[^>]*class=['"]g-item['"][^>]*>([\s\S]*?)<\/div>/gi
  let itemMatch: RegExpExecArray | null
  const seen = new Set<string>()
  while ((itemMatch = itemRegex.exec(gallerySection))) {
    const itemHtml = safeGroup(itemMatch, 1)
    if (!itemHtml) {
      continue
    }
    const anchorMatch = itemHtml.match(/<a[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i)
    if (!anchorMatch) {
      continue
    }
    const fullUrl = resolveSeasonUrl(safeGroup(anchorMatch, 1), baseUrl)
    const anchorHtml = safeGroup(anchorMatch, 2)
    const imgTagMatch = anchorHtml.match(/<img[^>]*>/i)
    const imgTag = imgTagMatch ? imgTagMatch[0] : ''
    if (!imgTag) {
      continue
    }
    const srcMatch = imgTag.match(/src=['"]([^'"]+)['"]/i)
    let thumbUrl = resolveSeasonUrl(srcMatch ? safeGroup(srcMatch, 1) : '', baseUrl)
    if (!thumbUrl) {
      const dataAttrRegex =
        /(data-original|data-src|data-lazy-src|data-medium-file|data-large-file)=['"]([^'"]+)['"]/gi
      let dataMatch: RegExpExecArray | null
      while ((dataMatch = dataAttrRegex.exec(imgTag))) {
        const candidate = resolveSeasonUrl(safeGroup(dataMatch, 2), baseUrl)
        if (candidate) {
          thumbUrl = candidate
          break
        }
      }
    }
    const altMatch = imgTag.match(/alt=['"]([^'"]*)['"]/i)
    const altRaw = safeGroup(altMatch, 1)
    const key = fullUrl || thumbUrl
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    const resolvedFull = fullUrl || thumbUrl
    const resolvedThumb = thumbUrl || fullUrl
    if (!resolvedFull || !resolvedThumb) {
      continue
    }
    const altText = extractCleanTitle(decodeHtmlEntities(altRaw || fallbackTitle || ''))
    result.stills.push({
      url: resolvedFull,
      full: resolvedFull,
      thumb: resolvedThumb,
      alt: altText,
    })
  }
  return result
}

const parseInfoTableEntries = (infoSection: string): HistoryInfoEntry[] => {
  if (!infoSection) {
    return []
  }
  const entries: HistoryInfoEntry[] = []
  const infoRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let infoMatch: RegExpExecArray | null
  while ((infoMatch = infoRegex.exec(infoSection))) {
    const rowHtml = safeGroup(infoMatch, 1)
    if (!rowHtml) {
      continue
    }
    const labelMatch = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i)
    const valueMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i)
    const label = cleanText(labelMatch ? safeGroup(labelMatch, 1) : '')
    const value = cleanText(valueMatch ? safeGroup(valueMatch, 1) : '')
    if (label && value) {
      entries.push({ label, value })
    }
  }
  return entries
}
export function parseLinkPage(html: string | null | undefined): LinkParseResult | null {
  if (!html) {
    return null
  }

  let href = ''

  const clipboardMatch = html.match(/data-clipboard-text=["']([^"']+pan\.baidu\.com[^"']*)["']/i)
  if (clipboardMatch) {
    href = clipboardMatch[1] ?? ''
  }

  if (!href) {
    const anchorMatch = html.match(/<a[^>]+href=["']([^"']*pan\.baidu\.com[^"']*)["'][^>]*>/i)
    if (anchorMatch) {
      href = anchorMatch[1] ?? ''
    }
  }

  if (!href) {
    return null
  }

  href = sanitizeLink(href)

  let passCode = ''
  try {
    const url = new URL(href)
    passCode = url.searchParams.get('pwd') || url.searchParams.get('password') || ''
  } catch (_error) {
    passCode = ''
  }

  if (!passCode) {
    const textMatch = html.match(/提取码[：:]*\s*([0-9a-zA-Z]+)/)
    if (textMatch) {
      passCode = textMatch[1] ?? ''
    }
  }

  return {
    linkUrl: href,
    passCode: passCode || '',
  }
}

export function parsePageTitleFromHtml(html: string | null | undefined): string {
  const match = html?.match(/<title>([\s\S]*?)<\/title>/i)
  if (!match) {
    return ''
  }
  let title = stripHtmlTags(match[1])
  title = title.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, '')
  return extractCleanTitle(title)
}

export function parseHistoryDetailFromHtml(
  html: string | null | undefined,
  pageUrl = '',
): HistoryDetail {
  const normalizedHtml = (html ?? '').replace(/\r/g, '')
  const baseUrl = pageUrl || ''
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
    completion: null,
  }

  const headerHtml = extractSectionByClass(normalizedHtml, 'sheader')
  if (headerHtml) {
    const header = parseHistoryHeader(headerHtml, baseUrl)
    detail.title = header.title || detail.title
    detail.poster = header.poster
    detail.releaseDate = header.releaseDate
    detail.country = header.country
    detail.runtime = header.runtime
    detail.rating = header.rating
    detail.genres = header.genres
  }

  const infoSection = extractSectionById(normalizedHtml, 'info')
  if (infoSection) {
    const synopsisResult = parseSynopsisSection(infoSection, baseUrl, detail.title)
    if (synopsisResult.synopsis) {
      detail.synopsis = synopsisResult.synopsis
    }
    if (synopsisResult.stills.length) {
      detail.stills = synopsisResult.stills
    }
    const infoEntries = parseInfoTableEntries(infoSection)
    if (infoEntries.length) {
      detail.info = infoEntries
    }
  }

  const completion = parseCompletionFromHtml(normalizedHtml, 'detail-meta')
  if (completion) {
    detail.completion = completion
  }

  return detail
}

export function extractDownloadTableHtml(html: string | null | undefined): string {
  const section = extractSectionById(html, 'download')
  if (!section) {
    return ''
  }
  const tbodyMatches = section.match(/<tbody[\s\S]*?<\/tbody>/gi)
  if (!tbodyMatches) {
    return ''
  }
  return tbodyMatches.join('\n')
}

export function isSeasonUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /\/seasons\/\d+\.html/.test(url)
}

export function isTvShowUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /\/tvshows\/\d+\.html/.test(url)
}

export function parseCompletionFromHtml(
  html: string | null | undefined,
  source = 'season-meta',
): CompletionStatus | null {
  if (!html || typeof html !== 'string') {
    return null
  }
  const extraRegex = /<div[^>]*class=['"][^'"]*\bextra\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi
  let latestExtraHtml = ''
  let extraMatch: RegExpExecArray | null
  while ((extraMatch = extraRegex.exec(html))) {
    latestExtraHtml = safeGroup(extraMatch, 1)
  }
  if (!latestExtraHtml) {
    return null
  }
  const spanRegex = /<span[^>]*class=['"]date['"][^>]*>([\s\S]*?)<\/span>/gi
  const spans: string[] = []
  let spanMatch: RegExpExecArray | null
  while ((spanMatch = spanRegex.exec(latestExtraHtml))) {
    spans.push(safeGroup(spanMatch, 1))
  }
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const text = stripHtmlTags(spans[i])
    if (!text || isDateLikeLabel(text)) {
      continue
    }
    const completion = createCompletionStatus(text, source)
    if (completion) {
      return completion
    }
  }
  return null
}

export function parseTvShowSeasonCompletionFromHtml(
  html: string | null | undefined,
): Record<string, CompletionStatus> {
  const map: Record<string, CompletionStatus> = {}
  if (!html || typeof html !== 'string') {
    return map
  }
  const seasonsSection = extractSectionById(html, 'seasons')
  if (!seasonsSection) {
    return map
  }
  const seasonRegex =
    /<div[^>]*class=['"]se-c['"][^>]*>[\s\S]*?<div[^>]*class=['"]se-q['"][^>]*>[\s\S]*?<a[^>]+href=['"]([^'"]+)['"][^>]*>[\s\S]*?<span[^>]*class=['"]title['"][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>[\s\S]*?<\/div>/gi
  let match: RegExpExecArray | null
  while ((match = seasonRegex.exec(seasonsSection))) {
    const href = safeGroup(match, 1)
    const titleHtml = safeGroup(match, 2)
    if (!href || !titleHtml) {
      continue
    }
    const idMatch = href.match(/\/seasons\/(\d+)\.html/)
    const seasonId = safeGroup(idMatch, 1)
    if (!seasonId) {
      continue
    }
    const inlineTexts: string[] = []
    const inlineRegex = /<i[^>]*>([\s\S]*?)<\/i>/gi
    let inlineMatch: RegExpExecArray | null
    while ((inlineMatch = inlineRegex.exec(titleHtml))) {
      const text = stripHtmlTags(safeGroup(inlineMatch, 1))
      if (text) {
        inlineTexts.push(text)
      }
    }
    let statusLabel: string | null = null
    for (let i = inlineTexts.length - 1; i >= 0; i -= 1) {
      const text = inlineTexts[i]
      if (text && !isDateLikeLabel(text)) {
        statusLabel = text
        break
      }
    }
    if (!statusLabel) {
      const textContent = stripHtmlTags(titleHtml)
      const parts = textContent.split(/\s+/).filter(Boolean)
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const part = parts[i]
        if (part && !isDateLikeLabel(part)) {
          statusLabel = part
          break
        }
      }
    }
    if (statusLabel) {
      const completion = createCompletionStatus(statusLabel, 'season-list')
      if (completion) {
        map[seasonId] = completion
      }
    }
  }
  return map
}

export function parseTvShowSeasonEntriesFromHtml(
  html: string | null | undefined,
  baseUrl: string,
): SeasonEntrySummary[] {
  if (!html || typeof html !== 'string') {
    return []
  }
  const seasonsSection = extractSectionById(html, 'seasons')
  if (!seasonsSection) {
    return []
  }
  const blockPattern = /<div[^>]*class=['"][^'"]*\bse-c\b[^'"]*['"][^>]*>/gi
  const entries: SeasonEntrySummary[] = []
  let index = 0
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockPattern.exec(seasonsSection))) {
    const blockStart = blockMatch.index
    const blockSlice = seasonsSection.slice(blockStart)
    const blockHtml = extractSectionByClass(blockSlice, 'se-c')
    if (!blockHtml) {
      continue
    }
    const anchorMatch = blockHtml.match(
      /<a[^>]+href=['"]([^'"]+)['"][^>]*>[\s\S]*?<span[^>]*class=['"]title['"][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>/i,
    )
    if (!anchorMatch) {
      continue
    }
    const href = resolveSeasonUrl(safeGroup(anchorMatch, 1), baseUrl)
    if (!href) {
      continue
    }
    const idMatch = href.match(/\/seasons\/(\d+)\.html/)
    const seasonId = safeGroup(idMatch, 1) || `season-${index + 1}`
    const titleHtml = safeGroup(anchorMatch, 2)
    const textContent = stripHtmlTags(titleHtml)
    const label = extractCleanTitle(textContent) || `季 ${index + 1}`
    const poster = extractPosterFromBlockHtml(blockHtml, baseUrl)
    entries.push({
      seasonId,
      url: href,
      label,
      seasonIndex: index,
      poster,
    })
    index += 1
    blockPattern.lastIndex = blockStart + blockHtml.length
  }
  return entries
}

export interface ParsedItem {
  id: string
  title: string
  linkUrl: string
  passCode: string
}

export function parseItemsFromHtml(
  html: string | null | undefined,
  historyItems: Record<string, { linkUrl?: string; passCode?: string }> = {},
): ParsedItem[] {
  const sectionHtml = extractDownloadTableHtml(html)
  if (!sectionHtml) {
    return []
  }
  const items: ParsedItem[] = []
  const seenIds = new Set<string>()
  const rowRegex = /<tr[^>]*id=["']link-(\d+)["'][\s\S]*?<\/tr>/gi
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(sectionHtml))) {
    const id = safeGroup(match, 1)
    if (!id || seenIds.has(id)) {
      continue
    }
    const rowHtml = match[0]
    const anchorMatch = rowHtml.match(
      /<a[^>]+href=["'][^"']*\/links\/\d+\.html[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    )
    const rawTitle = anchorMatch ? stripHtmlTags(safeGroup(anchorMatch, 1)) : ''
    const title = extractCleanTitle(rawTitle || '')
    const historyItem = historyItems[id]
    items.push({
      id,
      title: title || `资源 ${id}`,
      linkUrl: historyItem?.linkUrl || '',
      passCode: historyItem?.passCode || '',
    })
    seenIds.add(id)
  }
  return items
}
