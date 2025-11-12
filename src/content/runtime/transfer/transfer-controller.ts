import { state } from '../../state'
import type { createHistoryController } from '../../history/controller'
import type { createPanelPreferencesController } from '../../controllers/panel-preferences'
import type { createLoggingController } from '../../controllers/logging-controller'
import type { PanelBaseDirDomRefs, ResourceItem } from '../../types'
import { computeItemTargetPath, getTargetPath } from '../../services/season-manager'
import { normalizePageUrl } from '@/providers/sites/chaospace/page-analyzer'
import { showToast } from '../../components/toast'
import type { TabSeasonPreferenceController } from '../../services/tab-season-preference'
import { getContentProviderRegistry } from '@/content/providers/registry'
import type { SiteResourceItem, TransferContext } from '@/platform/registry'
import type { TransferJobMeta, TransferRequestPayload } from '@/shared/types/transfer'
import { chaosLogger } from '@/shared/log'
import { CHAOSPACE_SITE_PROVIDER_ID } from '@/providers/sites/chaospace/chaospace-site-provider'

export interface TransferController {
  handleTransfer: () => Promise<void>
  handleProgressEvent: (progress: unknown) => void
  setControlsDisabled: (disabled: boolean) => void
}

async function composeTransferRequestPayload(
  selectedItems: ResourceItem[],
  targetDirectory: string,
): Promise<TransferRequestPayload> {
  const providerPayload = await buildSiteProviderPayload(selectedItems)
  const items = buildTransferItems(selectedItems, targetDirectory, providerPayload)
  const origin = resolveTransferOrigin(providerPayload?.origin)
  const meta = buildTransferMeta(selectedItems.length, targetDirectory, providerPayload?.meta)
  const payload: TransferRequestPayload = {
    origin,
    items,
    targetDirectory,
    meta,
  }
  if (state.jobId) {
    payload.jobId = state.jobId
  }
  return payload
}

async function buildSiteProviderPayload(
  selectedItems: ResourceItem[],
): Promise<TransferRequestPayload | null> {
  if (!selectedItems.length) {
    return null
  }
  const providerId = resolveTransferSiteProviderId()
  if (!providerId) {
    return null
  }
  const provider = providerRegistry.getSiteProvider(providerId)
  if (!provider || typeof provider.buildTransferPayload !== 'function') {
    return null
  }
  const documentRef = typeof document !== 'undefined' ? document : null
  const selection: SiteResourceItem[] = selectedItems.map((item, index) =>
    mapResourceItemToSiteResource(item, index),
  )
  const context: TransferContext = {
    url: coerceString(state.pageUrl) ?? (typeof window !== 'undefined' ? window.location.href : ''),
    document: documentRef,
    timestamp: Date.now(),
    siteProviderId: providerId,
    extras: {
      origin: resolveTransferOrigin(),
      pageTitle: coerceString(state.pageTitle) || (documentRef?.title ?? ''),
    },
  }
  try {
    return (await provider.buildTransferPayload({ context, selection })) ?? null
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    chaosLogger.warn('[Pan Transfer] Provider transfer payload build failed', {
      providerId,
      message,
    })
    return null
  }
}

function buildTransferItems(
  selectedItems: ResourceItem[],
  targetDirectory: string,
  providerPayload: TransferRequestPayload | null,
): TransferRequestPayload['items'] {
  const providerItems = buildProviderItemMap(providerPayload?.items)
  return selectedItems.map((item) => {
    const normalizedId = normalizeItemId(item.id)
    const providerItem = normalizedId ? providerItems.get(normalizedId) : null
    const linkUrl = coerceString(providerItem?.linkUrl) ?? coerceString(item.linkUrl)
    const passCode = coerceString(providerItem?.passCode) ?? coerceString(item.passCode)
    const payloadItem: TransferRequestPayload['items'][number] = {
      id: item.id,
      title: item.title,
      targetPath: computeItemTargetPath(item, targetDirectory),
    }
    if (linkUrl) {
      payloadItem.linkUrl = linkUrl
    }
    if (passCode) {
      payloadItem.passCode = passCode
    }
    return payloadItem
  })
}

function buildProviderItemMap(
  items: TransferRequestPayload['items'] | undefined,
): Map<string, TransferRequestPayload['items'][number]> {
  const map = new Map<string, TransferRequestPayload['items'][number]>()
  if (!items) {
    return map
  }
  items.forEach((item) => {
    const normalizedId = normalizeItemId(item.id)
    if (normalizedId) {
      map.set(normalizedId, item)
    }
  })
  return map
}

