export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface TaskQueueJob<T> {
  id?: string
  name?: string
  run: () => Promise<T> | T
}

export interface TaskHandle<T> {
  id: string
  result: Promise<T>
  status(): TaskStatus
  cancel(): void
}

export interface TaskQueue {
  enqueue<T>(job: TaskQueueJob<T>): TaskHandle<T>
}

export class TaskCanceledError extends Error {
  constructor(message?: string) {
    super(message ?? 'Task cancelled')
    this.name = 'TaskCanceledError'
  }
}

type MicrotaskRunner = (callback: () => void) => void

const scheduleMicrotask: MicrotaskRunner =
  typeof queueMicrotask === 'function' ? queueMicrotask : (cb) => Promise.resolve().then(cb)

export class InMemoryTaskQueue implements TaskQueue {
  private sequence = 0

  enqueue<T>(job: TaskQueueJob<T>): TaskHandle<T> {
    const id = job.id ?? `task-${++this.sequence}`
    let status: TaskStatus = 'queued'
    let rejectRef: ((reason: unknown) => void) | null = null
    let cancelled = false

    const result = new Promise<T>((resolve, reject) => {
      rejectRef = reject
      scheduleMicrotask(() => {
        if (cancelled) {
          status = 'cancelled'
          reject(new TaskCanceledError(job.name ?? id))
          return
        }
        status = 'running'
        Promise.resolve()
          .then(() => job.run())
          .then(
            (value) => {
              status = 'completed'
              resolve(value)
            },
            (error) => {
              status = 'failed'
              reject(error)
            },
          )
      })
    })

    return {
      id,
      result,
      status: () => status,
      cancel: () => {
        if (status !== 'queued') {
          return
        }
        cancelled = true
        status = 'cancelled'
        if (rejectRef) {
          rejectRef(new TaskCanceledError(job.name ?? id))
          rejectRef = null
        }
      },
    }
  }
}
