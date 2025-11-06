import {
  type FileCategory,
  type FileFilterAction,
  type FileFilterCondition,
  type FileFilterLogic,
  type FileFilterRule,
  parseSizeInput,
} from '@/shared/settings'

type FileFilterConditionType = FileFilterCondition['type']

interface CreateEditorOptions {
  document: Document
}

interface CollectOptions {
  strict?: boolean
}

export interface CollectResult {
  rules: FileFilterRule[] | null
  errors: string[]
}

export interface FileFilterEditor {
  render: (rules: FileFilterRule[]) => void
  collect: (options?: CollectOptions) => CollectResult
  focusFirstInvalid: () => void
  clearErrors: () => void
}

const CATEGORY_OPTIONS: { value: FileCategory; label: string }[] = [
  { value: 'archive', label: '压缩包' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
  { value: 'image', label: '图片' },
  { value: 'document', label: '文档' },
  { value: 'subtitle', label: '字幕' },
  { value: 'media', label: '多媒体' },
  { value: 'other', label: '其他' },
]

const CONDITION_LABELS: Record<FileFilterConditionType, string> = {
  size: '文件大小',
  name: '文件名',
  regex: '正则匹配',
  extension: '扩展名',
  category: '文件类型',
  isDir: '目录状态',
}

let ruleIdSeed = 0
let conditionIdSeed = 0

function nextRuleId(): string {
  ruleIdSeed += 1
  return `filter-rule-${ruleIdSeed}`
}

function nextConditionId(): string {
  conditionIdSeed += 1
  return `filter-condition-${conditionIdSeed}`
}

function createButton(doc: Document, label: string, action: string): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.dataset['action'] = action
  button.textContent = label
  button.className = 'chaospace-rule-btn'
  return button
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

function parseExtensions(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item.slice(1) : item))
}

function createHeader(doc: Document): HTMLDivElement {
  const header = doc.createElement('div')
  header.className = 'chaospace-rule-card-header'
  return header
}

function createRuleCard(doc: Document, rule?: FileFilterRule): HTMLElement {
  const card = doc.createElement('section')
  card.className = 'chaospace-rule-card'
  card.dataset['ruleId'] = nextRuleId()

  const header = createHeader(doc)
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
  const enabledSpan = doc.createElement('span')
  enabledSpan.textContent = '启用'
  enabledLabel.append(enabledInput, enabledSpan)

  const moveUp = createButton(doc, '上移', 'move-up')
  const moveDown = createButton(doc, '下移', 'move-down')
  const remove = createButton(doc, '删除', 'remove')

  headerControls.append(collapseBtn, enabledLabel, moveUp, moveDown, remove)
  header.append(titleInput, headerControls)

  const body = doc.createElement('div')
  body.className = 'chaospace-rule-card-body'

  const descriptionGroup = doc.createElement('div')
  descriptionGroup.className = 'chaospace-rule-row'
  const descriptionLabel = doc.createElement('label')
  descriptionLabel.textContent = '备注'
  const descriptionInput = doc.createElement('input')
  descriptionInput.type = 'text'
  descriptionInput.placeholder = '例如：跳过体积太小的空目录'
  descriptionInput.value = rule?.description ?? ''
  descriptionInput.dataset['field'] = 'description'
  descriptionInput.className = 'chaospace-rule-input'
  descriptionGroup.append(descriptionLabel, descriptionInput)

  const actionGroup = doc.createElement('div')
  actionGroup.className = 'chaospace-rule-row'
  const actionLabel = doc.createElement('label')
  actionLabel.textContent = '命中行为'
  const actionSelect = doc.createElement('select')
  actionSelect.dataset['field'] = 'action'
  actionSelect.innerHTML = `
    <option value="exclude">剔除（不参与转存）</option>
    <option value="include">保留（强制参与转存）</option>
  `
  actionSelect.value = rule?.action ?? 'exclude'
  actionGroup.append(actionLabel, actionSelect)

  const logicGroup = doc.createElement('div')
  logicGroup.className = 'chaospace-rule-row'
  const logicLabel = doc.createElement('label')
  logicLabel.textContent = '条件匹配方式'
  const logicSelect = doc.createElement('select')
  logicSelect.dataset['field'] = 'logic'
  logicSelect.innerHTML = `
    <option value="all">全部满足（AND）</option>
    <option value="any">任意满足（OR）</option>
  `
  logicSelect.value = rule?.logic ?? 'all'
  logicGroup.append(logicLabel, logicSelect)

  const conditionList = doc.createElement('div')
  conditionList.className = 'chaospace-condition-list'
  conditionList.dataset['role'] = 'condition-list'
  if (rule?.conditions?.length) {
    rule.conditions.forEach((condition) => {
      conditionList.appendChild(createConditionCard(doc, condition.type, condition))
    })
  } else {
    conditionList.appendChild(createConditionCard(doc, 'name'))
  }

  const addCondition = createButton(doc, '添加条件', 'add-condition')
  addCondition.classList.add('chaospace-rule-add-condition')

  body.append(descriptionGroup, actionGroup, logicGroup, conditionList, addCondition)

  card.append(header, body)
  setCardCollapsed(card, false)

  return card
}