function buildTransferMeta(
  total: number,
  targetDirectory: string,
  providerMeta: TransferRequestPayload['meta'] | undefined,
): TransferJobMeta {
  const meta: TransferJobMeta = {
    ...(providerMeta ?? {}),
    total,
  }
  meta.baseDir = state.baseDir
  meta.useTitleSubdir = state.useTitleSubdir
  meta.useSeasonSubdir = state.useSeasonSubdir
  meta.pageTitle = meta.pageTitle || coerceString(state.pageTitle) || (document?.title ?? '')
  meta.pageUrl =
    meta.pageUrl || coerceString(state.pageUrl) || normalizePageUrl(window.location.href)
  meta.pageType = meta.pageType || (state.items.length > 1 ? 'series' : 'movie')
  meta.targetDirectory = targetDirectory
  meta.seasonDirectory = state.useSeasonSubdir ? { ...(state.seasonDirMap || {}) } : null
  const mergedSeasonCompletion = {
    ...(providerMeta?.seasonCompletion ?? {}),
    ...(state.seasonCompletion ?? {}),
  }
  meta.seasonCompletion = mergedSeasonCompletion
  if (state.completion !== undefined) {
    meta.completion = state.completion ?? null
  } else if (meta.completion === undefined) {
    meta.completion = null
  }
  if (Array.isArray(state.seasonEntries) && state.seasonEntries.length) {
    meta.seasonEntries = [...state.seasonEntries]
  } else if (!meta.seasonEntries) {
    meta.seasonEntries = providerMeta?.seasonEntries ?? []
  }
  if (state.poster?.src) {
    meta.poster = { src: state.poster.src, alt: state.poster.alt || '' }
  } else if (!meta.poster) {
    meta.poster = null
  }
  const providerId =
    coerceString(meta.siteProviderId) ||
    coerceString(state.activeSiteProviderId) ||
    coerceString(state.manualSiteProviderId)
  if (providerId) {
    meta.siteProviderId = providerId
  } else {
    delete meta.siteProviderId
  }
  const providerLabel =
    coerceString(meta.siteProviderLabel) || coerceString(state.activeSiteProviderLabel)
  if (providerLabel) {
    meta.siteProviderLabel = providerLabel
  } else {
    delete meta.siteProviderLabel
  }
  return meta
}

function resolveTransferOrigin(candidate?: string): string {
  const resolved = coerceString(candidate)
  if (resolved) {
    return resolved
  }
  if (coerceString(state.origin)) {
    return state.origin
  }
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

function resolveTransferSiteProviderId(): string | null {
  const active = coerceString(state.activeSiteProviderId)
  if (active) {
    return active
  }
  const manual = coerceString(state.manualSiteProviderId)
  if (manual) {
    return manual
  }
  return CHAOSPACE_SITE_PROVIDER_ID
}

function mapResourceItemToSiteResource(item: ResourceItem, index: number): SiteResourceItem {
  const resource: SiteResourceItem = {
    id: normalizeItemId(item.id) ?? `resource-${index + 1}`,
    title: coerceString(item.title) || `资源 ${index + 1}`,
  }
  const linkUrl = coerceString(item.linkUrl)
  if (linkUrl) {
    resource.linkUrl = linkUrl
  }
  const passCode = coerceString(item.passCode)
  if (passCode) {
    resource.passCode = passCode
  }
  if (Array.isArray(item.tags) && item.tags.length) {
    resource.tags = item.tags
      .map((tag) => coerceString(tag))
      .filter((tag): tag is string => Boolean(tag))
  }
  const meta: Record<string, unknown> = {}
  if (typeof item.order === 'number' && Number.isFinite(item.order)) {
    meta['order'] = item.order
  }
  if (item.seasonId) {
    meta['seasonId'] = item.seasonId
  }
  if (item.seasonLabel) {
    meta['seasonLabel'] = item.seasonLabel
  }
  if (typeof item.seasonIndex === 'number' && Number.isFinite(item.seasonIndex)) {
    meta['seasonIndex'] = item.seasonIndex
  }
  if (item.seasonUrl) {
    meta['seasonUrl'] = item.seasonUrl
  }
  if (item.seasonCompletion !== undefined) {
    meta['seasonCompletion'] = item.seasonCompletion
  }
  if (Object.keys(meta).length) {
    resource.meta = meta
  }
  return resource
}

function normalizeItemId(id: unknown): string | null {
  if (typeof id === 'string' && id.trim()) {
    return id.trim()
  }
  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id)
  }
  return null
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type HistoryController = ReturnType<typeof createHistoryController>
type PanelPreferencesController = ReturnType<typeof createPanelPreferencesController>
type LoggingController = ReturnType<typeof createLoggingController>

const providerRegistry = getContentProviderRegistry()

interface TransferResponsePayload {
  ok: boolean
  error?: string
  results?: Array<{ status?: string }>
  summary?: string
}

function isTransferResponsePayload(value: unknown): value is TransferResponsePayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  return 'ok' in value && typeof (value as { ok?: unknown }).ok === 'boolean'
}

