import {
  resolveStorageProviderMode as resolveDevStorageMode,
  type StorageProviderMode as DevStorageProviderMode,
} from '@/shared/dev-toggles'

export type ResolvedStorageProviderMode = DevStorageProviderMode
export type StorageProviderMode = 'auto' | ResolvedStorageProviderMode

let overrideMode: ResolvedStorageProviderMode | null = null

export function setStorageProviderModeOverride(mode: StorageProviderMode | null): void {
  if (!mode || mode === 'auto') {
    overrideMode = null
    return
  }
  overrideMode = mode
}

export function getStorageProviderModeOverride(): ResolvedStorageProviderMode | null {
  return overrideMode
}

export function resolveEffectiveStorageMode(
  mode: StorageProviderMode = 'auto',
): ResolvedStorageProviderMode {
  if (mode !== 'auto') {
    return mode
  }
  if (overrideMode) {
    return overrideMode
  }
  return resolveDevStorageMode(undefined)
}