function buildConditionBody(
  doc: Document,
  container: HTMLElement,
  type: FileFilterConditionType,
  condition?: FileFilterCondition,
): void {
  const body = doc.createElement('div')
  body.className = 'chaospace-condition-body'

  switch (type) {
    case 'size': {
      const operatorSelect = doc.createElement('select')
      operatorSelect.dataset['field'] = 'operator'
      operatorSelect.innerHTML = `
        <option value="eq">等于</option>
        <option value="lt">小于</option>
        <option value="lte">小于等于</option>
        <option value="gt">大于</option>
        <option value="gte">大于等于</option>
      `
      operatorSelect.value =
        (condition && 'operator' in condition ? condition.operator : 'gte') ?? 'gte'
      const valueInput = doc.createElement('input')
      valueInput.type = 'text'
      valueInput.dataset['field'] = 'value'
      valueInput.placeholder = '例如 500MB 或 1024'
      valueInput.value =
        condition && condition.type === 'size' && Number.isFinite(condition.value)
          ? String(condition.value)
          : ''

      const hint = doc.createElement('p')
      hint.className = 'chaospace-condition-hint'
      hint.textContent = '支持 KB/MB/GB 等单位，不填单位默认为字节。'

      body.append(operatorSelect, valueInput, hint)
      break
    }
    case 'name': {
      const modeSelect = doc.createElement('select')
      modeSelect.dataset['field'] = 'mode'
      modeSelect.innerHTML = `
        <option value="includes">包含</option>
        <option value="startsWith">前缀是</option>
        <option value="endsWith">后缀是</option>
      `
      modeSelect.value = condition && condition.type === 'name' ? condition.mode : 'includes'

      const valueInput = doc.createElement('input')
      valueInput.type = 'text'
      valueInput.dataset['field'] = 'value'
      valueInput.placeholder = '关键字，支持多个词用空格分隔'
      valueInput.value = condition && condition.type === 'name' ? condition.value : ''

      const caseLabel = doc.createElement('label')
      caseLabel.className = 'chaospace-inline-control'
      const caseCheckbox = doc.createElement('input')
      caseCheckbox.type = 'checkbox'
      caseCheckbox.dataset['field'] = 'caseSensitive'
      caseCheckbox.checked = Boolean(
        condition && condition.type === 'name' && condition.caseSensitive,
      )
      const caseText = doc.createElement('span')
      caseText.textContent = '区分大小写'
      caseLabel.append(caseCheckbox, caseText)

      body.append(modeSelect, valueInput, caseLabel)
      break
    }
    case 'regex': {
      const patternInput = doc.createElement('input')
      patternInput.type = 'text'
      patternInput.dataset['field'] = 'pattern'
      patternInput.placeholder = '正则表达式，例如 (1080p)'
      patternInput.value = condition && condition.type === 'regex' ? condition.pattern : ''

      const flagsInput = doc.createElement('input')
      flagsInput.type = 'text'
      flagsInput.dataset['field'] = 'flags'
      flagsInput.placeholder = 'flags（默认 g，可选 i m s u y）'
      flagsInput.value = condition && condition.type === 'regex' ? condition.flags || 'g' : 'g'

      body.append(patternInput, flagsInput)
      break
    }
    case 'extension': {
      const operatorSelect = doc.createElement('select')
      operatorSelect.dataset['field'] = 'operator'
      operatorSelect.innerHTML = `
        <option value="in">仅保留这些扩展名</option>
        <option value="not-in">排除这些扩展名</option>
      `
      operatorSelect.value = condition && condition.type === 'extension' ? condition.operator : 'in'

      const valuesInput = doc.createElement('input')
      valuesInput.type = 'text'
      valuesInput.dataset['field'] = 'values'
      valuesInput.placeholder = '多个扩展名用逗号或空格分隔，如 mkv, mp4'
      valuesInput.value =
        condition && condition.type === 'extension' ? condition.values.join(', ') : ''

      body.append(operatorSelect, valuesInput)
      break
    }
    case 'category': {
      const operatorSelect = doc.createElement('select')
      operatorSelect.dataset['field'] = 'operator'
      operatorSelect.innerHTML = `
        <option value="in">仅保留这些类型</option>
        <option value="not-in">排除这些类型</option>
      `
      operatorSelect.value = condition && condition.type === 'category' ? condition.operator : 'in'

      const valuesWrapper = doc.createElement('div')
      valuesWrapper.className = 'chaospace-category-options'
      valuesWrapper.dataset['field'] = 'values'
      const activeValues =
        condition && condition.type === 'category' ? new Set(condition.values) : new Set()
      CATEGORY_OPTIONS.forEach(({ value, label }) => {
        const optionLabel = doc.createElement('label')
        optionLabel.className = 'chaospace-inline-control'
        const optionInput = doc.createElement('input')
        optionInput.type = 'checkbox'
        optionInput.value = value
        optionInput.checked = activeValues.has(value)
        const optionText = doc.createElement('span')
        optionText.textContent = label
        optionLabel.append(optionInput, optionText)
        valuesWrapper.append(optionLabel)
      })

      body.append(operatorSelect, valuesWrapper)
      break
    }
    case 'isDir': {
      const valueSelect = doc.createElement('select')
      valueSelect.dataset['field'] = 'value'
      valueSelect.innerHTML = `
        <option value="true">仅目录</option>
        <option value="false">仅文件</option>
      `
      valueSelect.value =
        condition && condition.type === 'isDir' ? String(condition.value) : 'false'
      body.append(valueSelect)
      break
    }
    default: {
      break
    }
  }

  container.appendChild(body)
}

