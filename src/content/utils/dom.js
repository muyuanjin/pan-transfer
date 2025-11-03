function handleSuppressDrag(event) {
  event.preventDefault();
}

export function disableElementDrag(element) {
  if (!element) {
    return;
  }
  try {
    element.setAttribute('draggable', 'false');
    element.addEventListener('dragstart', handleSuppressDrag, { passive: false });
  } catch (_error) {
    // Ignore unsupported nodes.
  }
}
