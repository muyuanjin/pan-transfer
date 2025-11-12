import { TransferPipeline } from '@/core/transfer'
import { chaosLogger } from '@/shared/log'
import type { TransferRequestPayload, TransferResponsePayload } from '@/shared/types/transfer'
import type { TransferContext, StorageTransferResult } from '@/platform/registry/types'
import {
  resolveEffectiveStorageMode,
  type ResolvedStorageProviderMode,
  type StorageProviderMode,
} from './storage-mode'
import { getBackgroundProviderRegistry } from './registry'
import {
  getProviderPreferencesSnapshot,
  initProviderPreferences,
} from '@/background/settings/provider-preferences'

let pipelineCache: Partial<Record<ResolvedStorageProviderMode, TransferPipeline>> = {}
let lastTransferSnapshot: TransferDispatchSnapshot | null = null

void initProviderPreferences().catch((error) => {
  const err = error as Error
  chaosLogger.warn('[Pan Transfer] Failed to initialize provider preferences in background', {
    message: err?.message,
  })
})

export class StorageDispatchError extends Error {
  readonly storageResult: StorageTransferResult

  readonly storageProviderId: string

  constructor(
    message: string,
    params: { storageResult: StorageTransferResult; storageProviderId: string },
  ) {
    super(message)
    this.name = 'StorageDispatchError'
    this.storageResult = params.storageResult
    this.storageProviderId = params.storageProviderId
  }
}

export function getBackgroundTransferPipeline(
  mode: StorageProviderMode = 'auto',
): TransferPipeline {
  const storageMode = resolveEffectiveStorageMode(mode)
  const cached = pipelineCache[storageMode]
  if (cached) {
    return cached
  }
  const nextPipeline = new TransferPipeline({
    registry: getBackgroundProviderRegistry(storageMode),
    getProviderPreferences: () => getProviderPreferencesSnapshot(),
  })
  pipelineCache[storageMode] = nextPipeline
  return nextPipeline
}
export function resetBackgroundTransferPipelineCache(): void {
  pipelineCache = {}
}

export interface BackgroundTransferDispatchResult {
  response: TransferResponsePayload
  storageResult: StorageTransferResult
  storageProviderId: string
}

export interface TransferDispatchSnapshot {
  payload: TransferRequestPayload
  storageProviderId: string
  timestamp: number
}

export function getLastTransferDispatchSnapshot(): TransferDispatchSnapshot | null {
  return lastTransferSnapshot
}

export async function dispatchTransferPayload(
  payload: TransferRequestPayload,
  options: { context?: TransferContext; mode?: StorageProviderMode } = {},
): Promise<BackgroundTransferDispatchResult> {
  const pipelineInstance = getBackgroundTransferPipeline(options.mode)
  const context = options.context ?? buildTransferContext(payload)
  const jobConfig: {
    siteProviderId?: string
  } = {}
  if (payload.meta?.siteProviderId) {
    jobConfig.siteProviderId = payload.meta.siteProviderId
  }
  const { result, storageProviderId } = await pipelineInstance.dispatchToStorage({
    context,
    payload,
    ...jobConfig,
  })
  if (result.success !== true) {
    throw new StorageDispatchError(result.message || '存储提供方未能完成转存', {
      storageResult: result,
      storageProviderId,
    })
  }
  const response = extractTransferResponse(result, payload)
  lastTransferSnapshot = {
    payload: cloneTransferPayload(payload),
    storageProviderId,
    timestamp: Date.now(),
  }
  return {
    response,
    storageResult: result,
    storageProviderId,
  }
}

function buildTransferContext(payload: TransferRequestPayload): TransferContext {
  const context: TransferContext = {}
  if (typeof payload.meta?.pageUrl === 'string') {
    context.url = payload.meta.pageUrl
  }
  const extras: Record<string, unknown> = {}
  if (payload.meta?.pageTitle) {
    extras['pageTitle'] = payload.meta.pageTitle
  }
  if (payload.meta?.siteProviderId) {
    extras['siteProviderId'] = payload.meta.siteProviderId
  }
  if (payload.meta?.siteProviderLabel) {
    extras['siteProviderLabel'] = payload.meta.siteProviderLabel
  }
  if (Object.keys(extras).length) {
    context.extras = extras
  }
  return context
}

function extractTransferResponse(
  storageResult: StorageTransferResult,
  payload: TransferRequestPayload,
): TransferResponsePayload {
  const metaRecord = (storageResult.meta ?? {}) as Record<string, unknown>
  const rawResponse = metaRecord['response'] as TransferResponsePayload | undefined
  if (rawResponse && Array.isArray(rawResponse.results)) {
    return rawResponse
  }
  const fallback: TransferResponsePayload = {
    results: [],
    summary: storageResult.message || '存储提供方未返回结果',
  }
  if (payload.jobId) {
    fallback.jobId = payload.jobId
  }
  return fallback
}

function cloneTransferPayload(payload: TransferRequestPayload): TransferRequestPayload {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }
  return JSON.parse(JSON.stringify(payload)) as TransferRequestPayload
}