function createConditionCard(
  doc: Document,
  type: FileFilterConditionType,
  condition?: FileFilterCondition,
): HTMLElement {
  const card = doc.createElement('div')
  card.className = 'chaospace-condition-card'
  card.dataset['conditionId'] = nextConditionId()
  card.dataset['conditionType'] = type

  const header = doc.createElement('div')
  header.className = 'chaospace-condition-header'

  const typeSelect = doc.createElement('select')
  typeSelect.dataset['field'] = 'type'
  typeSelect.innerHTML = `
    <option value="name">文件名</option>
    <option value="regex">正则匹配</option>
    <option value="size">文件大小</option>
    <option value="extension">扩展名</option>
    <option value="category">文件类型</option>
    <option value="isDir">目录状态</option>
  `
  typeSelect.value = type

  const typeLabel = doc.createElement('span')
  typeLabel.className = 'chaospace-condition-title'
  typeLabel.textContent = CONDITION_LABELS[type]

  const negateLabel = doc.createElement('label')
  negateLabel.className = 'chaospace-inline-control'
  const negateCheckbox = doc.createElement('input')
  negateCheckbox.type = 'checkbox'
  negateCheckbox.dataset['field'] = 'negate'
  negateCheckbox.checked = Boolean(condition?.negate)
  const negateText = doc.createElement('span')
  negateText.textContent = '取反'
  negateLabel.append(negateCheckbox, negateText)

  const removeBtn = createButton(doc, '移除', 'remove-condition')

  header.append(typeSelect, typeLabel, negateLabel, removeBtn)
  card.appendChild(header)

  const updateBody = (nextType: FileFilterConditionType) => {
    card.dataset['conditionType'] = nextType
    const existingBody = card.querySelector('.chaospace-condition-body')
    if (existingBody) {
      existingBody.remove()
    }
    buildConditionBody(
      doc,
      card,
      nextType,
      condition && condition.type === nextType ? condition : undefined,
    )
    typeLabel.textContent = CONDITION_LABELS[nextType]
  }

  typeSelect.addEventListener('change', () => {
    const nextType = typeSelect.value as FileFilterConditionType
    condition = undefined
    updateBody(nextType)
  })

  updateBody(type)

  return card
}

