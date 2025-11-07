import { describe, it, expect, beforeEach } from 'vitest'
import { createFileFilterEditor } from '../file-filter-editor'
import { createFileRenameEditor } from '../file-rename-editor'

function getRuleCard(host: HTMLElement, index = 0): HTMLElement {
  const cards = host.querySelectorAll<HTMLElement>('[data-rule-id]')
  const card = cards[index]
  if (!card) {
    throw new Error(`Expected rule card at index ${index}`)
  }
  return card
}

function changeSelect(select: HTMLSelectElement, value: string): void {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('file filter editor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('collects sanitized rules based on DOM input', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createFileFilterEditor(host, { document })

    editor.render([])

    const ruleCard = getRuleCard(host)
    const nameInput = ruleCard.querySelector<HTMLInputElement>('input[data-field="name"]')
    const descriptionInput = ruleCard.querySelector<HTMLInputElement>(
      'input[data-field="description"]',
    )
    const actionSelect = ruleCard.querySelector<HTMLSelectElement>('select[data-field="action"]')
    const logicSelect = ruleCard.querySelector<HTMLSelectElement>('select[data-field="logic"]')

    nameInput!.value = '保留高清视频'
    descriptionInput!.value = 'video filters'
    changeSelect(actionSelect!, 'include')
    changeSelect(logicSelect!, 'any')

    const firstCondition = ruleCard.querySelector<HTMLElement>('[data-condition-id]')!
    const typeSelect = firstCondition.querySelector<HTMLSelectElement>('select[data-field="type"]')!
    changeSelect(typeSelect, 'extension')
    const extensionOperator = firstCondition.querySelector<HTMLSelectElement>(
      'select[data-field="operator"]',
    )!
    changeSelect(extensionOperator, 'in')
    const extensionInput = firstCondition.querySelector<HTMLInputElement>(
      'input[data-field="values"]',
    )!
    extensionInput.value = ' .MKV , mp4 ; zip '
    const negateCheckbox = firstCondition.querySelector<HTMLInputElement>(
      'input[data-field="negate"]',
    )!
    negateCheckbox.checked = true

    const addConditionBtn = ruleCard.querySelector<HTMLButtonElement>(
      '[data-action="add-condition"]',
    )!
    addConditionBtn.click()
    const secondCondition = ruleCard.querySelectorAll<HTMLElement>('[data-condition-id]')[1]!
    const secondTypeSelect = secondCondition.querySelector<HTMLSelectElement>(
      'select[data-field="type"]',
    )!
    changeSelect(secondTypeSelect, 'regex')
    const patternInput = secondCondition.querySelector<HTMLInputElement>(
      'input[data-field="pattern"]',
    )!
    patternInput.value = '(?<season>\\d+)'
    const flagsInput = secondCondition.querySelector<HTMLInputElement>('input[data-field="flags"]')!
    flagsInput.value = 'ggiix'

    addConditionBtn.click()
    const thirdCondition = ruleCard.querySelectorAll<HTMLElement>('[data-condition-id]')[2]!
    const thirdTypeSelect = thirdCondition.querySelector<HTMLSelectElement>(
      'select[data-field="type"]',
    )!
    changeSelect(thirdTypeSelect, 'size')
    const sizeOperator = thirdCondition.querySelector<HTMLSelectElement>(
      'select[data-field="operator"]',
    )!
    changeSelect(sizeOperator, 'gte')
    const sizeInput = thirdCondition.querySelector<HTMLInputElement>('input[data-field="value"]')!
    sizeInput.value = '1.5 GB'

    const result = editor.collect()
    expect(result.errors).toEqual([])
    expect(result.rules).toHaveLength(1)
    expect(result.rules?.[0]).toEqual({
      name: '保留高清视频',
      description: 'video filters',
      action: 'include',
      logic: 'any',
      enabled: true,
      conditions: [
        { type: 'extension', operator: 'in', values: ['mkv', 'mp4', 'zip'], negate: true },
        { type: 'regex', pattern: '(?<season>\\d+)', flags: 'gi', negate: false },
        { type: 'size', operator: 'gte', value: 1610612736, negate: false },
      ],
    })
  })

  it('reports validation errors and clears them via clearErrors', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createFileFilterEditor(host, { document })
    editor.render([])

    const result = editor.collect()
    expect(result.rules).toBeNull()
    expect(result.errors[0]).toContain('关键字不能为空')

    const errorEl = host.querySelector<HTMLElement>('.chaospace-rule-editor-error')!
    expect(errorEl.hidden).toBe(false)

    const valueInput = host.querySelector<HTMLInputElement>('input[data-field="value"]')!
    expect(valueInput.classList.contains('is-invalid')).toBe(true)

    editor.clearErrors()
    expect(errorEl.hidden).toBe(true)
    expect(errorEl.textContent).toBe('')
    expect(valueInput.classList.contains('is-invalid')).toBe(false)
  })
})

describe('file rename editor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('collects sanitized rename rules from DOM input', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createFileRenameEditor(host, { document })
    editor.render([])

    const ruleCard = getRuleCard(host)
    const nameInput = ruleCard.querySelector<HTMLInputElement>('input[data-field="name"]')!
    const descriptionInput = ruleCard.querySelector<HTMLInputElement>(
      'input[data-field="description"]',
    )!
    const enabledInput = ruleCard.querySelector<HTMLInputElement>('input[data-field="enabled"]')!
    const patternInput = ruleCard.querySelector<HTMLInputElement>('input[data-field="pattern"]')!
    const flagsInput = ruleCard.querySelector<HTMLInputElement>('input[data-field="flags"]')!
    const replacementInput = ruleCard.querySelector<HTMLInputElement>(
      'input[data-field="replacement"]',
    )!

    nameInput.value = '去掉发布组标签'
    descriptionInput.value = 'strip release tags'
    enabledInput.checked = false
    patternInput.value = '\\[(Rip|WEB)\\]\\s*(.*)'
    flagsInput.value = 'ggiix'
    replacementInput.value = '$2'

    const result = editor.collect()
    expect(result.errors).toEqual([])
    expect(result.rules).toEqual([
      {
        name: '去掉发布组标签',
        description: 'strip release tags',
        pattern: '\\[(Rip|WEB)\\]\\s*(.*)',
        flags: 'gi',
        replacement: '$2',
        enabled: false,
      },
    ])
  })

  it('indicates missing pattern errors and resets via clearErrors', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createFileRenameEditor(host, { document })
    editor.render([])

    const patternInput = host.querySelector<HTMLInputElement>('input[data-field="pattern"]')!
    patternInput.value = ''

    const result = editor.collect()
    expect(result.rules).toBeNull()
    expect(result.errors[0]).toContain('需要填写匹配表达式')

    const errorEl = host.querySelector<HTMLElement>('.chaospace-rule-editor-error')!
    expect(errorEl.hidden).toBe(false)
    expect(patternInput.classList.contains('is-invalid')).toBe(true)

    editor.clearErrors()
    expect(errorEl.hidden).toBe(true)
    expect(patternInput.classList.contains('is-invalid')).toBe(false)
  })
})
