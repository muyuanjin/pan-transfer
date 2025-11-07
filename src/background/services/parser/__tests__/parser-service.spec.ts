import { describe, expect, it } from 'vitest'
import {
  parseCompletionFromHtml,
  parseHistoryDetailFromHtml,
  parseItemsFromHtml,
  parseLinkPage,
  parseTvShowSeasonCompletionFromHtml,
  parseTvShowSeasonEntriesFromHtml,
} from '../../parser-service'

const detailHtml = `
  <div class="sheader">
    <div class="poster">
      <img src="/images/poster.jpg" alt="Poster Alt – CHAOSPACE">
    </div>
    <div class="data">
      <h1>Example Title – CHAOSPACE</h1>
    </div>
    <div class="extra">
      <span class="date">2024-09-01</span>
      <span class="country">Japan。</span>
      <span class="runtime">120 分钟。</span>
    </div>
    <span class="dt_rating_vgs">8.5</span>
    <span class="rating-count">1000 votes</span>
    <span class="rating-text">Excellent</span>
    <div class="sgeneros">
      <a>Drama</a>
      <a>Action</a>
    </div>
  </div>
  <div id="info">
    <div class="wp-content">
      <div>
        <p>Synopsis text。</p>
        <div id="dt_galery">
          <div class="g-item">
            <a href="/full.jpg">
              <img src="/thumb.jpg" alt="Still One">
            </a>
          </div>
          <div class="g-item">
            <a href="https://cdn.example.com/full2.jpg">
              <img data-src="https://cdn.example.com/thumb2.jpg" alt="">
            </a>
          </div>
        </div>
      </div>
    </div>
    <table>
      <tbody>
        <tr><th>Director</th><td>John Doe</td></tr>
        <tr><th>Cast</th><td>Jane Doe</td></tr>
      </tbody>
    </table>
  </div>
  <div class="detail-meta">
    <div class="extra">
      <span class="date">2024-09-01</span>
      <span class="date">完结</span>
    </div>
  </div>
`

const seasonsHtml = `
  <div id="seasons">
    <div class="se-c">
      <div class="se-q">
        <a href="/seasons/123.html">
          <span class="title">
            <i>2024</i>
            <i>完结</i>
            第一季
          </span>
        </a>
      </div>
      <img src="/images/season1.jpg" alt="Season One">
    </div>
    <div class="se-c">
      <div class="se-q">
        <a href="https://chaospace.tv/seasons/456.html">
          <span class="title">第二季</span>
        </a>
      </div>
      <img data-src="https://cdn.example.com/season2.jpg" alt="">
    </div>
    <div class="se-c broken">
      <div class="se-q">
        <div class="cta">
          <a href="/redirect?target=/promo?ref=season">
            <span class="title">
              <span class="cta-link">
                <a href="/seasons/789.html" aria-label="nested-link"></a>
              </span>
              &nbsp;
            </span>
          </a>
        </div>
      </div>
      <picture>
        <source srcset="//cdn.example.com/season3-320.webp 320w, //cdn.example.com/season3-720.webp 720w">
        <img data-src="/images/season3-lazy.jpg" alt="">
      </picture>
    </div>
  </div>
`

const downloadHtml = `
  <div id="download">
    <table>
      <tbody>
        <tr id="link-1">
          <td>
            <a href="/links/1.html">资源 1</a>
          </td>
        </tr>
        <tr id="link-2">
          <td>
            <a href="/links/2.html">资源 2</a>
          </td>
        </tr>
        <tr id="link-3">
          <td>
            <a href="/links/3.html"><strong>&nbsp;</strong></a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
`

