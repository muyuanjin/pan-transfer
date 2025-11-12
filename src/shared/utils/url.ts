const DEFAULT_BASE_URL = 'https://www.chaospace.cc/'

export interface CanonicalizePageUrlOptions {
  baseUrl?: string
  stripHash?: boolean
  stripSearch?: boolean
  allowFallback?: boolean
}

const resolveBaseUrl = (value?: string): string => {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  return DEFAULT_BASE_URL
}

export function canonicalizePageUrl(
  value: string | null | undefined,
  options: CanonicalizePageUrlOptions = {},
): string | null {
  const baseUrl = resolveBaseUrl(options.baseUrl)
  const hasValue = typeof value === 'string' && value.trim().length > 0
  if (!hasValue && !options.allowFallback) {
    return null
  }
  const target = hasValue ? value!.trim() : baseUrl
  try {
    const normalized = new URL(target, baseUrl)
    if (options.stripHash !== false) {
      normalized.hash = ''
    }
    if (options.stripSearch !== false) {
      normalized.search = ''
    }
    return normalized.toString()
  } catch {
    if (options.allowFallback) {
      try {
        const fallback = new URL(baseUrl)
        if (options.stripHash !== false) {
          fallback.hash = ''
        }
        if (options.stripSearch !== false) {
          fallback.search = ''
        }
        return fallback.toString()
      } catch {
        return DEFAULT_BASE_URL
      }
    }
    return null
  }
}

export function getDefaultChaospaceBaseUrl(): string {
  return DEFAULT_BASE_URL
}
