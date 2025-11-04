import {
  buildHistoryDetailFallback as buildHistoryDetailFallbackImpl,
  normalizeHistoryDetailResponse as normalizeHistoryDetailResponseImpl,
  ensureHistoryDetailOverlay as ensureHistoryDetailOverlayImpl,
  renderHistoryDetail as renderHistoryDetailImpl
} from './history-detail-impl.js';
import type { HistoryGroup, ContentState } from '../types';

export interface HistoryDetailPoster {
  src: string;
  alt?: string;
}

export interface HistoryDetailRating {
  value: string;
  votes: string;
  label: string;
  scale: number;
}

export interface HistoryDetailInfoEntry {
  label: string;
  value: string;
}

export interface HistoryDetailStill {
  full: string;
  thumb: string;
  alt: string;
  url: string;
}

export interface HistoryDetailData {
  title: string;
  poster: HistoryDetailPoster | null;
  releaseDate: string;
  country: string;
  runtime: string;
  rating: HistoryDetailRating | null;
  genres: string[];
  info: HistoryDetailInfoEntry[];
  synopsis: string;
  stills: HistoryDetailStill[];
  pageUrl?: string;
}

export type HistoryDetailFallback = HistoryDetailData;

export interface HistoryDetailOverrides extends Partial<HistoryDetailData> {}

export interface HistoryDetailDomRefs {
  [key: string]: HTMLElement | null | undefined;
}

export interface HistoryDetailOverlayOptions {
  onClose?: () => void;
}

export interface RenderHistoryDetailParams {
  state: ContentState;
  detailDom: HistoryDetailDomRefs;
  getHistoryGroupByKey: ((key: string) => HistoryGroup | null | undefined) | undefined;
  onClose: (() => void) | undefined;
}

export function buildHistoryDetailFallback(
  group: HistoryGroup | null,
  overrides: HistoryDetailOverrides = {}
): HistoryDetailFallback {
  return buildHistoryDetailFallbackImpl(group, overrides) as HistoryDetailFallback;
}

export function normalizeHistoryDetailResponse(
  rawDetail: unknown,
  fallback?: HistoryDetailFallback
): HistoryDetailData {
  return normalizeHistoryDetailResponseImpl(rawDetail, fallback) as HistoryDetailData;
}

export function ensureHistoryDetailOverlay(
  detailDom: HistoryDetailDomRefs,
  options: HistoryDetailOverlayOptions = {}
): void {
  ensureHistoryDetailOverlayImpl(detailDom, options);
}

export function renderHistoryDetail(params: RenderHistoryDetailParams): void {
  renderHistoryDetailImpl(params);
}
