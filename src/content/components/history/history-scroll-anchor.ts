interface HistoryScrollAnchorState {
  groupKey: string
  scrollTop: number
  relativeTop: number
}

const STORE_KEY = '__panTransferHistoryScrollAnchor__'
let fallbackAnchor: HistoryScrollAnchorState | null = null

function readStore(): {
  anchor: HistoryScrollAnchorState | null
  set: (value: HistoryScrollAnchorState | null) => void
} {
  if (typeof globalThis === 'object' && globalThis) {
    const store = globalThis as unknown as Record<string, HistoryScrollAnchorState | null>
    return {
      anchor: store[STORE_KEY] ?? null,
      set: (value) => {
        store[STORE_KEY] = value
      },
    }
  }
  return {
    anchor: fallbackAnchor,
    set: (value) => {
      fallbackAnchor = value
    },
  }
}

export function setHistoryScrollAnchor(anchor: HistoryScrollAnchorState): void {
  readStore().set(anchor)
}

export function consumeHistoryScrollAnchor(): HistoryScrollAnchorState | null {
  const store = readStore()
  const anchor = store.anchor
  store.set(null)
  return anchor
}
