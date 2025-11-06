<template>
  <div class="chaospace-toolbar">
    <div class="chaospace-sort-group">
      <div class="chaospace-sort-label">
        <span>排序</span>
        <div
          ref="sortGroupRef"
          class="chaospace-segmented chaospace-segmented--toolbar"
          role="radiogroup"
          aria-label="资源排序"
          :aria-disabled="isToolbarDisabled ? 'true' : 'false'"
          :data-selected="sortKey"
        >
          <button
            v-for="option in sortOptions"
            :key="option.value"
            type="button"
            class="chaospace-segmented-option"
            :class="{ 'is-active': sortKey === option.value }"
            role="radio"
            :aria-checked="sortKey === option.value ? 'true' : 'false'"
            :tabindex="sortKey === option.value ? 0 : -1"
            :data-value="option.value"
            :disabled="isToolbarDisabled"
            @click="setSortKey(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <button
        type="button"
        class="chaospace-order-btn"
        :disabled="isToolbarDisabled"
        :aria-pressed="sortOrder === 'desc' ? 'true' : 'false'"
        @click="toggleSortOrder"
      >
        {{ sortOrderLabel }}
      </button>
    </div>
    <div class="chaospace-select-group">
      <button type="button" :disabled="disableSelectionActions" @click="handleSelectAll">
        全选
      </button>
      <button type="button" :disabled="disableSelectionActions" @click="handleInvertSelection">
        反选
      </button>
      <button
        type="button"
        :disabled="disableSelectNew"
        :title="selectionHint"
        @click="handleSelectNewItems"
      >
        仅选新增
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useContentStore } from '../state'
import { toolbarContextKey } from '../runtime/ui/toolbar-context'

type SortKey = 'page' | 'title'

const store = useContentStore()
const toolbar = inject(toolbarContextKey)

if (!toolbar) {
  throw new Error('[Chaospace Transfer] Toolbar context is missing')
}

const sortOptions = [
  { value: 'page', label: '默认顺序' },
  { value: 'title', label: '标题' },
] as const satisfies Array<{ value: SortKey; label: string }>

const sortGroupRef = ref<HTMLElement | null>(null)

const sortKey = computed(() => store.sortKey)
const sortOrder = computed(() => store.sortOrder)
const sortOrderLabel = computed(() => (store.sortOrder === 'asc' ? '正序' : '倒序'))
const isToolbarDisabled = computed(() => store.toolbarDisabled)
const hasItems = computed(() => store.items.length > 0)
const newItemCount = computed(() => store.newItemIds.size)
const selectionHint = computed(() =>
  newItemCount.value > 0 ? `检测到 ${newItemCount.value} 条新增资源` : '暂无新增资源',
)
const disableSelectionActions = computed(() => isToolbarDisabled.value || !hasItems.value)
const disableSelectNew = computed(() => isToolbarDisabled.value || newItemCount.value === 0)

const setSortKey = (value: SortKey): void => {
  if (isToolbarDisabled.value) {
    return
  }
  if (store.sortKey === value) {
    return
  }
  store.sortKey = value
  toolbar.renderResourceList()
}

const toggleSortOrder = (): void => {
  if (isToolbarDisabled.value) {
    return
  }
  store.sortOrder = store.sortOrder === 'asc' ? 'desc' : 'asc'
  toolbar.renderResourceList()
}

const handleSelectAll = (): void => {
  toolbar.selection.selectAll(true)
}

const handleInvertSelection = (): void => {
  toolbar.selection.invert()
}

const handleSelectNewItems = (): void => {
  toolbar.selectNewItems()
}

useEventListener(sortGroupRef, 'keydown', (event) => {
  if (!(event instanceof KeyboardEvent)) {
    return
  }
  if (isToolbarDisabled.value) {
    return
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
    return
  }
  const target = event.target as HTMLElement | null
  if (!target || target.tagName !== 'BUTTON') {
    return
  }
  event.preventDefault()
  const currentValue =
    target.dataset['value'] === 'title' ? ('title' as SortKey) : ('page' as SortKey)
  const currentIndex = sortOptions.findIndex((option) => option.value === currentValue)
  if (currentIndex === -1) {
    return
  }
  const delta = event.key === 'ArrowRight' ? 1 : -1
  const nextIndex = (currentIndex + delta + sortOptions.length) % sortOptions.length
  const nextOption = sortOptions[nextIndex]
  if (!nextOption) {
    return
  }
  const nextValue = nextOption.value
  setSortKey(nextValue)
  requestAnimationFrame(() => {
    const nextButton = sortGroupRef.value?.querySelector<HTMLButtonElement>(
      `[data-value="${nextValue}"]`,
    )
    nextButton?.focus()
  })
})
</script>
