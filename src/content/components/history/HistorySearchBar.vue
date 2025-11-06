<template>
  <div class="chaospace-history-search" data-role="history-search-container">
    <span class="chaospace-history-search-icon" aria-hidden="true">🔍</span>
    <input
      ref="inputRef"
      v-model="searchTerm"
      type="search"
      class="chaospace-history-search-input"
      data-role="history-search"
      placeholder="搜索标题、目录或来源"
      aria-label="搜索转存历史"
      enterkeyhint="search"
    />
    <button
      type="button"
      class="chaospace-history-search-clear"
      data-role="history-search-clear"
      aria-label="清除搜索"
      :hidden="!isClearVisible"
      :disabled="isClearDisabled"
      @click="clearSearch"
    >
      ✕
    </button>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { historyContextKey } from '../../runtime/ui/history-context'
import { useHistorySearch } from './useHistorySearch'

const history = inject(historyContextKey)

if (!history) {
  throw new Error('[Chaospace Transfer] History context is missing')
}

const { inputRef, searchTerm, clearSearch, isClearVisible, isClearDisabled } =
  useHistorySearch(history)
</script>
