# Pan Transfer Architecture Migration Plan

_Last updated: 2025-11-08_

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

- Update docs (README, marketing copy, AGENT/CLAUDE references where applicable) to the "Pan Transfer" identity and describe multi-site vision.
- Introduce this migration plan and track it in issues/PR templates.
- Set up backlog items for code rename (package names, manifest `name`/`description`, log prefix). Runtime logs now use `[Pan Transfer]`; reconcile any remaining references in manifests and docs as interfaces ship.
- Outcome: contributors share a single plan; onboarding materials no longer reference the old single-site scope.

### Phase 1 – Core Abstractions & Scaffolding

- Create `src/platform/registry` and define TypeScript interfaces (`SiteProvider`, `StorageProvider`, `TransferContext`).
- Stand up `ProviderRegistry` service (background + shared module) with typed events for provider changes.
- Introduce `TransferPipeline` skeleton with dependency injection, queue hooks, and feature-flag toggles (e.g., `enableMultiSitePipeline`).
- Add Vitest specs for the registry/pipeline contracts and ensure mocks cover both site and storage providers.
- Exit criteria: background/content compile with new scaffolding (behind feature flag), no behavioural change for CHAOSPACE users.

### Phase 2 – Site Provider Extraction & Sample Expansion

- Move existing CHAOSPACE-specific selectors/parsers into `providers/sites/chaospace` implementing the new interface.
- Add a second "example" provider (e.g., `generic-forum`) that exercises the interface and documents integration steps.
- Implement detection orchestration in content runtime: first matching provider wins (with telemetry when none match).
- Ensure runtime logs stay on the `[Pan Transfer]` prefix once provider extraction lands to avoid mixing contexts.
- Update README with contributor docs on building site providers, plus a checklist for parity testing.
- Exit criteria: pipeline can toggle between CHAOSPACE provider and sample provider in dev config; Playwright exercises CHAOSPACE path.

### Phase 3 – Storage Provider Modularization

- Encapsulate Baidu Netdisk flows (`background/services/baidu`) into `providers/storage/baidu-netdisk` with typed capabilities (quota, link status, retry policy).
- Define storage-agnostic transfer commands so future providers can plug in without editing content runtime.
- Add integration tests (Vitest + mocked fetch) for Baidu provider; document how to add new storage providers.
- Exit criteria: Transfer pipeline depends only on storage interfaces; feature flag allows swapping mock storage provider in dev builds.

### Phase 4 – Multi-Site UX & Settings

- Extend Vue panel to show detected site/provider, allow manual override, and surface provider-specific metadata (e.g., resource tags).
- Add settings panel under `platform/settings` where users enable/disable providers and configure default storage target.
- Ensure modular CSS + `styles.loader` support provider-specific accents without global leaks.
- Playwright coverage: detection state, provider switch, transfer confirmation.
- Exit criteria: multi-site UI available behind `enableMultiSiteUI` flag; docs describe manual verification steps for each provider.

### Phase 5 – Release & Automation

- Author `.github/workflows/release.yml`:
  1. `npm ci`
  2. `npm run check`
  3. `npm run build`
  4. Upload `dist/` + metadata as workflow artifacts
  5. Optional: package zip + manifest version bump (manual approval gate for store upload)
- Add job to draft GitHub Releases with changelog excerpts once pipeline succeeds.
- Update README with release badges/instructions and document manual Chrome Web Store submission steps referencing the workflow artifacts.
- Exit criteria: tagged builds automatically generate signed artifacts ready for store upload without touching local machines.

## 5. Dependencies & Risks

- **Testing debt**: new providers require DOM fixtures; allocate time to build HTML snapshots for Vitest to avoid flaky selectors.
- **Log prefix migration**: ensure analytics dashboards accept `[Pan Transfer]` before switching to avoid missing prod alerts.
- **Feature flags**: leverage existing storage (local/session) to persist toggles across contexts.
- **Docs drift**: keep README + plan in sync; revisit this plan after each phase and update "Last updated".

## 6. Tracking & Next Steps

1. File GitHub issues per phase with checklists mirroring the bullets above.
2. Start with Phase 0 tasks (current PR): update README + share this plan.
3. Kick off Phase 1 by drafting provider interfaces (`src/platform/registry/types.ts`) and stub registry tests.
