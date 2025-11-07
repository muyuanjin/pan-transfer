# Chaospace Transfer — Improvement Plan

## 1. Logging prefix gaps break diagnostics

- **Findings**: `src/background/utils/share.ts:1-24` and `src/content/runtime/app.ts:603-645` emit console messages without the mandated `[Chaospace Transfer]` prefix.
- **Impact**: Violates the AGENTS logging contract and makes the Playwright watchdog (`tests/e2e/panel.spec.ts:175-205`) blind to certain errors, so regressions can slip through unnoticed.
- **Actions**
  1. Create a tiny logging helper (e.g., `src/shared/log.ts`) that enforces the prefix and replace the ad‑hoc `console.*` usages in these modules.
  2. Add an ESLint rule or codemod to forbid raw console logging outside that helper to prevent regressions.
  3. Extend the Playwright tracker to assert that every chaospace error already carries the prefix once the helper is in place.

## 2. `npm run check` mutates files and hides lint warnings

- **Findings**: The gate (`package.json:11-20`) starts with `format:silent` (`prettier --write`) and runs `eslint . --quiet`, which means CI “checks” rewrite developer files and silently drop hundreds of warnings (confirmed via `npm run lint`).
- **Impact**: Impossible to run the quality gate in read-only CI, and meaningful lint diagnostics (unused `_error`, unsafe any, CRLF issues, etc.) never fail the pipeline.
- **Actions**
  1. Replace the first stage with `npm run format:check` (or `prettier --check`) so `npm run check` is read-only.
  2. Swap `lint:quiet` for `npm run lint -- --max-warnings=0` (or a dedicated `lint:ci`) so warnings fail fast instead of being suppressed.
  3. Document the new expectations in `README.md` and AGENT docs so contributors know the gate no longer rewrites their worktree.

## 3. ESLint config cannot suppress `_error` catch parameters

- **Findings**: Despite using `_error` placeholders, ESLint still reports them (`npm run lint` output) because `eslint.config.mjs:82-160` only sets `argsIgnorePattern`/`varsIgnorePattern` and never configures `caughtErrorsIgnorePattern`.
- **Impact**: Noise drowns out actionable linting (dozens of warnings in `src/background/api/baidu-pan.ts`, `file-rules.ts`, etc.), so genuine problems are easy to miss.
- **Actions**
  1. Add `caughtErrorsIgnorePattern: '^_'` wherever `@typescript-eslint/no-unused-vars` is configured.
  2. While touching the rule, enable `ignoreRestSiblings: true` to future-proof destructuring use cases.
  3. Re-run `npm run lint` to ensure the warning count actually drops, making room to enable stricter rules later (e.g., banning implicit `any` inside the Baidu client).

## 4. README still documents the legacy MV2 layout

- **Findings**: `README.md:31-165` instructs users to load a `chaospace-extension/` folder, claims “no build process,” and outlines background/content scripts that no longer exist (the real source lives in `src/` built by Vite 7).
- **Impact**: New contributors will open the wrong directory, skip `npm install`, and miss the `npm run check` requirement from `AGENTS.md`, leading to broken review cycles.
- **Actions**
  1. Rewrite the installation/build sections to reflect the Vite + MV3 toolchain (`npm install`, `npm run dev`, `npm run build`, `npm run check`).
  2. Document the `src/` layout (background worker, content runtime, Vue components, shared utils) and clarify that `chaospace-extension/` is reference-only.
  3. Surface the quality gate expectations (log prefix, `npm run check`) so onboarding material matches `AGENTS.md`.

## 5. Playwright E2E assumes a pre-built `dist`

- **Findings**: `package.json:16` calls `playwright test` directly, but `tests/e2e/panel.spec.ts:243-248` throws if `dist/` is missing.
- **Impact**: Running `npm run e2e` locally (or in CI when you only want smoke tests) fails unless developers remember to run `npm run build` manually, slowing feedback and making scripted automation flaky.
- **Actions**
  1. Change the script to `npm run build && playwright test` (or gate on `dist` timestamp) so `npm run e2e` is self-contained.
  2. Alternatively, move the build check inside Playwright’s `test.beforeAll` and trigger `npm run build` programmatically when needed.
  3. Update docs/CI workflows to rely on the fixed script so contributors stop running two commands manually.

## 6. TinyPinyin inflates every content-script load

- **Findings**: `src/content/services/history-service.ts:1` imports the entire `tiny-pinyin` namespace eagerly even though pinyin conversion is only needed when users interact with the history overlay search.
- **Impact**: The content script ships an extra ~200 KB (unminified dictionary) to every CHAOSPACE page, slowing injection and violating the “minimal, performant” goal.
- **Actions**
  1. Switch to a dynamic import (`await import('tiny-pinyin')`) or a lightweight phonetic helper that runs only when history search is mounted.
  2. Cache the converter so repeated searches do not re-import the module.
  3. Consider precomputing Latin keywords when persisting history in the background worker to remove the dependency from the content runtime entirely.
