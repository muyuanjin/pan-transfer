export type FileFilterAction = 'exclude' | 'include'
export type FileFilterLogic = 'all' | 'any'
export type FileFilterEvaluationMode = 'ordered' | 'deny-first' | 'allow-first'

export type FileCategory =
  | 'archive'
  | 'audio'
  | 'video'
  | 'image'
  | 'document'
  | 'subtitle'
  | 'media'
  | 'other'

export interface FileFilterSizeCondition {
  type: 'size'
  operator: 'eq' | 'lt' | 'lte' | 'gt' | 'gte'
  value: number
  negate?: boolean
}

export interface FileFilterNameCondition {
  type: 'name'
  mode: 'includes' | 'startsWith' | 'endsWith'
  value: string
  caseSensitive: boolean
  negate?: boolean
}

export interface FileFilterRegexCondition {
  type: 'regex'
  pattern: string
  flags: string
  negate?: boolean
}

export interface FileFilterExtensionCondition {
  type: 'extension'
  operator: 'in' | 'not-in'
  values: string[]
  negate?: boolean
}

export interface FileFilterCategoryCondition {
  type: 'category'
  operator: 'in' | 'not-in'
  values: FileCategory[]
  negate?: boolean
}

export interface FileFilterDirectoryCondition {
  type: 'isDir'
  value: boolean
  negate?: boolean
}

export type FileFilterCondition =
  | FileFilterSizeCondition
  | FileFilterNameCondition
  | FileFilterRegexCondition
  | FileFilterExtensionCondition
  | FileFilterCategoryCondition
  | FileFilterDirectoryCondition

export interface FileFilterRule {
  name?: string
  description?: string
  action: FileFilterAction
  logic: FileFilterLogic
  enabled: boolean
  conditions: FileFilterCondition[]
}

export interface FileRenameRule {
  name?: string
  description?: string
  pattern: string
  flags: string
  replacement: string
  enabled: boolean
}

export interface TransferProcessingSettings {
  filterMode: FileFilterEvaluationMode
  filterRules: FileFilterRule[]
  renameRules: FileRenameRule[]
}

export const DEFAULT_FILE_FILTER_MODE: FileFilterEvaluationMode = 'deny-first'

const VALID_REGEX_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y'])

const SIZE_UNIT_MAP: Record<string, number> = {
  b: 1,
  kb: 1024,
  k: 1024,
  kib: 1024,
  mb: 1024 * 1024,
  m: 1024 * 1024,
  mib: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  g: 1024 * 1024 * 1024,
  gib: 1024 * 1024 * 1024,
}

const NAME_MODES = new Set<FileFilterNameCondition['mode']>(['includes', 'startsWith', 'endsWith'])

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === 'true') {
      return true
    }
    if (trimmed === 'false') {
      return false
    }
  }
  return undefined
}

function parseNegate(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    return trimmed === 'true' || trimmed === '1' || trimmed === 'yes' || trimmed === 'y'
  }
  return false
}

export function parseSizeInput(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value)
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const match = /^(-?\d+(?:\.\d+)?)([a-zA-Z]{0,4})$/.exec(trimmed.replace(/\s+/g, '').toLowerCase())
  if (!match) {
    return null
  }
  const numericValue = match[1]
  if (!numericValue) {
    return null
  }
  const unitRaw = match[2]
  const parsed = Number.parseFloat(numericValue)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }
  if (!unitRaw) {
    return Math.round(parsed)
  }
  const multiplier = SIZE_UNIT_MAP[unitRaw]
  if (!multiplier) {
    return null
  }
  return Math.round(parsed * multiplier)
}

function sanitizeRegexFlags(value: unknown, fallback = 'g'): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const unique = new Set<string>()
  for (const char of value) {
    if (VALID_REGEX_FLAGS.has(char)) {
      unique.add(char)
    }
  }
  if (!unique.size) {
    return fallback
  }
  return Array.from(unique).join('')
}

function sanitizeExtensions(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }
  const values = input
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item.slice(1) : item))
  return Array.from(new Set(values))
}

function sanitizeCategories(input: unknown): FileCategory[] {
  if (!Array.isArray(input)) {
    return []
  }
  const allowed: FileCategory[] = [
    'archive',
    'audio',
    'video',
    'image',
    'document',
    'subtitle',
    'media',
    'other',
  ]
  const normalized = input
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean) as string[]
  const unique = new Set<FileCategory>()
  normalized.forEach((value) => {
    const match = allowed.find((category) => category === value) as FileCategory | undefined
    if (match) {
      unique.add(match)
    }
  })
  return Array.from(unique)
}

