/* eslint-env node */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const distDir = path.join(rootDir, 'dist')
const distBackupDir = path.join(rootDir, 'dist.e2e-backup')
const isWindows = process.platform === 'win32'

const run = (command, args, label, options = {}) =>
  new Promise((resolve, reject) => {
    if (label) {
      process.stdout.write(`\n>> ${label}\n`)
    }
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: isWindows,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })

const npmCommand = 'npm'
const playwrightCommand = isWindows
  ? path.join('node_modules', '.bin', 'playwright.cmd')
  : path.join('node_modules', '.bin', 'playwright')

const ensureDirRemoved = (target) => {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      process.stderr.write(
        `Failed to remove ${target}: ${(error && error.message) || String(error)}\n`,
      )
    }
  }
}

async function prepareE2eBundle() {
  const hadDist = fs.existsSync(distDir)
  if (hadDist) {
    ensureDirRemoved(distBackupDir)
    fs.renameSync(distDir, distBackupDir)
  }

  try {
    await run(
      npmCommand,
      ['run', 'build'],
      'Building extension bundle with Generic Forum enabled for e2e',
      {
        env: {
          VITE_ENABLE_GENERIC_FORUM: '1',
          PAN_TRANSFER_ENABLE_GENERIC_FORUM: '1',
        },
      },
    )
  } catch (error) {
    if (hadDist && fs.existsSync(distBackupDir)) {
      fs.renameSync(distBackupDir, distDir)
    } else {
      ensureDirRemoved(distBackupDir)
      ensureDirRemoved(distDir)
    }
    throw error
  }

  const restore = () => {
    ensureDirRemoved(distDir)
    if (hadDist) {
      if (fs.existsSync(distBackupDir)) {
        fs.renameSync(distBackupDir, distDir)
      }
    } else {
      ensureDirRemoved(distBackupDir)
    }
  }

  return restore
}

async function main() {
  let restoreBundle = null
  try {
    restoreBundle = await prepareE2eBundle()
    await run(playwrightCommand, ['test'], 'Running Playwright smoke tests', {
      env: {
        VITE_ENABLE_GENERIC_FORUM: '1',
        PAN_TRANSFER_ENABLE_GENERIC_FORUM: '1',
      },
    })
  } finally {
    if (typeof restoreBundle === 'function') {
      restoreBundle()
    }
    try {
      fs.rmSync(path.join(rootDir, 'test-results'), { recursive: true, force: true })
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        process.stderr.write(
          `Failed to clean test-results directory: ${(error && error.message) || String(error)}\n`,
        )
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
