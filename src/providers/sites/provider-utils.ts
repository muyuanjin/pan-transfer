import type { SiteResourceItem, TransferContext } from '@/platform/registry'
import type { TransferRequestPayload } from '@/shared/types/transfer'

export interface BuildTransferPayloadOptions {
  resolvePageUrl?: (context: TransferContext, fallbackUrl: string) => string
}

export interface TransferSelectionInput {
  context: TransferContext
  selection: SiteResourceItem[]
}

export function buildTransferPayloadFromSelection(
  input: TransferSelectionInput,
  options: BuildTransferPayloadOptions = {},
): TransferRequestPayload {
  const fallbackUrl =
    typeof window !== 'undefined' && typeof window.location?.href === 'string'
      ? window.location.href
      : ''
  const resolvePageUrl = options.resolvePageUrl ?? defaultResolvePageUrl
  const pageUrl = resolvePageUrl(input.context, fallbackUrl)
  const items = input.selection.map((item) => {
    const payload: TransferRequestPayload['items'][number] = {
      id: item.id,
      title: item.title,
    }
    if (typeof item.linkUrl === 'string' && item.linkUrl.trim()) {
      payload.linkUrl = item.linkUrl
    }
    if (typeof item.passCode === 'string' && item.passCode.trim()) {
      payload.passCode = item.passCode
    }
    return payload
  })
  const extras = input.context.extras ?? {}
  const resolvedPageTitle =
    typeof extras['pageTitle'] === 'string' ? (extras['pageTitle'] as string) : undefined
  const resolvedOrigin =
    typeof extras['origin'] === 'string' ? (extras['origin'] as string) : undefined
  const meta: TransferRequestPayload['meta'] = {
    total: items.length,
  }
  if (pageUrl) {
    meta.pageUrl = pageUrl
  }
  if (resolvedPageTitle) {
    meta.pageTitle = resolvedPageTitle
  }
  const payload: TransferRequestPayload = {
    items,
    meta,
  }
  if (resolvedOrigin) {
    payload.origin = resolvedOrigin
  }
  return payload
}

function defaultResolvePageUrl(context: TransferContext, fallbackUrl: string): string {
  const candidate =
    (typeof context.url === 'string' && context.url.trim()) ||
    (typeof context.document?.URL === 'string' && context.document.URL) ||
    fallbackUrl
  return candidate || ''
}
