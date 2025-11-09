import type { TransferRequestPayload } from '@/shared/types/transfer'

export type ProviderStage = 'alpha' | 'beta' | 'stable'

export interface ProviderCapability {
  id: string
  description?: string
  stage?: ProviderStage
  experimental?: boolean
}

interface BaseProviderMetadata {
  id: string
  displayName: string
  description?: string
  version?: string
  homepage?: string
  tags?: string[]
  priority?: number
}

export interface SiteProviderMetadata extends BaseProviderMetadata {
  supportedHosts?: string[]
  contentTypes?: string[]
}

export interface StorageProviderMetadata extends BaseProviderMetadata {
  regions?: string[]
  supportsOffline?: boolean
}

export interface TransferContext {
  url?: string
  tabId?: number
  frameId?: number
  document?: Document | null
  timestamp?: number
  locale?: string
  siteProviderId?: string
  storageProviderId?: string
  extras?: Record<string, unknown>
}

export type SiteDetectionContext = TransferContext

export interface SiteResourceItem {
  id: string
  title: string
  linkUrl?: string
  passCode?: string
  tags?: string[]
  meta?: Record<string, unknown>
}

export interface SiteResourceCollection {
  items: SiteResourceItem[]
  meta?: Record<string, unknown>
  issues?: string[]
}

export interface SiteTransferBuildInput {
  context: TransferContext
  selection: SiteResourceItem[]
}

export interface SiteProvider {
  kind: 'site'
  id: string
  metadata: SiteProviderMetadata
  capabilities?: ProviderCapability[]
  detect(context: SiteDetectionContext): Promise<boolean> | boolean
  collectResources(context: TransferContext): Promise<SiteResourceCollection>
  buildTransferPayload?(
    input: SiteTransferBuildInput,
  ): Promise<TransferRequestPayload> | TransferRequestPayload
  authAssist?(context: TransferContext): Promise<void> | void
}

export interface StorageQuotaSnapshot {
  total?: number
  used?: number
  unit?: 'bytes' | 'files'
  expiresAt?: number
}

export interface StorageProviderReadiness {
  ready: boolean
  reason?: string
  requiresUserAction?: boolean
}

export interface StorageTransferRequest {
  context: TransferContext
  payload: TransferRequestPayload
}

export interface StorageTransferResult {
  success: boolean
  message?: string
  errno?: number
  retryable?: boolean
  meta?: Record<string, unknown>
}

export interface StorageProvider {
  kind: 'storage'
  id: string
  metadata: StorageProviderMetadata
  capabilities?: ProviderCapability[]
  checkReadiness(context: TransferContext): Promise<StorageProviderReadiness>
  getQuota?(context: TransferContext): Promise<StorageQuotaSnapshot | null>
  dispatchTransfer(request: StorageTransferRequest): Promise<StorageTransferResult>
}

export interface ProviderRegistrySnapshot {
  siteProviders: ReadonlyArray<SiteProvider>
  storageProviders: ReadonlyArray<StorageProvider>
}

export interface ProviderRegistryEventMap {
  siteProvidersChanged: ReadonlyArray<SiteProvider>
  storageProvidersChanged: ReadonlyArray<StorageProvider>
}

export type ProviderRegistryEvent = keyof ProviderRegistryEventMap
