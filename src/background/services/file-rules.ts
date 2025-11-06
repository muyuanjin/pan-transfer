import { STORAGE_KEYS } from '../common/constants'
import { storageGet } from '../storage/utils'
import type { ShareFileEntry } from '../api/baidu-pan'
import type { FileCategory } from '@/shared/settings'
import {
  DEFAULT_FILE_FILTER_MODE,
  normalizeFileFilterMode,
  normalizeFileFilterRules,
  normalizeFileRenameRules,
  type FileFilterAction,
  type FileFilterCondition,
  type FileFilterEvaluationMode,
  type FileFilterRule,
  type FileRenameRule,
} from '@/shared/settings'

export interface ProcessingSettings {
  mode: FileFilterEvaluationMode
  filterRules: FileFilterRule[]
  renameRules: FileRenameRule[]
}

export interface FilterSkipInfo {
  fsId: number
  name: string
  ruleName?: string
  action: FileFilterAction
}

export interface FileFilterResult {
  entries: ShareFileEntry[]
  skipped: FilterSkipInfo[]
}

export interface RenamePlanEntry {
  fsId: number
  originalName: string
  finalName: string
  isDir: boolean
  changed: boolean
}

const ARCHIVE_EXTS = new Set([
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'iso',
  'tgz',
  'tbz',
  'lz',
  'cab',
])

const AUDIO_EXTS = new Set([
  'mp3',
  'aac',
  'flac',
  'wav',
  'm4a',
  'ogg',
  'oga',
  'opus',
  'wma',
  'alac',
])

const VIDEO_EXTS = new Set([
  'mp4',
  'mkv',
  'mov',
  'avi',
  'ts',
  'flv',
  'wmv',
  'mpg',
  'mpeg',
  'm4v',
  'webm',
  'rm',
  'rmvb',
  '3gp',
])

const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'tiff',
  'heic',
  'heif',
])

const DOCUMENT_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'txt',
  'rtf',
  'md',
  'epub',
  'pages',
  'numbers',
  'key',
])

const SUBTITLE_EXTS = new Set(['srt', 'ass', 'ssa', 'vtt', 'sub'])

interface FileContext {
  name: string
  baseName: string
  extension: string
  size: number
  isDir: boolean
  categories: Set<FileCategory>
}

const conditionRegexCache = new Map<string, RegExp>()
const renameRegexCache = new Map<string, RegExp>()

function parseSize(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return 0
}

function splitName(name: string): { base: string; extension: string } {
  if (!name) {
    return { base: '', extension: '' }
  }
  const trimmed = name.trim()
  const lastDot = trimmed.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return { base: trimmed, extension: '' }
  }
  const base = trimmed.slice(0, lastDot)
  const extension = trimmed.slice(lastDot + 1)
  return { base, extension }
}

function buildContext(entry: ShareFileEntry): FileContext {
  const name = typeof entry.serverFilename === 'string' ? entry.serverFilename : ''
  const { base, extension } = splitName(name)
  const extLower = extension.toLowerCase()
  const categories = new Set<FileCategory>()
  if (ARCHIVE_EXTS.has(extLower)) {
    categories.add('archive')
  }
  if (AUDIO_EXTS.has(extLower)) {
    categories.add('audio')
    categories.add('media')
  }
  if (VIDEO_EXTS.has(extLower)) {
    categories.add('video')
    categories.add('media')
  }
  if (IMAGE_EXTS.has(extLower)) {
    categories.add('image')
  }
  if (DOCUMENT_EXTS.has(extLower)) {
    categories.add('document')
  }
  if (SUBTITLE_EXTS.has(extLower)) {
    categories.add('subtitle')
  }
  if (!categories.size) {
    categories.add('other')
  }
  const size = parseSize(entry.size)
  const isDir = Boolean(entry.isDir)
  return {
    name,
    baseName: base,
    extension,
    size,
    isDir,
    categories,
  }
}

function getRegex(pattern: string, flags: string, cache: Map<string, RegExp>): RegExp | null {
  const key = `${pattern}__${flags}`
  const cached = cache.get(key)
  if (cached) {
    return cached
  }
  try {
    const regex = new RegExp(pattern, flags)
    cache.set(key, regex)
    return regex
  } catch (_error) {
    return null
  }
}

