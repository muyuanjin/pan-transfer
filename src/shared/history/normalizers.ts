import type {
  HistoryPendingTransfer,
  TransferItemPayload,
  TransferJobMeta,
  TransferRequestPayload,
} from '@/shared/types/transfer'

interface PendingTransferLike {
  jobId?: unknown
  detectedAt?: unknown
  summary?: unknown
  newItemIds?: unknown
  payload?: unknown
}

interface PendingTransferPayloadLike {
  jobId?: unknown
  origin?: unknown
  targetDirectory?: unknown
  meta?: unknown
  items?: unknown
}

export function normalizePendingTransferItems(value: unknown): TransferItemPayload[] {
  let source: unknown[] = []
  if (Array.isArray(value)) {
    source = value
  } else if (value && typeof value === 'object') {
    source = Object.values(value as Record<string, unknown>)
  }
  return source
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const raw = entry as { [key: string]: unknown }
      const id = raw['id']
      if (typeof id !== 'string' && typeof id !== 'number') {
        return null
      }
      const normalized: TransferItemPayload = {
        id,
        title: typeof raw['title'] === 'string' ? (raw['title'] as string) : '',
      }
      if (typeof raw['targetPath'] === 'string' && raw['targetPath']) {
        normalized.targetPath = raw['targetPath'] as string
      }
      if (typeof raw['linkUrl'] === 'string' && raw['linkUrl']) {
        normalized.linkUrl = raw['linkUrl'] as string
      }
      if (typeof raw['passCode'] === 'string' && raw['passCode']) {
        normalized.passCode = raw['passCode'] as string
      }
      return normalized
    })
    .filter((entry): entry is TransferItemPayload => Boolean(entry))
}

function cloneTransferJobMeta(value: unknown): TransferJobMeta | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return { ...(value as TransferJobMeta) }
}

export function normalizePendingTransferPayload(
  payload: unknown,
  fallbackJobId: string,
): TransferRequestPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const raw = payload as PendingTransferPayloadLike
  const items = normalizePendingTransferItems(raw.items)
  if (!items.length) {
    return null
  }
  const normalized: TransferRequestPayload = {
    jobId: typeof raw.jobId === 'string' && raw.jobId ? raw.jobId : fallbackJobId,
    items,
  }
  if (typeof raw.origin === 'string' && raw.origin) {
    normalized.origin = raw.origin
  }
  if (typeof raw.targetDirectory === 'string' && raw.targetDirectory) {
    normalized.targetDirectory = raw.targetDirectory
  }
  const meta = cloneTransferJobMeta(raw.meta)
  if (meta) {
    normalized.meta = meta
  }
  return normalized
}

export function normalizePendingTransfer(value: unknown): HistoryPendingTransfer | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as PendingTransferLike
  const jobId = typeof raw.jobId === 'string' && raw.jobId ? raw.jobId : ''
  const detectedAt = Number.isFinite(raw.detectedAt as number) ? Number(raw.detectedAt) : 0
  if (!jobId || detectedAt <= 0) {
    return null
  }
  const payload = normalizePendingTransferPayload(raw.payload, jobId)
  if (!payload) {
    return null
  }
  const summary = typeof raw.summary === 'string' ? raw.summary : ''
  const newItemIds = Array.isArray(raw.newItemIds)
    ? raw.newItemIds.filter(
        (id): id is string | number => typeof id === 'string' || typeof id === 'number',
      )
    : []
  return {
    jobId,
    detectedAt,
    summary,
    newItemIds,
    payload,
  }
}
