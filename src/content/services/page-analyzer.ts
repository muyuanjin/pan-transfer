import {
  CLASSIFICATION_PATH_MAP,
  TV_SHOW_INITIAL_SEASON_BATCH,
  PAN_DISK_BASE_URL
} from '../constants';
import {
  stripHtmlTags,
  extractCleanTitle
} from '@/shared/utils/sanitizers';
import type { PosterInfo } from '@/shared/utils/sanitizers';
import {
  createCompletionStatus,
  summarizeSeasonCompletion,
  isDateLikeLabel,
  type CompletionStatus,
  type SeasonEntry
} from '@/shared/utils/completion-status';
import {
  normalizeSeasonLabel as normalizeSeasonLabelUtil
} from '@/shared/utils/chinese-numeral';
import type { DeferredSeasonInfo, ResourceItem } from '../types';

export type MediaClassification = 'movie' | 'tvshow' | 'anime' | 'unknown';

export interface ClassificationDebugPrimary {
  hasJapaneseChannel: boolean;
  hasStrongKeywordsInBody: boolean;
  hasStrongKeywordsInMeta: boolean;
  hasWeakKeywordsInBody: boolean;
  hasWeakKeywordsInMeta: boolean;
  tvChannels: string[];
}

export interface ClassificationDebug {
  isMovie: boolean;
  isTvShow: boolean;
  isSeason: boolean;
  mainPageLoaded: boolean;
  primary: ClassificationDebugPrimary;
  main: ClassificationDebugPrimary;
}

export interface DetailedClassificationResult {
  url: string;
  classification: MediaClassification;
  confidence: number;
  reasons: string[];
  debug: ClassificationDebug;
}

export interface AnalyzePageOptions {
  deferTvSeasons?: boolean;
  initialSeasonBatchSize?: number;
}

export interface PageAnalysisResult {
  items: ResourceItem[];
  url: string;
  origin: string;
  title: string;
  poster: PosterInfo | null;
  completion: CompletionStatus | null;
  seasonCompletion: Record<string, CompletionStatus>;
  deferredSeasons: DeferredSeasonInfo[];
  totalSeasons: number;
  loadedSeasons: number;
  seasonEntries: SeasonEntry[];
  classification: MediaClassification;
  classificationDetail: DetailedClassificationResult | null;
}

export interface SeasonDetailResult {
  items: ResourceItem[];
  completion: CompletionStatus | null;
  poster: PosterInfo | null;
}

type AnimeOrTvShow = Extract<MediaClassification, 'anime' | 'tvshow'>;

interface DocumentAnalysis {
  classification: AnimeOrTvShow;
  tvChannels: string[];
  hasJapaneseChannel: boolean;
  hasStrongKeywordsInBody: boolean;
  hasStrongKeywordsInMeta: boolean;
  hasWeakKeywordsInBody: boolean;
  hasWeakKeywordsInMeta: boolean;
  hasJapaneseKeywordsStrong: boolean;
  hasJapaneseKeywordsWeak: boolean;
}

interface SeasonBlockInfo extends DeferredSeasonInfo {
  completion: CompletionStatus | null;
  poster: PosterInfo | null;
}

interface SeasonCollectionResult {
  items: ResourceItem[];
  seasonCompletion: Record<string, CompletionStatus>;
  completion: CompletionStatus | null;
  deferredSeasons: DeferredSeasonInfo[];
  totalSeasons: number;
  loadedSeasons: number;
  seasonEntries: SeasonEntry[];
}

type SeasonEntryInternal = SeasonEntry & { lastHydratedAt?: number };

interface ExtractPosterOptions {
  baseUrl?: string;
  fallbackAlt?: string;
  selectors?: string[];
}

interface ExtractPosterResult extends PosterInfo {
  href?: string;
  aspectRatio?: number | null;
}

interface SrcsetCandidate {
  url: string;
  score: number;
}

interface ClassificationCache {
  analyzeDocument(doc: Document): DocumentAnalysis;
  getMainPageContent(options?: {
    onlyWhenNecessary?: boolean;
    currentAnalysis?: DocumentAnalysis | null;
  }): Promise<Document>;
}

