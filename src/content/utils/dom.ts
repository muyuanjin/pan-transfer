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
