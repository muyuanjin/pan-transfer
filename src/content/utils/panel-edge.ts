import { EDGE_STATE_KEY } from '../constants'
import type { PanelEdgeSnapshot } from '../types'
import { safeStorageGet, safeStorageSet } from './storage'

interface StoredEdgeState {
  hidden?: unknown
  side?: unknown
  peek?: unknown
}

export function normalizeEdgeState(value: unknown): PanelEdgeSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const { hidden, side, peek } = value as StoredEdgeState
  if (side !== 'left' && side !== 'right') {
    return null
  }
  if (typeof hidden !== 'boolean') {
    return null
  }
  const snapshot: PanelEdgeSnapshot = {
    isHidden: hidden,
    side,
  }
  const numericPeek = typeof peek === 'number' ? peek : Number.NaN
  if (Number.isFinite(numericPeek) && numericPeek > 0) {
    snapshot.peek = numericPeek
  }
  return snapshot
}

export async function loadStoredEdgeState(): Promise<PanelEdgeSnapshot | null> {
  const stored = await safeStorageGet<Record<string, unknown>>([EDGE_STATE_KEY], 'edge state')
  return normalizeEdgeState(stored[EDGE_STATE_KEY])
}

export async function persistEdgeState(snapshot: PanelEdgeSnapshot): Promise<void> {
  await safeStorageSet(
    {
      [EDGE_STATE_KEY]: {
        hidden: Boolean(snapshot.isHidden),
        side: snapshot.side,
        peek:
          typeof snapshot.peek === 'number' && Number.isFinite(snapshot.peek)
            ? snapshot.peek
            : undefined,
      },
    },
    'edge state',
  )
}
