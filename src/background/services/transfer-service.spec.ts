import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { TRANSFER_REQUEST_TIMEOUT_ERRNO } from '../common/constants'
import type { TransferShareMeta } from '../api/baidu-pan'
import { transferShare } from '../api/baidu-pan'
import { __testables } from './transfer-service'

vi.mock('../api/baidu-pan', () => {
  return {
    transferShare: vi.fn(),
  }
})

vi.mock('@/shared/log', () => ({
  chaosLogger: {
    warn: vi.fn(),
    log: vi.fn(),
  },
}))

describe('transferWithRetry', () => {
  let setTimeoutSpy: MockInstance<(typeof globalThis)['setTimeout']>

  beforeEach(() => {
    vi.useFakeTimers()
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
  })

  afterEach(() => {
    setTimeoutSpy.mockRestore()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('retries network failures with exponential backoff until max attempts', async () => {
    const transferShareMock = vi.mocked(transferShare)
    const networkError = new Error('网络异常：请求超时')
    transferShareMock.mockRejectedValue(networkError)

    const meta: TransferShareMeta = {
      shareId: 'share-1',
      userId: 'user-1',
      fsIds: [128],
      seKey: 'sek',
    }
    const maxAttempts = 3

    const transferPromise = __testables.transferWithRetry(
      meta,
      '/apps/pan-transfer',
      'token',
      'https://example.com',
      maxAttempts,
      { context: '测试任务' },
    )

    await vi.runAllTimersAsync()
    const result = await transferPromise

    expect(transferShareMock).toHaveBeenCalledTimes(maxAttempts)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(maxAttempts - 1)
    const delays = setTimeoutSpy.mock.calls.map(([, timeout]) => timeout)
    expect(delays).toEqual([500, 1000])
    expect(result).toEqual({
      errno: TRANSFER_REQUEST_TIMEOUT_ERRNO,
      attempts: maxAttempts,
      showMsg: networkError.message,
      pathMissing: false,
    })
  })
})