function normalizeCondition(raw: unknown): FileFilterCondition | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  const typeValue =
    typeof record['type'] === 'string'
      ? (record['type'] as string)
      : (record['kind'] as string | undefined)
  if (!typeValue) {
    return null
  }
  const lowerType = typeValue.trim().toLowerCase()
  const negated =
    parseNegate(record['negate']) ||
    parseNegate(record['not']) ||
    parseNegate(record['invert']) ||
    false

  switch (lowerType) {
    case 'size': {
      const operatorRaw =
        typeof record['operator'] === 'string'
          ? (record['operator'] as string)
          : (record['op'] as string | undefined)
      const operator = operatorRaw ? operatorRaw.trim().toLowerCase() : 'eq'
      if (!['eq', 'lt', 'lte', 'gt', 'gte'].includes(operator)) {
        return null
      }
      const parsed = parseSizeInput(record['value'] ?? record['size'] ?? record['bytes'])
      if (parsed === null) {
        return null
      }
      const condition: FileFilterSizeCondition = {
        type: 'size',
        operator: operator as FileFilterSizeCondition['operator'],
        value: parsed,
      }
      if (negated) {
        condition.negate = true
      }
      return condition
    }
    case 'name': {
      const value =
        typeof record['value'] === 'string'
          ? (record['value'] as string)
          : (record['contains'] as string | undefined)
      if (!value || !value.trim()) {
        return null
      }
      const modeRaw =
        (typeof record['mode'] === 'string' && (record['mode'] as string)) ||
        (typeof record['match'] === 'string' && (record['match'] as string)) ||
        'includes'
      const mode = modeRaw.trim().toLowerCase() as FileFilterNameCondition['mode']
      if (!NAME_MODES.has(mode)) {
        return null
      }
      const caseSensitive =
        parseBoolean(record['caseSensitive'] ?? record['case_sensitive']) ?? false
      const condition: FileFilterNameCondition = {
        type: 'name',
        mode,
        value: value.trim(),
        caseSensitive,
      }
      if (negated) {
        condition.negate = true
      }
      return condition
    }
    case 'regex':
    case 'regexp':
    case 'pattern': {
      const pattern =
        (typeof record['pattern'] === 'string' && (record['pattern'] as string)) ||
        (typeof record['regex'] === 'string' && (record['regex'] as string)) ||
        ''
      if (!pattern) {
        return null
      }
      const flags = sanitizeRegexFlags(record['flags'], 'g')
      const condition: FileFilterRegexCondition = {
        type: 'regex',
        pattern,
        flags,
      }
      if (negated) {
        condition.negate = true
      }
      return condition
    }
    case 'extension':
    case 'ext': {
      const values = sanitizeExtensions(record['values'] ?? record['ext'] ?? record['extensions'])
      if (!values.length) {
        return null
      }
      const operatorRaw =
        (typeof record['operator'] === 'string' && (record['operator'] as string)) ||
        (typeof record['op'] === 'string' && (record['op'] as string)) ||
        'in'
      const operator = operatorRaw.trim().toLowerCase()
      if (operator !== 'in' && operator !== 'not-in') {
        return null
      }
      const condition: FileFilterExtensionCondition = {
        type: 'extension',
        operator: operator as FileFilterExtensionCondition['operator'],
        values,
      }
      if (negated) {
        condition.negate = true
      }
      return condition
    }
    case 'category':
    case 'type': {
      const values = sanitizeCategories(
        record['values'] ?? record['categories'] ?? record['category'],
      )
      if (!values.length) {
        return null
      }
      const operatorRaw =
        (typeof record['operator'] === 'string' && (record['operator'] as string)) ||
        (typeof record['op'] === 'string' && (record['op'] as string)) ||
        'in'
      const operator = operatorRaw.trim().toLowerCase()
      if (operator !== 'in' && operator !== 'not-in') {
        return null
      }
      const condition: FileFilterCategoryCondition = {
        type: 'category',
        operator: operator as FileFilterCategoryCondition['operator'],
        values,
      }
      if (negated) {
        condition.negate = true
      }
      return condition
    }
    case 'isdir':
    case 'directory':
    case 'folder': {
      const value = parseBoolean(record['value'] ?? record['isDir'] ?? record['directory'])
      if (typeof value !== 'boolean') {
        return null
      }
      const condition: FileFilterDirectoryCondition = {
        type: 'isDir',
        value,
      }
      if (negated) {
        condition.negate = true
      }
      return condition
    }
    default:
      return null
  }
}

