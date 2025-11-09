import type {
  StorageProvider,
  StorageProviderReadiness,
  StorageTransferRequest,
  StorageTransferResult,
} from '@/platform/registry'
import type { TransferResponsePayload } from '@/shared/types/transfer'

export const MOCK_STORAGE_PROVIDER_ID = 'mock-storage'

export interface MockStorageProviderOptions {
  id?: string
  displayName?: string
  latencyMs?: number
  onTransfer?: (request: StorageTransferRequest) => void | Promise<void>
  readiness?: StorageProviderReadiness
}

export function createMockStorageProvider(
  options: MockStorageProviderOptions = {},
): StorageProvider {
  const metadataId = options.id ?? MOCK_STORAGE_PROVIDER_ID
  const latencyMs = Math.max(0, options.latencyMs ?? 0)

  return {
    kind: 'storage',
    id: metadataId,
    metadata: {
      id: metadataId,
      displayName: options.displayName ?? 'Mock Storage',
      description: 'Development-only storage provider for pipeline scaffolding',
      tags: ['mock', 'dev-only'],
      priority: -10,
    },
    capabilities: [
      {
        id: 'mock-transfer',
        description: 'Echoes transfer requests without touching remote APIs',
        stage: 'alpha',
        experimental: true,
      },
    ],
    async checkReadiness(): Promise<StorageProviderReadiness> {
      return options.readiness ?? { ready: true }
    },
    async dispatchTransfer(request: StorageTransferRequest): Promise<StorageTransferResult> {
      if (typeof options.onTransfer === 'function') {
        await options.onTransfer(request)
      }
      if (latencyMs > 0) {
        await delay(latencyMs)
      }
      const response: TransferResponsePayload = {
        results: [],
        summary: 'Mock transfer completed',
      }
      if (request.payload.jobId) {
        response.jobId = request.payload.jobId
      }
      return {
        success: true,
        message: 'Mock transfer completed',
        meta: {
          echoedItems: request.payload.items.length,
          response,
        },
      }
    },
  }
}

const delay = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
