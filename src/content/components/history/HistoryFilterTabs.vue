<template>
  <div class="chaospace-history-tabs" role="toolbar" aria-label="历史筛选">
    <button
      v-for="option in filterOptions"
      :key="option.value"
      type="button"
      class="chaospace-history-tab"
      :class="{ 'is-active': option.value === activeFilter }"
      role="radio"
      :aria-pressed="option.value === activeFilter ? 'true' : 'false'"
      :aria-checked="option.value === activeFilter ? 'true' : 'false'"
      :tabindex="option.value === activeFilter ? 0 : -1"
      :data-filter="option.value"
      @click="handleSelect(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { useContentStore } from '../../state'
import { historyContextKey } from '../../runtime/ui/history-context'
import type { HistoryFilter } from '../../types'

const history = inject(historyContextKey)

if (!history) {
  throw new Error('[Chaospace Transfer] History context is missing')
}

const store = useContentStore()

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'series', label: '剧集' },
  { value: 'ongoing', label: '未完结' },
  { value: 'completed', label: '已完结' },
  { value: 'movie', label: '电影' },
] satisfies Array<{ value: HistoryFilter; label: string }>

const activeFilter = computed(() => store.historyFilter)

const handleSelect = (filter: HistoryFilter): void => {
  if (filter === activeFilter.value) {
    return
  }
  history.setHistoryFilter(filter)
}
</script>
