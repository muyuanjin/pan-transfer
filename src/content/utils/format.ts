export function formatOriginLabel(
  origin: string | URL | null | undefined,
  baseHref: string | null | undefined = window.location?.href,
): string {
  if (!origin) {
    return ''
  }
  try {
    const url = new URL(origin, baseHref || undefined)
    return url.hostname.replace(/^www\./, '')
  } catch (_error) {
    return typeof origin === 'string' ? origin : ''
  }
}

export function sanitizeCssUrl(url: string | null | undefined): string {
  if (!url) {
    return ''
  }
  return url.replace(/["\n\r]/g, '').trim()
}