function evaluateCondition(context: FileContext, condition: FileFilterCondition): boolean {
  switch (condition.type) {
    case 'size': {
      const target = context.size
      const value = condition.value
      let match = false
      switch (condition.operator) {
        case 'eq':
          match = target === value
          break
        case 'lt':
          match = target < value
          break
        case 'lte':
          match = target <= value
          break
        case 'gt':
          match = target > value
          break
        case 'gte':
          match = target >= value
          break
        default:
          match = false
      }
      return condition.negate ? !match : match
    }
    case 'name': {
      const source = condition.caseSensitive ? context.name : context.name.toLowerCase()
      const value = condition.caseSensitive ? condition.value : condition.value.toLowerCase()
      let match = false
      if (condition.mode === 'includes') {
        match = value.length === 0 ? false : source.includes(value)
      } else if (condition.mode === 'startsWith') {
        match = value.length === 0 ? false : source.startsWith(value)
      } else if (condition.mode === 'endsWith') {
        match = value.length === 0 ? false : source.endsWith(value)
      }
      return condition.negate ? !match : match
    }
    case 'regex': {
      const regex = getRegex(condition.pattern, condition.flags, conditionRegexCache)
      if (!regex) {
        return false
      }
      const match = regex.test(context.name)
      regex.lastIndex = 0
      return condition.negate ? !match : match
    }
    case 'extension': {
      const ext = context.extension.toLowerCase()
      const values = condition.values
      const inSet = values.includes(ext)
      const match = condition.operator === 'not-in' ? !inSet : inSet
      return condition.negate ? !match : match
    }
    case 'category': {
      const categories = condition.values
      const hasCategory = categories.some((category) => context.categories.has(category))
      const match = condition.operator === 'not-in' ? !hasCategory : hasCategory
      return condition.negate ? !match : match
    }
    case 'isDir': {
      const match = context.isDir === condition.value
      return condition.negate ? !match : match
    }
    default:
      return false
  }
}

function ruleMatches(context: FileContext, rule: FileFilterRule): boolean {
  if (!rule || !rule.enabled || !Array.isArray(rule.conditions) || !rule.conditions.length) {
    return false
  }
  if (rule.logic === 'any') {
    return rule.conditions.some((condition) => evaluateCondition(context, condition))
  }
  return rule.conditions.every((condition) => evaluateCondition(context, condition))
}

function decideAction(
  context: FileContext,
  rules: FileFilterRule[],
  mode: FileFilterEvaluationMode,
): { action: FileFilterAction | null; rule?: FileFilterRule } {
  if (!rules.length) {
    return { action: null }
  }

  if (mode === 'ordered') {
    for (const rule of rules) {
      if (!rule || !rule.enabled) {
        continue
      }
      if (!ruleMatches(context, rule)) {
        continue
      }
      return { action: rule.action, rule }
    }
    return { action: null }
  }

  if (mode === 'deny-first') {
    let includeRule: FileFilterRule | undefined
    for (const rule of rules) {
      if (!rule || !rule.enabled) {
        continue
      }
      if (!ruleMatches(context, rule)) {
        continue
      }
      if (rule.action === 'exclude') {
        return { action: 'exclude', rule }
      }
      if (!includeRule) {
        includeRule = rule
      }
    }
    if (includeRule) {
      return { action: 'include', rule: includeRule }
    }
    return { action: null }
  }

  let excludeRule: FileFilterRule | undefined
  for (const rule of rules) {
    if (!rule || !rule.enabled) {
      continue
    }
    if (!ruleMatches(context, rule)) {
      continue
    }
    if (rule.action === 'include') {
      return { action: 'include', rule }
    }
    if (!excludeRule) {
      excludeRule = rule
    }
  }
  if (excludeRule) {
    return { action: 'exclude', rule: excludeRule }
  }
  return { action: null }
}

