import { disableElementDrag } from '../utils/dom.js';

export function buildHistoryDetailFallback(group, overrides = {}) {
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

  const mainRecord = group.main || {};
  const poster = (group.poster && group.poster.src)
    ? group.poster
    : (mainRecord.poster && mainRecord.poster.src ? mainRecord.poster : null);

  const fallback = {
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

  if (typeof overrides.title === 'string' && overrides.title.trim()) {
    fallback.title = overrides.title.trim();
  }
  if (typeof overrides.pageUrl === 'string' && overrides.pageUrl.trim()) {
    fallback.pageUrl = overrides.pageUrl.trim();
  }
  if (overrides.poster && overrides.poster.src) {
    fallback.poster = {
      src: overrides.poster.src,
      alt: overrides.poster.alt || fallback.title || ''
    };
  }
  if (typeof overrides.releaseDate === 'string' && overrides.releaseDate.trim()) {
    fallback.releaseDate = overrides.releaseDate.trim();
  }
  if (typeof overrides.country === 'string' && overrides.country.trim()) {
    fallback.country = overrides.country.trim();
  }
  if (typeof overrides.runtime === 'string' && overrides.runtime.trim()) {
    fallback.runtime = overrides.runtime.trim();
  }
  if (typeof overrides.synopsis === 'string' && overrides.synopsis.trim()) {
    fallback.synopsis = overrides.synopsis.trim();
  }
  if (Array.isArray(overrides.genres) && overrides.genres.length) {
    fallback.genres = overrides.genres.slice(0, 12);
  }
  if (Array.isArray(overrides.info) && overrides.info.length) {
    fallback.info = overrides.info.slice(0, 12);
  }
  if (Array.isArray(overrides.stills) && overrides.stills.length) {
    fallback.stills = overrides.stills.slice(0, 12);
  }

  return fallback;
}

export function normalizeHistoryDetailResponse(rawDetail, fallback) {
  const safeFallback = fallback || buildHistoryDetailFallback(null);
  const detail = rawDetail && typeof rawDetail === 'object' ? rawDetail : {};

  const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

  const normalized = {
    title: normalizeString(detail.title) || safeFallback.title,
    poster: detail.poster && detail.poster.src ? detail.poster : safeFallback.poster,
    releaseDate: normalizeString(detail.releaseDate),
    country: normalizeString(detail.country),
    runtime: normalizeString(detail.runtime),
    rating: detail.rating && detail.rating.value
      ? {
          value: normalizeString(detail.rating.value),
          votes: normalizeString(detail.rating.votes),
          label: normalizeString(detail.rating.label),
          scale: Number.isFinite(detail.rating.scale) ? detail.rating.scale : 10
        }
      : null,
    genres: Array.isArray(detail.genres)
      ? Array.from(new Set(detail.genres.map(normalizeString).filter(Boolean)))
      : [],
    info: Array.isArray(detail.info)
      ? detail.info
        .map(entry => ({
          label: normalizeString(entry?.label),
          value: normalizeString(entry?.value)
        }))
        .filter(entry => entry.label && entry.value)
      : [],
    synopsis: normalizeString(detail.synopsis),
    stills: Array.isArray(detail.stills)
      ? detail.stills
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
      : []
  };

  if (!normalized.poster && safeFallback.poster && safeFallback.poster.src) {
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
  if (!normalized.genres.length && Array.isArray(safeFallback.genres) && safeFallback.genres.length) {
    normalized.genres = safeFallback.genres.slice();
  }
  if (!normalized.info.length && Array.isArray(safeFallback.info) && safeFallback.info.length) {
    normalized.info = safeFallback.info.slice();
  }
  if (!normalized.stills.length && Array.isArray(safeFallback.stills) && safeFallback.stills.length) {
    normalized.stills = safeFallback.stills.slice();
  }

  return normalized;
}

export function ensureHistoryDetailOverlay(detailDom, { onClose } = {}) {
  if (detailDom.backdrop && detailDom.backdrop.isConnected) {
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'chaospace-history-detail-backdrop';
  backdrop.dataset.role = 'history-detail-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="chaospace-history-detail-modal" data-role="history-detail-modal" role="dialog" aria-modal="true">
      <button type="button" class="chaospace-history-detail-close" data-role="history-detail-close" aria-label="关闭详情">✕</button>
      <div class="chaospace-history-detail-header">
        <div class="chaospace-history-detail-poster">
          <img data-role="history-detail-poster" alt="" draggable="false" />
        </div>
        <div class="chaospace-history-detail-summary">
          <h3 class="chaospace-history-detail-title" data-role="history-detail-title"></h3>
          <div class="chaospace-history-detail-tags">
            <span data-role="history-detail-date"></span>
            <span data-role="history-detail-country"></span>
            <span data-role="history-detail-runtime"></span>
            <span data-role="history-detail-rating"></span>
          </div>
          <div class="chaospace-history-detail-genres" data-role="history-detail-genres"></div>
          <div class="chaospace-history-detail-info" data-role="history-detail-info"></div>
        </div>
      </div>
      <div class="chaospace-history-detail-body" data-role="history-detail-body">
        <div class="chaospace-history-detail-section">
          <div class="chaospace-history-detail-section-title">剧情简介</div>
          <div class="chaospace-history-detail-synopsis" data-role="history-detail-synopsis"></div>
        </div>
        <div class="chaospace-history-detail-section">
          <div class="chaospace-history-detail-section-title">剧照</div>
          <div class="chaospace-history-detail-stills" data-role="history-detail-stills"></div>
        </div>
      </div>
      <div class="chaospace-history-detail-loading" data-role="history-detail-loading">正在加载详情...</div>
      <div class="chaospace-history-detail-error" data-role="history-detail-error"></div>
    </div>
  `;

  document.body.appendChild(backdrop);

  detailDom.backdrop = backdrop;
  detailDom.modal = backdrop.querySelector('[data-role="history-detail-modal"]');
  detailDom.close = backdrop.querySelector('[data-role="history-detail-close"]');
  detailDom.poster = backdrop.querySelector('[data-role="history-detail-poster"]');
  detailDom.title = backdrop.querySelector('[data-role="history-detail-title"]');
  detailDom.date = backdrop.querySelector('[data-role="history-detail-date"]');
  detailDom.country = backdrop.querySelector('[data-role="history-detail-country"]');
  detailDom.runtime = backdrop.querySelector('[data-role="history-detail-runtime"]');
  detailDom.rating = backdrop.querySelector('[data-role="history-detail-rating"]');
  detailDom.genres = backdrop.querySelector('[data-role="history-detail-genres"]');
  detailDom.info = backdrop.querySelector('[data-role="history-detail-info"]');
  detailDom.synopsis = backdrop.querySelector('[data-role="history-detail-synopsis"]');
  detailDom.stills = backdrop.querySelector('[data-role="history-detail-stills"]');
  detailDom.body = backdrop.querySelector('[data-role="history-detail-body"]');
  detailDom.loading = backdrop.querySelector('[data-role="history-detail-loading"]');
  detailDom.error = backdrop.querySelector('[data-role="history-detail-error"]');
  detailDom.hideTimer = null;

  if (detailDom.close) {
    detailDom.close.addEventListener('click', () => {
      if (typeof onClose === 'function') {
        onClose();
      }
    });
  }

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop && typeof onClose === 'function') {
      onClose();
    }
  });

  if (detailDom.poster) {
    disableElementDrag(detailDom.poster);
    detailDom.poster.addEventListener('click', () => {
      const src = detailDom.poster.dataset.previewSrc || detailDom.poster.src;
      if (src && window.openZoomPreview) {
        window.openZoomPreview({
          src,
          alt: detailDom.poster.alt || detailDom.title?.textContent || ''
        });
      }
    });
  }

  if (detailDom.modal) {
    detailDom.modal.addEventListener('click', event => {
      const actionButton = event.target.closest('button[data-action]');
      if (!actionButton) {
        return;
      }
      const action = actionButton.dataset.action;
      if (action === 'preview-poster' && !actionButton.disabled && window.openZoomPreview) {
        const src = actionButton.dataset.src;
        if (src) {
          window.openZoomPreview({
            src,
            alt: actionButton.dataset.alt || ''
          });
        }
      }
    });
  }
}

export function renderHistoryDetail({ state, detailDom, getHistoryGroupByKey, onClose }) {
  ensureHistoryDetailOverlay(detailDom, { onClose });

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
    overlay.classList.remove('is-visible');
    if (!overlay.hidden) {
      detailDom.hideTimer = setTimeout(() => {
        if (!state.historyDetail.isOpen && overlay) {
          overlay.hidden = true;
        }
        detailDom.hideTimer = null;
      }, 200);
    } else {
      overlay.hidden = true;
    }
    document.body.classList.remove('chaospace-history-detail-active');
    return;
  }

  overlay.hidden = false;
  requestAnimationFrame(() => {
    overlay.classList.add('is-visible');
  });
  document.body.classList.add('chaospace-history-detail-active');

  const group = getHistoryGroupByKey(detailState.groupKey);
  const data = detailState.data || detailState.fallback || buildHistoryDetailFallback(group);

  if (detailDom.modal) {
    detailDom.modal.setAttribute('aria-busy', detailState.loading ? 'true' : 'false');
  }

  if (detailDom.loading) {
    detailDom.loading.hidden = !detailState.loading;
  }

  if (detailDom.error) {
    detailDom.error.hidden = !detailState.error;
    detailDom.error.textContent = detailState.error ? `加载失败：${detailState.error}` : '';
  }

  if (detailDom.body) {
    detailDom.body.hidden = detailState.error && !data;
  }

  if (detailDom.title) {
    detailDom.title.textContent = data.title || '转存记录';
  }

  if (detailDom.poster) {
    if (data.poster && data.poster.src) {
      detailDom.poster.src = data.poster.src;
      detailDom.poster.alt = data.poster.alt || data.title || '';
      detailDom.poster.dataset.previewSrc = data.poster.src;
      detailDom.poster.style.display = '';
      detailDom.poster.closest('.chaospace-history-detail-poster')?.classList.remove('is-empty');
    } else {
      detailDom.poster.removeAttribute('src');
      detailDom.poster.alt = '';
      detailDom.poster.dataset.previewSrc = '';
      detailDom.poster.style.display = 'none';
      detailDom.poster.closest('.chaospace-history-detail-poster')?.classList.add('is-empty');
    }
  }

  const dateLabel = data.releaseDate ? `📅 ${data.releaseDate}` : '';
  if (detailDom.date) {
    detailDom.date.textContent = dateLabel;
    detailDom.date.hidden = !dateLabel;
  }

  const countryLabel = data.country ? `🌍 ${data.country}` : '';
  if (detailDom.country) {
    detailDom.country.textContent = countryLabel;
    detailDom.country.hidden = !countryLabel;
  }

  const runtimeLabel = data.runtime ? `⏱️ ${data.runtime}` : '';
  if (detailDom.runtime) {
    detailDom.runtime.textContent = runtimeLabel;
    detailDom.runtime.hidden = !runtimeLabel;
  }

  let ratingLabel = '';
  if (data.rating && data.rating.value) {
    const pieces = [`⭐ ${data.rating.value}`];
    const votes = data.rating.votes;
    const label = data.rating.label;
    if (votes && label) {
      pieces.push(`· ${votes} ${label}`);
    } else if (votes) {
      pieces.push(`· ${votes}`);
    } else if (label) {
      pieces.push(`· ${label}`);
    }
    ratingLabel = pieces.join(' ');
  }

  if (detailDom.rating) {
    detailDom.rating.textContent = ratingLabel;
    detailDom.rating.hidden = !ratingLabel;
  }

  if (detailDom.genres) {
    detailDom.genres.innerHTML = '';
    const genres = Array.isArray(data.genres) ? data.genres : [];
    if (genres.length) {
      genres.slice(0, 12).forEach(genre => {
        const chip = document.createElement('span');
        chip.className = 'chaospace-history-detail-genre';
        chip.textContent = genre;
        detailDom.genres.appendChild(chip);
      });
      detailDom.genres.hidden = false;
    } else {
      detailDom.genres.hidden = true;
    }
  }

  if (detailDom.info) {
    detailDom.info.innerHTML = '';
    const infoEntries = Array.isArray(data.info) ? data.info : [];
    if (infoEntries.length) {
      infoEntries.slice(0, 12).forEach(entry => {
        const row = document.createElement('div');
        row.className = 'chaospace-history-detail-info-item';
        const labelEl = document.createElement('span');
        labelEl.className = 'chaospace-history-detail-info-label';
        labelEl.textContent = entry.label;
        const valueEl = document.createElement('span');
        valueEl.className = 'chaospace-history-detail-info-value';
        valueEl.textContent = entry.value;
        row.appendChild(labelEl);
        row.appendChild(valueEl);
        detailDom.info.appendChild(row);
      });
      detailDom.info.hidden = false;
    } else {
      detailDom.info.hidden = true;
    }
  }

  if (detailDom.synopsis) {
    if (data.synopsis) {
      detailDom.synopsis.textContent = data.synopsis;
      detailDom.synopsis.classList.remove('is-empty');
    } else {
      detailDom.synopsis.textContent = '暂无剧情简介';
      detailDom.synopsis.classList.add('is-empty');
    }
  }

  if (detailDom.stills) {
    detailDom.stills.innerHTML = '';
    const stills = Array.isArray(data.stills) ? data.stills : [];
    if (stills.length) {
      stills.slice(0, 12).forEach(still => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chaospace-history-detail-still';
        button.dataset.action = 'preview-poster';
        button.dataset.src = still.full || still.thumb || '';
        button.dataset.alt = still.alt || data.title || '剧照';
        button.title = still.alt || data.title || '剧照';

        const img = document.createElement('img');
        img.src = still.thumb || still.full || '';
        img.alt = still.alt || data.title || '';
        img.loading = 'lazy';
        img.decoding = 'async';

        disableElementDrag(img);
        disableElementDrag(button);

        button.appendChild(img);
        detailDom.stills.appendChild(button);
      });
      detailDom.stills.classList.remove('is-empty');
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'chaospace-history-detail-stills-empty';
      placeholder.textContent = '暂无剧照';
      detailDom.stills.appendChild(placeholder);
      detailDom.stills.classList.add('is-empty');
    }
  }
}
