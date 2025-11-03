import {
  CLASSIFICATION_PATH_MAP,
  TV_SHOW_INITIAL_SEASON_BATCH,
  PAN_DISK_BASE_URL
} from '../constants.js';
import {
  stripHtmlTags,
  extractCleanTitle,
  decodeHtmlEntities
} from '../../shared/utils/sanitizers.js';
import {
  createCompletionStatus,
  summarizeSeasonCompletion,
  isDateLikeLabel
} from '../../shared/utils/completion-status.js';
import {
  normalizeSeasonLabel as normalizeSeasonLabelUtil
} from '../../shared/utils/chinese-numeral.js';

const SEASON_TRAILING_NOISE_PATTERNS = [
  /\s*(?:N[\/-]?A|暂无(?:评分|评价)?|未评分|评分\s*[:：]?\s*待定|豆瓣\s*\d+(?:\.\d+)?|IMDb\s*\d+(?:\.\d+)?|烂番茄\s*\d+(?:\.\d+)?%?|\d+\.\d+(?:\s*分)?|\d+(?:\.\d+)?\s*\/\s*10|\d+(?:\.\d+)?\s*分)\s*$/iu,
  /\s*(?:已完结\d*|已完结|完结|全集|连载(?:中)?|更新(?:至[^，。；]*)?|更新中|播出中|定档[^，。；]*|收官|暂停(?:更新)?|未播|待播|待定|上映中|首播|即将播出|即将上线)\s*$/u,
  /\s*(?:\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?)\s*$/u,
  /\s*(?:[-–—·•|／]+)\s*$/u
];

