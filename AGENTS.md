# Repository Guidelines

## Project Structure & Module Organization
- Core Chrome extension files live in `chaospace-extension/`. Background automation resides in `chaospace-extension/background.js`, page scraping runs from `chaospace-extension/contentScript.js`, and the user interface is defined by `popup.html`, `popup.js`, and the companion CSS files.
- Keep reusable helpers close to their consumers; create subfolders inside `chaospace-extension/` only when the code is shared by multiple scripts.
- Store temporary assets or reference captures under `chaospace-extension/assets/` (create the folder if needed) and avoid committing large binaries.

## Build, Test, and Development Commands
- There is no bundler step; load the folder directly in Chrome via `chrome://extensions` → Load unpacked → `chaospace-extension/`.
- Use `web-ext lint --source-dir chaospace-extension` to catch manifest or API issues before pushing. Install `web-ext` globally with `npm install -g web-ext` if it is not available.
- Package the extension for manual sharing with `zip -r chaospace-extension.zip chaospace-extension`.

## Coding Style & Naming Conventions
- Follow the existing two-space indentation, trailing commas where beneficial, and prefer `const`/`let` over `var`.
- Keep logging uniform with the `[Chaospace Transfer]` prefix so console output stays searchable across background, popup, and content contexts.
- DOM hooks use clear, kebab-case IDs or class names, while exported functions in JavaScript use camelCase (e.g., `normalizePath`, `buildSurl`).

## Testing Guidelines
- Smoke-test every change by reloading the unpacked extension, visiting a CHAOSPACE episode page, and confirming that link extraction, transfer, and error banners still work.
- When modifying request flows in `background.js`, verify API responses through the Chrome DevTools Network tab and confirm retries handle known errno cases.
- Document any new manual test scenario in the pull request description so others can reproduce it quickly.

## Commit & Pull Request Guidelines
- Follow the lightweight Conventional Commits style seen in history (`feat: ...`, `fix: ...`) and keep scope hints clear.
- Each PR should describe the user-facing impact, list manual verification steps, and include screenshots or screen recordings when UI behavior changes.
- Reference relevant issue IDs or discussion threads, and request review from a maintainer familiar with the touched area before merging.

## Security & Configuration Notes
- Never commit personal Baidu cookies, tokens, or account-specific configuration; rely on local `.env` or Chrome profile storage instead.
- If a change introduces new permissions in `manifest.json`, call them out explicitly so reviewers can assess the risk.
