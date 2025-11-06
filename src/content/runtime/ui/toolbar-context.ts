import type { InjectionKey } from 'vue'
import type { createSelectionController } from './selection-controller'

type SelectionController = ReturnType<typeof createSelectionController>

export interface ToolbarContext {
  selection: SelectionController
  selectNewItems: () => void
  renderResourceList: () => void
}

export const toolbarContextKey: InjectionKey<ToolbarContext> = Symbol('ChaospaceToolbarContext')