export function createTransferController(deps: {
  panelDom: PanelBaseDirDomRefs
  logging: LoggingController
  preferences: PanelPreferencesController
  history: HistoryController
  getFloatingPanel: () => HTMLElement | null
  updateTransferButton: () => void
  renderPathPreview: () => void
  seasonPreference: TabSeasonPreferenceController
}): TransferController {
  const {
    panelDom,
    logging,
    preferences,
    history,
    getFloatingPanel,
    updateTransferButton,
    renderPathPreview,
    seasonPreference,
  } = deps

  const setControlsDisabled = (disabled: boolean): void => {
    if (panelDom.baseDirInput) panelDom.baseDirInput.disabled = disabled
    if (panelDom.useTitleCheckbox) panelDom.useTitleCheckbox.disabled = disabled
    if (panelDom.useSeasonCheckbox) panelDom.useSeasonCheckbox.disabled = disabled
    if (panelDom.addPresetButton) panelDom.addPresetButton.disabled = disabled
    state.toolbarDisabled = disabled
    state.presetsDisabled = disabled
  }

  const handleProgressEvent = (progress: unknown): void => {
    if (!progress || typeof progress !== 'object') {
      return
    }
    const payload = progress as {
      jobId?: string | null
      message?: string
      level?: string
      detail?: string
      stage?: string
      statusMessage?: string
      current?: number
      total?: number
    }
    if (!payload.jobId || payload.jobId !== state.jobId) {
      return
    }
    if (payload.message) {
      logging.pushLog(payload.message, {
        level: (payload.level as never) || 'info',
        detail: payload.detail || '',
        stage: payload.stage || '',
      })
    }
    if (payload.statusMessage) {
      state.statusMessage = payload.statusMessage
      logging.renderStatus()
    } else if (typeof payload.current === 'number' && typeof payload.total === 'number') {
      state.statusMessage = `正在处理 ${payload.current}/${payload.total}`
      logging.renderStatus()
    }
  }

  const handleTransfer = async (): Promise<void> => {
    if (!getFloatingPanel() || state.transferStatus === 'running') {
      return
    }

    if (state.historyExpanded) {
      history.setHistoryExpanded(false)
    }

    const selectedItems: ResourceItem[] = state.items.filter((item) =>
      state.selectedIds.has(item.id),
    )
    if (!selectedItems.length) {
      showToast('warning', '请选择资源', '至少勾选一个百度网盘资源再开始转存哦～')
      return
    }

    const baseDirValue = panelDom.baseDirInput ? panelDom.baseDirInput.value : state.baseDir
    preferences.setBaseDir(baseDirValue)

    if (panelDom.useTitleCheckbox) {
      state.useTitleSubdir = panelDom.useTitleCheckbox.checked
      void preferences.saveSettings()
    }
    if (panelDom.useSeasonCheckbox) {
      const nextSeasonValue = Boolean(panelDom.useSeasonCheckbox.checked)
      if (nextSeasonValue !== state.useSeasonSubdir) {
        await seasonPreference.applyUserSelection(nextSeasonValue)
      }
    }

    const targetDirectory = getTargetPath(state.baseDir, state.useTitleSubdir, state.pageTitle)

    state.jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    state.lastResult = null
    state.transferStatus = 'running'
    state.statusMessage = '正在准备转存...'
    logging.resetLogs()
    logging.pushLog('已锁定资源清单，准备开始转存', { stage: 'init' })
    logging.renderStatus()
    renderPathPreview()
    updateTransferButton()
    setControlsDisabled(true)

    try {
      const payload = await composeTransferRequestPayload(selectedItems, targetDirectory)

      logging.pushLog(`向后台发送 ${selectedItems.length} 条转存请求`, {
        stage: 'dispatch',
      })

      const response = (await chrome.runtime.sendMessage({
        type: 'chaospace:transfer',
        payload,
      })) as unknown

      if (!isTransferResponsePayload(response)) {
        throw new Error('未收到后台响应')
      }
      if (!response.ok) {
        const message = typeof response.error === 'string' ? response.error : '后台执行失败'
        throw new Error(message)
      }

      const results = Array.isArray(response.results) ? response.results : []
      const summary = typeof response.summary === 'string' ? response.summary : ''
      const success = results.filter((r) => r.status === 'success').length
      const failed = results.filter((r) => r.status === 'failed').length
      const skipped = results.filter((r) => r.status === 'skipped').length
      const emoji = failed === 0 ? '🎯' : success > 0 ? '🟡' : '💥'
      const title = failed === 0 ? '转存成功' : success > 0 ? '部分成功' : '全部失败'

      state.lastResult = {
        title: `${emoji} ${title}`,
        detail: `成功 ${success} · 跳过 ${skipped} · 失败 ${failed}`,
      }

      logging.pushLog(`后台执行完成：${summary}`, {
        stage: 'complete',
        level: failed === 0 ? 'success' : 'warning',
      })
      logging.setStatus(failed === 0 ? 'success' : 'error', `${title}：${summary}`)

      await history.loadHistory()

      showToast(
        failed === 0 ? 'success' : success > 0 ? 'warning' : 'error',
        `${emoji} ${title}`,
        `已保存到 ${targetDirectory}`,
        { success, failed, skipped },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '后台执行发生未知错误'
      logging.pushLog(message, { level: 'error', stage: 'error' })
      logging.setStatus('error', `转存失败：${message}`)
      showToast('error', '转存失败', message)
    } finally {
      if (state.transferStatus === 'running') {
        logging.setStatus('idle', '准备就绪 ✨')
      }
      updateTransferButton()
      setControlsDisabled(false)
      state.jobId = null
      state.transferStatus = 'idle'
    }
  }

  return {
    handleTransfer,
    handleProgressEvent,
    setControlsDisabled,
  }
}
