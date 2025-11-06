import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyzePage,
  suggestDirectoryFromClassification,
  __resetPageAnalyzerForTests,
} from './page-analyzer'

const FIXTURE_DIR = resolve(__dirname, '__fixtures__')
const ORIGINAL_FETCH = globalThis.fetch
const EMPTY_DOCUMENT = '<!DOCTYPE html><html lang="zh-CN"><head></head><body></body></html>'
const FETCH_FIXTURE_HTML = new Map<string, string>()
const RAW_FIXTURE_CACHE = new Map<string, string>()
const STRIPPED_FIXTURE_CACHE = new Map<string, string>()

function clearFetchFixtures(): void {
  FETCH_FIXTURE_HTML.clear()
}

function readFixture(name: string): string {
  const cached = RAW_FIXTURE_CACHE.get(name)
  if (cached) {
    return cached
  }
  const content = readFileSync(resolve(FIXTURE_DIR, name), 'utf-8')
  RAW_FIXTURE_CACHE.set(name, content)
  return content
}

function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

function readStrippedFixture(name: string): string {
  const cached = STRIPPED_FIXTURE_CACHE.get(name)
  if (cached) {
    return cached
  }
  const stripped = stripScripts(readFixture(name))
  STRIPPED_FIXTURE_CACHE.set(name, stripped)
  return stripped
}

function materializeDownloadAnchors(
  root: Document | Element,
  origin = 'https://www.chaospace.cc',
): void {
  const rows = root.querySelectorAll<HTMLElement>('#download tr[id^="link-"]')
  rows.forEach((row) => {
    const anchor = row.querySelector<HTMLAnchorElement>('a')
    if (!anchor) {
      return
    }
    const idMatch = row.id.match(/link-(\d+)/)
    if (!idMatch) {
      return
    }
    const linkId = idMatch[1]
    anchor.setAttribute('href', `${origin}/links/${linkId}.html`)
    anchor.classList.remove('clicklogin')
  })
}

function patchHtmlDownloadLinks(html: string, origin = 'https://www.chaospace.cc'): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  materializeDownloadAnchors(doc, origin)
  return doc.documentElement.outerHTML
}

function resetDocument(html = EMPTY_DOCUMENT, url = 'https://www.chaospace.cc/'): void {
  document.open()
  document.write(html)
  document.close()
  try {
    window.history.replaceState({}, '', url)
  } catch {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: url,
        origin: new URL(url).origin,
        pathname: new URL(url).pathname,
        search: new URL(url).search,
        hash: new URL(url).hash,
        toString() {
          return url
        },
        assign: vi.fn(),
        replace: vi.fn(),
        reload: vi.fn(),
      },
    })
  }
  materializeDownloadAnchors(document)
}

function loadFixtureIntoDocument(name: string, url: string): string {
  const stripped = readStrippedFixture(name)
  FETCH_FIXTURE_HTML.set(url, stripped)
  const sanitized = patchHtmlDownloadLinks(stripped)
  resetDocument(sanitized, url)
  return sanitized
}

function stubFetch(resolvedHtml: Record<string, string> = {}): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const html = resolvedHtml[url] ?? FETCH_FIXTURE_HTML.get(url)
    if (!html) {
      return {
        ok: false,
        status: 404,
        text: async () => '',
        headers: new Headers(),
      } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      text: async () => patchHtmlDownloadLinks(html),
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
}

