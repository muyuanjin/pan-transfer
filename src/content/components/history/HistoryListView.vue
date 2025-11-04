<template>
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
      <label class="chaospace-history-selector">
        <input
          type="checkbox"
          data-role="history-select-item"
          :data-group-key="entry.group.key"
          :checked="entry.isSelected"
          :disabled="historyBatchRunning"
        />
      </label>
      <div class="chaospace-history-item-header">
        <component
          :is="entry.poster ? 'button' : 'div'"
          class="chaospace-history-poster"
          :class="{ 'is-placeholder': !entry.poster }"
          v-bind="entry.posterAttrs"
        >
          <img
            v-if="entry.poster"
            :src="entry.poster.src"
            :alt="entry.poster.alt"
            draggable="false"
          />
        </component>
        <div
          class="chaospace-history-main"
          role="button"
          tabindex="0"
          data-action="history-detail"
          :data-group-key="entry.group.key"
          :data-page-url="entry.mainRecord.pageUrl || ''"
          :aria-label="`查看 ${entry.title} 的转存详情`"
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
          >
            {{ entry.checkLabel }}
          </button>
        </div>
        <button
          v-if="entry.seasonRows.length"
          type="button"
          class="chaospace-history-season-toggle"
          data-role="history-season-toggle"
          :data-group-key="entry.group.key"
          :aria-expanded="entry.seasonExpanded ? 'true' : 'false'"
        >
          {{ entry.seasonExpanded ? '收起季' : '展开季' }}
        </button>
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
        >
          <component
            :is="season.row.poster?.src ? 'button' : 'div'"
            class="chaospace-history-season-poster"
            :class="{ 'is-placeholder': !season.row.poster?.src }"
            v-bind="season.posterAttrs"
          >
            <img
              v-if="season.row.poster?.src"
              :src="season.row.poster.src"
              :alt="season.row.poster.alt || season.row.label || ''"
              draggable="false"
            />
          </component>
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
                season.panInfo.path === '/' ? '打开网盘首页' : `打开网盘目录 ${season.panInfo.path}`
              "
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
            >
              {{ season.checkLabel }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </template>
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

const props = defineProps<{
  entries: HistoryGroup[]
  currentUrl: string
  selectedKeys: string[]
  seasonExpandedKeys: string[]
  historyBatchRunning: boolean
  isHistoryGroupCompleted?: ((group: HistoryGroup) => boolean) | undefined
}>()

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
  checkDisabledReason: string | undefined
  posterAttrs: Record<string, unknown>
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
  checkDisabledReason: string | undefined
  poster: HistoryGroup['poster'] | null
  posterAttrs: Record<string, unknown>
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
      let checkDisabledReason: string | undefined
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
        posterAttrs: derived.row.poster?.src
          ? {
              type: 'button',
              'data-action': 'preview-poster',
              'data-src': derived.row.poster.src,
              'data-alt': derived.row.poster.alt || derived.row.label || '',
            }
          : {},
      }
    })
    const seasonExpanded = expandedSet.value.has(group.key)

    let checkLabel = '检测新篇'
    let checkDisabled = false
    let checkDisabledReason: string | undefined
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
    const posterAttrs = group.poster?.src
      ? {
          type: 'button',
          'data-action': 'preview-poster',
          'data-src': group.poster.src,
          'data-alt': group.poster.alt || group.title || '',
        }
      : {}

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
      posterAttrs,
    }
  })
})

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
