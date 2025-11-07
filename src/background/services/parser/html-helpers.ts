import type { PosterInfo } from '@/shared/utils/sanitizers'

export type MatchLike = RegExpExecArray | RegExpMatchArray | null | undefined

export const safeGroup = (match: MatchLike, index = 1): string => {
  if (!match) {
    return ''
  }
  const value = match[index]
  return typeof value === 'string' ? value : ''
}

const ensureGlobal = (pattern: RegExp): RegExp => {
  if (pattern.global) {
    return pattern
  }
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return new RegExp(pattern.source, flags)
}

export const collectMatches = <T>(
  source: string,
  pattern: RegExp,
  mapper: (match: RegExpExecArray) => T | null | undefined,
): T[] => {
  if (!source) {
    return []
  }
  const results: T[] = []
  const globalPattern = ensureGlobal(pattern)
  let match: RegExpExecArray | null
  while ((match = globalPattern.exec(source))) {
    const mapped = mapper(match)
    if (mapped !== undefined && mapped !== null) {
      results.push(mapped)
    }
  }
  return results
}

const sliceBalancedSection = (
  html: string,
  startIndex: number,
  searchStart: number,
  tagPattern: RegExp,
): string => {
  tagPattern.lastIndex = searchStart
  let depth = 1
  let resultEnd = html.length
  let token: RegExpExecArray | null
  while ((token = tagPattern.exec(html))) {
    if (token.index < searchStart) {
      continue
    }
    if (token[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) {
        resultEnd = tagPattern.lastIndex
        break
      }
    } else {
      depth += 1
    }
  }
  return html.slice(startIndex, resultEnd)
}

export const extractSectionById = (html: string | null | undefined, id: string): string => {
  if (!html || !id) {
    return ''
  }
  const openPattern = new RegExp(`<div[^>]+id\\s*=\\s*['"]${id}['"][^>]*>`, 'i')
  const match = openPattern.exec(html)
  if (!match) {
    return ''
  }
  const startIndex = match.index
  const searchStart = startIndex + match[0].length
  const divPattern = /<div\b[^>]*>|<\/div>/gi
  return sliceBalancedSection(html, startIndex, searchStart, divPattern)
}

export const extractSectionByClass = (
  html: string | null | undefined,
  className: string,
): string => {
  if (!html || !className) {
    return ''
  }
  const normalizedClass = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const openPattern = new RegExp(
    `<([a-zA-Z0-9]+)([^>]*class\\s*=\\s*['"][^'"]*\\b${normalizedClass}\\b[^'"]*['"][^>]*)>`,
    'i',
  )
  const match = openPattern.exec(html)
  if (!match) {
    return ''
  }
  const tagName = match[1]
  const startIndex = match.index
  const searchStart = startIndex + match[0].length
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, 'gi')
  return sliceBalancedSection(html, startIndex, searchStart, tagPattern)
}

export const resolveSeasonUrl = (href: string | null | undefined, baseUrl: string): string => {
  if (!href) {
    return ''
  }
  try {
    const normalizedHref = typeof href === 'string' ? href.trim() : href
    if (!normalizedHref) {
      return ''
    }
    const url = new URL(normalizedHref, baseUrl || undefined)
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

export const extractPosterFromBlockHtml = (
  blockHtml: string | null | undefined,
  baseUrl: string,
): PosterInfo | null => {
  if (!blockHtml) {
    return null
  }
  const imgMatch = blockHtml.match(/<img[^>]*>/i)
  if (!imgMatch) {
    return null
  }
  const imgTag = imgMatch[0]
  const srcsetMatch = imgTag.match(/(?:data-srcset|srcset)=['"]([^'"]+)['"]/i)
  let src = ''
  if (srcsetMatch) {
    const rawSrcset = safeGroup(srcsetMatch, 1)
    if (rawSrcset) {
      const candidates = rawSrcset
        .split(',')
        .map((entry) => entry.trim())
        .map((entry) => entry.split(/\s+/)[0])
        .filter(Boolean)
      for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const candidate = resolveSeasonUrl(candidates[i], baseUrl)
        if (candidate) {
          src = candidate
          break
        }
      }
    }
  }
  if (!src) {
    const attrRegex =
      /(data-original|data-src|data-lazy-src|data-medium-file|data-large-file|src)=['"]([^'"]+)['"]/gi
    const attrPattern = ensureGlobal(attrRegex)
    let attrMatch: RegExpExecArray | null
    while ((attrMatch = attrPattern.exec(imgTag))) {
      const candidate = resolveSeasonUrl(attrMatch[2], baseUrl)
      if (candidate) {
        src = candidate
        break
      }
    }
  }
  if (!src) {
    return null
  }
  const altMatch = imgTag.match(/alt=['"]([^'"]*)['"]/i)
  const alt = safeGroup(altMatch, 1).trim()
  return {
    src,
    alt,
  }
}
