# Pan Transfer Architecture Migration Plan

_Last updated: 2025-11-10_

## 1. Goals & Context

- **Reposition** the project from a CHAOSPACE-only helper to a generic "Pan Transfer" engine that can ingest resources from multiple video/resource sites and push them into Baidu Netdisk (with hooks for future cloud targets).
- **Preserve stability**: keep `npm run check` green at every milestone, reuse the battle-tested background/content frameworks, and ship incremental changes behind feature flags.
- **Unlock extensibility** via clear provider abstractions so adding a new site or storage backend can be done without touching unrelated logic.
- **Modernize release pipeline** to publish multi-site builds via GitHub Actions while maintaining manual Chrome Store sealing.

## 2. Guiding Principles

1. **Provider first**: any site- or storage-specific logic must live in dedicated providers implementing shared contracts (Strategy pattern).
2. **Single orchestration core**: a `TransferPipeline` mediates between site providers, transfer policies, and storage providers (Mediator + Pipeline patterns).
3. **Consistent logging & telemetry**: continue routing logs through `chaosLogger` until the global prefix is migrated (plan below) to avoid missing diagnostics.
4. **Progressive rollout**: ship the rebrand and config settings before fanning out to entirely new providers; default to CHAOSPACE provider until others reach parity.
5. **Docs and automation**: README + release workflows must evolve alongside architecture to keep contributors aligned.

## 3. Target Architecture Overview

```
src/
├── platform/
│   ├── registry/          # Provider discovery + capability metadata
│   └── settings/          # User/site preferences shared across contexts
├── providers/
│   ├── sites/
│   │   ├── chaospace/
│   │   ├── generic-forum/
│   │   └── ...
│   └── storage/
│       ├── baidu-netdisk/
│       └── ...            # placeholder for future OneDrive/123pan/etc
├── core/
│   ├── transfer/          # TransferPipeline + orchestrators
│   ├── tasks/             # Queue/retry primitives
│   └── messaging/         # Typed background/content bridges
└── ui/
    └── panels/            # PanelRoot + provider-aware subviews
```

### Key Contracts

- `SiteProvider`: exposes `detect(url | dom)`, `collectResources()`, `buildTransferPayload()`, optional `authAssist()`. Implements Adapter pattern per site.
- `StorageProvider`: wraps upload/list/create folder flows, exposes quota/readiness info, and surfaces retry hints.
- `TransferPipeline`: orchestrates detection → selection → background task dispatch. Accepts providers via dependency injection and uses Observer to sync content UI state.
- `ProviderRegistry`: central registry that knows which providers are enabled, manages lazy loading, and exposes capability metadata to UI.

## 4. Migration Phases

### Phase 0 – Rebrand & Communication (current sprint)

- ✅ Update docs (README, marketing copy, AGENT/CLAUDE references where applicable) to the "Pan Transfer" identity and describe multi-site vision. `README.md`, `AGENTS.md`, and `CLAUDE.md` now describe the Pan Transfer roadmap and tooling.
- ✅ Introduce this migration plan and track it in issues/PR templates. This document lives in `docs/pan-transfer-migration-plan.md` and is referenced from the contributor docs.
- ✅ Set up backlog items for code rename (package names, manifest `name`/`description`, log prefix). Runtime logs now use `[Pan Transfer]`; reconcile any remaining references in manifests and docs as interfaces ship. `package.json`, `src/manifest.json`, and `src/shared/log.ts` already reflect the rename/prefix.
- ✅ Outcome: contributors share a single plan; onboarding materials no longer reference the old single-site scope.

### Phase 1 – Core Abstractions & Scaffolding

