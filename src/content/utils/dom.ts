function handleSuppressDrag(event: DragEvent): void {
  event.preventDefault()
}

export function disableElementDrag(element: HTMLElement | null | undefined): void {
  if (!element) {
    return
  }
  try {
    element.setAttribute('draggable', 'false')
    element.addEventListener('dragstart', handleSuppressDrag, { passive: false })
  } catch (_error) {
    // Ignore unsupported nodes.
  }
}

export function closestElement<T extends Element = Element>(
  target: EventTarget | null,
  selector: string,
): T | null {
  if (!(target instanceof Element)) {
    return null
  }
  const match = target.closest(selector)
  return (match as T | null) ?? null
}
