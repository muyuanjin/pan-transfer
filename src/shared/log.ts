export const CHAOSPACE_LOG_PREFIX = '[Pan Transfer]'

type LogMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

type ConsoleArgs = Array<unknown>

function applyPrefix(args: ConsoleArgs): ConsoleArgs {
  if (!args.length) {
    return [CHAOSPACE_LOG_PREFIX]
  }
  const [first, ...rest] = args
  if (typeof first === 'string') {
    if (first.startsWith(CHAOSPACE_LOG_PREFIX)) {
      return [first, ...rest]
    }
    return [`${CHAOSPACE_LOG_PREFIX} ${first}`.trim(), ...rest]
  }
  return [CHAOSPACE_LOG_PREFIX, ...args]
}

function emit(method: LogMethod, ...args: ConsoleArgs): void {
  const prefixedArgs = applyPrefix(args)
  console[method](...prefixedArgs)
}

export const chaosLogger = {
  log: (...args: ConsoleArgs) => emit('log', ...args),
  info: (...args: ConsoleArgs) => emit('info', ...args),
  warn: (...args: ConsoleArgs) => emit('warn', ...args),
  error: (...args: ConsoleArgs) => emit('error', ...args),
  debug: (...args: ConsoleArgs) => emit('debug', ...args),
}

export function createScopedLogger(scope: string) {
  const label = scope ? `[${scope}]` : ''
  return {
    log: (...args: ConsoleArgs) => chaosLogger.log(label, ...args),
    info: (...args: ConsoleArgs) => chaosLogger.info(label, ...args),
    warn: (...args: ConsoleArgs) => chaosLogger.warn(label, ...args),
    error: (...args: ConsoleArgs) => chaosLogger.error(label, ...args),
    debug: (...args: ConsoleArgs) => chaosLogger.debug(label, ...args),
  }
}