export async function loadProcessingSettings(): Promise<ProcessingSettings> {
  try {
    const stored = await storageGet<{ [STORAGE_KEYS.settings]?: Record<string, unknown> }>(
      STORAGE_KEYS.settings,
    )
    const raw = (stored?.[STORAGE_KEYS.settings] as Record<string, unknown>) || {}
    const mode = normalizeFileFilterMode(raw['fileFilterMode'] ?? DEFAULT_FILE_FILTER_MODE)
    const filterRules = normalizeFileFilterRules(raw['fileFilters'])
    const renameRules = normalizeFileRenameRules(raw['fileRenameRules'])
    return {
      mode,
      filterRules,
      renameRules,
    }
  } catch (_error) {
    return {
      mode: DEFAULT_FILE_FILTER_MODE,
      filterRules: [],
      renameRules: [],
    }
  }
}

export function applyFileFilters(
  entries: ShareFileEntry[],
  rules: FileFilterRule[],
  mode: FileFilterEvaluationMode,
): FileFilterResult {
  if (!Array.isArray(entries) || !entries.length || !rules.length) {
    return {
      entries: Array.isArray(entries) ? entries.slice() : [],
      skipped: [],
    }
  }
  const filtered: ShareFileEntry[] = []
  const skipped: FilterSkipInfo[] = []
  entries.forEach((entry) => {
    if (!entry || typeof entry.serverFilename !== 'string') {
      return
    }
    const context = buildContext(entry)
    const decision = decideAction(context, rules, mode)
    if (decision.action === 'exclude') {
      const record: FilterSkipInfo = {
        fsId: entry.fsId,
        name: context.name,
        action: 'exclude',
      }
      if (decision.rule?.name) {
        record.ruleName = decision.rule.name
      }
      skipped.push(record)
      return
    }
    if (decision.action === 'include' || decision.action === null) {
      filtered.push(entry)
      return
    }
    filtered.push(entry)
  })
  return { entries: filtered, skipped }
}

export function buildRenamePlan(
  entries: ShareFileEntry[],
  renameRules: FileRenameRule[],
  existingNames?: Set<string>,
): RenamePlanEntry[] {
  if (!Array.isArray(entries) || !entries.length) {
    return []
  }
  if (!Array.isArray(renameRules) || !renameRules.some((rule) => rule && rule.enabled)) {
    return entries.map((entry) => ({
      fsId: entry.fsId,
      originalName: entry.serverFilename,
      finalName: entry.serverFilename,
      isDir: Boolean(entry.isDir),
      changed: false,
    }))
  }

  const usedNames = new Set<string>()
  if (existingNames) {
    existingNames.forEach((value) => {
      if (typeof value === 'string' && value) {
        usedNames.add(value.toLowerCase())
      }
    })
  }
  const nameCounters = new Map<string, number>()

  return entries.map((entry) => {
    const name = entry.serverFilename
    const { base, extension } = splitName(name)
    let nextBase = base
    renameRules.forEach((rule) => {
      if (!rule || !rule.enabled) {
        return
      }
      const pattern = rule.pattern
      if (!pattern) {
        return
      }
      const regex = getRegex(pattern, rule.flags || 'g', renameRegexCache)
      if (!regex) {
        return
      }
      const replacement = typeof rule.replacement === 'string' ? rule.replacement : ''
      nextBase = nextBase.replace(regex, replacement)
      regex.lastIndex = 0
    })
    let sanitizedBase = nextBase.trim()
    if (!sanitizedBase) {
      sanitizedBase = base
    }
    const extSuffix = extension ? `.${extension}` : ''
    const lowerKey = sanitizedBase.toLowerCase()
    let counter = nameCounters.get(lowerKey) ?? 0

    let finalName = `${sanitizedBase}${extSuffix}`
    let finalLower = finalName.toLowerCase()
    while (usedNames.has(finalLower)) {
      counter += 1
      const candidateBase = `${sanitizedBase} (${counter})`
      finalName = `${candidateBase}${extSuffix}`
      finalLower = finalName.toLowerCase()
    }
    nameCounters.set(lowerKey, counter)
    usedNames.add(finalLower)

    return {
      fsId: entry.fsId,
      originalName: name,
      finalName,
      isDir: Boolean(entry.isDir),
      changed: finalName !== name,
    }
  })
}
