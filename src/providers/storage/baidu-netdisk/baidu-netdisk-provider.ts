import { chaosLogger } from '@/shared/log'
import type {
  StorageProvider,
  StorageProviderReadiness,
  StorageTransferRequest,
  StorageTransferResult,
} from '@/platform/registry'
import { ensureBdstoken } from '@/background/api/baidu-pan'
import { handleTransfer } from '@/background/services/transfer-service'
import type { TransferResponsePayload } from '@/shared/types/transfer'

export const BAIDU_NETDISK_PROVIDER_ID = 'baidu-netdisk'

export interface BaiduNetdiskProviderOptions {
  displayName?: string
}

export function createBaiduNetdiskProvider(
  options: BaiduNetdiskProviderOptions = {},
): StorageProvider {
  return {
    kind: 'storage',
    id: BAIDU_NETDISK_PROVIDER_ID,
    metadata: {
      id: BAIDU_NETDISK_PROVIDER_ID,
      displayName: options.displayName ?? 'Baidu Netdisk',
      description: 'Default storage provider that encapsulates the existing Baidu flows',
      tags: ['baidu', 'netdisk'],
      priority: 50,
    },
    capabilities: [
      {
        id: 'share-transfer',
        description: 'Transfers Chaospace resources into Baidu Netdisk via share links',
      },
    ],
    async checkReadiness(): Promise<StorageProviderReadiness> {
      try {
        await ensureBdstoken()
        return { ready: true }
      } catch (error) {
        const err = error as Error
        return {
          ready: false,
          requiresUserAction: true,
          reason: err?.message || 'bdstoken unavailable',
        }
      }
    },
    async dispatchTransfer(request: StorageTransferRequest): Promise<StorageTransferResult> {
      try {
        const response = await handleTransfer(request.payload)
        return mapTransferResponse(response)
      } catch (error) {
        const err = error as Error
        chaosLogger.error('[Pan Transfer] Baidu provider transfer failed', {
          message: err?.message,
        })
        return {
          success: false,
          message: err?.message || '未知错误',
          retryable: true,
        }
      }
    },
  }
}

function mapTransferResponse(response: TransferResponsePayload): StorageTransferResult {
  const successCount = response.results.filter((item) => item.status === 'success').length
  const failedCount = response.results.filter((item) => item.status === 'failed').length
  const skippedCount = response.results.filter((item) => item.status === 'skipped').length
  return {
    success: failedCount === 0,
    message: response.summary,
    meta: {
      jobId: response.jobId,
      successCount,
      failedCount,
      skippedCount,
      results: response.results,
      response,
    },
  }
}
