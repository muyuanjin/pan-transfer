import { createScopedLogger } from '@/shared/log'
import type { ProviderRegistry } from '@/platform/registry/provider-registry'
import type {
  SiteProvider,
  StorageProvider,
  StorageTransferRequest,
  StorageTransferResult,
  TransferContext,
} from '@/platform/registry/types'
import type { TransferRequestPayload } from '@/shared/types/transfer'
import { InMemoryTaskQueue, type TaskHandle, type TaskQueue } from '../tasks/task-queue'

export interface TransferPipelineJob {
  id?: string
  context: TransferContext
  siteProviderId?: string
  storageProviderId?: string
  payload?: TransferRequestPayload
}

export type TransferPipelineJobResult =
  | {
      status: 'no-site-provider'
      context: TransferContext
    }
  | {
      status: 'noop'
      siteProviderId: string
      storageProviderId?: string
      context: TransferContext
    }

export interface TransferPipelineOptions {
  registry: ProviderRegistry
  taskQueue?: TaskQueue
}

export interface StorageDispatchResult {
  storageProviderId: string
  result: StorageTransferResult
}

export class TransferPipeline {
  private readonly registry: ProviderRegistry

  private readonly queue: TaskQueue

  private readonly logger = createScopedLogger('TransferPipeline')

  private sequence = 0

  constructor(options: TransferPipelineOptions) {
    this.registry = options.registry
    this.queue = options.taskQueue ?? new InMemoryTaskQueue()
  }

  enqueue(job: TransferPipelineJob): TaskHandle<TransferPipelineJobResult> {
    const jobId = job.id ?? this.nextJobId()
    return this.queue.enqueue({
      id: jobId,
      name: 'transfer-pipeline',
      run: () => this.processJob({ ...job, id: jobId }),
    })
  }

  async detectSiteProvider(context: TransferContext): Promise<SiteProvider | null> {
    const providers = this.registry.listSiteProviders()
    for (const provider of providers) {
      let matched = false
      try {
        matched = await provider.detect(context)
      } catch (error) {
        const err = error as Error
        this.logger.warn('[Pan Transfer] Site provider detection failed', {
          providerId: provider.id,
          message: err?.message,
        })
        continue
      }
      if (matched) {
        return provider
      }
    }
    return null
  }

  async dispatchToStorage(
    job: TransferPipelineJob & { payload: TransferRequestPayload },
  ): Promise<StorageDispatchResult> {
    const storageProvider = this.resolveStorageProvider(job)
    if (!storageProvider) {
      throw new Error('No storage provider is registered')
    }
    const readiness = await storageProvider.checkReadiness(job.context)
    if (!readiness.ready) {
      throw new Error(readiness.reason || 'Storage provider is unavailable')
    }
    const request: StorageTransferRequest = {
      context: job.context,
      payload: job.payload,
    }
    const result = await storageProvider.dispatchTransfer(request)
    return {
      storageProviderId: storageProvider.id,
      result,
    }
  }

  private async processJob(
    job: TransferPipelineJob & { id: string },
  ): Promise<TransferPipelineJobResult> {
    const siteProvider = await this.resolveSiteProvider(job)
    if (!siteProvider) {
      this.logger.debug('[Pan Transfer] No site provider resolved for job', {
        jobId: job.id,
        url: job.context.url,
      })
      return {
        status: 'no-site-provider',
        context: job.context,
      }
    }
    const storageProvider = this.resolveStorageProvider(job)
    this.logger.debug('[Pan Transfer] Transfer pipeline resolved providers', {
      jobId: job.id,
      siteProviderId: siteProvider.id,
      storageProviderId: storageProvider?.id,
    })

    // Future phases will orchestrate transfers here. For now we return a noop snapshot.
    const result: TransferPipelineJobResult = storageProvider
      ? {
          status: 'noop',
          siteProviderId: siteProvider.id,
          storageProviderId: storageProvider.id,
          context: job.context,
        }
      : {
          status: 'noop',
          siteProviderId: siteProvider.id,
          context: job.context,
        }
    return result
  }

  private async resolveSiteProvider(job: TransferPipelineJob): Promise<SiteProvider | null> {
    if (job.siteProviderId) {
      const provider = this.registry.getSiteProvider(job.siteProviderId)
      if (!provider) {
        this.logger.warn('[Pan Transfer] Requested site provider not found', {
          jobId: job.id,
          siteProviderId: job.siteProviderId,
        })
        return null
      }
      return provider
    }
    return this.detectSiteProvider(job.context)
  }

  private resolveStorageProvider(job: TransferPipelineJob): StorageProvider | null {
    if (job.storageProviderId) {
      const provider = this.registry.getStorageProvider(job.storageProviderId)
      if (!provider) {
        this.logger.warn('[Pan Transfer] Requested storage provider not found', {
          jobId: job.id,
          storageProviderId: job.storageProviderId,
        })
      }
      return provider
    }
    const [first] = this.registry.listStorageProviders()
    return first ?? null
  }

  private nextJobId(): string {
    this.sequence += 1
    return `transfer-pipeline-job-${this.sequence}`
  }
}
