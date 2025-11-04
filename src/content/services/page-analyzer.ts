import {
  getPageClassification as getPageClassificationImpl,
  suggestDirectoryFromClassification as suggestDirectoryFromClassificationImpl,
  normalizeDir as normalizeDirImpl,
  sanitizeSeasonDirSegment as sanitizeSeasonDirSegmentImpl,
  deriveSeasonDirectory as deriveSeasonDirectoryImpl,
  buildPanDirectoryUrl as buildPanDirectoryUrlImpl,
  normalizePageUrl as normalizePageUrlImpl,
  isTvShowUrl as isTvShowUrlImpl,
  isSeasonUrl as isSeasonUrlImpl,
  isSupportedDetailPage as isSupportedDetailPageImpl,
  analyzePage as analyzePageImpl,
  fetchSeasonDetail as fetchSeasonDetailImpl
} from './page-analyzer-impl.js';
import type { CompletionStatus, SeasonEntry } from '@/shared/utils/completion-status';
import type { PosterInfo } from '@/shared/utils/sanitizers';
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

export async function getPageClassification(options: { detailed: true }): Promise<DetailedClassificationResult>;
export async function getPageClassification(options?: { detailed?: false }): Promise<MediaClassification>;
export async function getPageClassification(options: { detailed?: boolean } = {}): Promise<MediaClassification | DetailedClassificationResult> {
  return getPageClassificationImpl(options) as Promise<MediaClassification | DetailedClassificationResult>;
}

export function suggestDirectoryFromClassification(
  classification: string | { classification?: string; type?: string } | null | undefined
): string | null {
  return suggestDirectoryFromClassificationImpl(classification) as string | null;
}

export function normalizeDir(value: string | null | undefined): string {
  return normalizeDirImpl(value) as string;
}

export function sanitizeSeasonDirSegment(value: string | null | undefined): string {
  return sanitizeSeasonDirSegmentImpl(value) as string;
}

export function deriveSeasonDirectory(label: string | null | undefined, index = 0): string {
  return deriveSeasonDirectoryImpl(label, index) as string;
}

export function buildPanDirectoryUrl(path: string): string {
  return buildPanDirectoryUrlImpl(path) as string;
}

export function normalizePageUrl(url: string | null | undefined): string {
  return normalizePageUrlImpl(url) as string;
}

export function isTvShowUrl(url: string | null | undefined): boolean {
  return Boolean(isTvShowUrlImpl(url));
}

export function isSeasonUrl(url: string | null | undefined): boolean {
  return Boolean(isSeasonUrlImpl(url));
}

export function isSupportedDetailPage(): boolean {
  return Boolean(isSupportedDetailPageImpl());
}

export async function analyzePage(options: AnalyzePageOptions = {}): Promise<PageAnalysisResult> {
  return analyzePageImpl(options) as Promise<PageAnalysisResult>;
}

export async function fetchSeasonDetail(info: DeferredSeasonInfo): Promise<SeasonDetailResult> {
  return fetchSeasonDetailImpl(info) as Promise<SeasonDetailResult>;
}