function createEmptyDebugPrimary(): ClassificationDebugPrimary {
  return {
    hasJapaneseChannel: false,
    hasStrongKeywordsInBody: false,
    hasStrongKeywordsInMeta: false,
    hasWeakKeywordsInBody: false,
    hasWeakKeywordsInMeta: false,
    tvChannels: []
  };
}

function createEmptyDebug(): ClassificationDebug {
  return {
    isMovie: false,
    isTvShow: false,
    isSeason: false,
    mainPageLoaded: false,
    primary: createEmptyDebugPrimary(),
    main: createEmptyDebugPrimary()
  };
}

const SEASON_TRAILING_NOISE_PATTERNS: readonly RegExp[] = [
  /\s*(?:N[\/-]?A|暂无(?:评分|评价)?|未评分|评分\s*[:：]?\s*待定|豆瓣\s*\d+(?:\.\d+)?|IMDb\s*\d+(?:\.\d+)?|烂番茄\s*\d+(?:\.\d+)?%?|\d+\.\d+(?:\s*分)?|\d+(?:\.\d+)?\s*\/\s*10|\d+(?:\.\d+)?\s*分)\s*$/iu,
  /\s*(?:已完结\d*|已完结|完结|全集|连载(?:中)?|更新(?:至[^，。；]*)?|更新中|播出中|定档[^，。；]*|收官|暂停(?:更新)?|未播|待播|待定|上映中|首播|即将播出|即将上线)\s*$/u,
  /\s*(?:\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?)\s*$/u,
  /\s*(?:[-–—·•|／]+)\s*$/u
];

