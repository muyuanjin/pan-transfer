import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createHistoryListActionHandlers,
  type HistoryController,
  type HistoryDetailActionParams,
} from '../history-context'

function createHistoryStub() {
  const spies = {
    setHistorySelection: vi.fn(),
    setHistorySeasonExpanded: vi.fn(),
    openHistoryDetail: vi.fn(),
    triggerHistoryUpdate: vi.fn().mockResolvedValue(null),
    toggleHistoryExpanded: vi.fn(),
  }
  return {
    history: spies as unknown as HistoryController,
    spies,
  }
}

describe('history-context action handlers', () => {
  let history: HistoryController
  let spies: ReturnType<typeof createHistoryStub>['spies']
  let openWindow: ReturnType<typeof vi.fn>
  let openZoomPreview: ReturnType<typeof vi.fn>
  let buildPanDirectoryUrl: ReturnType<typeof vi.fn>
  let recordCount: number

  const buildHandlers = () =>
    createHistoryListActionHandlers(history, {
      getHistoryRecordCount: () => recordCount,
      openWindow: openWindow as unknown as (url: string) => Window | null,
      openZoomPreview,
      buildPanDirectoryUrl,
    })

  beforeEach(() => {
    ;({ history, spies } = createHistoryStub())
    openWindow = vi.fn()
    openZoomPreview = vi.fn()
    buildPanDirectoryUrl = vi.fn(() => 'https://pan.example.com/root')
    recordCount = 3
  })

  it('delegates selection changes to the controller', () => {
    const handlers = buildHandlers()
    handlers.setHistorySelection('group-1', true)
    expect(spies.setHistorySelection).toHaveBeenCalledWith('group-1', true)
  })

  it('toggles season expansion via controller', () => {
    const handlers = buildHandlers()
    handlers.setHistorySeasonExpanded('group-2', false)
    expect(spies.setHistorySeasonExpanded).toHaveBeenCalledWith('group-2', false)
  })

  it('opens history detail with normalized overrides', () => {
    const handlers = buildHandlers()
    const params: HistoryDetailActionParams = {
      groupKey: 'group-3',
      scope: 'season',
      pageUrl: ' https://example.com/detail ',
      title: ' 示例剧集 ',
      poster: { src: 'https://img', alt: '' },
    }
    handlers.openHistoryDetail(params)
    expect(spies.openHistoryDetail).toHaveBeenCalledWith('group-3', {
      pageUrl: 'https://example.com/detail',
      title: '示例剧集',
      poster: { src: 'https://img', alt: ' 示例剧集 ' },
    })
  })

  it('opens URLs and pan directories via injected window handler', () => {
    const handlers = buildHandlers()
    handlers.openHistoryUrl(' https://target ') // url
    expect(openWindow).toHaveBeenCalledWith('https://target', '_blank', 'noopener')
    openWindow.mockClear()
    handlers.openHistoryPan({ path: '/Season 1' })
    expect(buildPanDirectoryUrl).toHaveBeenCalledWith('/Season 1')
    expect(openWindow).toHaveBeenCalledWith('https://pan.example.com/root', '_blank', 'noopener')
  })

  it('triggers update checks with sanitized URLs', async () => {
    const handlers = buildHandlers()
    const button = document.createElement('button')
    await handlers.triggerHistoryUpdate({ pageUrl: ' https://example.com ', button })
    expect(spies.triggerHistoryUpdate).toHaveBeenCalledWith(
      'https://example.com',
      button,
      undefined,
    )
  })

  it('previews posters only when src exists', () => {
    const handlers = buildHandlers()
    handlers.previewHistoryPoster({ src: '', alt: 'noop' })
    expect(openZoomPreview).not.toHaveBeenCalled()
    handlers.previewHistoryPoster({ src: ' https://poster ', alt: '海报' })
    expect(openZoomPreview).toHaveBeenCalledWith({ src: 'https://poster', alt: '海报' })
  })

  it('prevents expansion toggle when no history records exist', () => {
    const handlers = buildHandlers()
    handlers.toggleHistoryExpanded()
    expect(spies.toggleHistoryExpanded).toHaveBeenCalledTimes(1)
    spies.toggleHistoryExpanded.mockClear()
    recordCount = 0
    handlers.toggleHistoryExpanded()
    expect(spies.toggleHistoryExpanded).not.toHaveBeenCalled()
  })
})
