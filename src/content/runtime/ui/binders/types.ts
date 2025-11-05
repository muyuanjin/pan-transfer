export interface Binder {
  bind: () => () => void
}

export type BinderFactory<TDeps = void> = (deps: TDeps) => Binder