function stripSeasonTrailingNoise(value: string | null | undefined): string {
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

class ChaospaceClassifier implements ClassificationCache {
  private cachedMainDoc: Document | null = null;
  private cachedMainDocUrl = '';

  async classifyCurrentPage(): Promise<MediaClassification> {
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
      const mainDoc = await this.getMainPageContent({
        onlyWhenNecessary: true,
        currentAnalysis: primaryAnalysis
      });
      if (mainDoc && mainDoc !== document) {
        const mainAnalysis = this.analyzeDocument(mainDoc);
        if (mainAnalysis.classification === 'anime') {
          return 'anime';
        }
      }
    }
    return 'tvshow';
  }

  async getDetailedClassification(): Promise<DetailedClassificationResult> {
    const result: DetailedClassificationResult = {
      url: window.location.href || '',
      classification: 'unknown',
      confidence: 0,
      reasons: [],
      debug: {
        isMovie: false,
        isTvShow: false,
        isSeason: false,
        mainPageLoaded: false,
        primary: createEmptyDebugPrimary(),
        main: createEmptyDebugPrimary()
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

    let finalClassification: MediaClassification = primaryAnalysis.classification;
    let confidence = primaryAnalysis.hasJapaneseChannel ? 0.9 : (primaryAnalysis.hasJapaneseKeywordsStrong ? 0.75 : 0.6);

    if (primaryAnalysis.hasJapaneseChannel) {
      result.reasons.push('检测到日本电视台/平台标识');
    } else if (primaryAnalysis.hasJapaneseKeywordsStrong) {
      const sourceLabel = primaryAnalysis.hasStrongKeywordsInBody ? '页面正文' : '标题/简介';
      result.reasons.push(`检测到 ${sourceLabel} 中的日本相关关键词`);
    }

    if (finalClassification !== 'anime' && result.debug.isSeason) {
      const mainDoc = await this.getMainPageContent({
        onlyWhenNecessary: true,
        currentAnalysis: primaryAnalysis
      });
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

  analyzeDocument(doc: Document): DocumentAnalysis {
    const channels = this.extractTVChannels(doc);
    const hasJapaneseChannel = channels.some(channel => this.isJapaneseTVChannel(channel));
    const pageText = this.extractPageText(doc);
    const hasStrongKeywordsInBody = this.containsKeywords(pageText, JAPANESE_KEYWORDS_STRONG);
    const hasWeakKeywordsInBody = this.containsKeywords(pageText, JAPANESE_KEYWORDS_WEAK);
    const title = doc.title || document.title || '';
    const description = this.extractDescription(doc);
    const metaText = `${title} ${description}`;
    const hasStrongKeywordsInMeta = this.containsKeywords(metaText, JAPANESE_KEYWORDS_STRONG);
    const hasWeakKeywordsInMeta = this.containsKeywords(metaText, JAPANESE_KEYWORDS_WEAK);
    const hasJapaneseKeywordsStrong = hasStrongKeywordsInBody || hasStrongKeywordsInMeta;
    const hasJapaneseKeywordsWeak = hasWeakKeywordsInBody || hasWeakKeywordsInMeta;
    const classification: AnimeOrTvShow = hasJapaneseChannel || hasJapaneseKeywordsStrong ? 'anime' : 'tvshow';
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

  async getMainPageContent(
    { onlyWhenNecessary = false, currentAnalysis = null }: {
      onlyWhenNecessary?: boolean;
      currentAnalysis?: DocumentAnalysis | null;
    } = {}
  ): Promise<Document> {
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

  private isMoviePage(url: string | null | undefined): boolean {
    return typeof url === 'string' && url.includes('/movies/');
  }

  private isTvShowPage(url: string | null | undefined): boolean {
    if (typeof url !== 'string') {
      return false;
    }
    return url.includes('/tvshows/') || url.includes('/seasons/');
  }

  private isSeasonPage(url: string | null | undefined): boolean {
    return typeof url === 'string' && url.includes('/seasons/');
  }

  private findMainPageUrl(): string | null {
    try {
      const container = document.querySelector('.sgeneros');
      if (container) {
        const anchor = container.querySelector<HTMLAnchorElement>('a[href*="/tvshows/"]');
        if (anchor?.href) {
          return anchor.href;
        }
      }
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to resolve main page via .sgeneros', error);
    }

    const seasonPathMatch = window.location.pathname.match(/\/seasons\/(\d+)/i);
    if (seasonPathMatch?.[1]) {
      return `${window.location.origin}/tvshows/${seasonPathMatch[1]}.html`;
    }

    return null;
  }

  private extractTVChannels(doc: Document): string[] {
    const channels: string[] = [];
    const selectors = [
      '.extra a[href*="/network/"]',
      '.extra a[href*="/channel/"]',
      '.extra span.network',
      '.sked-details .network',
      '.sgeneros a[href*="/network/"]',
      '.sgeneros a[href*="/channel/"]'
    ];
    selectors.forEach(selector => {
      const entries = doc.querySelectorAll<HTMLElement>(selector);
      entries.forEach(entry => {
        const text = (entry.textContent || entry.title || '').trim();
        if (text) {
          channels.push(text);
        }
      });
    });
    return channels;
  }

  private extractPageText(doc: Document): string {
    try {
      const sourceRoot = doc.body || doc.documentElement || document.body;
      if (!sourceRoot) {
        return '';
      }
      const clone = sourceRoot.cloneNode(true) as HTMLElement;
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

  private containsKeywords(text: string, keywordSet: ReadonlySet<string>): boolean {
    if (!text) {
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

  private isJapaneseTVChannel(channel: string | null | undefined): boolean {
    if (!channel) {
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

  private extractDescription(doc: Document): string {
    try {
      const metaDescription = doc.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (metaDescription?.getAttribute('content')) {
        return metaDescription.getAttribute('content') || '';
      }
      const ogDescription = doc.querySelector<HTMLMetaElement>('meta[property="og:description"]');
      if (ogDescription?.getAttribute('content')) {
        return ogDescription.getAttribute('content') || '';
      }
      return '';
    } catch (error) {
      console.warn('[Chaospace Transfer] Failed to extract description', error);
      return '';
    }
  }
}

let pageClassificationPromise: Promise<DetailedClassificationResult> | null = null;
let pageClassificationUrl: string | null = null;

export async function getPageClassification(options: { detailed: true }): Promise<DetailedClassificationResult>;
export async function getPageClassification(options?: { detailed?: false }): Promise<MediaClassification>;
export async function getPageClassification({ detailed = false }: { detailed?: boolean } = {}): Promise<MediaClassification | DetailedClassificationResult> {
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
        debug: createEmptyDebug()
      } as DetailedClassificationResult;
    });
    pageClassificationUrl = currentUrl;
  }
  const result = await pageClassificationPromise;
  if (detailed) {
    return result;
  }
  return result.classification ?? 'unknown';
}

export function suggestDirectoryFromClassification(
  classification: string | { classification?: string; type?: string } | null | undefined
): string | null {
  if (!classification) {
    return null;
  }
  if (typeof classification === 'string') {
    return CLASSIFICATION_PATH_MAP[classification] || null;
  }
  if (classification && typeof classification === 'object') {
    const key = classification.classification || classification.type;
    if (typeof key === 'string') {
      return CLASSIFICATION_PATH_MAP[key] || null;
    }
  }
  return null;
}

export function normalizeDir(value: string | null | undefined): string {
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

export function sanitizeSeasonDirSegment(value: string | null | undefined): string {
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
        const baseSeasonLabel = seasonMatch[1] || '';
        if (baseSeasonLabel) {
          normalized = baseSeasonLabel;
        }
      }
    } else {
      const baseSeasonLabel = seasonMatch[1] || '';
      if (baseSeasonLabel) {
        normalized = baseSeasonLabel;
      }
    }
  }

  // 第八步：将中文数字转换为阿拉伯数字（无论是否匹配seasonMatch）
  normalized = normalizeSeasonLabelUtil(normalized);

  return normalized.trim();
}

function normalizeSeasonLabel(label: string | null | undefined, index = 0): string {
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

export function deriveSeasonDirectory(label: string | null | undefined, index = 0): string {
  // 先清理噪音，再生成目录名
  const cleaned = stripSeasonTrailingNoise(label || '');
  const base = sanitizeSeasonDirSegment(cleaned);
  if (base) {
    return base;
  }
  return `第${Number.isFinite(index) ? index + 1 : 1}季`;
}

export function buildPanDirectoryUrl(path: string): string {
  const normalized = normalizeDir(path);
  const encoded = encodeURIComponent(normalized === '/' ? '/' : normalized);
  return `${PAN_DISK_BASE_URL}${encoded}`;
}

export function normalizePageUrl(url: string | null | undefined): string {
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

export function isTvShowUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') {
    return false;
  }
  return url.includes('/tvshows/');
}

export function isSeasonUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /\/seasons\/\d+\.html/.test(url);
}

export function isSupportedDetailPage(): boolean {
  const url = window.location.href || '';
  return isTvShowUrl(url) || isSeasonUrl(url) || url.includes('/movies/');
}

export async function analyzePage(options: AnalyzePageOptions = {}): Promise<PageAnalysisResult> {
  const {
    deferTvSeasons = false,
    initialSeasonBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
  } = options;
  return collectLinks({ deferTvSeasons, initialSeasonBatchSize });
}

export async function fetchSeasonDetail(info: DeferredSeasonInfo | null | undefined): Promise<SeasonDetailResult> {
  if (!info || !info.url) {
    return {
      items: [],
      completion: info?.completion ?? null,
      poster: info?.poster ?? null
    };
  }
  let seasonItems: ResourceItem[] = [];
  let completion: CompletionStatus | null = info.completion ?? null;
  let poster: PosterInfo | null = info.poster ?? null;
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

async function collectLinks(options: AnalyzePageOptions = {}): Promise<PageAnalysisResult> {
  const {
    deferTvSeasons = false,
    initialSeasonBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
  } = options;
  const baseResult: PageAnalysisResult = {
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
    seasonEntries: [],
    classification: 'unknown',
    classificationDetail: null
  };

  try {
    let completion: CompletionStatus | null = null;
    let seasonCompletion: Record<string, CompletionStatus> = {};
    let deferredSeasons: DeferredSeasonInfo[] = [];
    let totalSeasons = 0;
    let loadedSeasons = 0;
    let seasonEntries: SeasonEntry[] = [];
    let items: ResourceItem[] = extractItemsFromDocument(document);

    if (isSeasonUrl(window.location.href)) {
      completion = extractSeasonPageCompletion(document);
    }

    if (isTvShowUrl(window.location.href)) {
      const seasonData = await collectTvShowSeasonItems({
        defer: deferTvSeasons,
        initialBatchSize: initialSeasonBatchSize
      });
      if (seasonData.items.length > 0) {
        items = seasonData.items;
      }
      seasonCompletion = seasonData.seasonCompletion;
      deferredSeasons = seasonData.deferredSeasons;
      totalSeasons = seasonData.totalSeasons;
      loadedSeasons = seasonData.loadedSeasons;
      seasonEntries = seasonData.seasonEntries;
      if (completion == null && seasonData.completion) {
        completion = seasonData.completion;
      }
    }

    const dedupedItems: ResourceItem[] = [];
    const seenIds = new Set<string | number>();
    items.forEach(item => {
      if (!item || seenIds.has(item.id)) {
        return;
      }
      seenIds.add(item.id);
      dedupedItems.push(item);
    });

    const classificationDetail = await getPageClassification({ detailed: true });
    const normalizedItems: ResourceItem[] = dedupedItems.map(item => {
      const normalizedLabel =
        (typeof item.seasonLabel === 'string' && item.seasonLabel.trim()) || Number.isFinite(item.seasonIndex)
          ? normalizeSeasonLabel(item.seasonLabel ?? '', item.seasonIndex ?? 0)
          : '';
      if (normalizedLabel) {
        return {
          ...item,
          seasonLabel: normalizedLabel
        };
      }
      return item;
    });
    const normalizedSeasonEntries: SeasonEntry[] = seasonEntries.map(entry => ({
      ...entry,
      label: normalizeSeasonLabel(entry.label, entry.seasonIndex)
    }));
    const normalizedDeferredSeasons: DeferredSeasonInfo[] = deferredSeasons.map(info => ({
      ...info,
      label: normalizeSeasonLabel(info.label, info.index)
    }));

    return {
      ...baseResult,
      items: normalizedItems,
      completion,
      seasonCompletion,
      deferredSeasons: normalizedDeferredSeasons,
      totalSeasons,
      loadedSeasons,
      seasonEntries: normalizedSeasonEntries,
      classification: classificationDetail.classification,
      classificationDetail
    };
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to collect links', error);
    let classificationDetail: DetailedClassificationResult | null = null;
    try {
      classificationDetail = await getPageClassification({ detailed: true });
    } catch (_error) {
      classificationDetail = null;
    }
    return {
      ...baseResult,
      classification: classificationDetail?.classification ?? 'unknown',
      classificationDetail
    };
  }
}


async function collectTvShowSeasonItems(options: { defer?: boolean; initialBatchSize?: number } = {}): Promise<SeasonCollectionResult> {
  const {
    defer = false,
    initialBatchSize = TV_SHOW_INITIAL_SEASON_BATCH
  } = options;
  const seasonBlocks = Array.from(document.querySelectorAll<HTMLElement>('#seasons .se-c'));
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
  const seasonInfos: SeasonBlockInfo[] = seasonBlocks
    .map((block, index) => {
      const anchor = block.querySelector<HTMLAnchorElement>('.se-q a[href]');
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
      const seasonId = seasonIdMatch?.[1] ?? `season-${index + 1}`;
      const completion = extractSeasonListCompletion(block);
      const poster = extractPosterFromSeasonBlock(block, {
        baseUrl: basePageUrl,
        fallbackAlt: label
      });
      const info: SeasonBlockInfo = {
        seasonId,
        label,
        url,
        index,
        completion,
        poster
      };
      return info;
    })
    .filter((info): info is SeasonBlockInfo => Boolean(info));

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

  const aggregated: ResourceItem[] = [];
  const seen = new Set<string | number>();
  const seasonCompletionMap = new Map<string, CompletionStatus>();
  const seasonEntryMap = new Map<string, SeasonEntryInternal>();

  seasonInfos.forEach(info => {
    if (info.completion) {
      seasonCompletionMap.set(info.seasonId, info.completion);
    }
    seasonEntryMap.set(info.seasonId, {
      seasonId: info.seasonId,
      label: normalizeSeasonLabel(info.label, info.index),
      url: info.url,
      seasonIndex: info.index,
      completion: info.completion,
      poster: info.poster,
      loaded: false,
      hasItems: false
    });
  });

  const effectiveBatchSize = defer
    ? Math.max(
        0,
        Math.min(Number.isFinite(initialBatchSize) ? Math.trunc(initialBatchSize) : 2, seasonInfos.length)
      )
    : seasonInfos.length;
  const immediateInfos = seasonInfos.slice(0, effectiveBatchSize);
  const deferredInfos: SeasonBlockInfo[] = defer ? seasonInfos.slice(effectiveBatchSize) : [];

  const immediateIdSet = new Set(immediateInfos.map(info => info.seasonId));
  seasonEntryMap.forEach(entry => {
    entry.loaded = immediateIdSet.has(entry.seasonId) || !defer;
  });

  const seasonResults = await Promise.all(
    immediateInfos.map(async info => {
      try {
        const result = await fetchSeasonDetail(info);
        return { info, ...result };
      } catch (error) {
        console.error('[Chaospace Transfer] Failed to load season page', info.url, error);
        return {
          info,
          items: [] as ResourceItem[],
          completion: info.completion,
          poster: info.poster
        };
      }
    })
  );

  seasonResults.forEach(({ info, items, completion, poster }) => {
    if (completion) {
      seasonCompletionMap.set(info.seasonId, completion);
    } else if (info.completion) {
      seasonCompletionMap.set(info.seasonId, info.completion);
    }
    const entry = seasonEntryMap.get(info.seasonId);
    if (entry) {
      entry.loaded = true;
      entry.completion = completion ?? info.completion ?? entry.completion ?? null;
      const effectivePoster = poster || info.poster || entry.poster || null;
      entry.poster = effectivePoster;
      if (items.length) {
        entry.hasItems = true;
      }
      entry.lastHydratedAt = Date.now();
    }
    if (!items.length) {
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
        seasonCompletion: completion ?? info.completion ?? null
      });
    });
  });

  const completionEntries = Array.from(seasonCompletionMap.values()).filter(
    (entry): entry is CompletionStatus => Boolean(entry)
  );
  const completionSummary = completionEntries.length ? summarizeSeasonCompletion(completionEntries) : null;
  const seasonEntries = Array.from(seasonEntryMap.values())
    .map(entry => ({
      ...entry,
      label: normalizeSeasonLabel(entry.label, entry.seasonIndex)
    }))
    .sort((a, b) => a.seasonIndex - b.seasonIndex);

  const deferredSeasons: DeferredSeasonInfo[] = deferredInfos.map(info => ({
    ...info,
    label: normalizeSeasonLabel(info.label, info.index)
  }));

  return {
    items: aggregated,
    seasonCompletion: Object.fromEntries(seasonCompletionMap.entries()),
    completion: completionSummary,
    deferredSeasons,
    totalSeasons: seasonInfos.length,
    loadedSeasons: seasonInfos.length - deferredInfos.length,
    seasonEntries
  };
}


function locateBaiduPanRows(root: Document | Element = document): HTMLElement[] {
  const scope = root && typeof (root as Element).querySelector === 'function'
    ? (root as Element)
    : document;
  const downloadSection = scope.querySelector<HTMLElement>('#download');
  if (!downloadSection) {
    return [];
  }
  const selector = 'table tbody tr[id^="link-"]';
  return Array.from(downloadSection.querySelectorAll<HTMLElement>(selector));
}

const PASSCODE_PATTERN = /提取码[：:]*\s*([0-9a-zA-Z]{2,8})/i;

function extractPassCodeFromNode(node: Element | null | undefined): string {
  const text = node?.textContent || '';
  const match = text.match(PASSCODE_PATTERN);
  return match?.[1] ?? '';
}

export function extractItemsFromDocument(
  root: Document | Element = document,
  { baseUrl }: { baseUrl?: string } = {}
): ResourceItem[] {
  const rows = locateBaiduPanRows(root);
  if (!rows.length) {
    return [];
  }
  const resolvedBaseUrl = baseUrl || window.location.href;
  const items: ResourceItem[] = [];
  rows.forEach(row => {
    const idMatch = (row.id || '').match(/link-(\d+)/);
    const id = idMatch?.[1] ?? '';
    if (!id) {
      return;
    }
    const anchor = row.querySelector<HTMLAnchorElement>('a');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href') || anchor.href || '';
    const initialLinkUrl = resolveAbsoluteUrl(href, resolvedBaseUrl);
    const fallbackLinkUrl = resolveAbsoluteUrl(`/links/${id}.html`, resolvedBaseUrl);
    const linkUrl = initialLinkUrl && initialLinkUrl.includes('/links/')
      ? initialLinkUrl
      : (fallbackLinkUrl && fallbackLinkUrl.includes('/links/') ? fallbackLinkUrl : '');
    if (!linkUrl) {
      return;
    }
    const title = extractCleanTitle(stripHtmlTags(anchor.textContent || anchor.innerText || ''));
    const passNode = row.querySelector<HTMLElement>('.pwd');
    let passCode = extractPassCodeFromNode(passNode);
    if (!passCode) {
      passCode = extractPassCodeFromNode(anchor);
    }
    if (!passCode) {
      passCode = extractPassCodeFromNode(row);
    }
    const resource: ResourceItem = {
      id,
      title: title || `资源 ${id}`,
      order: items.length,
      linkUrl
    };
    if (passCode) {
      resource.passCode = passCode;
    }
    if (anchor.classList.contains('clicklogin')) {
      (resource as Record<string, unknown>)['requiresLogin'] = true;
    }
    (resource as Record<string, unknown>)['createdAt'] = Date.now();
    items.push(resource);
  });
  return items;
}

function extractCompletionStatusFromElements(
  elements: ArrayLike<Element> | null | undefined,
  source = ''
): CompletionStatus | null {
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

export function extractSeasonPageCompletion(
  root: Document | Element = document,
  source = 'season-meta'
): CompletionStatus | null {
  const scope = root && typeof (root as Element).querySelector === 'function'
    ? (root as Element)
    : document;
  const extra = scope.querySelector<HTMLElement>('.data .extra');
  if (!extra) {
    return null;
  }
  const spans = extra.querySelectorAll<Element>('.date');
  return extractCompletionStatusFromElements(spans, source);
}

function extractSeasonListCompletion(block: Element | null | undefined): CompletionStatus | null {
  if (!block || typeof block.querySelector !== 'function') {
    return null;
  }
  const titleSpan = block.querySelector<HTMLElement>('.se-q .title');
  if (!titleSpan) {
    return null;
  }
  const infoTags = titleSpan.querySelectorAll<Element>('i');
  const status = extractCompletionStatusFromElements(infoTags, 'season-list');
  if (status) {
    return status;
  }
  const textNodes: string[] = [];
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

function deriveSeasonLabel(block: Element | null | undefined, defaultIndex = 0): string {
  if (!block || typeof block.querySelector !== 'function') {
    return `季 ${defaultIndex + 1}`;
  }
  const titleSpan = block.querySelector<HTMLElement>('.se-q .title');
  if (!titleSpan) {
    return `季 ${defaultIndex + 1}`;
  }
  const text = stripHtmlTags(titleSpan.textContent || '');
  const preliminaryClean = extractCleanTitle(text);
  // 立即清理噪音：日期、评分、状态等
  const clean = stripSeasonTrailingNoise(preliminaryClean);
  return clean || `季 ${defaultIndex + 1}`;
}

function extractPosterFromSeasonBlock(
  block: Element | null | undefined,
  options: ExtractPosterOptions = {}
): ExtractPosterResult | null {
  if (!block || typeof block.querySelector !== 'function') {
    return null;
  }
  const img = block.querySelector<HTMLImageElement>('img');
  if (!img) {
    return null;
  }
  return extractPosterFromImageElement(img, options);
}

export function extractPosterDetails(
  root: Document | Element = document,
  options: ExtractPosterOptions = {}
): ExtractPosterResult | null {
  const scope = root && typeof (root as Element).querySelector === 'function'
    ? (root as Element)
    : document;
  const baseUrl = options.baseUrl || window.location.href;
  const fallbackAlt = typeof options.fallbackAlt === 'string' ? options.fallbackAlt : getPageCleanTitle();
  const selectors = Array.isArray(options.selectors) && options.selectors.length
    ? options.selectors
    : ['.poster img', '.post-thumbnail img', 'article img'];
  let img: HTMLImageElement | null = null;
  for (const selector of selectors) {
    img = scope.querySelector<HTMLImageElement>(selector);
    if (img) {
      break;
    }
  }
  if (!img) {
    return null;
  }
  const poster = extractPosterFromImageElement(img, { baseUrl, fallbackAlt });
  if (poster && !poster.alt) {
    poster.alt = fallbackAlt;
  }
  return poster;
}

function extractPosterFromImageElement(
  img: HTMLImageElement | null | undefined,
  options: ExtractPosterOptions = {}
): ExtractPosterResult | null {
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
  const anchor = img.closest('a') as HTMLAnchorElement | null;
  const href = anchor ? resolveAbsoluteUrl(anchor.getAttribute('href') || anchor.href || '', baseUrl) : '';
  const widthAttr = parseInt(img.getAttribute('width') || '', 10);
  const heightAttr = parseInt(img.getAttribute('height') || '', 10);
  const width = Number.isFinite(img.naturalWidth) && img.naturalWidth > 0
    ? img.naturalWidth
    : (Number.isFinite(widthAttr) ? widthAttr : null);
  const height = Number.isFinite(img.naturalHeight) && img.naturalHeight > 0
    ? img.naturalHeight
    : (Number.isFinite(heightAttr) ? heightAttr : null);
  const aspectRatio = width && height ? Number((width / height).toFixed(3)) : null;
  return {
    src,
    alt,
    href,
    aspectRatio
  };
}

function pickImageSource(
  img: HTMLImageElement | null | undefined,
  options: { baseUrl?: string } = {}
): string {
  if (!img) {
    return '';
  }
  const baseUrl = options.baseUrl || window.location.href;
  const fromCurrent = resolveAbsoluteUrl(img.currentSrc || img.src || '', baseUrl);
  const srcsetCandidates = [
    ...parseSrcset(img.getAttribute('data-srcset'), baseUrl),
    ...parseSrcset(img.getAttribute('srcset'), baseUrl)
  ] as SrcsetCandidate[];
  if (srcsetCandidates.length > 0) {
    srcsetCandidates.sort((a, b) => b.score - a.score);
    const best = srcsetCandidates.find(candidate => Boolean(candidate.url));
    if (best && best.url) {
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

function parseSrcset(value: string | null | undefined, baseUrl: string): SrcsetCandidate[] {
  if (!value || typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map(entry => entry.trim())
    .map(entry => {
      const parts = entry.split(/\s+/);
      const urlPart = parts[0] ?? '';
      const descriptor = parts[1] ?? '';
      const widthMatch = descriptor.match(/(\d+(?:\.\d+)?)(w|x)?/i);
      let score = 0;
      if (widthMatch) {
        const sizeValue = widthMatch[1];
        if (sizeValue) {
          const size = parseFloat(sizeValue);
          if (Number.isFinite(size)) {
            const descriptorType = widthMatch[2]?.toLowerCase();
            score = descriptorType === 'x' ? size * 1000 : size;
          }
        }
      }
      const resolved = resolveAbsoluteUrl(urlPart, baseUrl);
      return {
        url: resolved,
        score
      };
    })
    .filter((item): item is SrcsetCandidate => Boolean(item.url));
}

function resolveAbsoluteUrl(value: string | null | undefined, baseUrl = window.location.href): string {
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

function getPageCleanTitle(): string {
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

export async function fetchHtmlDocument(url: string): Promise<Document> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }
  const html = await response.text();
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

const JAPANESE_TV_CHANNELS: ReadonlySet<string> = new Set([
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

const JAPANESE_KEYWORDS_STRONG: ReadonlySet<string> = new Set([
  '日本', '日剧', '日劇', '日漫', '日本動畫', '日本动画',
  '番剧', '番劇', '新番', '季番', '年番', '半年番',
  '声优', '聲優', '声優', 'seiyu',
  '原作：日本', '日本漫画', '日本漫畫',
  'アニメ', 'アニメーション', 'アニメ化', 'マンガ', 'まんが',
  'ライトノベル', 'ラノベ', '小説原作', '小說原作',
  'ゲーム原作', '遊戲改編', 'ゲーム原作',
  '原作：ライトノベル', '原作：ラノベ'
]);

const JAPANESE_KEYWORDS_WEAK: ReadonlySet<string> = new Set([
  '动漫', '動畫', '动画', '动画片', 'anime', 'light novel', 'manga'
]);
