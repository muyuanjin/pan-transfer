// @ts-nocheck
import { createApp, reactive, type App } from 'vue';
import HistoryDetailOverlay from './HistoryDetailOverlay.vue';
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
  hideTimer?: number | null;
  backdrop?: HTMLElement | null;
  modal?: HTMLElement | null;
  close?: HTMLElement | null;
  poster?: HTMLElement | null;
  title?: HTMLElement | null;
  date?: HTMLElement | null;
  country?: HTMLElement | null;
  runtime?: HTMLElement | null;
  rating?: HTMLElement | null;
  genres?: HTMLElement | null;
  info?: HTMLElement | null;
  synopsis?: HTMLElement | null;
  stills?: HTMLElement | null;
  body?: HTMLElement | null;
  loading?: HTMLElement | null;
  error?: HTMLElement | null;
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

interface HistoryDetailOverlayState {
  visible: boolean;
  loading: boolean;
  error: string;
  data: HistoryDetailData | null;
  fallback: HistoryDetailData | null;
}

const overlayState = reactive<HistoryDetailOverlayState>({
  visible: false,
  loading: false,
  error: '',
  data: null,
  fallback: null
});

let overlayApp: App<Element> | null = null;
let overlayHost: HTMLElement | null = null;
let currentCloseHandler: (() => void) | undefined;

export function buildHistoryDetailFallback(
  group: HistoryGroup | null,
  overrides: HistoryDetailOverrides = {}
): HistoryDetailFallback {
  if (!group) {
    return {
      title: typeof overrides.title === 'string' && overrides.title ? overrides.title : '转存记录',
      poster: overrides.poster && overrides.poster.src ? overrides.poster : null,
      releaseDate: typeof overrides.releaseDate === 'string' ? overrides.releaseDate : '',
      country: typeof overrides.country === 'string' ? overrides.country : '',
      runtime: typeof overrides.runtime === 'string' ? overrides.runtime : '',
      rating: null,
      genres: Array.isArray(overrides.genres) ? overrides.genres.slice(0, 12) : [],
      info: Array.isArray(overrides.info) ? overrides.info.slice(0, 12) : [],
      synopsis: typeof overrides.synopsis === 'string' ? overrides.synopsis : '',
      stills: Array.isArray(overrides.stills) ? overrides.stills.slice(0, 12) : [],
      pageUrl: typeof overrides.pageUrl === 'string' ? overrides.pageUrl : ''
    };
  }

  const mainRecord = group.main || ({} as Record<string, any>);
  const poster = (group.poster && group.poster.src)
    ? group.poster
    : (mainRecord.poster && mainRecord.poster.src ? mainRecord.poster : null);

  const fallback: HistoryDetailData = {
    title: group.title || mainRecord.pageTitle || '转存记录',
    poster,
    releaseDate: '',
    country: '',
    runtime: '',
    rating: null,
    genres: [],
    info: [],
    synopsis: '',
    stills: [],
    pageUrl: mainRecord.pageUrl || ''
  };

  (Object.keys(overrides) as (keyof HistoryDetailOverrides)[]).forEach((key) => {
    const value = overrides[key];
    if (value === undefined || value === null) {
      return;
    }
    if (key === 'poster' && value && (value as HistoryDetailPoster).src) {
      const posterOverride = value as HistoryDetailPoster;
      fallback.poster = {
        src: posterOverride.src,
        alt: posterOverride.alt || fallback.title || ''
      };
      return;
    }
    if (key === 'genres' && Array.isArray(value)) {
      fallback.genres = (value as string[]).slice(0, 12);
      return;
    }
    if (key === 'info' && Array.isArray(value)) {
      fallback.info = (value as HistoryDetailInfoEntry[]).slice(0, 12);
      return;
    }
    if (key === 'stills' && Array.isArray(value)) {
      fallback.stills = (value as HistoryDetailStill[]).slice(0, 12);
      return;
    }
    if (key === 'rating' && value && typeof value === 'object') {
      fallback.rating = value as HistoryDetailRating;
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      switch (key) {
        case 'title':
          fallback.title = trimmed || fallback.title;
          break;
        case 'releaseDate':
          fallback.releaseDate = trimmed;
          break;
        case 'country':
          fallback.country = trimmed;
          break;
        case 'runtime':
          fallback.runtime = trimmed;
          break;
        case 'synopsis':
          fallback.synopsis = trimmed;
          break;
        case 'pageUrl':
          fallback.pageUrl = trimmed;
          break;
        default:
          break;
      }
    }
  });

  return fallback;
}

