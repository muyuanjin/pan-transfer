# Provider Override & Verification Guide

This note explains how to exercise the provider switcher inside the floating panel and how to
manually verify each provider before a rollout.

## Manual Override Basics

1. Open any supported page (Chaospace in production, or a staged domain for other providers).
2. Expand the floating panel and locate the **解析来源** card at the top.
3. The badge shows the detected provider label and the current mode (`自动` or `手动`).
4. Use the dropdown labelled **首选解析器** to force a specific provider. When a provider is not
   available for the current page it will be filtered out of the dropdown and a toast will explain
   why the switch failed.
5. Provider settings can also be toggled from ⚙️ → **站点解析器** to disable a provider entirely or
   set a preferred default. These settings sync through `chrome.storage.local`.

When a provider switch succeeds:

- The badge updates immediately and the resource list refreshes with the new parser output.
- The panel accent colors re-skin to match the provider (purple for Chaospace, teal for Generic
  Forum).
- `state.manualSiteProviderId` tracks the manual selection until you switch back to 自动.

## CHAOSPACE Verification Checklist

1. Visit any Chaospace detail page (`https://chaospace.cc/tvshows/...`); the panel should mount
   automatically with the CHAOSPACE badge.
2. Confirm the accent colors remain the default purple gradient and `[Pan Transfer]` logs explicitly
   mention `siteProviderId: "chaospace"`.
3. Toggle to `手动 → CHAOSPACE` and back to `自动`. Each switch should refresh the resource list
   without losing selection state.
4. Disable CHAOSPACE inside ⚙️ → **站点解析器**. A warning toast will explain that all providers are
   disabled and the toolbar badge switches to **停用**. Reloading the page should skip mounting the
   panel entirely until you click the browser toolbar icon to restore the defaults.
5. Re-run `npm run e2e` (or the Playwright chaospace suite) to ensure automated coverage still passes
   after manual overrides.

## Generic Forum (Sample) Regression

Generic Forum is kept purely for docs/tests and is no longer bundled into the extension. The panel
must ignore its markers in every build so real users never see Generic Forum labels or the teal
accent theme.

1. Serve the sample markup from `docs/providers/generic-forum-sample.html` (or rely on the Playwright
   `?pan-provider-demo=1` helper).
2. Load the sandbox page inside Chrome with the built extension (`npm run build` → load `dist/`).
3. The floating panel should stay on the CHAOSPACE provider badge, keep the purple accent, and omit
   any dropdown entries containing `generic-forum`.
4. Open ⚙️ → **站点解析器** and confirm the list never mentions Generic Forum.
5. Run `npm run e2e` to cover these assertions automatically; the suite mounts the sandbox through
   Playwright and guarantees the Generic Forum demo stays hidden.

### Generic Forum QA Deltas

- The sample HTML references fake `pan.baidu.com` links, so real transfers will fail. Switch the
  storage provider to the mock implementation (`window.PAN_TRANSFER_STORAGE_PROVIDER = 'mock'` or
  the `chrome-extension://<id>/test-hooks.html → setStorageProviderMode('mock')` helper) before
  running any transfer smoke tests.
- Because the sandbox does not replay real CHAOSPACE history, completion badges fall back to the
  default CHAOSPACE state until a mock transfer finishes. Treat this as expected during host review.
- The provider markers come from the sample HTML (and from the `?pan-provider-demo=1` Playwright
  hook) and are not injected on production CHAOSPACE pages yet. Keep using the sandbox host when
  verifying Generic Forum until the provider is greenlit.

## Troubleshooting Tips

- If the accent color does not change, reload the tab to ensure the provider CSS was injected (the
  content script now lazy-loads `styles/providers/<provider>.css` via `styles.loader`).
- Provider dropdown options are filtered by both the detection result and the disabled list. Re-open
  the settings modal to ensure the provider is enabled.
- For new providers, reuse the Generic Forum sandbox flow: patch the manifest with the target host,
  serve a minimal HTML fixture containing `data-pan-resource` blocks, and verify the badge/accent
  states before requesting store review.
