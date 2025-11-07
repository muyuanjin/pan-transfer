export interface ToastStats {
  success: number
  failed: number
  skipped: number
}

export type ToastHandler = (
  type: string,
  title: string,
  message?: string | null,
  stats?: ToastStats | null,
) => void

let currentToast: HTMLDivElement | null = null

const TOAST_MARGIN = 12

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

export function showToast(
  type: string,
  title: string,
  message: string | null | undefined,
  stats: ToastStats | null = null,
): void {
  try {
    if (currentToast && currentToast.parentNode) {
      currentToast.remove()
      currentToast = null
    }

    if (!document.body) {
      return
    }

    const toast = document.createElement('div')
    toast.className = `chaospace-toast ${type}`

    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'chaospace-toast-close'
    closeButton.setAttribute('aria-label', '关闭通知')
    closeButton.textContent = '×'
    closeButton.addEventListener('click', () => {
      if (toast.parentNode) {
        toast.remove()
        if (currentToast === toast) {
          currentToast = null
        }
      }
    })
    toast.appendChild(closeButton)

    const titleEl = document.createElement('div')
    titleEl.className = 'chaospace-toast-title'
    titleEl.textContent = title
    toast.appendChild(titleEl)

    if (message) {
      const messageEl = document.createElement('div')
      messageEl.className = 'chaospace-toast-message'
      messageEl.textContent = message
      toast.appendChild(messageEl)
    }

    if (stats) {
      const statsEl = document.createElement('div')
      statsEl.className = 'chaospace-toast-stats'

      if (stats.success > 0) {
        const successStat = document.createElement('div')
        successStat.className = 'chaospace-toast-stat success'
        successStat.textContent = `✅ 成功 · ${stats.success}`
        statsEl.appendChild(successStat)
      }

      if (stats.failed > 0) {
        const failedStat = document.createElement('div')
        failedStat.className = 'chaospace-toast-stat failed'
        failedStat.textContent = `❌ 失败 · ${stats.failed}`
        statsEl.appendChild(failedStat)
      }

      if (stats.skipped > 0) {
        const skippedStat = document.createElement('div')
        skippedStat.className = 'chaospace-toast-stat skipped'
        skippedStat.textContent = `🌀 跳过 · ${stats.skipped}`
        statsEl.appendChild(skippedStat)
      }

      toast.appendChild(statsEl)
    }

    document.body.appendChild(toast)
    currentToast = toast

    let dragPointerId: number | null = null
    let dragOffsetX = 0
    let dragOffsetY = 0

    const updatePosition = (clientX: number, clientY: number): void => {
      const bounds = toast.getBoundingClientRect()
      const width = bounds.width
      const height = bounds.height
      const maxLeft = window.innerWidth - width - TOAST_MARGIN
      const maxTop = window.innerHeight - height - TOAST_MARGIN
      const nextLeft = clamp(clientX - dragOffsetX, TOAST_MARGIN, maxLeft)
      const nextTop = clamp(clientY - dragOffsetY, TOAST_MARGIN, maxTop)
      toast.style.right = ''
      toast.style.left = `${nextLeft}px`
      toast.style.top = `${nextTop}px`
    }

    const handlePointerMove = (event: PointerEvent): void => {
      if (dragPointerId === null || event.pointerId !== dragPointerId) {
        return
      }
      updatePosition(event.clientX, event.clientY)
    }

    const endDrag = (event: PointerEvent): void => {
      if (dragPointerId === null || event.pointerId !== dragPointerId) {
        return
      }
      toast.releasePointerCapture(event.pointerId)
      dragPointerId = null
      toast.classList.remove('chaospace-toast-dragging')
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', endDrag)
      document.removeEventListener('pointercancel', endDrag)
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (event.button !== 0 || !target || target.closest('.chaospace-toast-close')) {
        return
      }
      const rect = toast.getBoundingClientRect()
      dragPointerId = event.pointerId
      dragOffsetX = event.clientX - rect.left
      dragOffsetY = event.clientY - rect.top
      toast.setPointerCapture(event.pointerId)
      toast.classList.add('chaospace-toast-dragging')
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', endDrag)
      document.addEventListener('pointercancel', endDrag)
      updatePosition(event.clientX, event.clientY)
    }

    toast.addEventListener('pointerdown', handlePointerDown)

    setTimeout(() => {
      if (currentToast === toast && toast.parentNode) {
        toast.remove()
        currentToast = null
      }
    }, 5000)
  } catch (error) {
    console.error('[Chaospace Transfer] Failed to show toast', error)
  }
}
