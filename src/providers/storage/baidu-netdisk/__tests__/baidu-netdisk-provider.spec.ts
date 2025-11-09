import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaiduNetdiskProvider } from '../baidu-netdisk-provider'
import type { TransferRequestPayload, TransferResponsePayload } from '@/shared/types/transfer'
import type { StorageTransferRequest, TransferContext } from '@/platform/registry'

const { mockedEnsureBdstoken, mockedHandleTransfer } = vi.hoisted(() => {
  const ensure = vi.fn<() => Promise<string>>(async () => '')
  const transfer = vi.fn<(payload: TransferRequestPayload) => Promise<TransferResponsePayload>>(
    async () => ({
      results: [],
      summary: '',
    }),
  )
  return {
    mockedEnsureBdstoken: ensure,
    mockedHandleTransfer: transfer,
  }
})

vi.mock('@/background/api/baidu-pan', () => ({
  ensureBdstoken: mockedEnsureBdstoken,
}))

vi.mock('@/background/services/transfer-service', () => ({
  handleTransfer: mockedHandleTransfer,
}))

describe('createBaiduNetdiskProvider', () => {
  beforeEach(() => {
    mockedEnsureBdstoken.mockReset()
    mockedHandleTransfer.mockReset()
  })

  it('reports readiness via ensureBdstoken', async () => {
    const provider = createBaiduNetdiskProvider()
    const readinessContext = { url: 'https://example.com' } as TransferContext
    mockedEnsureBdstoken.mockResolvedValueOnce('token')
    await expect(provider.checkReadiness(readinessContext)).resolves.toEqual({ ready: true })

    const error = new Error('not logged in')
    mockedEnsureBdstoken.mockRejectedValueOnce(error)
    await expect(provider.checkReadiness(readinessContext)).resolves.toEqual({
      ready: false,
      requiresUserAction: true,
      reason: 'not logged in',
    })
  })

  it('delegates transfers to handleTransfer', async () => {
    const provider = createBaiduNetdiskProvider()
    mockedHandleTransfer.mockResolvedValue({
      jobId: 'job-1',
      results: [
        { id: 1, title: 'foo', status: 'success', message: 'ok' },
        { id: 2, title: 'bar', status: 'skipped', message: 'dup' },
      ],
      summary: 'done',
    })

    const result = await provider.dispatchTransfer({
      context: {},
      payload: { items: [] },
    } as StorageTransferRequest)

    expect(mockedHandleTransfer).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: true,
      meta: {
        jobId: 'job-1',
        successCount: 1,
        skippedCount: 1,
      },
    })
  })
})
