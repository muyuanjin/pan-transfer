import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { onKeyStroke, refDebounced } from '@vueuse/core'
import { useContentStore } from '../../state'
import type { HistoryController } from '../../runtime/ui/history-context'

interface UseHistorySearchResult {
  inputRef: Ref<HTMLInputElement | null>
  searchTerm: Ref<string>
  clearSearch: () => void
  isClearVisible: ComputedRef<boolean>
  isClearDisabled: ComputedRef<boolean>
}

export function useHistorySearch(history: HistoryController): UseHistorySearchResult {
  const store = useContentStore()

  const inputRef = ref<HTMLInputElement | null>(null)
  const searchTerm = ref(store.historySearchTerm || '')
  const debouncedSearch = refDebounced(searchTerm, 250)

  const isClearVisible = computed(() => searchTerm.value.length > 0)
  const isClearDisabled = computed(() => !isClearVisible.value)

  const syncTermToHistory = (value: string): void => {
    if (store.historySearchTerm === value) {
      return
    }
    history.setHistorySearchTerm(value)
  }

  const clearSearch = (): void => {
    if (!searchTerm.value && !store.historySearchTerm) {
      return
    }
    searchTerm.value = ''
    syncTermToHistory('')
    inputRef.value?.focus()
  }

  watch(
    debouncedSearch,
    (value) => {
      const next = typeof value === 'string' ? value.trim() : ''
      syncTermToHistory(next)
    },
    { immediate: true },
  )

  watch(
    () => store.historySearchTerm,
    (value) => {
      const normalized = typeof value === 'string' ? value : ''
      if (normalized === searchTerm.value) {
        return
      }
      searchTerm.value = normalized
    },
  )

  onKeyStroke(
    'Escape',
    (event) => {
      if (!inputRef.value || document.activeElement !== inputRef.value) {
        return
      }
      if (!searchTerm.value) {
        return
      }
      event.preventDefault()
      clearSearch()
    },
    { target: inputRef },
  )

  return {
    inputRef,
    searchTerm,
    clearSearch,
    isClearVisible,
    isClearDisabled,
  }
}
