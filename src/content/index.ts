import { ContentRuntime } from './runtime/runtime'

const runtime = new ContentRuntime()

function bootstrap(): void {
  runtime.init()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true })
} else {
  bootstrap()
}
