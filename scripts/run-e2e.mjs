/* eslint-env node */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const distManifest = path.join(rootDir, 'dist', 'manifest.json')
const isWindows = process.platform === 'win32'

const run = (command, args, label) =>
  new Promise((resolve, reject) => {
    if (label) {
      process.stdout.write(`\n>> ${label}\n`)
    }
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
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

async function main() {
  if (!fs.existsSync(distManifest)) {
    await run(npmCommand, ['run', 'build'], 'Building extension bundle (dist missing)')
  }

  await run(playwrightCommand, ['test'], 'Running Playwright smoke tests')

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

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