describe('parser-service', () => {
  it('parses link page and extracts passcode', () => {
    const html = `<a href="https://pan.baidu.com/s/foobar?pwd=abcd">Download</a>`
    const result = parseLinkPage(html)
    expect(result).toEqual({
      linkUrl: 'https://pan.baidu.com/s/foobar?pwd=abcd',
      passCode: 'abcd',
    })
  })

  it('falls back to 提取码 text when passcode is missing from URL', () => {
    const html = `
      <div class="link-card" data-clipboard-text="https://pan.baidu.com/s/baidu-share">
        <p>百度网盘下载 · CHAOSPACE</p>
        <span>提取码：Z9X8</span>
      </div>
    `
    const result = parseLinkPage(html)
    expect(result).toEqual({
      linkUrl: 'https://pan.baidu.com/s/baidu-share',
      passCode: 'Z9X8',
    })
  })

  it('parses history detail sections into structured data', () => {
    const detail = parseHistoryDetailFromHtml(detailHtml, 'https://chaospace.tv/shows/example.html')
    expect(detail.title).toBe('Example Title')
    expect(detail.poster?.src).toBe('https://chaospace.tv/images/poster.jpg')
    expect(detail.releaseDate).toBe('2024-09-01')
    expect(detail.country).toBe('Japan')
    expect(detail.runtime).toBe('120 分钟')
    expect(detail.rating).toEqual({
      value: '8.5',
      votes: '1000 votes',
      label: 'Excellent',
      scale: 10,
    })
    expect(detail.genres).toEqual(['Drama', 'Action'])
    expect(detail.synopsis).toContain('Synopsis text')
    expect(detail.stills).toHaveLength(2)
    const [firstStill, secondStill] = detail.stills
    if (!firstStill || !secondStill) {
      throw new Error('Expected history stills to be populated')
    }
    expect(firstStill).toMatchObject({
      url: 'https://chaospace.tv/full.jpg',
      thumb: 'https://chaospace.tv/thumb.jpg',
      alt: 'Still One',
    })
    expect(secondStill).toMatchObject({
      url: 'https://cdn.example.com/full2.jpg',
      thumb: 'https://cdn.example.com/thumb2.jpg',
      alt: 'Example Title',
    })
    expect(detail.info).toEqual([
      { label: 'Director', value: 'John Doe' },
      { label: 'Cast', value: 'Jane Doe' },
    ])
    expect(detail.completion?.state).toBe('completed')
    expect(detail.completion?.label).toBe('完结')
  })

  it('parses season entries including poster URLs', () => {
    const entries = parseTvShowSeasonEntriesFromHtml(
      seasonsHtml,
      'https://chaospace.tv/tvshows/1.html',
    )
    expect(entries).toHaveLength(3)
    const [firstEntry, secondEntry, thirdEntry] = entries
    if (!firstEntry || !secondEntry || !thirdEntry) {
      throw new Error('Expected season entries to be populated')
    }
    expect(firstEntry).toMatchObject({
      seasonId: '123',
      url: 'https://chaospace.tv/seasons/123.html',
      label: '2024 完结',
      seasonIndex: 0,
    })
    expect(firstEntry.poster?.src).toBe('https://chaospace.tv/images/season1.jpg')
    expect(secondEntry.seasonId).toBe('456')
    expect(secondEntry.poster?.src).toBe('https://cdn.example.com/season2.jpg')
    expect(thirdEntry.url).toBe('https://chaospace.tv/redirect?target=/promo?ref=season')
    expect(thirdEntry.poster?.src).toBe('https://chaospace.tv/images/season3-lazy.jpg')
    expect(thirdEntry.poster?.alt).toBe('')
  })

  it('parses completion labels from season listings', () => {
    const completion = parseTvShowSeasonCompletionFromHtml(seasonsHtml)
    expect(completion['123']?.state).toBe('completed')
    expect(completion['123']?.label).toBe('完结')
  })

  it('falls back to generated season identifiers when markup is malformed', () => {
    const entries = parseTvShowSeasonEntriesFromHtml(
      seasonsHtml,
      'https://chaospace.tv/tvshows/1.html',
    )
    const fallbackEntry = entries[2]
    if (!fallbackEntry) {
      throw new Error('Expected fallback season entry to exist')
    }
    expect(fallbackEntry).toMatchObject({
      seasonId: 'season-3',
      url: 'https://chaospace.tv/redirect?target=/promo?ref=season',
      label: '未命名资源',
    })
  })

  it('extracts items from download tables using history fallback', () => {
    const history = {
      '1': { linkUrl: 'https://pan.baidu.com/s/123', passCode: 'abcd' },
    }
    const items = parseItemsFromHtml(downloadHtml, history)
    expect(items).toEqual([
      {
        id: '1',
        title: '资源 1',
        linkUrl: 'https://pan.baidu.com/s/123',
        passCode: 'abcd',
      },
      {
        id: '2',
        title: '资源 2',
        linkUrl: '',
        passCode: '',
      },
      {
        id: '3',
        title: '未命名资源',
        linkUrl: '',
        passCode: '',
      },
    ])
  })

  it('derives completion state from arbitrary detail markup', () => {
    const completion = parseCompletionFromHtml(
      `<div class="extra"><span class="date">2024-10-01</span><span class="date">更新至 10</span></div>`,
      'detail-meta',
    )
    expect(completion).toMatchObject({
      label: '更新至 10',
      state: 'ongoing',
      source: 'detail-meta',
    })
  })
})
