export const HISTORY_LIST_ACTION_EVENT = 'chaospace:history-list-action'
export const HISTORY_SUMMARY_TOGGLE_EVENT = 'chaospace:history-summary-toggle'

export type HistoryListAction =
  | {
      type: 'select'
      groupKey: string
      selected: boolean
    }
  | {
      type: 'toggle-season'
      groupKey: string
      expanded: boolean
    }
  | {
      type: 'open-detail'
      groupKey: string
      scope: 'group' | 'season'
      pageUrl?: string
      title?: string
      poster?: { src: string; alt?: string | null } | null
    }
  | {
      type: 'open-url'
      url: string
    }
  | {
      type: 'open-pan'
      url: string
      path: string
    }
  | {
      type: 'trigger-update'
      pageUrl: string
      button: HTMLButtonElement | null
      scope: 'group' | 'season'
    }
  | {
      type: 'preview-poster'
      src: string
      alt: string
    }
