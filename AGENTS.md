# Repository Guidelines

## Project Structure & Module Organization

- Core extension source now lives under `src/` and is bundled via Vite (see `REFACTOR_PROGRESS.md` for the latest module map). Background automation bootstraps from `src/background/index.js`, the content runtime from `src/content/index.js`, and shared helpers sit under `src/shared/`.
- The legacy `chaospace-extension/` directory is frozen for parity checks only; do not patch bugs or add features there. Any missing behaviour should be recreated inside `src/` and pulled through the build.
- Keep reusable helpers close to their consumers; create subfolders inside `src/` only when the code is shared by multiple scripts.
- Store temporary assets or reference captures under `src/public/` (for build assets) or `chaospace-extension/assets/` when validating legacy behaviour. Avoid committing large binaries.

## **重要**: 提交代码/任务结束前务必按顺序依次运行 `npm run typecheck`、`npm run format`、`npm run build`、`npm run test`、`npm run e2e` 确保所有检查通过。(由于输出可能会被截断,你要确保至少`npm run e2e`是独立运行的,这是最终最重要的测试,务必通过)

### 修复代码问题的推荐流程

```bash
# 1. 先格式化代码
npm run format

# 2. 自动修复可修复的问题
npm run lint:fix

# 3. 运行类型检查,手动修复类型错误
npm run typecheck

# 4. 运行完整检查
npm run check
```

## Coding Style & Naming Conventions

- Follow the existing two-space indentation, trailing commas where beneficial, and prefer `const`/`let` over `var`.
- Keep logging uniform with the `[Chaospace Transfer]` prefix so console output stays searchable across background, popup, and content contexts.
- DOM hooks use clear, kebab-case IDs or class names, while exported functions in JavaScript use camelCase (e.g., `normalizePath`, `buildSurl`).

## Testing Guidelines

- Smoke-test every change by reloading the unpacked `dist/` build, visiting a CHAOSPACE episode page, and confirming that link extraction, transfer, and error banners still work.
- When modifying request flows in `src/background/`, verify API responses through the Chrome DevTools Network tab and confirm retries handle known errno cases.
- Document any new manual test scenario in the pull request description so others can reproduce it quickly.

## Commit & Pull Request Guidelines

- Follow the lightweight Conventional Commits style seen in history (`feat: ...`, `fix: ...`) and keep scope hints clear.
- Each PR should describe the user-facing impact, list manual verification steps, and include screenshots or screen recordings when UI behavior changes.
- Reference relevant issue IDs or discussion threads, and request review from a maintainer familiar with the touched area before merging.

## Security & Configuration Notes

- Never commit personal Baidu cookies, tokens, or account-specific configuration; rely on local `.env` or Chrome profile storage instead.
- If a change introduces new permissions in `manifest.json`, call them out explicitly so reviewers can assess the risk.
