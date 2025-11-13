import { describe, expect, it, vi } from 'vitest'
import { createAbortableBinder } from '../abortable-binder'

describe('createAbortableBinder', () => {
  it('removes listeners when cleanup is invoked', () => {
    const target = new EventTarget()
    const handler = vi.fn()

    const cleanup = createAbortableBinder((add) => {
      add(target, 'ping', handler)
    })

    target.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1)

    cleanup()

    target.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('runs custom cleanup callbacks before aborting listeners', () => {
    const customCleanup = vi.fn()
    const cleanup = createAbortableBinder(() => customCleanup)

    cleanup()

    expect(customCleanup).toHaveBeenCalledTimes(1)
  })
})
