import { describe, it, expect } from 'vitest'

import * as fileRuleModule from '../file-rules'
import type { FileFilterResult, RenamePlanEntry } from '../file-rules'
import type { ShareFileEntry } from '../../api/baidu-pan'
import type { FileFilterRule, FileRenameRule, FileFilterEvaluationMode } from '@/shared/settings'

function createEntry(
  fsId: number,
  name: string,
  size: number,
  options: { isDir?: boolean; path?: string } = {},
): ShareFileEntry {
  return {
    fsId,
    serverFilename: name,
    size,
    isDir: options.isDir ?? false,
    path: options.path ?? `/mock/${name}`,
  }
}

function assertIsFileFilterResult(value: unknown): asserts value is FileFilterResult {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as FileFilterResult).entries) ||
    !Array.isArray((value as FileFilterResult).skipped)
  ) {
    throw new Error('Unexpected file filter result')
  }
}

function assertIsRenamePlan(value: unknown): asserts value is RenamePlanEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Unexpected rename plan result')
  }
}

describe('applyFileFilters', () => {
  it('excludes entries that match all filter conditions', () => {
    const entries = [
      createEntry(1, 'Sample.ZERO.mkv', 0),
      createEntry(2, 'Movie.1080p.mkv', 4_500_000_000),
    ]
    const rules: FileFilterRule[] = [
      {
        action: 'exclude',
        logic: 'all',
        enabled: true,
        conditions: [
          { type: 'size', operator: 'eq', value: 0 },
          { type: 'regex', pattern: 'sample', flags: 'i' },
        ],
      },
    ]

    const result = applyFileFiltersSafe(entries, rules, 'deny-first')
    assertIsFileFilterResult(result)

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.serverFilename).toBe('Movie.1080p.mkv')
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.name).toBe('Sample.ZERO.mkv')
  })

  it('respects allow-first mode priorities', () => {
    const entries = [createEntry(3, 'trailer.mov', 20_000_000), createEntry(4, 'bonus.txt', 1_024)]
    const rules: FileFilterRule[] = [
      {
        action: 'include',
        logic: 'any',
        enabled: true,
        conditions: [{ type: 'extension', operator: 'in', values: ['mov'] }],
      },
      {
        action: 'exclude',
        logic: 'all',
        enabled: true,
        conditions: [{ type: 'size', operator: 'lt', value: 10_000 }],
      },
    ]

    const result = applyFileFiltersSafe(entries, rules, 'allow-first')
    assertIsFileFilterResult(result)

    expect(result.entries.map((entry) => entry?.serverFilename)).toEqual(['trailer.mov'])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.name).toBe('bonus.txt')
  })

  it('populates readable rule labels when filters skip files', () => {
    const entries = [createEntry(5, 'empty.bin', 0), createEntry(6, 'note.txt', 10)]
    const rules: FileFilterRule[] = [
      {
        action: 'exclude',
        logic: 'all',
        enabled: true,
        description: '空文件',
        conditions: [{ type: 'size', operator: 'eq', value: 0 }],
      },
      {
        action: 'exclude',
        logic: 'all',
        enabled: true,
        conditions: [{ type: 'extension', operator: 'in', values: ['txt'] }],
      },
    ]

    const result = applyFileFiltersSafe(entries, rules, 'ordered')
    assertIsFileFilterResult(result)

    expect(result.skipped).toHaveLength(2)
    expect(result.skipped[0]).toMatchObject({ name: 'empty.bin', ruleName: '空文件' })
    expect(result.skipped[1]).toMatchObject({ name: 'note.txt', ruleName: '规则 #2' })
  })

  it('treats whitespace separated name keywords as OR matches', () => {
    const entries = [
      createEntry(7, '欢迎关注微信公众号chaospace2018', 0),
      createEntry(8, 'Somnium.2025.1080p.WEBRip.CHS&ENG-HAN.CHAOSPACE.mp4', 2_000_000_000),
    ]
    const rules: FileFilterRule[] = [
      {
        action: 'exclude',
        logic: 'all',
        enabled: true,
        name: '剔除无意义的空文件',
        conditions: [
          { type: 'size', operator: 'lte', value: 10 },
          {
            type: 'name',
            mode: 'includes',
            value: '关注 微信 微博 发布 地址 推荐',
            caseSensitive: false,
          },
        ],
      },
    ]

    const result = applyFileFiltersSafe(entries, rules, 'deny-first')
    assertIsFileFilterResult(result)

    expect(result.entries.map((entry) => entry.serverFilename)).toEqual([
      'Somnium.2025.1080p.WEBRip.CHS&ENG-HAN.CHAOSPACE.mp4',
    ])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ name: '欢迎关注微信公众号chaospace2018' })
  })
})

