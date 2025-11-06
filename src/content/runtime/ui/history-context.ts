import type { InjectionKey } from 'vue'
import type { createHistoryController } from '../../history/controller'

export type HistoryController = ReturnType<typeof createHistoryController>

export const historyContextKey: InjectionKey<HistoryController> = Symbol('ChaospaceHistoryContext')
