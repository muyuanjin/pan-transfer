import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import os from 'node:os'

const PAN_TRANSFER_LOG_PREFIX = '[Pan Transfer]'
const cpuCount =
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
// 限制 Vitest 同时运行的 worker 数量，避免压满所有 CPU 核
const MAX_WORKERS = Math.max(1, Math.floor(cpuCount / 2))
const MIN_WORKERS = Math.max(1, Math.min(MAX_WORKERS, Math.floor(cpuCount / 4)))

export default defineConfig(async () => {
  const { default: vue } = await import('@vitejs/plugin-vue')

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.spec.ts'],
      reporters: 'basic',
      watch: false,
      minWorkers: MIN_WORKERS,
      maxWorkers: MAX_WORKERS,
      onConsoleLog(log) {
        if (log.includes(PAN_TRANSFER_LOG_PREFIX)) {
          return false
        }
        return undefined
      },
    },
  }
})