function getField<T extends HTMLElement>(root: HTMLElement, selector: string): T | null {
  return root.querySelector<T>(selector)
}

function setInvalid(element: HTMLElement | null, message?: string): void {
  if (!element) {
    return
  }
  element.classList.add('is-invalid')
  if (message) {
    element.dataset['invalidMessage'] = message
  }
}

function clearInvalid(element: HTMLElement | null): void {
  if (!element) {
    return
  }
  element.classList.remove('is-invalid')
  delete element.dataset['invalidMessage']
}

function collectCondition(
  card: HTMLElement,
  errors: string[],
  ruleIndex: number,
): FileFilterCondition | null {
  const typeSelect = getField<HTMLSelectElement>(card, 'select[data-field="type"]')
  const type = (typeSelect?.value as FileFilterConditionType) || 'name'

  let condition: FileFilterCondition | null = null
  const negate = Boolean(getField<HTMLInputElement>(card, 'input[data-field="negate"]')?.checked)

  const body = card.querySelector('.chaospace-condition-body') as HTMLElement | null
  const label = CONDITION_LABELS[type] || '条件'

  const invalidMessage = (detail: string) => `规则 ${ruleIndex + 1} 的「${label}」${detail}`

  if (body) {
    body.querySelectorAll('.is-invalid').forEach((node) => {
      clearInvalid(node as HTMLElement)
    })
  }

  switch (type) {
    case 'size': {
      const operator = getField<HTMLSelectElement>(card, 'select[data-field="operator"]')?.value as
        | 'eq'
        | 'lt'
        | 'lte'
        | 'gt'
        | 'gte'
        | undefined
      const rawValue = getField<HTMLInputElement>(card, 'input[data-field="value"]')?.value ?? ''
      const parsed = parseSizeInput(rawValue || undefined)
      if (!operator) {
        errors.push(invalidMessage('需要选择比较方式'))
        setInvalid(getField(card, 'select[data-field="operator"]'))
        return null
      }
      if (parsed === null) {
        errors.push(invalidMessage('需要填写有效的体积数值'))
        setInvalid(getField(card, 'input[data-field="value"]'))
        return null
      }
      condition = { type, operator, value: parsed, negate }
      break
    }
    case 'name': {
      const mode = getField<HTMLSelectElement>(card, 'select[data-field="mode"]')?.value as
        | 'includes'
        | 'startsWith'
        | 'endsWith'
        | undefined
      const value =
        getField<HTMLInputElement>(card, 'input[data-field="value"]')?.value.trim() ?? ''
      const caseSensitive = Boolean(
        getField<HTMLInputElement>(card, 'input[data-field="caseSensitive"]')?.checked,
      )
      if (!mode) {
        errors.push(invalidMessage('需要选择匹配方式'))
        setInvalid(getField(card, 'select[data-field="mode"]'))
        return null
      }
      if (!value) {
        errors.push(invalidMessage('关键字不能为空'))
        setInvalid(getField(card, 'input[data-field="value"]'))
        return null
      }
      condition = { type, mode, value, caseSensitive, negate }
      break
    }
    case 'regex': {
      const pattern =
        getField<HTMLInputElement>(card, 'input[data-field="pattern"]')?.value.trim() ?? ''
      const flagsInput = getField<HTMLInputElement>(card, 'input[data-field="flags"]')
      const flagsRaw = flagsInput?.value ?? 'g'
      const flags = sanitizeRegexFlags(flagsRaw)
      if (!pattern) {
        errors.push(invalidMessage('需要填写正则表达式'))
        setInvalid(getField(card, 'input[data-field="pattern"]'))
        return null
      }
      condition = { type, pattern, flags, negate }
      if (flagsInput) {
        flagsInput.value = flags
      }
      break
    }
    case 'extension': {
      const operator = getField<HTMLSelectElement>(card, 'select[data-field="operator"]')?.value as
        | 'in'
        | 'not-in'
        | undefined
      const valuesRaw = getField<HTMLInputElement>(card, 'input[data-field="values"]')?.value ?? ''
      const values = parseExtensions(valuesRaw)
      if (!operator) {
        errors.push(invalidMessage('需要选择模式'))
        setInvalid(getField(card, 'select[data-field="operator"]'))
        return null
      }
      if (!values.length) {
        errors.push(invalidMessage('至少填写一个扩展名'))
        setInvalid(getField(card, 'input[data-field="values"]'))
        return null
      }
      condition = { type, operator, values, negate }
      break
    }
    case 'category': {
      const operator = getField<HTMLSelectElement>(card, 'select[data-field="operator"]')?.value as
        | 'in'
        | 'not-in'
        | undefined
      const valuesRoot = getField<HTMLDivElement>(card, 'div[data-field="values"]')
      const checked = valuesRoot
        ? Array.from(valuesRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
            .filter((input) => input.checked)
            .map((input) => input.value as FileCategory)
        : []
      if (!operator) {
        errors.push(invalidMessage('需要选择模式'))
        setInvalid(getField(card, 'select[data-field="operator"]'))
        return null
      }
      if (!checked.length) {
        errors.push(invalidMessage('至少选择一个文件类型'))
        setInvalid(valuesRoot)
        return null
      }
      condition = { type, operator, values: checked, negate }
      break
    }
    case 'isDir': {
      const valueRaw = getField<HTMLSelectElement>(card, 'select[data-field="value"]')?.value
      if (valueRaw !== 'true' && valueRaw !== 'false') {
        errors.push(invalidMessage('请选择目录或文件'))
        setInvalid(getField(card, 'select[data-field="value"]'))
        return null
      }
      condition = { type, value: valueRaw === 'true', negate }
      break
    }
    default:
      errors.push(invalidMessage('配置不完整'))
      return null
  }
  return condition
}

function collectRule(card: HTMLElement, index: number, errors: string[]): FileFilterRule | null {
  card.classList.remove('is-invalid')
  card.querySelectorAll('.is-invalid').forEach((node) => node.classList.remove('is-invalid'))

  const name = getField<HTMLInputElement>(card, 'input[data-field="name"]')?.value.trim()
  const description =
    getField<HTMLInputElement>(card, 'input[data-field="description"]')?.value.trim() ?? ''
  const enabled = Boolean(getField<HTMLInputElement>(card, 'input[data-field="enabled"]')?.checked)
  const action = getField<HTMLSelectElement>(card, 'select[data-field="action"]')?.value as
    | FileFilterAction
    | undefined
  const logic = getField<HTMLSelectElement>(card, 'select[data-field="logic"]')?.value as
    | FileFilterLogic
    | undefined

  if (!action) {
    errors.push(`规则 ${index + 1} 需要选择命中行为`)
    setInvalid(getField(card, 'select[data-field="action"]'))
    card.classList.add('is-invalid')
    return null
  }
  if (!logic) {
    errors.push(`规则 ${index + 1} 需要选择条件匹配方式`)
    setInvalid(getField(card, 'select[data-field="logic"]'))
    card.classList.add('is-invalid')
    return null
  }

  const conditionCards = Array.from(card.querySelectorAll<HTMLElement>('[data-condition-id]'))

  if (!conditionCards.length) {
    errors.push(`规则 ${index + 1} 需至少添加一个条件`)
    card.classList.add('is-invalid')
    return null
  }

  const conditions: FileFilterCondition[] = []
  conditionCards.forEach((conditionCard) => {
    const condition = collectCondition(conditionCard, errors, index)
    if (condition) {
      conditions.push(condition)
    }
  })

  if (!conditions.length) {
    card.classList.add('is-invalid')
    return null
  }

  const rule: FileFilterRule = {
    action,
    logic,
    enabled,
    conditions,
  }
  if (name) {
    rule.name = name
  }
  if (description) {
    rule.description = description
  }
  return rule
}

export function createFileFilterEditor(
  host: HTMLElement,
  { document }: CreateEditorOptions,
): FileFilterEditor {
  host.innerHTML = ''
  host.classList.add('chaospace-rule-editor-root')

  const errorEl = document.createElement('div')
  errorEl.className = 'chaospace-rule-editor-error'
  errorEl.hidden = true

  const list = document.createElement('div')
  list.className = 'chaospace-rule-editor-list'

  const emptyState = document.createElement('div')
  emptyState.className = 'chaospace-rule-empty'
  emptyState.textContent = '尚未添加过滤规则'

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

  function attachRuleCard(card: HTMLElement): void {
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
      if (action === 'add-condition') {
        const container = card.querySelector<HTMLElement>('[data-role="condition-list"]')
        if (!container) {
          return
        }
        container.appendChild(createConditionCard(document, 'name'))
        return
      }
      if (action === 'remove-condition') {
        const condition = target.closest<HTMLElement>('[data-condition-id]')
        if (condition) {
          const container = condition.parentElement
          condition.remove()
          if (container && !container.querySelector('[data-condition-id]')) {
            container.appendChild(createConditionCard(document, 'name'))
          }
        }
        return
      }
      if (action === 'toggle-collapse') {
        toggleCardCollapsed(card)
        return
      }
    })

    card.addEventListener('change', (event) => {
      const target = event.target as HTMLElement
      if (!(target instanceof HTMLElement)) {
        return
      }
      if (target.matches('select[data-field="type"]')) {
        const condition = target.closest<HTMLElement>('[data-condition-id]')
        if (!condition) {
          return
        }
        const nextType = (target as HTMLSelectElement).value as FileFilterConditionType
        const existingBody = condition.querySelector('.chaospace-condition-body')
        if (existingBody) {
          existingBody.remove()
        }
        buildConditionBody(document, condition, nextType)
        condition.dataset['conditionType'] = nextType
      }
      clearInvalid(target as HTMLElement)
      const parentInvalid = target.closest('.is-invalid') as HTMLElement | null
      if (parentInvalid) {
        parentInvalid.classList.remove('is-invalid')
      }
    })
  }

  addButton.addEventListener('click', () => {
    const card = createRuleCard(document)
    list.appendChild(card)
    attachRuleCard(card)
    refreshEmptyState()
    card.scrollIntoView({ block: 'nearest' })
  })

  function render(rules: FileFilterRule[]): void {
    list.innerHTML = ''
    errorEl.hidden = true
    if (!rules.length) {
      const card = createRuleCard(document)
      list.appendChild(card)
      attachRuleCard(card)
      refreshEmptyState()
      return
    }
    rules.forEach((rule) => {
      const card = createRuleCard(document, rule)
      list.appendChild(card)
      attachRuleCard(card)
    })
    refreshEmptyState()
  }

  function collect(_: CollectOptions = {}): CollectResult {
    const errors: string[] = []
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-rule-id]'))
    const rules: FileFilterRule[] = []

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
      conditions: rule.conditions.map((condition) => ({ ...condition })),
    }))
    return { rules: cloned, errors: [] }
  }

  function focusFirstInvalid(): void {
    const firstInvalid =
      list.querySelector<HTMLElement>(
        '.is-invalid input, .is-invalid select, .is-invalid textarea',
      ) ?? list.querySelector<HTMLElement>('.is-invalid')
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
