import { chaosLogger } from '@/shared/log'
import {
  DATA_EXPORT_VERSION,
  MAX_HISTORY_RATE_LIMIT_MS,
  MIN_HISTORY_RATE_LIMIT_MS,
} from '../../constants'

export type ImportScopeKey = 'settings' | 'history' | 'cache' | 'panel'

export type ImportScopeAvailability = Record<ImportScopeKey, boolean>

export interface BackupValidationIssue {
  code: string
  message: string
  path?: string
  scope?: ImportScopeKey
}

export interface BackupValidationResult {
  fatalErrors: BackupValidationIssue[]
  scopeIssues: Partial<Record<ImportScopeKey, BackupValidationIssue[]>>
  missingSections: ImportScopeKey[]
  availability: ImportScopeAvailability
  data: Record<string, unknown> | null
  metadata: {
    type: string | null
    version: number | null
  }
}

const BACKUP_FILE_TYPE = 'chaospace-transfer-backup'
const SUPPORTED_VERSION_MIN = 1
const SUPPORTED_VERSION_MAX = DATA_EXPORT_VERSION
const IMPORT_SCOPE_KEYS: ImportScopeKey[] = ['settings', 'history', 'cache', 'panel']
const MAX_ISSUES_PER_SCOPE = 5
const MAX_HISTORY_SAMPLE = 3

const INITIAL_AVAILABILITY: ImportScopeAvailability = {
  settings: false,
  history: false,
  cache: false,
  panel: false,
}

export function resolveBackupDataRoot(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份文件缺少有效的 JSON 数据')
  }
  const payloadRecord = payload as Record<string, unknown>
  const candidate = payloadRecord['data']
  if (candidate && typeof candidate === 'object') {
    return candidate as Record<string, unknown>
  }
  const hasLegacyShape = IMPORT_SCOPE_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(payloadRecord, key),
  )
  if (hasLegacyShape) {
    return payloadRecord
  }
  throw new Error('备份文件缺少 data 节点或结构已损坏')
}

export function validateBackupPayload(payload: unknown): BackupValidationResult {
  const availability = { ...INITIAL_AVAILABILITY }
  const scopeIssues: Partial<Record<ImportScopeKey, BackupValidationIssue[]>> = {}
  const missingSections: ImportScopeKey[] = []
  const fatalErrors: BackupValidationIssue[] = []
  const metadata: BackupValidationResult['metadata'] = {
    type: null,
    version: null,
  }

  if (!payload || typeof payload !== 'object') {
    fatalErrors.push(createIssue('invalid-structure', '备份文件不是有效的 JSON 对象'))
    return {
      fatalErrors,
      scopeIssues,
      missingSections,
      availability,
      data: null,
      metadata,
    }
  }

  const root = payload as Record<string, unknown>
  metadata.type = typeof root['type'] === 'string' ? (root['type'] as string) : null
  metadata.version = typeof root['version'] === 'number' ? (root['version'] as number) : null

  if (!metadata.type) {
    fatalErrors.push(createIssue('missing-type', '备份文件缺少 type 标识，无法判定来源'))
  } else if (metadata.type !== BACKUP_FILE_TYPE) {
    fatalErrors.push(
      createIssue(
        'type-mismatch',
        `备份类型不兼容：检测到 ${metadata.type}，需使用 ${BACKUP_FILE_TYPE}`,
      ),
    )
  }

  if (metadata.version == null) {
    fatalErrors.push(createIssue('missing-version', '备份文件缺少 version 字段，无法确认兼容性'))
  } else if (metadata.version < SUPPORTED_VERSION_MIN || metadata.version > SUPPORTED_VERSION_MAX) {
    fatalErrors.push(
      createIssue(
        'version-mismatch',
        `备份版本 ${metadata.version} 不受支持（需在 ${SUPPORTED_VERSION_MIN}～${SUPPORTED_VERSION_MAX} 之间）`,
      ),
    )
  }

  let data: Record<string, unknown> | null = null
  try {
    data = resolveBackupDataRoot(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : '备份数据结构损坏，无法提取内容'
    fatalErrors.push(createIssue('invalid-structure', message))
  }

  if (!data || fatalErrors.length) {
    fatalErrors.forEach((issue) => {
      chaosLogger.error('[Pan Transfer] Backup fatal issue', issue)
    })
    return {
      fatalErrors,
      scopeIssues,
      missingSections,
      availability,
      data: null,
      metadata,
    }
  }

  IMPORT_SCOPE_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(data as Record<string, unknown>, key)) {
      availability[key] = true
      const issues = validateScope(key, (data as Record<string, unknown>)[key])
      if (issues.length) {
        scopeIssues[key] = issues.slice(0, MAX_ISSUES_PER_SCOPE)
        scopeIssues[key]?.forEach((issue) => {
          chaosLogger.warn('[Pan Transfer] Backup scope issue', { scope: key, ...issue })
        })
      }
    } else {
      availability[key] = false
      missingSections.push(key)
    }
  })

  if (missingSections.length) {
    chaosLogger.warn('[Pan Transfer] Backup missing sections', { missingSections })
  }

  return {
    fatalErrors,
    scopeIssues,
    missingSections,
    availability,
    data,
    metadata,
  }
}