export function normalizeHistoryDetailResponse(
  rawDetail: unknown,
  fallback?: HistoryDetailFallback
): HistoryDetailData {
  const safeFallback = fallback || buildHistoryDetailFallback(null);
  const detail = rawDetail && typeof rawDetail === 'object' ? rawDetail as Record<string, any> : {};

  const normalizeString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

  const normalized: HistoryDetailData = {
    title: normalizeString(detail['title']) || safeFallback.title,
    poster: detail['poster'] && detail['poster'].src ? detail['poster'] : safeFallback.poster,
    releaseDate: normalizeString(detail['releaseDate']),
    country: normalizeString(detail['country']),
    runtime: normalizeString(detail['runtime']),
    rating: detail['rating'] && detail['rating'].value
      ? {
          value: normalizeString(detail['rating'].value),
          votes: normalizeString(detail['rating'].votes),
          label: normalizeString(detail['rating'].label),
          scale: Number.isFinite(detail['rating'].scale) ? Number(detail['rating'].scale) : 10
        }
      : null,
    genres: Array.isArray(detail['genres'])
      ? Array.from(new Set((detail['genres'] as unknown[]).map(normalizeString).filter(Boolean))).slice(0, 12)
      : [],
    info: Array.isArray(detail['info'])
      ? (detail['info'] as unknown[])
        .map(entry => ({
          label: normalizeString(entry?.label),
          value: normalizeString(entry?.value)
        }))
        .filter(entry => entry.label && entry.value)
        .slice(0, 12)
      : [],
    synopsis: normalizeString(detail['synopsis']),
    stills: Array.isArray(detail['stills'])
      ? (detail['stills'] as unknown[])
        .map(still => {
          const full = normalizeString(still?.full);
          const url = normalizeString(still?.url);
          const thumb = normalizeString(still?.thumb);
          const alt = normalizeString(still?.alt) || safeFallback.title;
          const resolvedFull = full || url || thumb;
          const resolvedThumb = thumb || url || full;
          if (!resolvedFull && !resolvedThumb) {
            return null;
          }
          return {
            full: resolvedFull || resolvedThumb,
            thumb: resolvedThumb || resolvedFull,
            alt,
            url: url || resolvedFull || resolvedThumb
          };
        })
        .filter(Boolean)
        .slice(0, 12) as HistoryDetailStill[]
      : [],
    pageUrl: normalizeString(detail['pageUrl']) || safeFallback.pageUrl || ''
  };

  if (!normalized.poster && safeFallback.poster?.src) {
    normalized.poster = safeFallback.poster;
  }
  if (!normalized.releaseDate && safeFallback.releaseDate) {
    normalized.releaseDate = safeFallback.releaseDate;
  }
  if (!normalized.country && safeFallback.country) {
    normalized.country = safeFallback.country;
  }
  if (!normalized.runtime && safeFallback.runtime) {
    normalized.runtime = safeFallback.runtime;
  }
  if (!normalized.synopsis && safeFallback.synopsis) {
    normalized.synopsis = safeFallback.synopsis;
  }
  if (!normalized.genres.length && safeFallback.genres.length) {
    normalized.genres = safeFallback.genres.slice();
  }
  if (!normalized.info.length && safeFallback.info.length) {
    normalized.info = safeFallback.info.slice();
  }
  if (!normalized.stills.length && safeFallback.stills.length) {
    normalized.stills = safeFallback.stills.slice();
  }

  return normalized;
}

export function ensureHistoryDetailOverlay(
  detailDom: HistoryDetailDomRefs,
  options: HistoryDetailOverlayOptions = {}
): void {
  currentCloseHandler = options.onClose;

  if (overlayApp) {
    return;
  }

  const host = document.createElement('div');
  host.className = 'chaospace-history-detail-host';
  document.body.appendChild(host);
  overlayHost = host;

  const handleClose = () => {
    if (typeof currentCloseHandler === 'function') {
      currentCloseHandler();
    }
  };

  overlayApp = createApp(HistoryDetailOverlay, {
    state: overlayState,
    onClose: handleClose
  });
  overlayApp.mount(host);

  assignDetailDomRefs(detailDom);
}