export function normalizeFileFilterRules(input: unknown): FileFilterRule[] {
  if (!Array.isArray(input)) {
    return []
  }
  const result: FileFilterRule[] = []
  input.forEach((raw) => {
    if (!raw || typeof raw !== 'object') {
      return
    }
    const record = raw as Record<string, unknown>
    const enabled = record['enabled'] !== false
    const action = record['action'] === 'include' ? 'include' : 'exclude'
    const logicRaw =
      (typeof record['logic'] === 'string' && (record['logic'] as string)) ||
      (typeof record['operator'] === 'string' && (record['operator'] as string)) ||
      'all'
    const logicValue = logicRaw.trim().toLowerCase()
    const logic: FileFilterLogic = logicValue === 'any' || logicValue === 'or' ? 'any' : 'all'
    const conditionsInput = Array.isArray(record['conditions'])
      ? (record['conditions'] as unknown[])
      : Array.isArray(record['rules'])
        ? (record['rules'] as unknown[])
        : []
    const conditions: FileFilterCondition[] = []
    conditionsInput.forEach((conditionRaw) => {
      const condition = normalizeCondition(conditionRaw)
      if (condition) {
        conditions.push(condition)
      }
    })
    if (!conditions.length) {
      return
    }
    const rule: FileFilterRule = {
      action,
      logic,
      enabled,
      conditions,
    }
    if (typeof record['name'] === 'string' && record['name'].trim()) {
      rule.name = record['name'].trim()
    }
    if (typeof record['description'] === 'string' && record['description'].trim()) {
      rule.description = record['description'].trim()
    }
    result.push(rule)
  })
  return result
}

export function normalizeFileRenameRules(input: unknown): FileRenameRule[] {
  if (!Array.isArray(input)) {
    return []
  }
  const result: FileRenameRule[] = []
  input.forEach((raw) => {
    if (!raw || typeof raw !== 'object') {
      return
    }
    const record = raw as Record<string, unknown>
    const enabled = record['enabled'] !== false
    const pattern =
      (typeof record['pattern'] === 'string' && (record['pattern'] as string)) ||
      (typeof record['regex'] === 'string' && (record['regex'] as string)) ||
      ''
    if (!pattern) {
      return
    }
    const replacement =
      (typeof record['replacement'] === 'string' && (record['replacement'] as string)) ||
      (typeof record['replace'] === 'string' && (record['replace'] as string)) ||
      ''
    const flags = sanitizeRegexFlags(record['flags'], 'g')
    const rule: FileRenameRule = {
      pattern,
      flags,
      replacement,
      enabled,
    }
    if (typeof record['name'] === 'string' && record['name'].trim()) {
      rule.name = record['name'].trim()
    } else if (typeof record['label'] === 'string' && record['label'].trim()) {
      rule.name = record['label'].trim()
    }
    if (typeof record['description'] === 'string' && record['description'].trim()) {
      rule.description = record['description'].trim()
    }
    result.push(rule)
  })
  return result
}

export function normalizeFileFilterMode(value: unknown): FileFilterEvaluationMode {
  if (typeof value !== 'string') {
    return DEFAULT_FILE_FILTER_MODE
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ordered' || normalized === '按顺序优先') {
    return 'ordered'
  }
  if (normalized === 'allow-first' || normalized === 'accept-first' || normalized === '接受优先') {
    return 'allow-first'
  }
  if (normalized === 'deny-first' || normalized === 'reject-first' || normalized === '否决优先') {
    return 'deny-first'
  }
  return DEFAULT_FILE_FILTER_MODE
}

export function serializeFileFilterRules(rules: FileFilterRule[]): FileFilterRule[] {
  return rules.map((rule) => ({
    ...rule,
    conditions: rule.conditions.map((condition) => ({ ...condition })),
  })) as FileFilterRule[]
}

export function serializeFileRenameRules(rules: FileRenameRule[]): FileRenameRule[] {
  return rules.map((rule) => ({
    ...rule,
  })) as FileRenameRule[]
}
