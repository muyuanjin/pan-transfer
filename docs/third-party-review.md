# Third-Party Review Packet

## Project Guardrails (`AGENTS.md`)

```
# Chaospace Extension — Agent Guide

_Last updated: 2025-11-05 (UTC-8)_

## Core Principles

- **Mission**: Deliver a Manifest V3 Chrome extension using Vite 7 + TypeScript 5.9 + Vue 3 that mirrors the legacy behaviour while adding modern safety/tooling.
- **Source of truth**: All active code lives in `src/`. Treat `chaospace-extension/` as read-only reference for parity checks.
- **Quality gate**: Keep `npm run check` green (format:check → typecheck → lint:ci → build → vitest → playwright) before handing work back.
- **Logging**: Prefix runtime logs with `[Pan Transfer]` across background, content, and UI contexts.

## !!IMPORTANT!! Keep `npm run check` green before handing work back!!!

## Architecture Snapshot

- **Background service worker**: `src/background/index.ts` (module). Uses typed message guards, services under `src/background/services/`, and storage/cache utilities in `src/background/storage/`.
- **Content runtime**: `src/content/index.ts` instantiates `ContentRuntime` (`src/content/runtime/runtime.ts`). Vue components render the floating panel (`components/PanelRoot.vue`), resource list (`components/ResourceListView.vue`), history overlays (`components/history/*.vue`), and detail modal. Controllers/binders live under `src/content/{controllers,history,runtime/ui}`; shared state sits in `src/content/state/index.ts`.
- **Shared modules**: Cross-context types in `src/shared/types/transfer.ts`; sanitizers/completion helpers in `src/shared/utils/`.
- **Styles**: Modular CSS under `src/content/styles/{foundation,overlays,utilities}` with `styles.loader.ts` for on-demand injection.
- **Testing**: Vitest specs cover parser/page analyzer/history/resource renderers (`src/**/__tests__`), and Playwright e2e (`tests/e2e/panel.spec.ts`) validates the built extension.

## Tooling & Commands

- Install deps once with `npm install`.
- Development preview: `npm run dev`.
- Primary checks: `npm run check` (required), which runs `format:check → typecheck → lint:ci → build → vitest → e2e` without mutating the worktree and fails on any ESLint warning.
- Individual commands:
  - `npm run typecheck` — `vue-tsc --noEmit -p tsconfig.app.json`
  - `npm run build` — typecheck + Vite production build to `dist/`
  - `npm run test` — Vitest suites
  - `npm run e2e` — Playwright smoke (builds automatically if `dist/` is missing)
  - `npm run lint:ci` — ESLint with `--max-warnings=0` for CI parity
- Optional: `web-ext lint --source-dir dist` for manifest/API validation.

## Coding Conventions

- TypeScript + Vue SFC; two-space indentation; prefer `const`/`let`; trailing commas when helpful.
- DOM hooks follow clear kebab-case data-role or class selectors. Exported functions use camelCase (`normalizePath`, `buildSurl`).
- Keep reusable helpers near consumers; only create new shared subdirectories when multiple entry points rely on the code.
- New Vue components should load scoped styles via existing modular CSS patterns.

## Testing Expectations

- Run Playwright (`npm run e2e`) after building; ensure the panel loads on real CHAOSPACE pages without `[Pan Transfer]` errors.
- When touching background transfer/history flows, manually verify via Chrome devtools (Network tab) and ensure retries handle known Baidu errno codes.
- Document new manual verification steps alongside code changes (PR descriptions or notes).

## Safety & Compliance

- Never commit personal Baidu credentials, cookies, or user data; rely on local `.env` or Chrome profile storage.
- Highlight any new permissions requested in `src/manifest.json` so reviewers can assess risk.
- Remember the legacy MV2 bundle is frozen—do not modify files in `chaospace-extension/`.
```

## Review Feedback to Evaluate

### Reviewer A (system reviewer output)

> No blocking issues detected in the current diff (`docs/review-findings.md`, `src/background/common/constants.ts`, `src/background/services/transfer-service.ts`). The retry logic cleanly handles fetch-level failures and the new errno is surfaced through the existing error mapper. Residual risk: the new network-error path lacks automated coverage, so a regression test that simulates a fetch timeout and asserts the retry/backoff + `TRANSFER_REQUEST_TIMEOUT_ERRNO` flow would help guard against future changes.

### Reviewer B (manual comment up for adjudication)