- ✅ Create `src/platform/registry` and define TypeScript interfaces (`SiteProvider`, `StorageProvider`, `TransferContext`). See `src/platform/registry/types.ts`.
- ✅ Stand up `ProviderRegistry` service (background + shared module) with typed events for provider changes. Implemented in `src/platform/registry/provider-registry.ts` with unit tests.
- ✅ Introduce `TransferPipeline` skeleton with dependency injection and queue hooks. `src/core/transfer/transfer-pipeline.ts` now handles provider detection + dispatch.
- ✅ Add Vitest specs for the registry/pipeline contracts and ensure mocks cover both site and storage providers. Covered via `src/platform/registry/__tests__/provider-registry.spec.ts` and `src/core/transfer/__tests__/transfer-pipeline.spec.ts`.
- ✅ Exit criteria: background/content compile with new scaffolding, no behavioural change for CHAOSPACE users (changes shipped without altering front-end behaviour).

### Phase 2 – Site Provider Extraction & Sample Expansion

- ✅ Move existing CHAOSPACE-specific selectors/parsers into `providers/sites/chaospace` implementing the new interface. The analyzer + parsers now live under `src/providers/sites/chaospace`.
- ✅ `providers/sites/chaospace` now hosts the migrated DOM analyzers plus `createChaospaceSiteProvider` with initial detection/resource-mapping tests; runtime still consumes the analyzer directly until registry wiring lands.
- ✅ Content runtime now shows the detected provider badge in the floating panel header and automatically rebuilds via the ProviderRegistry path.
- ✅ Content runtime now instantiates a ProviderRegistry + `TransferPipeline` runner, so Chaospace detection/collection flows through `SiteProvider.collectResources` with automatic fallback to the legacy analyzer when no providers match.
- ✅ Add a second "example" provider (e.g., `generic-forum`) that exercises the interface and documents integration steps. `src/providers/sites/generic-forum` plus its fixtures/tests ship as the sample.
- ✅ Implement detection orchestration in content runtime: first matching provider wins (with telemetry when none match). `src/content/services/page-analysis-runner.ts` now calls `TransferPipeline.detectSiteProvider`.
- ✅ Ensure runtime logs stay on the `[Pan Transfer]` prefix once provider extraction lands to avoid mixing contexts. `src/shared/log.ts` + Playwright guards enforce the prefix.
- ✅ Update README with contributor docs on building site providers, plus a checklist for parity testing. See “Adding Site Providers” in `README.md`.
- ✅ Exit criteria: pipeline automatically routes between CHAOSPACE provider and the sample provider based on detection; Playwright exercises the CHAOSPACE path (`tests/e2e/panel.spec.ts` keeps the Chaospace regression suite).

#### Phase 2b – Provider-Driven Snapshots & History Refresh (new)

- ✅ Extend the `SiteProvider` contract with snapshot-oriented hooks (e.g., `collectSnapshot`, `collectHistoryDetail`, `resolveSeasonEntries`) so the background refresh pipeline no longer hard-codes Chaospace HTML parsing. (`src/platform/registry/types.ts`)
- ✅ Move `collectPageSnapshot`, history-detail parsing, season entry normalization, and completion summarization behind those provider hooks; keep the existing Chaospace parser as the reference implementation. (`src/providers/sites/chaospace/chaospace-site-provider.ts`)
- ✅ Allow providers to define item identity/deduping, completion heuristics, and “deferred season” loaders so history reconciliation respects provider-specific semantics. Chaospace now controls these behaviours inside its provider module.
- ✅ Wire `history-service` to resolve the provider via `ProviderRegistry` and dispatch to its snapshot implementation; when a provider lacks refresh support, skip gracefully with telemetry. (`src/background/services/history-service.ts`)
- ✅ Update shared history types to persist `siteProviderId/Label`; history and transfer stores now retain these fields (`src/shared/types/history.ts`, `src/shared/types/transfer.ts`, `src/background/storage/history-store.ts`). History cards, summaries, and search metadata now surface provider labels via `src/content/components/history/HistoryListView.vue`, `HistorySummaryView.vue`, and `history/history-card.helpers.ts`.
- ✅ Add Vitest fixtures per provider to cover snapshot + history-detail parsing without hitting the network; ensure Playwright can validate that history lists reflect provider labels. (`src/providers/sites/chaospace/__tests__/fixtures/chaospace-history-page.html`, `src/providers/sites/chaospace/__tests__/site-provider.spec.ts`, `tests/e2e/panel.spec.ts`)
- ✅ Introduce an extension-hosted test hook (`src/public/test-hooks.html`) so Playwright can seed `chrome.storage.local` directly before asserting provider labels/history UI, keeping the panel tests deterministic.
- ✅ Exit criteria: background history refresh works for any provider that implements the snapshot hooks, and Chaospace uses the new interface without regressing existing behaviour. (Provider fixtures + history UI in place unblock migration to Phase 4.)

