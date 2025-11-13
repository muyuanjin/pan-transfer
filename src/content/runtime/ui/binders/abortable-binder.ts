export type AbortableEventAdder = <T extends EventTarget>(
  target: T | null | undefined,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
) => void

export type AbortableBinderRegistrar = (
  add: AbortableEventAdder,
  signal: AbortSignal,
) => void | (() => void)

export function createAbortableBinder(register: AbortableBinderRegistrar): () => void {
  const controller = new AbortController()
  const { signal } = controller
  const add: AbortableEventAdder = (target, type, listener, options) => {
    if (!target) {
      return
    }
    if (typeof options === 'boolean') {
      target.addEventListener(type, listener, { capture: options, signal })
      return
    }
    const finalOptions =
      options && typeof options === 'object' ? { ...options, signal } : { signal }
    target.addEventListener(type, listener, finalOptions)
  }
  const cleanup = register(add, signal)
  return () => {
    if (typeof cleanup === 'function') {
      cleanup()
    }
    controller.abort()
  }
}
