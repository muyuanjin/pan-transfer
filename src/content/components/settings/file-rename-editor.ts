import type { FileRenameRule } from '@/shared/settings'

interface CreateEditorOptions {
  document: Document
}

interface CollectOptions {
  strict?: boolean
}

export interface CollectResult {
  rules: FileRenameRule[] | null
  errors: string[]
}

export interface FileRenameEditor {
  render: (rules: FileRenameRule[]) => void
  collect: (options?: CollectOptions) => CollectResult
  focusFirstInvalid: () => void
  clearErrors: () => void
}

let renameRuleIdSeed = 0

function nextRuleId(): string {
  renameRuleIdSeed += 1
  return `rename-rule-${renameRuleIdSeed}`
}

function createButton(doc: Document, label: string, action: string): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.dataset['action'] = action
  button.textContent = label
  button.className = 'chaospace-rule-btn'
  return button
}

function sanitizeRegexFlags(value: string): string {
  const valid = new Set(['g', 'i', 'm', 's', 'u', 'y'])
  const result: string[] = []
  for (const char of value) {
    if (valid.has(char) && !result.includes(char)) {
      result.push(char)
    }
  }
  if (!result.length) {
    result.push('g')
  }
  return result.join('')
}

function setCardCollapsed(card: HTMLElement, collapsed: boolean): void {
  card.classList.toggle('is-collapsed', collapsed)
  const body = card.querySelector<HTMLElement>('.chaospace-rule-card-body')
  if (body) {
    body.hidden = collapsed
  }
  const button = card.querySelector<HTMLButtonElement>('[data-action="toggle-collapse"]')
  if (button) {
    button.textContent = collapsed ? '展开' : '收起'
  }
}

function toggleCardCollapsed(card: HTMLElement): void {
  setCardCollapsed(card, !card.classList.contains('is-collapsed'))
}

