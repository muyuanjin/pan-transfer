import { describe, expect, it, vi } from 'vitest'
import { createMockStorageProvider, MOCK_STORAGE_PROVIDER_ID } from '../mock-storage-provider'

describe('createMockStorageProvider', () => {
  it('reports readiness by default', async () => {
    const provider = createMockStorageProvider()
    await expect(provider.checkReadiness({} as never)).resolves.toEqual({ ready: true })
    expect(provider.id).toBe(MOCK_STORAGE_PROVIDER_ID)
  })

  it('dispatches transfers and invokes callback', async () => {
    const onTransfer = vi.fn()
    const provider = createMockStorageProvider({ onTransfer })
    const request = {
      context: { url: 'https://example.com' },
      payload: {
        items: [{ id: '1', title: 'Demo' }],
      },
    }

    const result = await provider.dispatchTransfer(request as never)

    expect(onTransfer).toHaveBeenCalledTimes(1)
    expect(onTransfer).toHaveBeenCalledWith(request)
    expect(result).toMatchObject({
      success: true,
      meta: { echoedItems: 1 },
    })
  })
})
