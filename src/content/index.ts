import { ContentRuntime } from './runtime/runtime'

const runtime = new ContentRuntime()

function bootstrap(): void {
  runtime.init()
}

let domReadyHandler: (() => void) | null = null

if (document.readyState === 'loading') {
  domReadyHandler = () => {
    domReadyHandler = null
    bootstrap()
  }
  document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true })
} else {
  bootstrap()
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // no-op: module replacement handled via dispose/init lifecycle
  })
  import.meta.hot.dispose(() => {
    if (domReadyHandler) {
      document.removeEventListener('DOMContentLoaded', domReadyHandler)
      domReadyHandler = null
    }
    runtime.destroy()
  })
}
