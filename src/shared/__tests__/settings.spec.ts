import { describe, it, expect } from 'vitest'

import {
  normalizeFileFilterRules,
  normalizeFileRenameRules,
  normalizeFileFilterMode,
} from '../settings'

describe('settings normalization', () => {
  it('normalizes size conditions with unit suffix', () => {
    const rules = normalizeFileFilterRules([
      {
        action: 'exclude',
        logic: 'all',
        enabled: true,
        conditions: [
          { type: 'size', operator: 'lt', value: '10kb' },
          { type: 'regex', pattern: 'sample', flags: 'i' },
        ],
      },
    ])

    expect(rules).toHaveLength(1)
    const [rule] = rules
    expect(rule?.conditions).toHaveLength(2)
    const sizeCondition = rule?.conditions?.[0]
    expect(sizeCondition).toMatchObject({
      type: 'size',
      operator: 'lt',
      value: 10 * 1024,
    })
  })

  it('sanitizes rename rules and keeps valid flags', () => {
    const rules = normalizeFileRenameRules([
      { pattern: '\\\\.', replacement: ' ', flags: 'gi', enabled: true },
      { pattern: '(\\d+)', replacement: '$1', flags: 'abc', enabled: true },
    ])

    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({
      pattern: '\\\\.',
      replacement: ' ',
      flags: 'gi',
    })
    // invalid flags should be removed, fallback to default 'g'
    expect(rules[1]).toMatchObject({
      pattern: '(\\d+)',
      flags: 'g',
    })
  })

  it('normalizes filter mode alias', () => {
    expect(normalizeFileFilterMode('接受优先')).toBe('allow-first')
    expect(normalizeFileFilterMode('否决优先')).toBe('deny-first')
    expect(normalizeFileFilterMode('按顺序优先')).toBe('ordered')
  })
})
