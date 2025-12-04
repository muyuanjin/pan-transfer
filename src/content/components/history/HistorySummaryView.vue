<template>
  <div
    class="chaospace-history-summary-item"
    :class="{ 'is-placeholder': !summary, 'is-empty': !summary }"
    data-role="history-summary-entry"
    role="button"
    tabindex="0"
    @click="handleSummaryActivate"
    @keydown.enter.prevent="handleSummaryActivate"
    @keydown.space.prevent="handleSummaryActivate"
  >
    <div class="chaospace-history-summary-topline">
      <span class="chaospace-history-summary-label">🔖 转存历史</span>
      <button
        v-if="!isHistoryOnly"
        type="button"
        class="chaospace-history-toggle"
        data-role="history-toggle"
        :aria-expanded="historyExpanded ? 'true' : 'false'"
        :aria-label="historyExpanded ? '收起转存历史' : '展开转存历史'"
        @click.stop.prevent="handleSummaryActivate"
      >
        {{ historyExpanded ? '收起' : '展开' }}
      </button>
    </div>
    <template v-if="summary">
      <div class="chaospace-history-summary-title">{{ summary.title }}</div>
      <div v-if="summary.metaParts.length" class="chaospace-history-summary-meta">
        <span v-for="(meta, index) in summary.metaParts" :key="index">{{ meta }}</span>
      </div>
    </template>
    <template v-else>
      <div class="chaospace-history-summary-empty">{{ emptyMessage }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useHistoryListActions } from '../../runtime/ui/history-context'
import { useContentStore } from '../../state'

const props = defineProps<{
  summary: {
    title: string
    metaParts: string[]
  } | null
  historyExpanded: boolean
  emptyMessage?: string
}>()

const emptyMessage = computed<string>(() => props.emptyMessage || '暂无其他转存记录')

const { toggleHistoryExpanded } = useHistoryListActions()

const store = useContentStore()
const isHistoryOnly = computed(
  () => store.items.length === 0 && store.deferredSeasonInfos.length === 0,
)

function handleSummaryActivate(): void {
  if (isHistoryOnly.value) {
    return
  }
  toggleHistoryExpanded()
}
</script>
