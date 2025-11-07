<template>
  <div class="chaospace-history-list-root" style="display: contents">
    <template v-for="entry in derivedEntries" :key="entry.group.key">
      <div
        class="chaospace-history-item"
        :class="{
          'is-selected': entry.isSelected,
          'is-current': entry.isCurrent,
          'is-season-expanded': entry.seasonExpanded,
        }"
        data-detail-trigger="group"
        :data-group-key="entry.group.key"
      >
        <div class="chaospace-history-selector">
          <label class="chaospace-history-selector-input">
            <input
              type="checkbox"
              data-role="history-select-item"
              :data-group-key="entry.group.key"
              :checked="entry.isSelected"
              :disabled="historyBatchRunning"
              @change="handleSelect(entry.group.key, $event)"
            />
          </label>
          <button
            v-if="entry.seasonRows.length"
            type="button"
            class="chaospace-history-season-toggle"
            data-role="history-season-toggle"
            :data-group-key="entry.group.key"
            :aria-expanded="entry.seasonExpanded ? 'true' : 'false'"
            :aria-label="entry.seasonExpanded ? '收起季' : '展开季'"
            :title="entry.seasonExpanded ? '收起季' : '展开季'"
            @click.prevent="handleToggleSeason(entry)"
          >
            <span class="chaospace-history-season-toggle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                <path d="M9 6l6 6-6 6" fill="none" />
              </svg>
            </span>
          </button>
        </div>
        <div class="chaospace-history-item-header">
          <button
            v-if="entry.poster?.src"
            type="button"
            class="chaospace-history-poster"
            data-action="preview-poster"
            :data-src="entry.poster.src"
            :data-alt="entry.poster.alt || entry.title"
            @click.stop.prevent="handlePosterPreview(entry.poster, entry.title)"
          >
            <img :src="entry.poster.src" :alt="entry.poster.alt || entry.title" draggable="false" />
          </button>
          <div v-else class="chaospace-history-poster is-placeholder"></div>
          <div
            class="chaospace-history-main"
            role="button"
            tabindex="0"
            data-action="history-detail"
            :data-group-key="entry.group.key"
            :data-page-url="entry.mainRecord.pageUrl || ''"
            :aria-label="`查看 ${entry.title} 的转存详情`"
            @click="handleGroupDetail(entry, $event)"
            @keydown.enter.prevent="handleGroupDetail(entry, $event)"
            @keydown.space.prevent="handleGroupDetail(entry, $event)"
          >
            <div class="chaospace-history-title">
              {{ entry.title }}
              <span
                v-if="entry.statusBadge"
                class="chaospace-history-status chaospace-history-status-inline"
                :class="entry.statusBadgeClass"
              >
                {{ statusEmoji(entry.statusBadge.state) }} {{ entry.statusBadge.label }}
              </span>
            </div>
            <div class="chaospace-history-meta">
              {{ entry.metaParts.join(' · ') }}
            </div>
          </div>
          <div class="chaospace-history-actions">
            <button
              type="button"
              class="chaospace-history-action chaospace-history-action-open"
              data-action="open"
              :data-url="entry.mainRecord.pageUrl || ''"
              :disabled="!entry.mainRecord.pageUrl"
              :class="{ 'is-disabled': !entry.mainRecord.pageUrl }"
              @click.stop.prevent="handleOpenUrl(entry.mainRecord.pageUrl)"
            >
              进入资源
            </button>
            <button
              type="button"
              class="chaospace-history-action chaospace-history-action-pan"
              data-action="open-pan"
              :data-url="entry.panInfo.url"
              :data-path="entry.panInfo.path"
              :title="
                entry.panInfo.path === '/' ? '打开网盘首页' : `打开网盘目录 ${entry.panInfo.path}`
              "
              @click.stop.prevent="handleOpenPan(entry.panInfo)"
            >
              进入网盘
            </button>
            <button
              v-if="entry.showCheck"
              type="button"
              class="chaospace-history-action chaospace-history-action-check"
              data-action="check"
              :data-url="entry.mainRecord.pageUrl || ''"
              :disabled="entry.checkDisabled"
              :class="{ 'is-disabled': entry.checkDisabled }"
              :data-reason="entry.checkDisabledReason"
              @click.stop.prevent="handleTriggerUpdate(entry, $event)"
            >
              {{ entry.checkLabel }}
            </button>
          </div>
        </div>
        <div
          v-if="entry.seasonRows.length"
          class="chaospace-history-season-list"
          data-role="history-season-list"
          :data-group-key="entry.group.key"
          :hidden="!entry.seasonExpanded"
        >
          <div
            v-for="season in entry.seasonRows"
            :key="season.row.key"
            class="chaospace-history-season-item"
            data-detail-trigger="season"
            :data-group-key="entry.group.key"
            :data-key="season.row.key"
            :data-page-url="season.row.url || ''"
            :data-title="season.row.label || ''"
            :data-poster-src="season.row.poster?.src || ''"
            :data-poster-alt="season.row.poster?.alt || ''"
            role="button"
            tabindex="0"
            :aria-label="`查看 ${season.row.label || '季详情'} 的转存详情`"
            @click="handleSeasonRowDetail(entry, season, $event)"
            @keydown.enter.prevent="handleSeasonRowDetail(entry, season, $event)"
            @keydown.space.prevent="handleSeasonRowDetail(entry, season, $event)"
          >
            <button
              v-if="season.row.poster?.src"
              type="button"
              class="chaospace-history-season-poster"
              :class="{ 'is-placeholder': !season.row.poster?.src }"
              data-action="preview-poster"
              :data-src="season.row.poster?.src || ''"
              :data-alt="season.row.poster?.alt || season.row.label || ''"
              @click.stop.prevent="handleSeasonPosterPreview(season)"
            >
              <img
                :src="season.row.poster?.src"
                :alt="season.row.poster?.alt || season.row.label || ''"
                draggable="false"
              />
            </button>
            <div
              v-else
              class="chaospace-history-season-poster"
              :class="{ 'is-placeholder': !season.row.poster?.src }"
            ></div>
            <div class="chaospace-history-season-body">
              <div class="chaospace-history-season-title">
                {{ season.row.label || '未知季' }}
                <span
                  v-if="season.statusBadge"
                  class="chaospace-history-status chaospace-history-status-inline"
                  :class="season.statusBadgeClass"
                >
                  {{ statusEmoji(season.statusBadge.state) }} {{ season.statusBadge.label }}
                </span>
              </div>
              <div class="chaospace-history-season-meta">
                {{ season.timestampLabel }}
              </div>
            </div>
            <div class="chaospace-history-actions">
              <button
                type="button"
                class="chaospace-history-action chaospace-history-action-open"
                data-action="open"
                :data-url="season.row.url || ''"
                :disabled="!season.row.url"
                :class="{ 'is-disabled': !season.row.url }"
                @click.stop.prevent="handleOpenUrl(season.row.url)"
              >
                进入资源
              </button>
              <button
                type="button"
                class="chaospace-history-action chaospace-history-action-pan"
                data-action="open-pan"
                :data-url="season.panInfo.url"
                :data-path="season.panInfo.path"
                :title="
                  season.panInfo.path === '/'
                    ? '打开网盘首页'
                    : `打开网盘目录 ${season.panInfo.path}`
                "
                @click.stop.prevent="handleOpenPan(season.panInfo)"
              >
                进入网盘
              </button>
              <button
                type="button"
                class="chaospace-history-action chaospace-history-action-check"
                data-action="check"
                :data-url="season.row.url || ''"
                :disabled="season.checkDisabled"
                :class="{ 'is-disabled': season.checkDisabled }"
                :data-reason="season.checkDisabledReason"
                @click.stop.prevent="handleSeasonTriggerUpdate(season, $event)"
              >
                {{ season.checkLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { buildHistoryGroupSeasonRows } from '../../services/history-service'
import type { HistoryGroup, HistoryGroupSeasonRow } from '../../types'
import {
  deriveHistoryGroupMeta,
  deriveSeasonRow,
  resolveHistoryPanInfo,
  type HistoryStatusBadge,
} from './history-card.helpers'
import { useHistoryListActions } from '../../runtime/ui/history-context'

const props = defineProps<{
  entries: HistoryGroup[]
  currentUrl: string
  selectedKeys: string[]
  seasonExpandedKeys: string[]
  historyBatchRunning: boolean
  isHistoryGroupCompleted?: ((group: HistoryGroup) => boolean) | undefined
}>()

const historyActions = useHistoryListActions()

const selectedSet = computed(() => new Set(props.selectedKeys))
const expandedSet = computed(() => new Set(props.seasonExpandedKeys))

interface DerivedSeasonView {
  row: HistoryGroupSeasonRow
  timestampLabel: string
  panInfo: ReturnType<typeof resolveHistoryPanInfo>
  statusBadge: HistoryStatusBadge | null
  statusBadgeClass: Record<string, boolean>
  checkLabel: string
  checkDisabled: boolean
  checkDisabledReason: string | null
  poster: HistoryGroupSeasonRow['poster'] | null
}

interface DerivedEntryView {
  group: HistoryGroup
  title: string
  mainRecord: HistoryGroup['main'] & Record<string, any>
  panInfo: ReturnType<typeof resolveHistoryPanInfo>
  statusBadge: HistoryStatusBadge | null
  statusBadgeClass: Record<string, boolean>
  isSelected: boolean
  isCurrent: boolean
  metaParts: string[]
  seasonRows: DerivedSeasonView[]
  seasonExpanded: boolean
  showCheck: boolean
  checkLabel: string
  checkDisabled: boolean
  checkDisabledReason: string | null
  poster: HistoryGroup['poster'] | null
}

const derivedEntries = computed<DerivedEntryView[]>(() => {
  return props.entries.map((group) => {
    const mainRecord = (group.main ?? {}) as DerivedEntryView['mainRecord']
    const meta = deriveHistoryGroupMeta(group)
    const panInfo = resolveHistoryPanInfo({ record: mainRecord, group })
    const isSelected = selectedSet.value.has(group.key)
    const isCurrent = Array.isArray(group.urls)
      ? group.urls.some((url) => normalizeUrl(url) === normalizeUrl(props.currentUrl))
      : false
    const seasonRowsRaw = buildHistoryGroupSeasonRows(group) as HistoryGroupSeasonRow[]
    const seasonRows: DerivedSeasonView[] = seasonRowsRaw.map((row) => {
      const derived = deriveSeasonRow(group, row)
      const canCheckSeason = row.canCheck && Boolean(row.url)
      let checkLabel = '检测新篇'
      let checkDisabled = !canCheckSeason
      let checkDisabledReason: string | null = null
      if (!row.url) {
        checkLabel = '无链接'
        checkDisabled = true
      } else if (!row.canCheck) {
        checkLabel = '无法检测'
        checkDisabled = true
      } else if (derived.completed) {
        checkLabel = '已完结'
        checkDisabled = true
        checkDisabledReason = 'completed'
      }
      const badgeClass = buildStatusBadgeClass(derived.statusBadge)
      return {
        row,
        timestampLabel: derived.timestampLabel ? `更新于 ${derived.timestampLabel}` : '',
        panInfo: derived.panInfo,
        statusBadge: derived.statusBadge,
        statusBadgeClass: badgeClass,
        checkLabel,
        checkDisabled,
        checkDisabledReason,
        poster: row.poster || null,
      }
    })
    const seasonExpanded = expandedSet.value.has(group.key)

    let checkLabel = '检测新篇'
    let checkDisabled = false
    let checkDisabledReason: string | null = null
    const pageType = typeof mainRecord.pageType === 'string' ? mainRecord.pageType : undefined
    const showCheck = pageType === 'series'
    if (showCheck) {
      const completed = props.isHistoryGroupCompleted
        ? Boolean(props.isHistoryGroupCompleted(group))
        : false
      if (completed) {
        checkDisabled = true
        checkDisabledReason = 'completed'
        checkLabel = '已完结'
      } else if (!mainRecord.pageUrl || typeof mainRecord.pageUrl !== 'string') {
        checkDisabled = true
        checkLabel = '无链接'
      }
    }

    return {
      group,
      title:
        group.title ||
        (typeof mainRecord.pageTitle === 'string' ? mainRecord.pageTitle : '') ||
        '未命名资源',
      mainRecord,
      panInfo,
      statusBadge: meta.statusBadge,
      statusBadgeClass: buildStatusBadgeClass(meta.statusBadge),
      isSelected,
      isCurrent,
      metaParts: meta.metaParts,
      seasonRows,
      seasonExpanded,
      showCheck,
      checkLabel,
      checkDisabled,
      checkDisabledReason,
      poster: group.poster || null,
    }
  })
})

function handleSelect(groupKey: string, event: Event): void {
  const checkbox = event.target as HTMLInputElement | null
  if (!checkbox) {
    return
  }
  historyActions.setHistorySelection(groupKey, checkbox.checked)
}

function handleToggleSeason(entry: DerivedEntryView): void {
  historyActions.setHistorySeasonExpanded(entry.group.key, !entry.seasonExpanded)
}

function handleGroupDetail(entry: DerivedEntryView, event?: Event): void {
  event?.preventDefault()
  historyActions.openHistoryDetail({
    groupKey: entry.group.key,
    scope: 'group',
    pageUrl: entry.mainRecord.pageUrl || '',
    title: entry.title,
    poster: entry.poster ? { src: entry.poster.src, alt: entry.poster.alt || entry.title } : null,
  })
}

function handleSeasonRowDetail(
  entry: DerivedEntryView,
  season: DerivedSeasonView,
  event?: Event,
): void {
  event?.preventDefault()
  historyActions.openHistoryDetail({
    groupKey: entry.group.key,
    scope: 'season',
    pageUrl: season.row.url || '',
    title: season.row.label || '',
    poster: season.row.poster
      ? { src: season.row.poster.src, alt: season.row.poster.alt || season.row.label || '' }
      : null,
  })
}

function handleOpenUrl(url: unknown): void {
  const normalized = typeof url === 'string' ? url.trim() : ''
  if (!normalized) {
    return
  }
  historyActions.openHistoryUrl(normalized)
}

function handleOpenPan(panInfo: { url: string; path: string }): void {
  historyActions.openHistoryPan({ url: panInfo.url, path: panInfo.path })
}

function handleTriggerUpdate(entry: DerivedEntryView, event: Event): void {
  const button = event.currentTarget as HTMLButtonElement | null
  const pageUrl =
    typeof entry.mainRecord.pageUrl === 'string' ? entry.mainRecord.pageUrl.trim() : ''
  if (!pageUrl) {
    return
  }
  historyActions.triggerHistoryUpdate({ pageUrl, button })
}

function handleSeasonTriggerUpdate(season: DerivedSeasonView, event: Event): void {
  const button = event.currentTarget as HTMLButtonElement | null
  const pageUrl = typeof season.row.url === 'string' ? season.row.url.trim() : ''
  if (!pageUrl) {
    return
  }
  historyActions.triggerHistoryUpdate({ pageUrl, button })
}

function handlePosterPreview(
  poster: { src: string; alt?: string | null },
  fallbackTitle: string,
): void {
  historyActions.previewHistoryPoster({
    src: poster.src,
    alt: poster.alt || fallbackTitle || '',
  })
}

function handleSeasonPosterPreview(season: DerivedSeasonView): void {
  if (!season.row.poster?.src) {
    return
  }
  historyActions.previewHistoryPoster({
    src: season.row.poster.src,
    alt: season.row.poster.alt || season.row.label || '',
  })
}

function statusEmoji(state: string | undefined): string {
  const map = {
    completed: '✅',
    ongoing: '📡',
    upcoming: '🕒',
    unknown: 'ℹ️',
  } as const
  const key = (state ?? 'unknown') as keyof typeof map
  return map[key]
}

function buildStatusBadgeClass(badge: HistoryStatusBadge | null): Record<string, boolean> {
  if (!badge) {
    return {}
  }
  return {
    [`is-${badge.state || 'unknown'}`]: true,
  }
}

function normalizeUrl(url: string | undefined | null): string {
  if (!url) {
    return ''
  }
  try {
    return new URL(url, window.location.href).href
  } catch {
    return url
  }
}
</script>
