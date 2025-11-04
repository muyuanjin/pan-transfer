<template>
  <div
    class="chaospace-history-detail-backdrop"
    data-role="history-detail-backdrop"
    :class="{ 'is-visible': state.visible }"
    :hidden="!state.visible"
    @click.self="emitClose"
  >
    <div
      class="chaospace-history-detail-modal"
      data-role="history-detail-modal"
      role="dialog"
      aria-modal="true"
      :aria-busy="state.loading ? 'true' : 'false'"
    >
      <button
        type="button"
        class="chaospace-history-detail-close"
        data-role="history-detail-close"
        aria-label="关闭详情"
        @click="emitClose"
      >✕</button>
      <div class="chaospace-history-detail-header">
        <div class="chaospace-history-detail-poster" :class="{ 'is-empty': !detail.poster }">
          <img
            data-role="history-detail-poster"
            v-if="detail.poster"
            :src="detail.poster.src"
            :alt="detail.poster.alt || detail.title"
            draggable="false"
            @click="previewImage(detail.poster.src, detail.poster.alt || detail.title)"
          />
        </div>
        <div class="chaospace-history-detail-summary">
          <h3 class="chaospace-history-detail-title" data-role="history-detail-title">{{ detail.title }}</h3>
          <div class="chaospace-history-detail-tags">
            <span data-role="history-detail-date" v-show="dateLabel">{{ dateLabel }}</span>
            <span data-role="history-detail-country" v-show="countryLabel">{{ countryLabel }}</span>
            <span data-role="history-detail-runtime" v-show="runtimeLabel">{{ runtimeLabel }}</span>
            <span data-role="history-detail-rating" v-show="ratingLabel">{{ ratingLabel }}</span>
          </div>
          <div class="chaospace-history-detail-genres" data-role="history-detail-genres" v-show="genres.length">
            <span
              v-for="genre in genres"
              :key="genre"
              class="chaospace-history-detail-genre"
            >
              {{ genre }}
            </span>
          </div>
          <div class="chaospace-history-detail-info" data-role="history-detail-info" v-show="info.length">
            <div
              v-for="entry in info"
              :key="entry.label + entry.value"
              class="chaospace-history-detail-info-item"
            >
              <span class="chaospace-history-detail-info-label">{{ entry.label }}</span>
              <span class="chaospace-history-detail-info-value">{{ entry.value }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="chaospace-history-detail-body" data-role="history-detail-body" v-show="!state.error || !!detail">
        <div class="chaospace-history-detail-section">
          <div class="chaospace-history-detail-section-title">剧情简介</div>
          <div
            class="chaospace-history-detail-synopsis"
            data-role="history-detail-synopsis"
            :class="{ 'is-empty': !detail.synopsis }"
          >
            {{ detail.synopsis || '暂无剧情简介' }}
          </div>
        </div>
        <div class="chaospace-history-detail-section">
          <div class="chaospace-history-detail-section-title">剧照</div>
          <div class="chaospace-history-detail-stills" data-role="history-detail-stills" :class="{ 'is-empty': !stills.length }">
            <template v-if="stills.length">
              <button
                v-for="still in stills"
                :key="still.full + still.thumb"
                type="button"
                class="chaospace-history-detail-still"
                data-action="preview-poster"
                :data-src="still.full"
                :data-alt="still.alt"
                :title="still.alt"
                @click="previewImage(still.full, still.alt)"
              >
                <img
                  :src="still.thumb"
                  :alt="still.alt"
                  loading="lazy"
                  decoding="async"
                  draggable="false"
                />
              </button>
            </template>
            <div v-else class="chaospace-history-detail-stills-empty">暂无剧照</div>
          </div>
        </div>
      </div>
      <div class="chaospace-history-detail-loading" data-role="history-detail-loading" v-show="state.loading">
        正在加载详情...
      </div>
      <div class="chaospace-history-detail-error" data-role="history-detail-error" v-show="state.error">
        加载失败：{{ state.error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck
import { computed } from 'vue';
import type { HistoryDetailData } from './history-detail';

interface HistoryDetailOverlayState {
  visible: boolean;
  loading: boolean;
  error: string;
  data: HistoryDetailData | null;
  fallback: HistoryDetailData | null;
}

const props = defineProps<{
  state: HistoryDetailOverlayState;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const detail = computed<HistoryDetailData>(() => {
  return props.state.data || props.state.fallback || {
    title: '转存记录',
    poster: null,
    releaseDate: '',
    country: '',
    runtime: '',
    rating: null,
    genres: [],
    info: [],
    synopsis: '',
    stills: []
  };
});

const dateLabel = computed(() => detail.value.releaseDate ? `📅 ${detail.value.releaseDate}` : '');
const countryLabel = computed(() => detail.value.country ? `🌍 ${detail.value.country}` : '');
const runtimeLabel = computed(() => detail.value.runtime ? `⏱️ ${detail.value.runtime}` : '');
const ratingLabel = computed(() => {
  const rating = detail.value.rating;
  if (!rating || !rating.value) {
    return '';
  }
  const pieces = [`⭐ ${rating.value}`];
  if (rating.votes && rating.label) {
    pieces.push(`· ${rating.votes} ${rating.label}`);
  } else if (rating.votes) {
    pieces.push(`· ${rating.votes}`);
  } else if (rating.label) {
    pieces.push(`· ${rating.label}`);
  }
  return pieces.join(' ');
});

const genres = computed(() => detail.value.genres?.slice(0, 12) ?? []);
const info = computed(() => detail.value.info?.slice(0, 12) ?? []);
const stills = computed(() => detail.value.stills?.slice(0, 12).map(still => ({
  full: still.full || still.url || still.thumb || '',
  thumb: still.thumb || still.url || still.full || '',
  alt: still.alt || detail.value.title || '剧照'
})) ?? []);

function emitClose(): void {
  emit('close');
}

function previewImage(src: string | undefined, alt: string | undefined): void {
  if (!src) {
    return;
  }
  if (typeof window.openZoomPreview === 'function') {
    window.openZoomPreview({
      src,
      alt: alt || ''
    });
  }
}
</script>