describe('buildRenamePlan', () => {
  it('applies rename rules sequentially and preserves extensions', () => {
    const entries = [
      createEntry(10, '[Team] Movie.1080p.WEB-DL.mkv', 4_600_000_000),
      createEntry(11, 'Episode.01.Sample.mkv', 1_800_000_000),
    ]
    const renameRules: FileRenameRule[] = [
      {
        pattern: '\\[.*?\\]\\s*',
        replacement: '',
        flags: 'g',
        enabled: true,
      },
      {
        pattern: '\\.',
        replacement: ' ',
        flags: 'g',
        enabled: true,
      },
      {
        pattern: 'Sample',
        replacement: '',
        flags: 'gi',
        enabled: true,
      },
      {
        pattern: '\\s+',
        replacement: ' ',
        flags: 'g',
        enabled: true,
      },
    ]

    const planInput = buildRenamePlanSafe(entries, renameRules, new Set(['movie 1080p web-dl.mkv']))
    assertIsRenamePlan(planInput)
    const plan = planInput

    expect(plan).toHaveLength(2)
    expect(plan[0]).toMatchObject({
      originalName: '[Team] Movie.1080p.WEB-DL.mkv',
      finalName: 'Movie 1080p WEB-DL (1).mkv',
      changed: true,
      preferredName: 'Movie 1080p WEB-DL.mkv',
      conflictedWithExisting: true,
    })
    expect(plan[1]).toMatchObject({
      originalName: 'Episode.01.Sample.mkv',
      finalName: 'Episode 01.mkv',
      changed: true,
      preferredName: 'Episode 01.mkv',
      conflictedWithExisting: false,
    })
  })

  it('falls back to original name when replacement results empty base', () => {
    const entries = [createEntry(20, 'README', 0)]
    const renameRules: FileRenameRule[] = [
      {
        pattern: '.+',
        replacement: '',
        flags: 'g',
        enabled: true,
      },
    ]

    const planInput = buildRenamePlanSafe(entries, renameRules)
    assertIsRenamePlan(planInput)
    const plan = planInput

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({
      originalName: 'README',
      finalName: 'README',
      changed: false,
    })
  })

  it('preserves compound and volume extensions while ignoring hidden-file leading dots', () => {
    const entries = [
      createEntry(30, 'dataset.pkg.tar.zst', 1),
      createEntry(31, 'backup.cpio.xz', 1),
      createEntry(32, 'archive.rar.part12', 1),
      createEntry(33, 'movie.7z.002', 1),
      createEntry(34, '.bashrc', 1),
      createEntry(35, '.env.prod', 1),
    ]
    const renameRules: FileRenameRule[] = [
      {
        pattern: '^.+$',
        replacement: 'normalized',
        flags: '',
        enabled: true,
      },
    ]

    const planInput = buildRenamePlanSafe(entries, renameRules)
    assertIsRenamePlan(planInput)
    const plan = planInput

    expect(plan.map((entry) => entry.finalName)).toEqual([
      'normalized.pkg.tar.zst',
      'normalized.cpio.xz',
      'normalized.rar.part12',
      'normalized.7z.002',
      'normalized',
      'normalized.prod',
    ])
  })
})
type ApplyFileFiltersFn = (
  entries: ShareFileEntry[],
  rules: FileFilterRule[],
  mode: FileFilterEvaluationMode,
) => FileFilterResult

type BuildRenamePlanFn = (
  entries: ShareFileEntry[],
  renameRules: FileRenameRule[],
  existingNames?: Set<string>,
) => RenamePlanEntry[]

const applyFileFiltersSafe = fileRuleModule.applyFileFilters as unknown as ApplyFileFiltersFn
const buildRenamePlanSafe = fileRuleModule.buildRenamePlan as unknown as BuildRenamePlanFn