function createRuleCard(doc: Document, rule?: FileRenameRule): HTMLElement {
  const card = doc.createElement('section')
  card.className = 'chaospace-rule-card'
  card.dataset['ruleId'] = nextRuleId()

  const header = doc.createElement('div')
  header.className = 'chaospace-rule-card-header'

  const titleInput = doc.createElement('input')
  titleInput.type = 'text'
  titleInput.placeholder = '规则名称（可选）'
  titleInput.value = rule?.name ?? ''
  titleInput.dataset['field'] = 'name'
  titleInput.className = 'chaospace-rule-input'

  const headerControls = doc.createElement('div')
  headerControls.className = 'chaospace-rule-header-controls'

  const collapseBtn = createButton(doc, '收起', 'toggle-collapse')
  collapseBtn.classList.add('chaospace-rule-collapse')

  const enabledLabel = doc.createElement('label')
  enabledLabel.className = 'chaospace-switch'
  const enabledInput = doc.createElement('input')
  enabledInput.type = 'checkbox'
  enabledInput.dataset['field'] = 'enabled'
  enabledInput.checked = rule?.enabled !== false
  const enabledText = doc.createElement('span')
  enabledText.textContent = '启用'
  enabledLabel.append(enabledInput, enabledText)

  const moveUp = createButton(doc, '上移', 'move-up')
  const moveDown = createButton(doc, '下移', 'move-down')
  const remove = createButton(doc, '删除', 'remove')

  headerControls.append(collapseBtn, enabledLabel, moveUp, moveDown, remove)
  header.append(titleInput, headerControls)

  const body = doc.createElement('div')
  body.className = 'chaospace-rule-card-body'

  const nameHint = doc.createElement('p')
  nameHint.className = 'chaospace-condition-hint'
  nameHint.textContent = '用于记录该规则的用途，将在日志中引用。'

  const patternGroup = doc.createElement('div')
  patternGroup.className = 'chaospace-rule-row'
  const patternLabel = doc.createElement('label')
  patternLabel.textContent = '匹配表达式'
  const patternInput = doc.createElement('input')
  patternInput.type = 'text'
  patternInput.placeholder = '需要匹配的正则表达式，例如 (2160[pP])'
  patternInput.value = rule?.pattern ?? ''
  patternInput.dataset['field'] = 'pattern'
  patternInput.className = 'chaospace-rule-input'
  patternGroup.append(patternLabel, patternInput)

  const flagsGroup = doc.createElement('div')
  flagsGroup.className = 'chaospace-rule-row'
  const flagsLabel = doc.createElement('label')
  flagsLabel.textContent = 'Flags'
  const flagsInput = doc.createElement('input')
  flagsInput.type = 'text'
  flagsInput.placeholder = '默认 g，可组合 i m s u y'
  flagsInput.value = rule?.flags ?? 'g'
  flagsInput.dataset['field'] = 'flags'
  flagsInput.className = 'chaospace-rule-input'
  const flagsHint = doc.createElement('p')
  flagsHint.className = 'chaospace-condition-hint'
  flagsHint.textContent =
    '示例：gi 表示全局 + 忽略大小写，若需多种行为直接连续输入字母（如 gms）。g: 全局匹配，i: 忽略大小写，m: 多行模式，s: 使 . 匹配换行符，u: Unicode 模式，y: 粘连匹配。'
  flagsGroup.append(flagsLabel, flagsInput, flagsHint)

  const replacementGroup = doc.createElement('div')
  replacementGroup.className = 'chaospace-rule-row'
  const replacementLabel = doc.createElement('label')
  replacementLabel.textContent = '替换结果'
  const replacementInput = doc.createElement('input')
  replacementInput.type = 'text'
  replacementInput.placeholder = '用于替换的文本，可包含 $1、$2 等捕获组'
  replacementInput.value = rule?.replacement ?? ''
  replacementInput.dataset['field'] = 'replacement'
  replacementInput.className = 'chaospace-rule-input'
  replacementGroup.append(replacementLabel, replacementInput)

  const descriptionGroup = doc.createElement('div')
  descriptionGroup.className = 'chaospace-rule-row'
  const descriptionLabel = doc.createElement('label')
  descriptionLabel.textContent = '备注'
  const descriptionInput = doc.createElement('input')
  descriptionInput.type = 'text'
  descriptionInput.placeholder = '可选：补充说明，例如“去掉发布组标签”'
  descriptionInput.value = rule?.description ?? ''
  descriptionInput.dataset['field'] = 'description'
  descriptionInput.className = 'chaospace-rule-input'
  descriptionGroup.append(descriptionLabel, descriptionInput)

  body.append(nameHint, patternGroup, flagsGroup, replacementGroup, descriptionGroup)

  card.append(header, body)
  setCardCollapsed(card, false)

  return card
}

function getField<T extends HTMLElement>(root: HTMLElement, selector: string): T | null {
  return root.querySelector<T>(selector)
}

function setInvalid(element: HTMLElement | null): void {
  element?.classList.add('is-invalid')
}

function clearInvalid(element: HTMLElement | null): void {
  element?.classList.remove('is-invalid')
}

function collectRule(card: HTMLElement, index: number, errors: string[]): FileRenameRule | null {
  card.classList.remove('is-invalid')
  card.querySelectorAll('.is-invalid').forEach((node) => node.classList.remove('is-invalid'))

  const name = getField<HTMLInputElement>(card, 'input[data-field="name"]')?.value.trim() ?? ''
  const description =
    getField<HTMLInputElement>(card, 'input[data-field="description"]')?.value.trim() ?? ''
  const enabled = Boolean(getField<HTMLInputElement>(card, 'input[data-field="enabled"]')?.checked)
  const patternInput = getField<HTMLInputElement>(card, 'input[data-field="pattern"]')
  const pattern = patternInput?.value.trim() ?? ''
  const flagsInput = getField<HTMLInputElement>(card, 'input[data-field="flags"]')
  const flagsRaw = flagsInput?.value ?? 'g'
  const flags = sanitizeRegexFlags(flagsRaw)
  const replacementInput = getField<HTMLInputElement>(card, 'input[data-field="replacement"]')
  const replacement = replacementInput?.value ?? ''

  if (!pattern) {
    errors.push(`重命名规则 ${index + 1} 需要填写匹配表达式`)
    setInvalid(patternInput)
    card.classList.add('is-invalid')
    return null
  }

  if (flagsInput) {
    flagsInput.value = flags
  }

  const rule: FileRenameRule = {
    pattern,
    flags,
    replacement,
    enabled,
  }
  if (name) {
    rule.name = name
  }
  if (description) {
    rule.description = description
  }
  return rule
}

