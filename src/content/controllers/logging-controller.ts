import { MAX_LOG_ENTRIES } from '../constants'
import type { LogEntry, LogLevel, PanelLoggingDomRefs, TransferStatus } from '../types'
import type { ContentStore } from '../state'

interface LoggingControllerDeps {
  state: ContentStore
  panelDom: PanelLoggingDomRefs
  document: Document
}

interface PushLogOptions {
  level?: LogLevel
  detail?: string
  stage?: string
}

const STAGE_LABEL_MAP: Record<string, string> = {
  bstToken: '🔐 bdstoken',
  list: '📂 列表',
  verify: '✅ 验证',
  transfer: '🚚 转存',
  item: '🎯 项目',
  bootstrap: '⚙️ 启动',
  prepare: '🧭 准备',
  dispatch: '📤 派发',
  summary: '🧮 汇总',
  complete: '✅ 完成',
  fatal: '💥 故障',
  init: '🚦 初始化',
  error: '⛔ 错误',
  filter: '🧹 过滤',
  rename: '✏️ 重命名',
}

const STATUS_EMOJI_MAP: Record<TransferStatus, string> = {
  idle: '🌙',
  running: '⚙️',
  success: '🎉',
  error: '⚠️',
}

function formatStageLabel(stage?: string | null): string {
  if (!stage) {
    return '📡 进度'
  }
  const stageKey = String(stage)
  const base = stageKey.split(':')[0] || stageKey
  return STAGE_LABEL_MAP[stageKey] || STAGE_LABEL_MAP[base] || stageKey
}

export function createLoggingController({ state, panelDom, document }: LoggingControllerDeps) {
  function renderLogs(): void {
    const list = panelDom.logList
    list.innerHTML = ''

    if (!state.logs.length) {
      panelDom.logContainer.classList.add('is-empty')
      return
    }

    panelDom.logContainer.classList.remove('is-empty')

    const entries = [...state.logs].reverse()
    entries.forEach((entry, index) => {
      const li = document.createElement('li')
      li.className = `chaospace-log-item chaospace-log-${entry.level}`
      li.dataset['logId'] = entry.id
      li.dataset['stage'] = entry.stage || ''
      const stageLabel = formatStageLabel(entry.stage)
      const animationDelay = `${Math.min(index * 40, 200)}ms`
      li.style.setProperty('--chaospace-log-delay', animationDelay)
      li.innerHTML = `
        <span class="chaospace-log-stage">${stageLabel}</span>
        <div class="chaospace-log-content">
          <span class="chaospace-log-message">${entry.message}</span>
          ${entry.detail ? `<span class="chaospace-log-detail">${entry.detail}</span>` : ''}
        </div>
      `
      list.appendChild(li)
      requestAnimationFrame(() => {
        li.classList.add('is-visible')
      })
    })

    const logWrapper = panelDom.logContainer
    requestAnimationFrame(() => {
      logWrapper.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    })
  }

  function resetLogs(): void {
    state.logs = []
    renderLogs()
  }

  function pushLog(message: string, options: PushLogOptions = {}): void {
    const { level = 'info', detail = '', stage = '' } = options
    const lastEntry = state.logs[state.logs.length - 1]
    if (
      lastEntry &&
      lastEntry.message === message &&
      lastEntry.stage === stage &&
      lastEntry.detail === detail &&
      lastEntry.level === level
    ) {
      return
    }
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      message,
      detail,
      level,
      stage,
    }
    state.logs = [...state.logs.slice(-(MAX_LOG_ENTRIES - 1)), entry]
    renderLogs()
  }

  function renderStatus(): void {
    const status = state.transferStatus
    const emoji = STATUS_EMOJI_MAP[status] || 'ℹ️'
    if (panelDom.statusText) {
      panelDom.statusText.innerHTML = `<span class="chaospace-status-emoji">${emoji}</span>${state.statusMessage}`
    }

    if (!state.lastResult) {
      panelDom.resultSummary.innerHTML = ''
      panelDom.resultSummary.classList.add('is-empty')
    } else {
      panelDom.resultSummary.classList.remove('is-empty')
      const result = state.lastResult as { title?: string; detail?: string }
      const title = result.title || ''
      const detail = result.detail || ''
      panelDom.resultSummary.innerHTML = `
        <span class="chaospace-log-summary-title">${title}</span>
        ${detail ? `<span class="chaospace-log-summary-detail">${detail}</span>` : ''}
      `
    }
  }

  function setStatus(status: TransferStatus, message?: string): void {
    state.transferStatus = status
    if (message) {
      state.statusMessage = message
    }
    renderStatus()
  }

  return {
    resetLogs,
    pushLog,
    renderStatus,
    setStatus,
    renderLogs,
  }
}