describe('page-analyzer 使用 chaospace 真实页面', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearFetchFixtures()
    if (ORIGINAL_FETCH) {
      globalThis.fetch = ORIGINAL_FETCH.bind(globalThis)
    } else {
      // @ts-expect-error - 清理测试替换
      delete globalThis.fetch
    }
    resetDocument()
    stubFetch()
    __resetPageAnalyzerForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearFetchFixtures()
    if (ORIGINAL_FETCH) {
      globalThis.fetch = ORIGINAL_FETCH.bind(globalThis)
    } else {
      // @ts-expect-error - 清理测试替换
      delete globalThis.fetch
    }
    resetDocument()
  })

  it('分析电影详情页时应提取全部网盘条目并归类为电影', async () => {
    const movieUrl = 'https://www.chaospace.cc/movies/432912.html'
    loadFixtureIntoDocument('chaospace-movie-432912.html', movieUrl)
    const result = await analyzePage()

    expect(result.url).toBe(movieUrl)
    expect(result.origin).toBe('https://www.chaospace.cc')
    expect(result.classification).toBe('movie')
    expect(suggestDirectoryFromClassification(result.classification)).toBe('/视频/电影')
    expect(result.title).not.toHaveLength(0)
    expect(result.poster?.src).toMatch(/^https?:\/\//)
    expect(result.items.length).toBeGreaterThan(0)
    expect(
      result.items.every(
        (item) => typeof item.linkUrl === 'string' && item.linkUrl.includes('/links/'),
      ),
    ).toBe(true)
    expect(result.deferredSeasons).toHaveLength(0)
    expect(result.seasonEntries).toHaveLength(0)
  })

  it('剧集详情页应识别日本电视台并归类为番剧，同时拉取首批季资源', async () => {
    const showUrl = 'https://www.chaospace.cc/tvshows/429052.html'
    loadFixtureIntoDocument('chaospace-tvshow-429052.html', showUrl)
    const seasonUrl = 'https://www.chaospace.cc/seasons/429054.html'
    const seasonHtml = readStrippedFixture('chaospace-season-429054.html')
    stubFetch({ [seasonUrl]: seasonHtml })

    const result = await analyzePage({ deferTvSeasons: false })

    expect(result.url).toBe(showUrl)
    expect(result.classification).toBe('anime')
    expect(result.classificationDetail?.debug.primary.tvChannels).toContain('TV Tokyo')
    expect(result.classificationDetail?.reasons.some((reason) => reason.includes('日本'))).toBe(
      true,
    )
    expect(suggestDirectoryFromClassification(result.classificationDetail)).toBe('/视频/番剧')
    expect(result.seasonEntries).toHaveLength(1)
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item) => item.seasonLabel === '第1季')).toBe(true)
    expect(result.seasonEntries[0]?.poster?.src).toMatch(/^https?:\/\//)
    expect(result.deferredSeasons).toHaveLength(0)
  })

  it('季页面应继承父剧集上下文并生成季目录', async () => {
    const seasonUrl = 'https://www.chaospace.cc/seasons/428609.html'
    loadFixtureIntoDocument('chaospace-season-428609.html', seasonUrl)
    const parentUrl = 'https://www.chaospace.cc/tvshows/428607.html'
    const parentHtml = readStrippedFixture('chaospace-tvshow-428607.html')
    FETCH_FIXTURE_HTML.set(parentUrl, parentHtml)
    stubFetch()

    const result = await analyzePage()

    expect(result.url).toBe('https://www.chaospace.cc/tvshows/428607.html')
    expect(result.origin).toBe('https://www.chaospace.cc')
    expect(result.title).toBe('身为暗杀者的我明显比勇者还强')
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item) => item.seasonId === '428609')).toBe(true)
    expect(result.items.every((item) => item.seasonLabel === '第1季')).toBe(true)
    expect(result.seasonEntries).toHaveLength(1)
    expect(result.seasonEntries[0]?.url).toBe(seasonUrl)
    expect(result.seasonEntries[0]?.seasonIndex).toBe(0)
    expect(result.seasonCompletion['428609']?.label).toBeDefined()
  })

  it('fetchSeasonDetail 应从季页面提取全部网盘资源及完成度信息', async () => {
    const seasonUrl = 'https://www.chaospace.cc/seasons/428609.html'
    const html = stripScripts(readFixture('chaospace-season-428609.html'))
    stubFetch({ [seasonUrl]: html })

    const { fetchSeasonDetail } = await import('./page-analyzer')

    const detail = await fetchSeasonDetail({
      seasonId: '428609',
      label: '第一季 2025-10-07更新至E05N/A',
      url: seasonUrl,
      index: 0,
    })

    expect(detail.items.length).toBeGreaterThan(0)
    expect(detail.items.every((item) => item.linkUrl?.includes('/links/'))).toBe(true)
    expect(
      detail.items.every((item) => typeof item.id === 'string' || typeof item.id === 'number'),
    ).toBe(true)
    expect(detail.completion?.label || '').not.toHaveLength(0)
    expect(detail.poster?.src).toMatch(/^https?:\/\//)
  })

  it('extractItemsFromDocument 应为需登录的资源构建链接并保留提取码', async () => {
    document.body.innerHTML = `
      <div id="download">
        <table>
          <tbody>
            <tr id="link-424242">
              <td>
                <a href="#" class="clicklogin">示例资源 提取码 aB12</a>
              </td>
              <td><strong class="quality">WEB-1080P</strong></td>
              <td class="pwd"></td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    const { extractItemsFromDocument } = await import('./page-analyzer')

    const items = extractItemsFromDocument(document)

    expect(items).toHaveLength(1)
    expect(items[0]?.linkUrl).toBe('https://www.chaospace.cc/links/424242.html')
    expect(items[0]?.passCode).toBe('aB12')
    expect((items[0] as Record<string, unknown>)['requiresLogin']).toBe(true)
  })

  it('sanitizeSeasonDirSegment 应将混合状态标签标准化为第1季', async () => {
    const tvHtml = readFixture('chaospace-tvshow-428607.html')
    const parser = new DOMParser()
    const doc = parser.parseFromString(stripScripts(tvHtml), 'text/html')
    const titleNode = doc.querySelector('#seasons .se-c .se-q .title')
    const rawLabel = titleNode?.textContent?.trim() || ''

    const { sanitizeSeasonDirSegment } = await import('./page-analyzer')

    expect(sanitizeSeasonDirSegment(rawLabel)).toBe('第1季')
  })
})