export function renderHistoryDetail(params: RenderHistoryDetailParams): void {
  const { state, detailDom, getHistoryGroupByKey, onClose } = params;
  const overlayOptions: HistoryDetailOverlayOptions = {};
  if (onClose) {
    overlayOptions.onClose = onClose;
  }
  ensureHistoryDetailOverlay(detailDom, overlayOptions);

  const overlay = detailDom.backdrop;
  if (!overlay) {
    return;
  }

  if (detailDom.hideTimer) {
    clearTimeout(detailDom.hideTimer);
    detailDom.hideTimer = null;
  }

  const detailState = state.historyDetail;
  if (!detailState.isOpen) {
    overlayState.visible = false;
    overlayState.loading = false;
    overlayState.error = '';
    if (!overlay.hasAttribute('hidden')) {
      detailDom.hideTimer = window.setTimeout(() => {
        if (!state.historyDetail.isOpen && overlay) {
          overlay.setAttribute('hidden', 'true');
        }
        detailDom.hideTimer = null;
      }, 200);
    } else {
      overlay.setAttribute('hidden', 'true');
    }
    document.body.classList.remove('chaospace-history-detail-active');
    return;
  }

  overlay.removeAttribute('hidden');
  window.requestAnimationFrame(() => {
    overlayState.visible = true;
  });
  document.body.classList.add('chaospace-history-detail-active');

  const group = typeof getHistoryGroupByKey === 'function'
    ? getHistoryGroupByKey(detailState.groupKey)
    : null;
  const fallback = detailState.fallback
    ? (detailState.fallback as HistoryDetailData)
    : buildHistoryDetailFallback(group ?? null);

  overlayState.loading = Boolean(detailState.loading);
  overlayState.error = detailState.error || '';
  overlayState.data = detailState.data ? (detailState.data as HistoryDetailData) : null;
  overlayState.fallback = fallback;

  assignDetailDomRefs(detailDom);
}

function assignDetailDomRefs(detailDom: HistoryDetailDomRefs): void {
  if (!overlayHost) {
    return;
  }
  const backdrop = overlayHost.querySelector('[data-role="history-detail-backdrop"]') as HTMLElement | null;
  detailDom.backdrop = backdrop;
  detailDom.modal = overlayHost.querySelector('[data-role="history-detail-modal"]') as HTMLElement | null;
  detailDom.close = overlayHost.querySelector('[data-role="history-detail-close"]') as HTMLElement | null;
  detailDom.poster = overlayHost.querySelector('[data-role="history-detail-poster"]') as HTMLElement | null;
  detailDom.title = overlayHost.querySelector('[data-role="history-detail-title"]') as HTMLElement | null;
  detailDom.date = overlayHost.querySelector('[data-role="history-detail-date"]') as HTMLElement | null;
  detailDom.country = overlayHost.querySelector('[data-role="history-detail-country"]') as HTMLElement | null;
  detailDom.runtime = overlayHost.querySelector('[data-role="history-detail-runtime"]') as HTMLElement | null;
  detailDom.rating = overlayHost.querySelector('[data-role="history-detail-rating"]') as HTMLElement | null;
  detailDom.genres = overlayHost.querySelector('[data-role="history-detail-genres"]') as HTMLElement | null;
  detailDom.info = overlayHost.querySelector('[data-role="history-detail-info"]') as HTMLElement | null;
  detailDom.synopsis = overlayHost.querySelector('[data-role="history-detail-synopsis"]') as HTMLElement | null;
  detailDom.stills = overlayHost.querySelector('[data-role="history-detail-stills"]') as HTMLElement | null;
  detailDom.body = overlayHost.querySelector('[data-role="history-detail-body"]') as HTMLElement | null;
  detailDom.loading = overlayHost.querySelector('[data-role="history-detail-loading"]') as HTMLElement | null;
  detailDom.error = overlayHost.querySelector('[data-role="history-detail-error"]') as HTMLElement | null;
}
