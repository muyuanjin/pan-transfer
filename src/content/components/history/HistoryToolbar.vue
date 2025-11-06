<template>
  <div class="chaospace-history-toolbar" data-role="history-toolbar">
    <label class="chaospace-history-select-all">
      <input
        ref="selectAllRef"
        type="checkbox"
        :disabled="selectAllDisabled"
        @change="handleSelectAllChange"
      />
      <span>全选当前筛选结果</span>
    </label>
    <div class="chaospace-history-toolbar-actions">
      <span class="chaospace-history-selection-count" data-role="history-selection-count">
        {{ selectionLabel }}
      </span>
      <button
        type="button"
        class="chaospace-history-primary-btn"
        data-role="history-batch-check"
        :disabled="batchCheckDisabled"
        @click="handleBatchCheck"
      >
        {{ batchCheckLabel }}
      </button>
      <button
        type="button"
        class="chaospace-history-ghost-btn"
        data-role="history-delete-selected"
        :disabled="deleteDisabled"
        @click="handleDeleteSelected"
      >
        删除选中
      </button>
      <button
        type="button"
        class="chaospace-history-ghost-btn"
        data-role="history-clear"
        :disabled="clearDisabled"
        @click="handleClear"
      >
        清空历史
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useContentStore } from '../../state'
import { historyContextKey } from '../../runtime/ui/history-context'
import { filterHistoryGroups, canCheckHistoryGroup } from '../../services/history-service'
import type { HistoryGroup } from '../../types'

const history = inject(historyContextKey)

if (!history) {
  throw new Error('[Chaospace Transfer] History context is missing')
}

const store = useContentStore()

const selectAllRef = ref<HTMLInputElement | null>(null)

const allGroups = computed<HistoryGroup[]>(() =>
  Array.isArray(store.historyGroups) ? store.historyGroups : [],
)

const filteredGroups = computed<HistoryGroup[]>(() =>
  filterHistoryGroups(allGroups.value, store.historyFilter, {
    searchTerm: store.historySearchTerm,
  }),
)

const selectedKeys = computed<Set<string>>(() => {
  const raw = store.historySelectedKeys
  if (raw instanceof Set) {
    return new Set(Array.from(raw))
  }
  return new Set<string>()
})

const selectedWithinFilter = computed(
  () => filteredGroups.value.filter((group) => selectedKeys.value.has(group.key)).length,
)

const totalWithinFilter = computed(() => filteredGroups.value.length)

const selectionLabel = computed(() =>
  selectedWithinFilter.value > 0
    ? `已选 ${selectedWithinFilter.value} / ${totalWithinFilter.value}`
    : `共 ${totalWithinFilter.value}`,
)

const selectableSelectedCount = computed(
  () =>
    filteredGroups.value.filter(
      (group) => selectedKeys.value.has(group.key) && canCheckHistoryGroup(group),
    ).length,
)

const batchCheckLabel = computed(() =>
  store.historyBatchRunning ? store.historyBatchProgressLabel || '检测中...' : '批量检测更新',
)

const batchCheckDisabled = computed(
  () => store.historyBatchRunning || selectableSelectedCount.value === 0,
)

const deleteDisabled = computed(() => store.historyBatchRunning || selectedKeys.value.size === 0)

const clearDisabled = computed(() => store.historyBatchRunning || allGroups.value.length === 0)

const selectAllDisabled = computed(() => store.historyBatchRunning || totalWithinFilter.value === 0)

const selectAllState = computed(() => {
  if (!totalWithinFilter.value) {
    return { checked: false, indeterminate: false }
  }
  if (selectedWithinFilter.value === totalWithinFilter.value) {
    return { checked: true, indeterminate: false }
  }
  if (selectedWithinFilter.value === 0) {
    return { checked: false, indeterminate: false }
  }
  return { checked: false, indeterminate: true }
})

watch(
  selectAllState,
  (state) => {
    if (!selectAllRef.value) {
      return
    }
    selectAllRef.value.checked = state.checked
    selectAllRef.value.indeterminate = state.indeterminate
  },
  { immediate: true },
)

watch(
  () => selectAllRef.value,
  (input) => {
    if (!input) {
      return
    }
    const state = selectAllState.value
    input.checked = state.checked
    input.indeterminate = state.indeterminate
  },
  { immediate: true },
)

const handleSelectAllChange = (event: Event): void => {
  if (!(event.target instanceof HTMLInputElement)) {
    return
  }
  history.setHistorySelectAll(event.target.checked)
}

const handleBatchCheck = (): void => {
  if (batchCheckDisabled.value) {
    return
  }
  history.handleHistoryBatchCheck()
}

const handleDeleteSelected = (): void => {
  if (deleteDisabled.value) {
    return
  }
  history.handleHistoryDeleteSelected()
}

const handleClear = (): void => {
  if (clearDisabled.value) {
    return
  }
  history.handleHistoryClear()
}
</script>