export function createFileRenameEditor(
  host: HTMLElement,
  { document }: CreateEditorOptions,
): FileRenameEditor {
  host.innerHTML = ''
  host.classList.add('chaospace-rule-editor-root')

  const errorEl = document.createElement('div')
  errorEl.className = 'chaospace-rule-editor-error'
  errorEl.hidden = true

  const list = document.createElement('div')
  list.className = 'chaospace-rule-editor-list'

  const emptyState = document.createElement('div')
  emptyState.className = 'chaospace-rule-empty'
  emptyState.textContent = '尚未添加重命名规则'

  const actionsRow = document.createElement('div')
  actionsRow.className = 'chaospace-rule-editor-actions'

  const addButton = createButton(document, '新增规则', 'add-rule')
  addButton.classList.add('chaospace-rule-primary')
  actionsRow.appendChild(addButton)

  host.append(errorEl, list, emptyState, actionsRow)

  function refreshEmptyState(): void {
    const hasRule = Boolean(list.querySelector('[data-rule-id]'))
    emptyState.hidden = hasRule
  }

  function attachCard(card: HTMLElement): void {
    card.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      if (!(target instanceof HTMLElement)) {
        return
      }
      const action = target.dataset['action']
      if (!action) {
        return
      }
      event.preventDefault()
      if (action === 'remove') {
        card.remove()
        refreshEmptyState()
        return
      }
      if (action === 'move-up' || action === 'move-down') {
        const sibling =
          action === 'move-up'
            ? (card.previousElementSibling as HTMLElement | null)
            : (card.nextElementSibling as HTMLElement | null)
        if (sibling && sibling.dataset['ruleId']) {
          if (action === 'move-up') {
            list.insertBefore(card, sibling)
          } else {
            list.insertBefore(sibling, card)
          }
        }
        return
      }
      if (action === 'toggle-collapse') {
        toggleCardCollapsed(card)
        return
      }
    })

    card.addEventListener('input', (event) => {
      const target = event.target as HTMLElement
      clearInvalid(target as HTMLElement)
      const invalidParent = target.closest('.is-invalid') as HTMLElement | null
      invalidParent?.classList.remove('is-invalid')
    })
  }

  addButton.addEventListener('click', () => {
    const card = createRuleCard(document)
    list.appendChild(card)
    attachCard(card)
    refreshEmptyState()
    card.scrollIntoView({ block: 'nearest' })
  })

  function render(rules: FileRenameRule[]): void {
    list.innerHTML = ''
    errorEl.hidden = true
    if (!rules.length) {
      const card = createRuleCard(document)
      list.appendChild(card)
      attachCard(card)
      refreshEmptyState()
      return
    }
    rules.forEach((rule) => {
      const card = createRuleCard(document, rule)
      list.appendChild(card)
      attachCard(card)
    })
    refreshEmptyState()
  }

  function collect(_: CollectOptions = {}): CollectResult {
    const errors: string[] = []
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-rule-id]'))
    const rules: FileRenameRule[] = []

    cards.forEach((card, index) => {
      const rule = collectRule(card, index, errors)
      if (rule) {
        rules.push(rule)
      }
    })

    if (errors.length) {
      errorEl.hidden = false
      errorEl.textContent = errors[0] ?? ''
      return { rules: null, errors }
    }

    errorEl.hidden = true
    errorEl.textContent = ''
    const cloned = rules.map((rule) => ({
      ...rule,
    }))
    return { rules: cloned, errors: [] }
  }

  function focusFirstInvalid(): void {
    const firstInvalid =
      list.querySelector<HTMLElement>('.is-invalid input, .is-invalid select') ??
      list.querySelector<HTMLElement>('.is-invalid')
    if (firstInvalid instanceof HTMLElement) {
      firstInvalid.focus({ preventScroll: false })
    }
  }

  function clearErrors(): void {
    errorEl.hidden = true
    errorEl.textContent = ''
    list.querySelectorAll('.is-invalid').forEach((node) => node.classList.remove('is-invalid'))
  }

  return {
    render,
    collect,
    focusFirstInvalid,
    clearErrors,
  }
}
