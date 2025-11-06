import { PIN_STATE_KEY } from '../constants'
import { safeStorageGet, safeStorageSet } from './storage'

export function normalizePinState(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const nested = record['pinned']
    if (typeof nested === 'boolean') {
      return nested
    }
  }
  return null
}

export async function loadStoredPinState(): Promise<boolean | null> {
  const stored = await safeStorageGet<Record<string, unknown>>([PIN_STATE_KEY], 'pin state')
  return normalizePinState(stored[PIN_STATE_KEY])
}

export async function persistPinState(nextPinned: boolean): Promise<void> {
  await safeStorageSet(
    {
      [PIN_STATE_KEY]: Boolean(nextPinned),
    },
    'pin state',
  )
}