### Phase 3 – Storage Provider Modularization

- ✅ Encapsulate Baidu Netdisk flows (`background/services/baidu`) into `providers/storage/baidu-netdisk` with typed capabilities (quota, link status, retry policy).
- ✅ Added a temporary `providers/storage/mock-storage-provider` to exercise the pipeline and tests before extracting the Baidu provider.
- ✅ Scaffolded `providers/storage/baidu-netdisk` that wraps the existing `handleTransfer` pipeline plus readiness checks, and introduced a dev toggle (`VITE_PAN_STORAGE_PROVIDER=mock` or `window.PAN_TRANSFER_STORAGE_PROVIDER='mock'`) to swap between Baidu and the mock provider.
- ✅ Background transfer requests (manual + history re-check) now route through the `TransferPipeline` storage dispatch helper so choosing Baidu vs. mock storage is purely configuration, no longer a direct call to `handleTransfer`.
- ✅ Define storage-agnostic transfer commands so future providers can plug in without editing content runtime. `dispatchTransferPayload` + the `'chaospace:transfer'` message now speak purely in terms of `StorageProvider` interfaces.
- ✅ Add integration tests (Vitest + mocked fetch) for Baidu provider (`src/providers/storage/baidu-netdisk/__tests__/baidu-netdisk-provider.spec.ts`).
- ✅ Document how to add new storage providers (README now includes “Adding Storage Providers” plus the mirrored 中文段落).
- ✅ Exit criteria: Transfer pipeline depends only on storage interfaces; feature flag allows swapping mock storage provider in dev builds.

### Phase 4 – Multi-Site UX & Settings

- Extend Vue panel to show detected site/provider, allow manual override, and surface provider-specific metadata (e.g., resource tags).
- Add settings panel under `platform/settings` where users enable/disable providers and configure default storage target.
- Ensure modular CSS + `styles.loader` support provider-specific accents without global leaks.
- Playwright coverage: detection state, provider switch, transfer confirmation.
- Exit criteria: multi-site UI ships by default; docs describe manual verification steps for each provider.

### Phase 5 – Release & Automation

- ✅ Author `.github/workflows/release.yml`:
  1. `npm ci`
  2. `npm run check`
  3. `npm run build`
  4. Upload `dist/` + metadata as workflow artifacts
  5. Optional: package zip + manifest version bump (manual approval gate for store upload)
- ✅ Add job to draft GitHub Releases with changelog excerpts once pipeline succeeds. (`softprops/action-gh-release` + generated notes)
- ✅ Update README with release badges/instructions and document manual Chrome Web Store submission steps referencing the workflow artifacts.
- ✅ Exit criteria: tagged builds automatically generate signed artifacts ready for store upload without touching local machines.

## 5. Dependencies & Risks

- **Testing debt**: new providers require DOM fixtures; allocate time to build HTML snapshots for Vitest to avoid flaky selectors.
- **Log prefix migration**: ensure analytics dashboards accept `[Pan Transfer]` before switching to avoid missing prod alerts.
- **Feature flags**: leverage existing storage (local/session) to persist toggles across contexts.
- **Docs drift**: keep README + plan in sync; revisit this plan after each phase and update "Last updated".

## 6. Tracking & Next Steps

1. File GitHub issues per phase with checklists mirroring the bullets above.
2. Phase 0 + Phase 1 remain complete; Phase 2b deliverables (history fixtures + UI surfacing) are now validated, so shift attention to the remaining documentation tasks in Phase 3.
3. With provider-driven history fixtures/tests and UI labels landed, proceed toward Phase 4’s multi-site UX work while tracking any follow-up bugs that emerge from the new coverage.
