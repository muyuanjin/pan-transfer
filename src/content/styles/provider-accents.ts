import { loadCss } from '../styles.loader'
import { isGenericForumEnabled } from '@/shared/dev-toggles'

import chaospaceAccentUrl from './providers/chaospace.css?url'
import genericForumAccentUrl from './providers/generic-forum.css?url'

const PROVIDER_CSS_MAP = new Map<string, string>([['chaospace', chaospaceAccentUrl]])

if (isGenericForumEnabled()) {
  PROVIDER_CSS_MAP.set('generic-forum', genericForumAccentUrl)
}

const loadCache = new Map<string, Promise<void>>()

function resolveAssetUrl(url: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(url.replace(/^\//, ''))
  }
  return url
}

export function ensureProviderAccentStyles(
  providerId: string | null,
  target: Document | ShadowRoot = document,
): Promise<void> | null {
  if (!providerId) {
    return null
  }
  const assetUrl = PROVIDER_CSS_MAP.get(providerId)
  if (!assetUrl) {
    return null
  }
  const resolvedUrl = resolveAssetUrl(assetUrl)
  let promise = loadCache.get(resolvedUrl)
  if (promise) {
    return promise
  }
  promise = loadCss(resolvedUrl, target).catch((error) => {
    loadCache.delete(resolvedUrl)
    throw error
  })
  loadCache.set(resolvedUrl, promise)
  return promise
}