> 关键问题: 当前代码不能真正实现预期功能,因为 transferResult 在异常后为 null,会导致立即退出循环而不是重试。  
> 这是一个影响提交的逻辑错误,需要修复后再提交。  
> ...  
> 在 `transfer-service.ts:344` 附近,catch 块的控制流存在问题:
>
> ```ts
> if (!canRetry) {
>   break // ← 这里 break 后,下面的 continue 就是死代码
> }
> // ... logging ...
> await delay(500 * attempt)
> continue
> ```
>
> 以及 transferResult 在异常后保持为 null,会在第 353 行触发 break:
>
> ```ts
> if (!transferResult) {
>   break // ← 即使异常后想重试,这里也会直接退出
> }
> ```
>
> 建议修改:
>
> 1. 方案 A: catch 块末尾不要在 !canRetry 时 break,让代码自然走到 if (!transferResult) break
> 2. 方案 B: 在 catch 块的 continue 前不设置 break,改为:
>
> ```ts
> if (canRetry) {
>   await delay(500 * attempt)
>   continue
> }
> // 不可重试时,transferResult 为 null,走到外层 if (!transferResult) break
> ```

## Relevant Source (`src/background/services/transfer-service.ts:312-380`)

```ts
  while (attempt < maxAttempts) {
    attempt += 1
    logStage(jobId, 'transfer', `${titleLabel}第 ${attempt} 次发送转存请求`, {
      detail,
    })
    let transferResult: Awaited<ReturnType<typeof transferShare>> | null = null
    try {
      transferResult = await transferShare(meta, targetPath, bdstoken, referer)
    } catch (error) {
      const err = error as ChaospaceError
      if (err?.code === 'PAN_LOGIN_REQUIRED') {
        throw err
      }
      errno = TRANSFER_REQUEST_TIMEOUT_ERRNO
      lastShowMsg = err?.message
      lastPathMissing = false
      const canRetry = attempt < maxAttempts
      chaosLogger.warn('[Pan Transfer] transfer request failed', {
        path: targetPath,
        attempt,
        message: err?.message,
      })
      logStage(
        jobId,
        'transfer',
        `${titleLabel}转存请求异常（第 ${attempt} 次）${canRetry ? '，准备重试' : ''}`,
        {
          level: canRetry ? 'warning' : 'error',
          detail: err?.message,
        },
      )
      if (!canRetry) {
        break
      }
      chaosLogger.log('[Pan Transfer] transfer retry scheduled', {
        path: targetPath,
        errno: TRANSFER_REQUEST_TIMEOUT_ERRNO,
        attempt,
        reason: 'network-error',
      })
      await delay(500 * attempt)
      continue
    }
    if (!transferResult) {
      break
    }
    errno = transferResult.errno
    lastShowMsg = transferResult.showMsg
    lastPathMissing = isTransferPathMissing(errno, transferResult.showMsg)
    if (errno === 0 || errno === 666) {
      logStage(
        jobId,
        'transfer',
        `${titleLabel}转存成功（第 ${attempt} 次尝试${errno === 666 ? ' · 存在重复文件' : ''}）`,
        {
          level: 'success',
          detail,
        },
      )
      const successResult: {
        errno: number
        attempts: number
        showMsg?: string
        pathMissing?: boolean
      } = {
        errno,
        attempts: attempt,
      }
      if (transferResult.showMsg) {
        successResult.showMsg = transferResult.showMsg
      }
```

### Control-Flow Notes

- `transferResult` is reset to `null` at the start of each loop iteration, assigned only if `transferShare` resolves.
- When a `transferShare` call throws, the `catch` handles logging and determines `canRetry`.
- If `canRetry` is `false`, the worker breaks out of the loop immediately; otherwise it schedules the retry, waits, and `continue`s—skipping the `if (!transferResult) break` guard for that iteration.
- The `if (!transferResult) break` guard is reached only on iterations where the `try` block completes without throwing yet the resolved value is falsy.

This packet contains all known inputs for the third reviewer to determine whether Reviewer B’s finding is valid.

## Arbitration Decision

- **结论**：驳回 Reviewer B 关于“异常后 `transferResult` 为 null 导致不重试”的判断，采纳 Reviewer A 的“无阻塞问题”评估。
- **理由**：
  - 当 `canRetry === true` 时，`catch` 分支会记录日志、`await delay(500 * attempt)`，然后 `continue`，因此不会执行到 `if (!transferResult) break`。
  - 只有在 `canRetry === false`（已达最大重试次数）时才会 `break`，这是预期的终止路径。
  - `continue` 并非死代码；它位于 `if (!canRetry)` 分支之外，只在允许重试的路径上运行。
  - 该 `if (!transferResult)` 守卫仅保护“`transferShare` 成功返回却得到 falsy 值”的情况，与 `catch` 路径互不影响。
- **风险/改进（非阻塞）**：
  - 添加自动化测试，模拟 `transferShare` 抛出超时或网络异常，验证重试次数、退避间隔和 `errno = TRANSFER_REQUEST_TIMEOUT_ERRNO`。
  - 可选的可读性重构：`if (canRetry) { ... await delay ...; continue } else { break }`，并为 `if (!transferResult)` 添加注释说明。