function validateScope(scope: ImportScopeKey, value: unknown): BackupValidationIssue[] {
  switch (scope) {
    case 'settings':
      return validateSettingsSection(value)
    case 'history':
      return validateHistorySection(value)
    case 'cache':
      return validateCacheSection(value)
    case 'panel':
      return validatePanelSection(value)
    default:
      return []
  }
}

function validateSettingsSection(value: unknown): BackupValidationIssue[] {
  if (!value || typeof value !== 'object') {
    return [createIssue('invalid-section', 'settings 节点必须为对象', { scope: 'settings' })]
  }
  const record = value as Record<string, unknown>
  const issues: BackupValidationIssue[] = []
  issues.push(...requireStringField(record, 'baseDir', 'settings.baseDir', { scope: 'settings' }))
  issues.push(
    ...requireBooleanField(record, 'useTitleSubdir', 'settings.useTitleSubdir', {
      scope: 'settings',
    }),
  )
  issues.push(
    ...requireBooleanField(record, 'useSeasonSubdir', 'settings.useSeasonSubdir', {
      scope: 'settings',
    }),
  )
  issues.push(
    ...requireEnumField(record, 'theme', 'settings.theme', ['light', 'dark'], {
      scope: 'settings',
    }),
  )
  issues.push(
    ...requireNumberField(record, 'historyRateLimitMs', 'settings.historyRateLimitMs', {
      scope: 'settings',
      min: MIN_HISTORY_RATE_LIMIT_MS,
      max: MAX_HISTORY_RATE_LIMIT_MS,
    }),
  )
  issues.push(
    ...requireStringArrayField(record, 'presets', 'settings.presets', { scope: 'settings' }),
  )
  issues.push(
    ...requireObjectArrayField(record, 'fileFilters', 'settings.fileFilters', {
      scope: 'settings',
    }),
  )
  issues.push(
    ...requireObjectArrayField(record, 'fileRenameRules', 'settings.fileRenameRules', {
      scope: 'settings',
    }),
  )
  return issues
}

