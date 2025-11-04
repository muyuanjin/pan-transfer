export function normalizePath(input: string | null | undefined): string {
  if (!input) {
    return '/'
  }
  let normalized = input.trim()
  normalized = normalized.replace(/\\/g, '/')
  normalized = normalized.replace(/\/+/g, '/')
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}
