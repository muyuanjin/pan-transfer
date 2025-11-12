import { defineComponent, h } from 'vue'
import HistoryListView from './HistoryListView.vue'
import type { HistoryGroup } from '../../types'

export interface HistoryListBindings {
  entries: HistoryGroup[]
  currentUrl: string
  selectedKeys: string[]
  seasonExpandedKeys: string[]
  historyBatchRunning: boolean
  isHistoryGroupCompleted?: ((group: HistoryGroup) => boolean) | undefined
}

export function createHistoryListHost(bindings: HistoryListBindings) {
  return defineComponent({
    name: 'ChaospaceHistoryListHost',
    setup() {
      return () => h(HistoryListView, bindings)
    },
  })
}