function stripSeasonTrailingNoise(value) {
  let result = (value || '').trim();
  if (!result) {
    return '';
  }
  let changed = true;
  while (changed && result) {
    changed = false;
    for (const pattern of SEASON_TRAILING_NOISE_PATTERNS) {
      const next = result.replace(pattern, '').trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }
  return result;
}

class ChaospaceClassifier {
  constructor() {
    this.cachedMainDoc = null;
    this.cachedMainDocUrl = '';
  }

  async classifyCurrentPage() {
    const url = window.location.href || '';
    if (this.isMoviePage(url)) {
      return 'movie';
    }
    if (!this.isTvShowPage(url)) {
      return 'unknown';
    }

    const primaryAnalysis = this.analyzeDocument(document);
    if (primaryAnalysis.classification === 'anime') {
      return 'anime';
    }
    if (this.isSeasonPage(url)) {
      const mainDoc = await this.getMainPageContent({ onlyWhenNecessary: true, currentAnalysis: primaryAnalysis });
      if (mainDoc && mainDoc !== document) {
        const mainAnalysis = this.analyzeDocument(mainDoc);
        if (mainAnalysis.classification === 'anime') {
          return 'anime';
        }
      }
    }
    return 'tvshow';
  }

  async getDetailedClassification() {
    const result = {
      url: window.location.href || '',
      classification: 'unknown',
      confidence: 0,
      reasons: [],
      debug: {
        isMovie: false,
        isTvShow: false,
        isSeason: false,
        primary: {
          hasJapaneseChannel: false,
          hasStrongKeywordsInBody: false,
          hasStrongKeywordsInMeta: false,
          hasWeakKeywordsInBody: false,
          hasWeakKeywordsInMeta: false,
          tvChannels: []
        },
        mainPageLoaded: false,
        main: {
          hasJapaneseChannel: false,
          hasStrongKeywordsInBody: false,
          hasStrongKeywordsInMeta: false,
          hasWeakKeywordsInBody: false,
          hasWeakKeywordsInMeta: false,
          tvChannels: []
        }
      }
    };

    const url = window.location.href || '';
    result.debug.isMovie = this.isMoviePage(url);
    if (result.debug.isMovie) {
      result.classification = 'movie';
      result.confidence = 1;
      result.reasons.push('URL 包含 /movies/ 路径');
      return result;
    }

    result.debug.isTvShow = this.isTvShowPage(url);
    result.debug.isSeason = this.isSeasonPage(url);
    if (!result.debug.isTvShow) {
      result.reasons.push('URL 未匹配剧集路径');
      return result;
    }

    const primaryAnalysis = this.analyzeDocument(document);
    result.debug.primary = {
      hasJapaneseChannel: primaryAnalysis.hasJapaneseChannel,
      hasStrongKeywordsInBody: primaryAnalysis.hasStrongKeywordsInBody,
      hasStrongKeywordsInMeta: primaryAnalysis.hasStrongKeywordsInMeta,
      hasWeakKeywordsInBody: primaryAnalysis.hasWeakKeywordsInBody,
      hasWeakKeywordsInMeta: primaryAnalysis.hasWeakKeywordsInMeta,
      tvChannels: primaryAnalysis.tvChannels
    };

    let finalClassification = primaryAnalysis.classification;
    let confidence = primaryAnalysis.hasJapaneseChannel ? 0.9 : (primaryAnalysis.hasJapaneseKeywordsStrong ? 0.75 : 0.6);

    if (primaryAnalysis.hasJapaneseChannel) {
      result.reasons.push('检测到日本电视台/平台标识');
    } else if (primaryAnalysis.hasJapaneseKeywordsStrong) {
      const sourceLabel = primaryAnalysis.hasStrongKeywordsInBody ? '页面正文' : '标题/简介';
      result.reasons.push(`检测到 ${sourceLabel} 中的日本相关关键词`);
    }

    if (finalClassification !== 'anime' && result.debug.isSeason) {
      const mainDoc = await this.getMainPageContent({ onlyWhenNecessary: true, currentAnalysis: primaryAnalysis });
      if (mainDoc && mainDoc !== document) {
        result.debug.mainPageLoaded = true;
        const mainAnalysis = this.analyzeDocument(mainDoc);
        result.debug.main = {
          hasJapaneseChannel: mainAnalysis.hasJapaneseChannel,
          hasStrongKeywordsInBody: mainAnalysis.hasStrongKeywordsInBody,
          hasStrongKeywordsInMeta: mainAnalysis.hasStrongKeywordsInMeta,
          hasWeakKeywordsInBody: mainAnalysis.hasWeakKeywordsInBody,
          hasWeakKeywordsInMeta: mainAnalysis.hasWeakKeywordsInMeta,
          tvChannels: mainAnalysis.tvChannels
        };
        if (mainAnalysis.classification === 'anime') {
          finalClassification = 'anime';
          confidence = mainAnalysis.hasJapaneseChannel ? 0.9 : (mainAnalysis.hasJapaneseKeywordsStrong ? 0.75 : 0.6);
          if (mainAnalysis.hasJapaneseChannel) {
            result.reasons.push('主剧集页检测到日本电视台/平台标识');
          } else if (mainAnalysis.hasJapaneseKeywordsStrong) {
            const mainSourceLabel = mainAnalysis.hasStrongKeywordsInBody ? '主剧集页正文' : '主剧集页标题/简介';
            result.reasons.push(`主剧集页检测到 ${mainSourceLabel} 中的日本相关关键词`);
          }
        }
      }
    }

    if (finalClassification !== 'anime') {
      result.reasons.push('未匹配番剧特征，归类为普通影视');
    }

    result.classification = finalClassification;
    result.confidence = confidence;
    return result;
  }

  isMoviePage(url) {
    return typeof url === 'string' && url.includes('/movies/');
  }

  isTvShowPage(url) {
    if (typeof url !== 'string') {
      return false;
    }
    return url.includes('/tvshows/') || url.includes('/seasons/');
  }

  isSeasonPage(url) {
    return typeof url === 'string' && url.includes('/seasons/');
  }

  analyzeDocument(doc) {
    const channels = this.extractTVChannels(doc);
    const hasJapaneseChannel = channels.some(channel => this.isJapaneseTVChannel(channel));
    const pageText = this.extractPageText(doc);
    const hasStrongKeywordsInBody = this.containsKeywords(pageText, JAPANESE_KEYWORDS_STRONG);
    const hasWeakKeywordsInBody = this.containsKeywords(pageText, JAPANESE_KEYWORDS_WEAK);
    const title = (doc && doc.title) || document.title || '';
    const description = this.extractDescription(doc);
    const metaText = `${title} ${description}`;
    const hasStrongKeywordsInMeta = this.containsKeywords(metaText, JAPANESE_KEYWORDS_STRONG);
    const hasWeakKeywordsInMeta = this.containsKeywords(metaText, JAPANESE_KEYWORDS_WEAK);
    const hasJapaneseKeywordsStrong = hasStrongKeywordsInBody || hasStrongKeywordsInMeta;
    const hasJapaneseKeywordsWeak = hasWeakKeywordsInBody || hasWeakKeywordsInMeta;
    const classification = hasJapaneseChannel || hasJapaneseKeywordsStrong ? 'anime' : 'tvshow';
    return {
      classification,
      tvChannels: channels,
      hasJapaneseChannel,
      hasStrongKeywordsInBody,
      hasStrongKeywordsInMeta,
      hasWeakKeywordsInBody,
      hasWeakKeywordsInMeta,
      hasJapaneseKeywordsStrong,
      hasJapaneseKeywordsWeak
    };
  }

  findMainPageUrl() {
    try {
      const container = document.querySelector('.sgeneros');
      if (container) {
        const anchor = container.querySelector('a[href*="/tvshows/"]');
        if (anchor && anchor.href) {
          return anchor.href;
        }
      }
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to resolve main page via .sgeneros', error);
    }

    const seasonPathMatch = window.location.pathname.match(/\/seasons\/(\d+)/i);
    if (seasonPathMatch && seasonPathMatch[1]) {
      return `${window.location.origin}/tvshows/${seasonPathMatch[1]}.html`;
    }

    return null;
  }

  async getMainPageContent({ onlyWhenNecessary = false, currentAnalysis = null } = {}) {
    if (onlyWhenNecessary && currentAnalysis && (currentAnalysis.hasJapaneseChannel || currentAnalysis.hasJapaneseKeywordsStrong)) {
      return document;
    }

    const mainUrl = this.findMainPageUrl();
    if (!mainUrl) {
      return document;
    }
    if (this.cachedMainDoc && this.cachedMainDocUrl === mainUrl) {
      return this.cachedMainDoc;
    }

    try {
      const response = await fetch(mainUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/html',
          'User-Agent': navigator.userAgent
        },
        credentials: 'include'
      });
      if (!response.ok) {
        return document;
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      this.cachedMainDoc = doc;
      this.cachedMainDocUrl = mainUrl;
      return doc;
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to load main page for classification', error);
      return document;
    }
  }

  extractTVChannels(doc) {
    const channels = [];
    const root = doc && typeof doc.querySelectorAll === 'function' ? doc : document;
    const selectors = [
      '.extra a[href*="/network/"]',
      '.extra a[href*="/channel/"]',
      '.extra span.network',
      '.sked-details .network',
      '.sgeneros a[href*="/network/"]',
      '.sgeneros a[href*="/channel/"]'
    ];
    selectors.forEach(selector => {
      const entries = root.querySelectorAll(selector);
      entries.forEach(entry => {
        const text = (entry?.textContent || entry?.title || '').trim();
        if (text) {
          channels.push(text);
        }
      });
    });
    return channels;
  }

  extractPageText(doc) {
    try {
      const sourceRoot = doc?.body || doc?.documentElement || document.body;
      if (!sourceRoot) {
        return '';
      }
      const clone = sourceRoot.cloneNode(true);
      if (!clone || typeof clone.querySelectorAll !== 'function') {
        return '';
      }
      clone.querySelectorAll('script, style, nav, footer, header').forEach(node => node.remove());
      const text = clone.textContent || '';
      return text.replace(/\s+/g, ' ').trim();
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to extract page text', error);
      return '';
    }
  }

  containsKeywords(text, keywordSet) {
    if (!text || typeof text !== 'string') {
      return false;
    }
    const lower = text.toLowerCase();
    for (const keyword of keywordSet) {
      if (lower.includes(keyword.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  isJapaneseTVChannel(channel) {
    if (!channel || typeof channel !== 'string') {
      return false;
    }
    const trimmed = channel.trim();
    if (!trimmed) {
      return false;
    }
    if (JAPANESE_TV_CHANNELS.has(trimmed)) {
      return true;
    }
    const lower = trimmed.toLowerCase();
    const known = [...JAPANESE_TV_CHANNELS].some(name => name.toLowerCase() === lower);
    if (known) {
      return true;
    }
    const patterns = [
      /^(at-x|atx|at_x)$/i,
      /^(bs\d+|bs\d+\s*\w*)$/i,
      /^(tokyo\s*mx|mx\s*tv)$/i,
      /^(gunma\s*tv|群馬テレビ)$/i,
      /^(tochigi\s*tv|栃木テレビ)$/i,
      /^(nippon\s*tv|ntv|日テレ)$/i,
      /^(tv\s*asahi|asahi|テレビ朝日)$/i,
      /^(tbs\s*tv|tbs)$/i,
      /^(tv\s*tokyo|tx|テレビ東京)$/i,
      /^(fuji\s*tv|cx|フジテレビ)$/i,
      /^(nhk\s*\w*|nhk)$/i,
      /^(animax|アニマックス)$/i,
      /^(abema|アベマ)$/i
    ];
    return patterns.some(pattern => pattern.test(trimmed));
  }

  extractDescription(doc) {
    try {
      const root = doc && typeof doc.querySelector === 'function' ? doc : document;
      const metaDescription = root.querySelector('meta[name="description"]');
      if (metaDescription && metaDescription.getAttribute('content')) {
        return metaDescription.getAttribute('content') || '';
      }
      const ogDescription = root.querySelector('meta[property="og:description"]');
      if (ogDescription && ogDescription.getAttribute('content')) {
        return ogDescription.getAttribute('content') || '';
      }
      return '';
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to extract description', error);
      return '';
    }
  }
}

let pageClassificationPromise = null;
let pageClassificationUrl = null;

export async function getPageClassification({ detailed = false } = {}) {
  const currentUrl = window.location.href || '';
  if (pageClassificationUrl !== currentUrl) {
    pageClassificationPromise = null;
    pageClassificationUrl = currentUrl;
  }
  if (!pageClassificationPromise) {
    const classifier = new ChaospaceClassifier();
    pageClassificationPromise = classifier.getDetailedClassification().catch(error => {
      console.error('[Chaospace Transfer] Page classification failed', error);
      return {
        url: window.location.href || '',
        classification: 'unknown',
        confidence: 0,
        reasons: ['分类器执行出错'],
        debug: {}
      };
    });
    pageClassificationUrl = currentUrl;
  }
  const result = await pageClassificationPromise;
  return detailed ? result : result?.classification || 'unknown';
}

export function suggestDirectoryFromClassification(classification) {
  if (!classification) {
    return null;
  }
  if (typeof classification === 'string') {
    return CLASSIFICATION_PATH_MAP[classification] || null;
  }
  if (classification && typeof classification === 'object') {
    const key = classification.classification || classification.type;
    return CLASSIFICATION_PATH_MAP[key] || null;
  }
  return null;
}

export function normalizeDir(value) {
  const input = (value || '').trim();
  if (!input) {
    return '/';
  }
  let normalized = input.replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function sanitizeSeasonDirSegment(value) {
  const text = (value || '').trim();
  if (!text) {
    return '';
  }

  // 第一步：统一空白字符
  let normalized = text.replace(/\s+/g, ' ').trim();

  // 第二步：清理尾部噪音（日期、评分、状态等）
  normalized = stripSeasonTrailingNoise(normalized);

  // 第三步：移除括号内的状态标注
  normalized = normalized.replace(/[（(][^()（）]*?(完结|更新|连载|上映|首播)[^()（）]*?[)）]/gu, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // 第四步：再次清理尾部噪音
  normalized = stripSeasonTrailingNoise(normalized);

  // 第五步：替换文件系统非法字符
  normalized = normalized.replace(/[<>:"|?*]+/g, '-');
  normalized = normalized.replace(/[\/\\]+/g, '-');
  normalized = normalized.replace(/-+/g, '-');
  normalized = normalized.replace(/^-+|-+$/g, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // 第六步：最后一次清理尾部噪音
  normalized = stripSeasonTrailingNoise(normalized);

  // 第七步：针对"第X季"格式的特殊处理
  const seasonMatch = normalized.match(/^(第[\d一二三四五六七八九十百零两]+季)(?:\s*(.+))?$/u);
  if (seasonMatch) {
    const suffix = (seasonMatch[2] || '').trim();
    if (suffix) {
      // 如果后缀看起来是噪音，只保留季标识
      const cleanedSuffix = suffix.replace(/^[·•|，,，。；;:-]+/u, '').trim();
      const keywords = ['完结', '更新', '连载', '全集', '播', '定档', '收官', '暂停', '评分', '豆瓣', 'IMDb', '烂番茄', '首播', '上映'];
      const looksDate = /\d{4}[./-]\d{1,2}/.test(cleanedSuffix);
      const looksNumeric = /^[\d\s./%-]+$/.test(cleanedSuffix);
      const looksRating = /^(?:N[\/-]?A|暂无(?:评分|评价)?|未评分|评分\s*[:：]?\s*待定|豆瓣\s*\d+(?:\.\d+)?|IMDb\s*\d+(?:\.\d+)?|烂番茄\s*\d+(?:\.\d+)?%?|\d+\.\d+(?:\s*分)?|\d+(?:\.\d+)?\s*\/\s*10|\d+(?:\.\d+)?\s*分)$/iu.test(cleanedSuffix);
      const hasKeywords = keywords.some(keyword => cleanedSuffix.includes(keyword));
      if (looksDate || looksNumeric || looksRating || hasKeywords) {
        normalized = seasonMatch[1];
      }
    } else {
      normalized = seasonMatch[1];
    }
  }

  // 第八步：将中文数字转换为阿拉伯数字（无论是否匹配seasonMatch）
  normalized = normalizeSeasonLabelUtil(normalized);

  return normalized.trim();
}

function normalizeSeasonLabel(label, index = 0) {
  // 先清理噪音
  const cleaned = stripSeasonTrailingNoise(label || '');
  if (!cleaned) {
    return `第${Number.isFinite(index) ? index + 1 : 1}季`;
  }

  // 再进行目录清理和标准化
  const sanitized = sanitizeSeasonDirSegment(cleaned);
  if (sanitized) {
    const compact = sanitized.replace(/\s+/g, ' ').trim();
    if (/^s\d+$/i.test(compact)) {
      return compact.toUpperCase();
    }
    if (/^season\s*\d+$/i.test(compact)) {
      return compact.replace(/\s+/g, ' ').replace(/season/i, 'Season');
    }
    return compact;
  }

  // 如果清理后为空，使用默认值
  return `第${Number.isFinite(index) ? index + 1 : 1}季`;
}

export function deriveSeasonDirectory(label, index = 0) {
  // 先清理噪音，再生成目录名
  const cleaned = stripSeasonTrailingNoise(label || '');
  const base = sanitizeSeasonDirSegment(cleaned);
  if (base) {
    return base;
  }
  return `第${Number.isFinite(index) ? index + 1 : 1}季`;
}

export function buildPanDirectoryUrl(path) {
  const normalized = normalizeDir(path);
  const encoded = encodeURIComponent(normalized === '/' ? '/' : normalized);
  return `${PAN_DISK_BASE_URL}${encoded}`;
}

export function normalizePageUrl(url) {
  if (!url) {
    return window.location.href;
  }
  try {
    const normalized = new URL(url, window.location.href);
    normalized.hash = '';
    return normalized.toString();
  } catch (_error) {
    return window.location.href;
  }
}

export function isTvShowUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  return url.includes('/tvshows/');
}

export function isSeasonUrl(url) {
  return typeof url === 'string' && /\/seasons\/\d+\.html/.test(url);
}

export function isSupportedDetailPage() {
  const url = window.location.href || '';
  return isTvShowUrl(url) || isSeasonUrl(url) || url.includes('/movies/');
}

export async function analyzePage(options = {}) {
  const {
    deferTvSeasons = false,
    initialSeasonBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
  } = options || {};
  return collectLinks({ deferTvSeasons, initialSeasonBatchSize });
}

export async function fetchSeasonDetail(info) {
  if (!info || !info.url) {
    return {
      items: [],
      completion: info?.completion || null,
      poster: info?.poster || null
    };
  }
  let seasonItems = [];
  let completion = info.completion || null;
  let poster = info.poster || null;
  try {
    const doc = await fetchHtmlDocument(info.url);
    seasonItems = extractItemsFromDocument(doc, { baseUrl: info.url });
    const derivedCompletion =
      extractSeasonPageCompletion(doc, 'season-detail') ||
      info.completion ||
      null;
    if (derivedCompletion) {
      completion = derivedCompletion;
    }
    const docPoster = extractPosterDetails(doc, {
      baseUrl: info.url,
      fallbackAlt: info.label
    });
    if (docPoster) {
      poster = docPoster;
    }
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to load season page', info.url, error);
  }
  return {
    items: seasonItems,
    completion,
    poster
  };
}

async function collectLinks(options = {}) {
  const {
    deferTvSeasons = false,
    initialSeasonBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
  } = options || {};
  const baseResult = {
    items: [],
    url: window.location.href || '',
    origin: window.location.origin || '',
    title: getPageCleanTitle(),
    poster: extractPosterDetails(),
    completion: null,
    seasonCompletion: {},
    deferredSeasons: [],
    totalSeasons: 0,
    loadedSeasons: 0,
    seasonEntries: []
  };

  try {
    let completion = null;
    let seasonCompletion = {};
    let deferredSeasons = [];
    let totalSeasons = 0;
    let loadedSeasons = 0;
    let seasonEntries = [];
    let seasonData = null;
    let items = extractItemsFromDocument(document);
    if (isSeasonUrl(window.location.href)) {
      completion = extractSeasonPageCompletion(document);
    }
    if (isTvShowUrl(window.location.href)) {
      seasonData = await collectTvShowSeasonItems({
        defer: deferTvSeasons,
        initialBatchSize: initialSeasonBatchSize
      });
      if (seasonData.items && seasonData.items.length > 0) {
        items = seasonData.items;
      }
      if (seasonData.seasonCompletion) {
        seasonCompletion = seasonData.seasonCompletion;
      }
      if (Array.isArray(seasonData.deferredSeasons)) {
        deferredSeasons = seasonData.deferredSeasons;
      }
      totalSeasons = seasonData.totalSeasons;
      loadedSeasons = seasonData.loadedSeasons;
      seasonEntries = seasonData.seasonEntries;
      if (completion == null && seasonData.completion) {
        completion = seasonData.completion;
      }
    }

    const filteredItems = items.filter(item => item && item.id);
    const dedupedItems = [];
    const seen = new Set();
    filteredItems.forEach(item => {
      if (seen.has(item.id)) {
        return;
      }
      seen.add(item.id);
      dedupedItems.push(item);
    });

    const classificationDetail = await getPageClassification({ detailed: true });
    const normalizedItems = dedupedItems.map(item => {
      if (!item || typeof item !== 'object') {
        return item;
      }
      const normalizedLabel =
        (typeof item.seasonLabel === 'string' && item.seasonLabel.trim()) || Number.isFinite(item.seasonIndex)
          ? normalizeSeasonLabel(item.seasonLabel, item.seasonIndex)
          : '';
      if (normalizedLabel) {
        return {
          ...item,
          seasonLabel: normalizedLabel
        };
      }
      return item;
    });
    const normalizedSeasonEntries = Array.isArray(seasonEntries)
      ? seasonEntries.map(entry => ({
          ...entry,
          label: normalizeSeasonLabel(entry.label, entry.seasonIndex)
        }))
      : [];
    const normalizedDeferredSeasons = Array.isArray(deferredSeasons)
      ? deferredSeasons.map(info => ({
          ...info,
          label: normalizeSeasonLabel(info.label, info.index)
        }))
      : [];

    return {
      ...baseResult,
      items: normalizedItems,
      completion,
      seasonCompletion,
      deferredSeasons: normalizedDeferredSeasons,
      totalSeasons,
      loadedSeasons,
      seasonEntries: normalizedSeasonEntries,
      classification: classificationDetail?.classification || 'unknown',
      classificationDetail
    };
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to collect links', error);
    const classificationDetail = await getPageClassification({ detailed: true }).catch(() => null);
    return {
      ...baseResult,
      classification: classificationDetail?.classification || 'unknown',
      classificationDetail
    };
  }
}

async function collectTvShowSeasonItems(options = {}) {
  const {
    defer = false,
    initialBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
  } = options || {};
  const seasonBlocks = Array.from(document.querySelectorAll('#seasons .se-c'));
  if (!seasonBlocks.length) {
    return {
      items: [],
      seasonCompletion: {},
      completion: null,
      deferredSeasons: [],
      totalSeasons: 0,
      loadedSeasons: 0,
      seasonEntries: []
    };
  }

  const basePageUrl = window.location.href;
  const seasonInfos = seasonBlocks
    .map((block, index) => {
      const anchor = block.querySelector('.se-q a[href]');
      if (!anchor) {
        return null;
      }
      const href = anchor.getAttribute('href') || anchor.href;
      const url = resolveAbsoluteUrl(href);
      if (!url) {
        return null;
      }
      const rawLabel = deriveSeasonLabel(block, index);
      const label = normalizeSeasonLabel(rawLabel, index);
      const seasonIdMatch = url.match(/\/seasons\/(\d+)\.html/);
      const seasonId = seasonIdMatch ? seasonIdMatch[1] : `season-${index + 1}`;
      const completion = extractSeasonListCompletion(block);
      const poster = extractPosterFromSeasonBlock(block, {
        baseUrl: basePageUrl,
        fallbackAlt: label
      });
      return { url, label, index, seasonId, completion, poster };
    })
    .filter(Boolean);

  if (!seasonInfos.length) {
    return {
      items: [],
      seasonCompletion: {},
      completion: null,
      deferredSeasons: [],
      totalSeasons: 0,
      loadedSeasons: 0,
      seasonEntries: []
    };
  }

  const aggregated = [];
  const seen = new Set();
  const seasonCompletionMap = new Map();
  const seasonEntryMap = new Map();

  seasonInfos.forEach(info => {
    if (info.completion) {
      seasonCompletionMap.set(info.seasonId, info.completion);
    }
    seasonEntryMap.set(info.seasonId, {
      seasonId: info.seasonId,
      label: normalizeSeasonLabel(info.label, info.index),
      url: info.url,
      seasonIndex: info.index,
      completion: info.completion || null,
      poster: info.poster || null,
      loaded: false,
      hasItems: false
    });
  });

  const effectiveBatchSize = defer
    ? Math.max(
        0,
        Math.min(
          Number.isFinite(initialBatchSize) ? Math.trunc(initialBatchSize) : 2,
          seasonInfos.length
        )
      )
    : seasonInfos.length;
  const immediateInfos = seasonInfos.slice(0, effectiveBatchSize);
  const deferredInfos = defer ? seasonInfos.slice(effectiveBatchSize) : [];

  const immediateIdSet = new Set(immediateInfos.map(info => info.seasonId));
  seasonEntryMap.forEach(entry => {
    entry.loaded = immediateIdSet.has(entry.seasonId) || !defer;
  });

  const seasonResults = immediateInfos.length
    ? await Promise.all(
        immediateInfos.map(async info => {
          try {
            const result = await fetchSeasonDetail(info);
            return { info, ...result };
          } catch (error) {
            console.error('[Chaospace Transfer] Failed to load season page', info.url, error);
            return {
              info,
              items: [],
              completion: info.completion || null,
              poster: info.poster || null
            };
          }
        })
      )
    : [];

  const results = seasonResults;

  results.forEach(({ info, items, completion, poster }) => {
    if (completion) {
      seasonCompletionMap.set(info.seasonId, completion);
    } else if (info.completion) {
      seasonCompletionMap.set(info.seasonId, info.completion);
    }
    const entry = seasonEntryMap.get(info.seasonId);
    if (entry) {
      entry.loaded = true;
      entry.completion = completion || info.completion || entry.completion || null;
      const effectivePoster = poster || info.poster || entry.poster || null;
      if (effectivePoster) {
        entry.poster = effectivePoster;
      }
      if (items && items.length) {
        entry.hasItems = true;
      }
      entry.lastHydratedAt = Date.now();
    }
    if (!items || !items.length) {
      return;
    }
    const displayLabel = normalizeSeasonLabel(info.label, info.index);
    items.forEach((item, itemIndex) => {
      if (seen.has(item.id)) {
        return;
      }
      seen.add(item.id);
      aggregated.push({
        ...item,
        order: info.index * 10000 + (typeof item.order === 'number' ? item.order : itemIndex),
        seasonLabel: displayLabel,
        seasonIndex: info.index,
        seasonId: info.seasonId,
        seasonUrl: info.url,
        seasonCompletion: completion || info.completion || null
      });
    });
  });

  const completionEntries = Array.from(seasonCompletionMap.values()).filter(Boolean);
  const completionSummary = completionEntries.length ? summarizeSeasonCompletion(completionEntries) : null;
  const seasonEntries = Array.from(seasonEntryMap.values())
    .map(entry => ({
      ...entry,
      label: normalizeSeasonLabel(entry.label, entry.seasonIndex)
    }))
    .sort((a, b) => a.seasonIndex - b.seasonIndex);

  return {
    items: aggregated,
    seasonCompletion: Object.fromEntries(seasonCompletionMap.entries()),
    completion: completionSummary,
    deferredSeasons: deferredInfos,
    totalSeasons: seasonInfos.length,
    loadedSeasons: seasonInfos.length - deferredInfos.length,
    seasonEntries
  };
}

function locateBaiduPanRows(root = document) {
  const scope = root && typeof root.querySelector === 'function' ? root : document;
  const downloadSection = scope.querySelector('#download');
  if (!downloadSection) {
    return [];
  }
  const selector = 'table tbody tr[id^="link-"]';
  return Array.from(downloadSection.querySelectorAll(selector));
}

function extractItemsFromDocument(root = document, { baseUrl } = {}) {
  const rows = locateBaiduPanRows(root);
  if (!rows.length) {
    return [];
  }
  const items = [];
  rows.forEach(row => {
    const idMatch = (row.id || '').match(/link-(\d+)/);
    const id = idMatch ? idMatch[1] : '';
    if (!id) {
      return;
    }
    const anchor = row.querySelector('a[href*="/links/"]');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href') || anchor.href || '';
    const linkUrl = resolveAbsoluteUrl(href, baseUrl);
    const title = extractCleanTitle(stripHtmlTags(anchor.textContent || anchor.innerText || ''));
    const passNode = row.querySelector('.pwd');
    const passCodeMatch = passNode ? passNode.textContent.match(/提取码[：:]*\s*([0-9a-zA-Z]+)/) : null;
    const passCode = passCodeMatch ? passCodeMatch[1] : '';
    items.push({
      id,
      title: title || `资源 ${id}`,
      linkUrl,
      passCode,
      order: items.length,
      createdAt: Date.now()
    });
  });
  return items;
}

function extractCompletionStatusFromElements(elements, source = '') {
  if (!elements || typeof elements.length !== 'number') {
    return null;
  }
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    const text = (el?.textContent || '').trim();
    if (!text || isDateLikeLabel(text)) {
      continue;
    }
    const status = createCompletionStatus(text, source);
    if (status) {
      return status;
    }
  }
  return null;
}

function extractSeasonPageCompletion(root = document, source = 'season-meta') {
  if (!root || typeof root.querySelector !== 'function') {
    return null;
  }
  const extra = root.querySelector('.data .extra');
  if (!extra) {
    return null;
  }
  const spans = extra.querySelectorAll('.date');
  return extractCompletionStatusFromElements(spans, source);
}

function extractSeasonListCompletion(block) {
  if (!block || typeof block.querySelector !== 'function') {
    return null;
  }
  const titleSpan = block.querySelector('.se-q .title');
  if (!titleSpan) {
    return null;
  }
  const infoTags = titleSpan.querySelectorAll('i');
  const status = extractCompletionStatusFromElements(infoTags, 'season-list');
  if (status) {
    return status;
  }
  const textNodes = [];
  titleSpan.childNodes.forEach(node => {
    if (node && node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent || '').trim();
      if (value) {
        textNodes.push(value);
      }
    }
  });
  for (let i = textNodes.length - 1; i >= 0; i -= 1) {
    const candidate = textNodes[i];
    if (candidate && !isDateLikeLabel(candidate)) {
      const completion = createCompletionStatus(candidate, 'season-list');
      if (completion) {
        return completion;
      }
    }
  }
  return null;
}

function deriveSeasonLabel(block, defaultIndex = 0) {
  if (!block || typeof block.querySelector !== 'function') {
    return `季 ${defaultIndex + 1}`;
  }
  const titleSpan = block.querySelector('.se-q .title');
  if (!titleSpan) {
    return `季 ${defaultIndex + 1}`;
  }
  const text = stripHtmlTags(titleSpan.textContent || '');
  const preliminaryClean = extractCleanTitle(text);
  // 立即清理噪音：日期、评分、状态等
  const clean = stripSeasonTrailingNoise(preliminaryClean);
  return clean || `季 ${defaultIndex + 1}`;
}

function extractPosterFromSeasonBlock(block, options = {}) {
  if (!block || typeof block.querySelector !== 'function') {
    return null;
  }
  const img = block.querySelector('img');
  if (!img) {
    return null;
  }
  return extractPosterFromImageElement(img, options);
}

function extractPosterDetails(root = document, options = {}) {
  const scope = root && typeof root.querySelector === 'function' ? root : document;
  const baseUrl = options.baseUrl || window.location.href;
  const fallbackAlt = typeof options.fallbackAlt === 'string' ? options.fallbackAlt : getPageCleanTitle();
  const selectors = Array.isArray(options.selectors) && options.selectors.length
    ? options.selectors
    : ['.poster img', '.post-thumbnail img', 'article img'];
  let img = null;
  for (const selector of selectors) {
    img = scope.querySelector(selector);
    if (img) {
      break;
    }
  }
  if (!img) {
    return null;
  }
  return extractPosterFromImageElement(img, { baseUrl, fallbackAlt });
}

function extractPosterFromImageElement(img, options = {}) {
  if (!img) {
    return null;
  }
  const baseUrl = options.baseUrl || window.location.href;
  const src = pickImageSource(img, { baseUrl });
  if (!src) {
    return null;
  }
  const altRaw = (img.getAttribute('alt') || '').trim();
  const fallbackAlt = typeof options.fallbackAlt === 'string' ? options.fallbackAlt : '';
  const alt = altRaw ? extractCleanTitle(altRaw) : (fallbackAlt || '');
  const anchor = img.closest('a');
  const href = anchor ? resolveAbsoluteUrl(anchor.getAttribute('href') || anchor.href || '', baseUrl) : '';
  const widthAttr = parseInt(img.getAttribute('width') || '', 10);
  const heightAttr = parseInt(img.getAttribute('height') || '', 10);
  const width = Number.isFinite(img.naturalWidth) && img.naturalWidth > 0 ? img.naturalWidth : (Number.isFinite(widthAttr) ? widthAttr : null);
  const height = Number.isFinite(img.naturalHeight) && img.naturalHeight > 0 ? img.naturalHeight : (Number.isFinite(heightAttr) ? heightAttr : null);
  const aspectRatio = width && height ? Number((width / height).toFixed(3)) : null;
  return {
    src,
    alt,
    href,
    aspectRatio
  };
}

function pickImageSource(img, options = {}) {
  if (!img) {
    return '';
  }
  const baseUrl = options.baseUrl || window.location.href;
  const fromCurrent = resolveAbsoluteUrl(img.currentSrc || img.src || '', baseUrl);
  const srcsetCandidates = [
    ...parseSrcset(img.getAttribute('data-srcset'), baseUrl),
    ...parseSrcset(img.getAttribute('srcset'), baseUrl)
  ];
  if (srcsetCandidates.length > 0) {
    srcsetCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    const best = srcsetCandidates.find(Boolean);
    if (best?.url) {
      return best.url;
    }
  }
  const attributeCandidates = [
    img.getAttribute('data-original'),
    img.getAttribute('data-src'),
    img.getAttribute('data-lazy-src'),
    img.getAttribute('data-medium-file'),
    img.getAttribute('data-large-file'),
    img.getAttribute('src')
  ];
  for (const candidate of attributeCandidates) {
    const absolute = resolveAbsoluteUrl(candidate || '', baseUrl);
    if (absolute) {
      return absolute;
    }
  }
  return fromCurrent;
}

function parseSrcset(value, baseUrl) {
  if (!value || typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map(entry => entry.trim())
    .map(entry => {
      const parts = entry.split(/\s+/);
      const urlPart = parts[0];
      const descriptor = parts[1] || '';
      const widthMatch = descriptor.match(/(\d+(?:\.\d+)?)(w|x)?/i);
      let score = 0;
      if (widthMatch) {
        const size = parseFloat(widthMatch[1]);
        if (Number.isFinite(size)) {
          score = widthMatch[2] && widthMatch[2].toLowerCase() === 'x' ? size * 1000 : size;
        }
      }
      const resolved = resolveAbsoluteUrl(urlPart, baseUrl);
      return {
        url: resolved,
        score
      };
    })
    .filter(item => Boolean(item.url));
}

function resolveAbsoluteUrl(value, baseUrl = window.location.href) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return new URL(trimmed, baseUrl).href;
  } catch (_error) {
    return '';
  }
}

function getPageCleanTitle() {
  const pageTitle = document.title;
  if (!pageTitle) {
    return '未命名资源';
  }
  let title = pageTitle.replace(/\s*[–\-_|]\s*CHAOSPACE.*$/i, '');
  title = extractCleanTitle(title);
  if (!title) {
    title = '未命名资源';
  }
  return title;
}

async function fetchHtmlDocument(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }
  const html = await response.text();
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

const JAPANESE_TV_CHANNELS = new Set([
  'NHK', 'NHK-G', 'NHK-E', 'NHK-BS', 'NHK-BS4K', 'NHK-BS8K',
  'Nippon TV', 'NTV', 'Yomiuri TV', 'ytv',
  'TV Asahi', 'EX', 'ABC', 'ANN',
  'TBS', 'TBS TV', 'BS-TBS', 'CS-TBS',
  'TV Tokyo', 'TX', 'BS Japan', 'AT-X',
  'Fuji TV', 'CX', 'BS Fuji', 'BS-Fuji',
  'Tokyo MX', 'Tokyo Metropolitan Television', 'MXTV',
  'Kansai TV', 'KTV',
  'Chubu-Nippon Broadcasting', 'CBC',
  'Mainichi Broadcasting System', 'MBS',
  'Asahi Broadcasting Corporation', 'ABC',
  'Osaka Television', 'OTV',
  'Kyoto Broadcasting System', 'KBS',
  'BS11', 'BS-TBS', 'BS Japan', 'BS Fuji', 'BS Asahi', 'BS NTV',
  'BS11 digital', 'BS11 デジタル',
  'AT-X', 'ATX', 'AT-Xアニメ', 'AT-X Anime',
  'Kids Station', 'キッズステーション',
  'Animax', 'アニマックス',
  'Bandai Channel', 'バンダイチャンネル',
  'Gunma TV', '群馬テレビ',
  'Tochigi TV', '栃木テレビ',
  'Chiba TV', '千葉テレビ',
  'TV Saitama', '埼玉テレビ',
  'TV Kanagawa', 'tvk', '神奈川テレビ',
  'Sun TV', 'サンテレビ',
  'KBS Kyoto', '京都放送',
  'ABC Asahi', '朝日放送',
  'MBS Mainichi', '毎日放送',
  'AbemaTV', 'Abema', 'アベマTV',
  'dアニメストア', 'd Anime Store',
  '日テレ', 'テレビ朝日', 'TBSテレビ', 'フジテレビ',
  'テレビ東京', 'NHK総合', 'NHK-Eテレ',
  'BS日テレ', 'BS朝日', 'BSフジ'
]);

const JAPANESE_KEYWORDS_STRONG = new Set([
  '日本', '日剧', '日劇', '日漫', '日本動畫', '日本动画',
  '番剧', '番劇', '新番', '季番', '年番', '半年番',
  '声优', '聲優', '声優', 'seiyu',
  '原作：日本', '日本漫画', '日本漫畫',
  'アニメ', 'アニメーション', 'アニメ化', 'マンガ', 'まんが',
  'ライトノベル', 'ラノベ', '小説原作', '小說原作',
  'ゲーム原作', '遊戲改編', 'ゲーム原作',
  '原作：ライトノベル', '原作：ラノベ'
]);

const JAPANESE_KEYWORDS_WEAK = new Set([
  '动漫', '動畫', '动画', '动画片', 'anime', 'light novel', 'manga'
]);
