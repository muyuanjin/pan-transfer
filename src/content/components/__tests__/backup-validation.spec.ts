import { describe, expect, it } from 'vitest'
import { validateBackupPayload } from '../settings/backup-validation'
import { DATA_EXPORT_VERSION } from '../../constants'

interface BackupDataFixture {
  settings: Record<string, unknown>
  history: Record<string, unknown>
  cache: Record<string, unknown>
  panel?: Record<string, unknown> | null
  [key: string]: unknown
}

interface BackupFixture {
  type: string
  version: number
  data: BackupDataFixture
}

function createValidBackup(): BackupFixture {
  return {
    type: 'chaospace-transfer-backup',
    version: DATA_EXPORT_VERSION,
    data: {
      settings: {
        baseDir: '/视频',
        useTitleSubdir: true,
        useSeasonSubdir: true,
        theme: 'light',
        historyRateLimitMs: 2000,
        presets: ['/视频/番剧'],
        fileFilters: [],
        fileRenameRules: [],
      },
      history: {
        records: [],
      },
      cache: {},
      panel: {
        position: { left: 12, top: 34 },
        size: { width: 320, height: 600 },
        pinned: false,
        edge: { hidden: false, side: 'right' },
      },
    },
  }
}

describe('validateBackupPayload', () => {
  it('returns fatal error when type mismatches', () => {
    const payload = createValidBackup()
    payload.type = 'legacy-backup'
    const result = validateBackupPayload(payload)
    expect(result.fatalErrors).toHaveLength(1)
    expect(result.fatalErrors[0]?.code).toBe('type-mismatch')
  })

  it('collects scope issues for invalid settings fields without blocking other scopes', () => {
    const payload = createValidBackup()
    payload.data.settings = {
      ...payload.data.settings,
      baseDir: 123,
    }
    const result = validateBackupPayload(payload)
    expect(result.fatalErrors).toHaveLength(0)
    expect(result.availability.settings).toBe(true)
    expect(result.scopeIssues.settings).toBeDefined()
    expect(result.scopeIssues.settings?.[0]?.path).toBe('settings.baseDir')
  })

  it('marks sections that are missing entirely as unavailable', () => {
    const payload = createValidBackup()
    delete payload.data.panel
    const result = validateBackupPayload(payload)
    expect(result.availability.panel).toBe(false)
    expect(result.missingSections).toContain('panel')
  })
})