function validateHistorySection(value: unknown): BackupValidationIssue[] {
  if (!value || typeof value !== 'object') {
    return [createIssue('invalid-section', 'history 节点必须为对象', { scope: 'history' })]
  }
  const record = value as Record<string, unknown>
  const issues: BackupValidationIssue[] = []
  if ('records' in record) {
    const records = record['records']
    if (!Array.isArray(records)) {
      issues.push(
        createIssue('type-mismatch', '字段 history.records 应为数组', {
          path: 'history.records',
          scope: 'history',
        }),
      )
    } else {
      records.slice(0, MAX_HISTORY_SAMPLE).forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          issues.push(
            createIssue('type-mismatch', `history.records[${index}] 应为对象`, {
              path: `history.records[${index}]`,
              scope: 'history',
            }),
          )
          return
        }
        const recordEntry = entry as Record<string, unknown>
        if ('pageUrl' in recordEntry && typeof recordEntry['pageUrl'] !== 'string') {
          issues.push(
            createIssue('type-mismatch', `字段 history.records[${index}].pageUrl 应为字符串`, {
              path: `history.records[${index}].pageUrl`,
              scope: 'history',
            }),
          )
        }
        if ('pendingTransfer' in recordEntry && recordEntry['pendingTransfer']) {
          const pending = recordEntry['pendingTransfer']
          if (!pending || typeof pending !== 'object') {
            issues.push(
              createIssue(
                'type-mismatch',
                `history.records[${index}].pendingTransfer 应为对象或 null`,
                {
                  path: `history.records[${index}].pendingTransfer`,
                  scope: 'history',
                },
              ),
            )
          }
        }
      })
    }
  }
  return issues
}

function validateCacheSection(value: unknown): BackupValidationIssue[] {
  if (value == null) {
    return []
  }
  if (typeof value !== 'object') {
    return [createIssue('type-mismatch', 'cache 节点必须为对象或 null', { scope: 'cache' })]
  }
  return []
}

function validatePanelSection(value: unknown): BackupValidationIssue[] {
  if (!value || typeof value !== 'object') {
    return [createIssue('invalid-section', 'panel 节点必须为对象', { scope: 'panel' })]
  }
  const record = value as Record<string, unknown>
  const issues: BackupValidationIssue[] = []
  if ('position' in record && record['position'] != null) {
    const position = record['position']
    if (!position || typeof position !== 'object') {
      issues.push(
        createIssue('type-mismatch', 'panel.position 必须为对象或 null', {
          path: 'panel.position',
          scope: 'panel',
        }),
      )
    } else {
      issues.push(
        ...requireNumberField(position as Record<string, unknown>, 'left', 'panel.position.left', {
          scope: 'panel',
        }),
      )
      issues.push(
        ...requireNumberField(position as Record<string, unknown>, 'top', 'panel.position.top', {
          scope: 'panel',
        }),
      )
    }
  }
  if ('size' in record && record['size'] != null) {
    const size = record['size']
    if (!size || typeof size !== 'object') {
      issues.push(
        createIssue('type-mismatch', 'panel.size 必须为对象或 null', {
          path: 'panel.size',
          scope: 'panel',
        }),
      )
    } else {
      issues.push(
        ...requireNumberField(size as Record<string, unknown>, 'width', 'panel.size.width', {
          scope: 'panel',
        }),
      )
      issues.push(
        ...requireNumberField(size as Record<string, unknown>, 'height', 'panel.size.height', {
          scope: 'panel',
        }),
      )
    }
  }
  if ('pinned' in record && record['pinned'] != null) {
    if (typeof record['pinned'] !== 'boolean') {
      issues.push(
        createIssue('type-mismatch', 'panel.pinned 应为布尔值', {
          path: 'panel.pinned',
          scope: 'panel',
        }),
      )
    }
  }
  if ('edge' in record && record['edge'] != null) {
    const edge = record['edge']
    if (!edge || typeof edge !== 'object') {
      issues.push(
        createIssue('type-mismatch', 'panel.edge 必须为对象或 null', {
          path: 'panel.edge',
          scope: 'panel',
        }),
      )
    } else {
      issues.push(
        ...requireBooleanField(edge as Record<string, unknown>, 'hidden', 'panel.edge.hidden', {
          scope: 'panel',
        }),
      )
      issues.push(
        ...requireEnumField(
          edge as Record<string, unknown>,
          'side',
          'panel.edge.side',
          ['left', 'right'],
          {
            scope: 'panel',
          },
        ),
      )
    }
  }
  return issues
}

function requireStringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: { scope: ImportScopeKey },
): BackupValidationIssue[] {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return [createIssue('missing-field', `缺少字段 ${path}`, { ...options, path })]
  }
  if (typeof record[key] !== 'string') {
    return [
      createIssue('type-mismatch', `字段 ${path} 类型不正确，期望 string`, { ...options, path }),
    ]
  }
  return []
}

function requireBooleanField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: { scope: ImportScopeKey },
): BackupValidationIssue[] {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return [createIssue('missing-field', `缺少字段 ${path}`, { ...options, path })]
  }
  if (typeof record[key] !== 'boolean') {
    return [
      createIssue('type-mismatch', `字段 ${path} 类型不正确，期望 boolean`, {
        ...options,
        path,
      }),
    ]
  }
  return []
}

function requireEnumField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  values: readonly string[],
  options: { scope: ImportScopeKey },
): BackupValidationIssue[] {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return [createIssue('missing-field', `缺少字段 ${path}`, { ...options, path })]
  }
  if (typeof record[key] !== 'string' || !values.includes(String(record[key]))) {
    return [
      createIssue('type-mismatch', `字段 ${path} 类型不正确，期望 ${values.join('/')}`, {
        ...options,
        path,
      }),
    ]
  }
  return []
}

function requireNumberField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: { scope: ImportScopeKey; min?: number; max?: number },
): BackupValidationIssue[] {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return [createIssue('missing-field', `缺少字段 ${path}`, { ...options, path })]
  }
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return [
      createIssue('type-mismatch', `字段 ${path} 类型不正确，期望 number`, {
        ...options,
        path,
      }),
    ]
  }
  if (options.min != null && value < options.min) {
    return [
      createIssue('out-of-range', `字段 ${path} 需 ≥ ${options.min}`, {
        ...options,
        path,
      }),
    ]
  }
  if (options.max != null && value > options.max) {
    return [
      createIssue('out-of-range', `字段 ${path} 需 ≤ ${options.max}`, {
        ...options,
        path,
      }),
    ]
  }
  return []
}

function requireStringArrayField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: { scope: ImportScopeKey },
): BackupValidationIssue[] {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return [createIssue('missing-field', `缺少字段 ${path}`, { ...options, path })]
  }
  const value = record[key]
  if (!Array.isArray(value)) {
    return [
      createIssue('type-mismatch', `字段 ${path} 类型不正确，期望 string[]`, {
        ...options,
        path,
      }),
    ]
  }
  const invalidIndex = value.findIndex((item) => typeof item !== 'string')
  if (invalidIndex >= 0) {
    return [
      createIssue('type-mismatch', `字段 ${path}[${invalidIndex}] 类型不正确，期望 string`, {
        ...options,
        path: `${path}[${invalidIndex}]`,
      }),
    ]
  }
  return []
}

function requireObjectArrayField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: { scope: ImportScopeKey },
): BackupValidationIssue[] {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return [createIssue('missing-field', `缺少字段 ${path}`, { ...options, path })]
  }
  const value = record[key]
  if (!Array.isArray(value)) {
    return [
      createIssue('type-mismatch', `字段 ${path} 类型不正确，期望 object[]`, {
        ...options,
        path,
      }),
    ]
  }
  const invalidIndex = value.findIndex((item) => !item || typeof item !== 'object')
  if (invalidIndex >= 0) {
    return [
      createIssue('type-mismatch', `字段 ${path}[${invalidIndex}] 必须为对象`, {
        ...options,
        path: `${path}[${invalidIndex}]`,
      }),
    ]
  }
  return []
}

function createIssue(
  code: string,
  message: string,
  options: { scope?: ImportScopeKey; path?: string } = {},
): BackupValidationIssue {
  const issue: BackupValidationIssue = {
    code,
    message,
  }
  if (typeof options.path === 'string') {
    issue.path = options.path
  }
  if (options.scope) {
    issue.scope = options.scope
  }
  return issue
}
