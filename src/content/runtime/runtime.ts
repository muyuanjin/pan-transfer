import { createRuntimeApp } from './app'

export class ContentRuntime {
  private readonly app = createRuntimeApp()

  init(): void {
    this.app.init()
  }

  destroy(): void {
    if (typeof this.app.destroy === 'function') {
      this.app.destroy()
    }
  }
}
