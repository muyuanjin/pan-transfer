export function formatOriginLabel(origin, baseHref = window.location?.href) {
  if (!origin) {
    return '';
  }
  try {
    const url = new URL(origin, baseHref || undefined);
    return url.hostname.replace(/^www\./, '');
  } catch (_error) {
    return origin;
  }
}

export function sanitizeCssUrl(url) {
  if (!url) {
    return '';
  }
  return url.replace(/["\n\r]/g, '').trim();
}
