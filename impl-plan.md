# Weather Application Implementation Plan

## 1. Document Control and Approval Gate

| Item | Value |
|---|---|
| SDLC stage | Stage 4 — implementation planning |
| Authoritative artifact | Repository-root `impl-plan.md` |
| Requirements baseline | Repository-root `requirements.md`, user-approved 2026-10-27 |
| Architecture baseline | Repository-root `architecture.md`, user-approved 2026-10-27 |
| Design-review baseline | Repository-root `design-review.md`, Stage 3 satisfied 2026-10-27 |
| Plan structure | **User-approved input dated 2026-10-27:** dependency-ordered bounded tasks, concrete paths, blocker dispositions, deliverables, tests, commands, traceability, and a final human gate |
| Blocker state | **B-001 through B-016 resolved by the authoritative baselines and approved follow-up decisions** |
| Plan status | **Approved by the user on 2026-10-27** |
| Production implementation authorized | **Yes, for approved and unblocked Stage 5 tasks** |
| Plan amendment | **User-approved 2026-10-27: revise T-110 and T-120 to local-only verification; no deployment** |
| Current gate | Complete local verification, manual reviews, and final evidence/exception review; do not deploy |

This plan changes no requirement, architecture decision, or design-review
finding. It records the approved implementation details, including the
concrete module layout and Node.js major, and authorizes its unblocked Stage 5
tasks.

### User-approved Stage 7 amendment — 2026-10-27

The user explicitly approved replacing the deployment-specific portions of
T-110 and T-120 with local-only checks. No Cloudflare or other hosting
deployment is authorized by this amendment. The requirements and architecture
baselines are unchanged. Local checks must be described as local evidence;
they must not be presented as deployed response-header or hosting evidence.
T-120 still requires the approved 100-VU, five-minute workload and thresholds,
but it shall target only the local production preview using a loopback-only
script with redirects disabled. If k6 is unavailable, the task remains
incomplete; this plan change does not constitute a test result.

## 2. Evidence and Repository Inventory

The plan was prepared from the complete current baselines:

- `requirements.md`: FR-001–FR-007, NFR-001–NFR-016, BR-001–BR-021,
  AC-001–AC-044, WMO mapping, and approved B-003–B-016 dispositions;
- `architecture.md`: AD-001–AD-013, ports-and-adapters boundaries, provider
  contracts, state/retry/storage/budget policies, security, deployment, and
  verification architecture;
- `design-review.md`: satisfied Stage 3 gate, closed required findings, and
  non-blocking DR-016; and
- the repository-root inventory and existing `impl-plan.md`.

Repository state at finalization:

| Artifact | State |
|---|---|
| Production source | **Not Found** |
| Package manifest or lockfile | **Not Found** |
| Existing executable tests/fixtures | **Not Found** |
| Build/deployment configuration | **Not Found** |
| Git metadata | **Not Found**; this directory is not a Git repository |
| Referenced `implementation-planning` skill file | **Not Found** |

These values remain evidence facts; they are not silently reinterpreted.
Because there is no existing implementation, all implementation and test
files listed below are planned deliverables rather than existing files.

## 3. Resolved Toolchain, Module Map, and Commands

### 3.1 Toolchain

- **Runtime:** Node.js **24.x**, pinned in `.nvmrc`, `package.json#engines`,
  and CI. This resolves the approved Active-LTS policy because the official
  Node.js release page lists v24 as LTS while v26 is Current on 2026-10-27.
- **Application:** TypeScript, React, Vite, native ES modules, npm.
- **Tests:** Vitest, React Testing Library, MSW, and Playwright.
- **Quality:** Vitest/V8 coverage with minimum **80% lines, branches, and
  functions**; Lighthouse CI; `web-vitals` plus Event Timing instrumentation;
  gzip bundle-size verification; k6.
- **Hosting:** Cloudflare Pages static deployment. No server runtime, edge
  function, BFF, service worker, weather cache, or telemetry destination.

`package-lock.json` is committed and CI uses `npm ci`. Exact package versions
will be selected and locked during T-010; that mechanical selection may not
change the approved tools or architecture.

### 3.2 Concrete planned paths

```text
/
├─ package.json, package-lock.json, tsconfig*.json, vite.config.ts
├─ vitest.config.ts, playwright.config.ts, lighthouserc.cjs, .nvmrc
├─ index.html
├─ public/
│  ├─ _headers
│  └─ _redirects
├─ src/
│  ├─ domain/
│  │  ├─ models/, validation/, identity/, forecast/, conditions/, formatting/
│  │  └─ errors/
│  ├─ application/
│  │  ├─ ports/
│  │  ├─ weather/WeatherRequestCoordinator.ts
│  │  ├─ favorites/FavoritesPreferencesService.ts
│  │  ├─ budget/RequestBudgetService.ts
│  │  ├─ state/
│  │  └─ diagnostics/
│  ├─ adapters/
│  │  ├─ open-meteo/
│  │  ├─ geolocation/
│  │  ├─ storage/
│  │  ├─ budget/
│  │  └─ browser/
│  ├─ presentation/
│  │  ├─ app/, search/, location/, weather/, forecast/, favorites/, status/
│  │  └─ styles/
│  ├─ assets/icons/
│  ├─ composition/createApp.ts
│  └─ main.tsx
├─ tests/
│  ├─ fixtures/{geocoding,weather,storage}/
│  ├─ unit/{domain,application,adapters}/
│  ├─ component/
│  ├─ integration/
│  ├─ e2e/
│  ├─ accessibility/
│  └─ performance/
├─ scripts/
│  ├─ check-bundle.mjs
│  ├─ aggregate-lighthouse.mjs
│  └─ aggregate-interactions.mjs
├─ load/k6-static.js
└─ docs/{verification.md,provider-contract.md,release.md}
```

Dependencies point inward:
`presentation -> application -> domain`; application references interfaces in
`src/application/ports/`; browser/provider/storage code implements those
ports under `src/adapters/`; only `src/composition/createApp.ts` constructs
adapters. Tests may import any layer but production inward layers may not
import presentation or adapters.

### 3.3 Planned verification commands

| Purpose | Command |
|---|---|
| Reproducible install | `npm ci` |
| Type and static checks | `npm run check` |
| Unit/component/contract tests | `npm test` |
| Coverage gate | `npm run test:coverage` |
| Production build | `npm run build` |
| Initial gzip JS budget | `npm run test:bundle` |
| Playwright functional suite | `npm run test:e2e` |
| Accessibility suite | `npm run test:a11y` |
| DR-016 interaction evidence | `npm run test:performance:interactions` |
| Twenty-run Lighthouse evidence | `npm run test:performance:lighthouse` |
| Full local verification | `npm run verify` |
| Dependency audit | `npm audit --audit-level=high` |
| Five-minute static load test | `k6 run -e BASE_URL=<pages-url> load/k6-static.js` |

On Windows/CI, `BASE_URL` is supplied using the runner's environment syntax;
scripts themselves remain platform-neutral.

## 4. Blocker and Design-Review Dispositions

No B-series blocker remains open. The table records, rather than re-decides,
the synchronized approved decisions.

| Blocker | Status and controlling decision |
|---|---|
| B-001 | **Resolved:** Node 24.x; TypeScript, React, Vite, npm, ES modules; concrete paths in Section 3. |
| B-002 | **Resolved:** Vitest, React Testing Library, MSW, Playwright; V8 coverage at 80% minimum for lines, branches, and functions. |
| B-003 | **Resolved:** 1 MiB provider body, 200-character strings, 20 geocoding results, 16 daily values; latitude `[-90,90]`, longitude `[-180,180]`, Celsius `[-100,70]`, Fahrenheit `[-148,158]`, humidity `[0,100]`, elevation `[-500,9000]`, positive safe-integer IDs, WMO `[0,99]`; incompatible contracts rejected. |
| B-004 | **Resolved:** requirements Section 7.1 is exhaustive; unknown valid codes use `unknown`; SVG icons are bundled locally. |
| B-005 | **Resolved:** missing region/country is selectable and displayed unavailable; missing name, valid ID, or valid coordinates rejects a search candidate. |
| B-006 | **Resolved:** exact half degrees round away from zero; identical date records collapse and conflicting duplicates invalidate that date. |
| B-007 | **Resolved:** storage schema v1 only, no legacy migrator; valid-v1, mixed-invalid, corrupt-JSON, and future-version fixtures are mandatory. |
| B-008 | **Resolved:** clear-all removes favorites and preserves the unit. |
| B-009 | **Resolved:** session-memory fallback with persistent warning; failed writes preserve last confirmed durable state; valid storage events use latest-document-wins in delivery order. |
| B-010 | **Resolved:** successful application retrieval time is the browser clock instant, displayed in the validated location timezone and not labelled provider observation time. |
| B-011 | **Resolved:** WCAG 2.2 AA; keyboard/screen-reader semantics; latest two Chrome, Edge, Firefox, Safari majors; 320–1440+ CSS px; English copy and locale-aware formatting. |
| B-012 | **Resolved:** concise disclosure; no telemetry; bounded session-only in-memory diagnostics, cleared on reload/close, no export, and prohibited-data exclusions; no automatic favorite expiry. |
| B-013 | **Resolved:** strict approved CSP/headers; lockfile, `npm ci`, audit/dependency review, monthly updates, and release-blocking high/critical production findings absent approved exception. |
| B-014 | **Resolved:** online only, no service worker/weather cache; fail-closed same-origin coordination using localStorage, BroadcastChannel, and Web Locks; rolling 60-minute 100-request and rolling 24-hour 500-request limits. |
| B-015 | **Resolved:** Vite static build on Cloudflare Pages with committed `_redirects` and `_headers`. |
| B-016 | **Resolved:** 20 cold mobile Lighthouse runs at 4x CPU/1.6 Mbps evaluated at p75; LCP <=2.5 s, INP <=200 ms, CLS <=0.1, feedback <=100 ms, initial gzip JS <=250 KiB; k6 100 VUs for five minutes, errors <1%, p95 static response <500 ms; no end-to-end SLA. |

DR-001–DR-015 retain the statuses in `design-review.md`. **DR-016 is
addressed, not promoted to a blocker**, by the executable interaction
measurement in T-100: ordinary Lighthouse navigation output is explicitly
not accepted as INP evidence.

## 5. Dependency-Ordered Work Plan

Every task is bounded. A task may start only when its dependencies are
complete. “Acceptance” below is measurable task acceptance, not permission to
waive any baseline acceptance criterion.

### T-010 — Scaffold and enforce architecture/tooling

- **Depends on:** Final human approval of this plan.
- **Paths:** Root manifests/configuration, `src/` layer directories,
  `tests/`, CI configuration.
- **Deliverables:** Node 24.x pins; React/Vite/TypeScript npm scaffold;
  lockfile; scripts in Section 3.3; import-boundary checks; Vitest/RTL/MSW/
  Playwright setup; 80% coverage thresholds; empty accessible shell.
- **Tests:** Build and smoke render; test discovery; import-boundary negative
  fixture; clean `npm ci`.
- **Acceptance:** `npm ci`, `npm run check`, `npm test`, and `npm run build`
  succeed from a clean workspace; no BFF, service worker, secret, or runtime
  provider call exists.
- **Links:** AD-001, AD-006, AD-010; B-001, B-002, B-013.

### T-020 — Define domain contracts, validation, and fixtures

- **Depends on:** T-010.
- **Paths:** `src/domain/{models,validation,identity,conditions,errors}/`,
  `src/application/ports/`, `tests/fixtures/`, `docs/provider-contract.md`.
- **Deliverables:** Provider-neutral discriminated results; complete models
  and ports; all numeric/string/body/array limits; canonical identities and
  precision-preserving coordinate representation; exact WMO table; safe
  error keys; immutable local provider/storage fixtures.
- **Tests:** Every boundary and one-past-boundary; all WMO codes and unknown
  valid code; required/wrong-type/malformed/extra-field contracts; 1 MiB and
  256 KiB UTF-8 boundaries; 200/201 character boundaries; positive safe
  integer IDs; fixture schema checks.
- **Acceptance:** No unvalidated provider/persisted object can construct a
  domain model; incompatible contracts are rejected without coercion; every
  mapping branch has a fixture; no routine test calls Open-Meteo.
- **Links:** FR-001.8/.11/.12, FR-003.13/.14, NFR-004, NFR-007, NFR-016;
  AC-025–AC-030, AC-043; DR-002, DR-011; B-003–B-005.

### T-030 — Implement pure forecast, unit, identity, and formatting policies

- **Depends on:** T-020.
- **Paths:** `src/domain/{forecast,formatting,identity,conditions}/`.
- **Deliverables:** Strict location-local date handling; next-three-day
  selection; sort/deduplicate/conflict rejection; half-away-from-zero
  display rounding; Celsius/Fahrenheit semantics; canonical identity and
  changed-ID migration; locale formatting without timezone/unit drift.
- **Tests:** Midnight and DST, impossible dates, missing timezone, gaps,
  malformed and conflicting records, 2.5/-2.5/2.49/-2.49, ID-less search,
  device namespace, exact coordinate match/mismatch, multiple locales.
- **Acceptance:** Only the three dates immediately after location-local today
  qualify; no timezone fallback or fabricated day; formatting never mutates
  validated values.
- **Links:** FR-003, FR-004, FR-006.4/.15/.16, BR-005–BR-009,
  BR-014–BR-017; AC-005–AC-008, AC-018–AC-020, AC-022–AC-023, AC-044;
  B-006, B-010.

### T-040 — Implement timing, retry, embargo, and diagnostics policies

- **Depends on:** T-020.
- **Paths:** `src/application/ports/Clock.ts`,
  `src/application/weather/`, `src/application/diagnostics/`,
  `src/adapters/browser/`.
- **Deliverables:** Per-attempt 10-second timeout, cancellation, one transient
  retry, 250–1,000 ms jitter, `Retry-After` parsing/embargo, 10-second active
  wait cap, one-second manual cooldown, bounded in-memory diagnostic ring.
- **Tests:** Fake-clock just-before/at/after boundaries; 408/429/5xx/network/
  timeout versus other 4xx/validation; delta/date/invalid/past/long
  `Retry-After`; cancellation and late timer; diagnostic overflow, reload
  reset, exclusions, absence of export/transmission.
- **Acceptance:** No operation exceeds two attempts; embargo cannot be
  bypassed; long embargo ends active loading but remains enforced; diagnostics
  are session-memory-only and contain no raw payload, search history, precise
  coordinates, favorite, or permission state.
- **Links:** FR-005.7–.12, FR-007.7, NFR-005, NFR-014, BR-012;
  AC-009–AC-012, AC-042; AD-008, AD-013; B-012.

### T-050 — Implement preferences/favorites repository

- **Depends on:** T-020, T-030.
- **Paths:** `src/application/favorites/`,
  `src/adapters/storage/{PreferencesRepository,MemoryPreferencesRepository}.ts`,
  `tests/fixtures/storage/`.
- **Deliverables:** Schema-v1 document; 256 KiB UTF-8 limit; independent
  envelope/unit/entry validation; per-entry reset notification; no legacy
  migration; minimal favorites; whole-document confirmed writes; session
  fallback; storage-event latest-valid-document-wins.
- **Tests:** Required four fixture families; 256 KiB boundary; prototype and
  extra/prohibited fields; invalid unit; precision round trip; deduplication,
  changed ID, remove-one, clear-all preserving unit; inaccessible/private/
  quota/write failure; ordered valid and invalid storage events.
- **Acceptance:** Failed write never changes claimed durable state; fallback
  warning persists for the session; weather/history/permission/search fields
  are never serialized; valid neighbors survive an invalid v1 entry.
- **Links:** FR-006, NFR-007, NFR-015, BR-009/.10/.18–.20;
  AC-013–AC-015, AC-021–AC-023, AC-032–AC-035; AD-005, AD-009;
  B-007–B-009.

### T-060 — Implement rolling cross-tab request budget

- **Depends on:** T-020, T-040.
- **Paths:** `src/application/budget/`,
  `src/adapters/budget/{LocalStorageBudgetAdapter,BroadcastBudgetChannel}.ts`.
- **Deliverables:** Separate versioned budget document; Web Locks exclusive
  reservation; read/prune/check/append/write/confirm sequence; unique attempt
  IDs; BroadcastChannel/storage-event convergence; fail-closed behavior.
- **Tests:** Rolling 60-minute/24-hour exact expiry boundaries, 99/100/101 and
  499/500/501 attempts, retries consuming reservations, blocked attempts not
  consuming, clock movement, simultaneous tabs, lock cancellation, absent
  BroadcastChannel, inaccessible/failed/unconfirmed storage, stricter
  provider embargo.
- **Acceptance:** No dispatch occurs without confirmed reservation; counts
  never exceed 100 in any rolling 60 minutes or 500 in any rolling 24 hours
  across test tabs; budget documents contain no location/user content.
- **Links:** FR-005.13, BR-021, AC-036; AD-012; DR-006; B-014.

### T-070 — Implement external adapters

- **Depends on:** T-020, T-030, T-040, T-060.
- **Paths:** `src/adapters/open-meteo/`, `src/adapters/geolocation/`.
- **Deliverables:** Structured geocoding/forecast URLs; pre-dispatch budget
  reservation; response-size/type/range mapping; typed failures and abort;
  explicit-action-only geolocation with ten-second timeout and late-callback
  rejection. No reverse geocoding.
- **Tests:** MSW contract suite for success/empty/ambiguous/partial/malformed/
  oversized/HTTP/retry cases; exact query parameters and URL encoding;
  geolocation no-startup/success/denial/unavailable/timeout/cancellation/
  invalid coordinates/late callback.
- **Acceptance:** Only approved HTTPS hosts and parameters are used; no API
  key; rejected input dispatches nothing; all returned values are
  provider-neutral validated results.
- **Links:** FR-001–FR-005, NFR-001, NFR-004–NFR-006, AC-001–AC-012,
  AC-017, AC-025–AC-031, AC-043; DR-002, DR-008, DR-011.

### T-080 — Implement coordinator and application services

- **Depends on:** T-030–T-070.
- **Paths:** `src/application/weather/WeatherRequestCoordinator.ts`,
  `src/application/state/`, `src/application/favorites/`.
- **Deliverables:** Monotonic tokens; immutable location/unit operation
  identity; independent component states; terminal aggregation and atomic
  publication; supersession/cancellation; stale-token rejection;
  single-flight refresh; stale retention; persisted unit refetch.
- **Tests:** Every current/forecast terminal-state pair and completion order;
  same-token retry; rapid location/unit/favorite/geolocation changes; old
  token completion; duplicate refresh; failed refresh; no old-temperature
  relabel; retrieval timestamp in location timezone.
- **Acceptance:** No snapshot mixes location or unit; only active tokens
  publish; aggregation is bounded; retained previous data is visibly stale;
  successful retrieval time has the approved meaning.
- **Links:** FR-003–FR-006, BR-007/.008/.011–.013/.017,
  AC-006, AC-009–AC-016, AC-031; AD-003, AD-007; DR-004, DR-009.

### T-090 — Implement accessible responsive presentation

- **Depends on:** T-050, T-080.
- **Paths:** `src/presentation/`, `src/assets/icons/`, `public/_headers`,
  `public/_redirects`.
- **Deliverables:** Search/candidates, explicit location, weather/forecast,
  unit/refresh/retry, favorites, status/error/stale/offline/budget states;
  bundled SVGs; responsive styling; focus/status semantics; privacy notice;
  Open-Meteo attribution; strict CSP/security headers and SPA fallback.
- **Tests:** RTL user flows and announcements; automated accessibility;
  keyboard focus/order/visibility; injection rendered as text; all statuses;
  320, 1440, and >1440 widths; no external icons; no service-worker
  registration; English copy with locale-aware values.
- **Acceptance:** Ambiguous results do not fetch weather before selection;
  all actions are keyboard-operable and named; missing data is explicit;
  persistent fallback/write warnings are honest; approved CSP has no
  `unsafe-inline`/`unsafe-eval`.
- **Links:** FR-001–FR-007, NFR-001–NFR-009, NFR-014/.015,
  AC-001–AC-039, AC-042/.044; B-004/.005/.008–B-013.

### T-100 — Integrated E2E, accessibility, and interaction performance

- **Depends on:** T-090.
- **Paths:** `tests/e2e/`, `tests/accessibility/`,
  `tests/performance/interactions.spec.ts`,
  `scripts/aggregate-interactions.mjs`.
- **Deliverables:** Playwright core-flow/error/offline/cross-tab suite;
  executable DR-016 interaction suite using `web-vitals` INP reporting and a
  `PerformanceObserver` for Event Timing; retained JSON measurements, traces,
  and CI summary.
- **Measurement protocol:**
  1. Run 20 cold, isolated Chromium contexts against the production build
     with cache/storage reset, 4x CPU slowdown, and 1.6 Mbps throughput.
  2. Install instrumentation before application execution. Script
     representative search/candidate, unit-change, refresh/retry, and
     favorite interactions against MSW/stubbed data.
  3. For every action, mark dispatch and detect the first corresponding
     visible DOM feedback; require each latency to be <=100 ms.
  4. Capture interaction entries and final INP through Event Timing and
     `web-vitals`; sort 20 valid run values and use nearest-rank p75
     (`ceil(0.75*20)`, the 15th value).
  5. No warm-up run is discarded and no failed valid run is excluded.
     Harness failures are reported separately and rerun only after the cause
     is recorded; raw and aggregated artifacts are retained by CI.
- **Tests:** All AC flows; supported Playwright engines, with manual Safari
  checks where automation cannot establish actual Safari behavior; automated
  and manual WCAG 2.2 AA review; cross-tab Web Lock/budget races.
- **Acceptance:** p75 INP <=200 ms and every measured visible feedback start
  <=100 ms; functional/accessibility suites pass. **Ordinary Lighthouse
  output, especially cold navigation output without scripted interaction, is
  not sufficient evidence for INP.**
- **Links:** NFR-003, NFR-008, NFR-010, AC-038–AC-040; DR-010, DR-016.

### T-110 — Build, Lighthouse, bundle, and local artifact verification

- **Depends on:** T-100.
- **Paths:** Vite/Lighthouse configs, `scripts/check-bundle.mjs`,
  `scripts/aggregate-lighthouse.mjs`, `public/`, `docs/verification.md`.
- **Deliverables:** Production build; initial-JS gzip report; 20-run
  Lighthouse CI evidence; local Vite production-preview root/deep-link
  checks; static validation of the committed Cloudflare header/redirect
  policy; privacy, attribution, no-telemetry, and no-service-worker checks.
  Live Cloudflare deployment and response-header checks are explicitly
  excluded by the user-approved 2026-10-27 amendment.
- **Measurement protocol:** Run 20 independent cold mobile-profile Lighthouse
  navigations with cache/storage reset, 4x CPU slowdown and 1.6 Mbps
  throughput. No warm-up is excluded. Aggregate each metric by nearest-rank
  p75 (15th sorted value). Retain raw reports and aggregate JSON. Lighthouse
  proves LCP and CLS here; T-100 is the release evidence for INP and feedback.
- **Tests:** p75 LCP <=2.5 s; p75 CLS <=0.1; initial transferred JavaScript
  <=250 KiB gzip; static CSP and required-header policy; approved connect
  hosts only; local SPA root/deep-link routes; dependency audit. Do not claim
  that static policy validation verifies headers served by Cloudflare.
- **Acceptance:** Every threshold passes on retained evidence; high/critical
  production vulnerabilities block release absent a documented, time-bounded
  human exception; no availability guarantee is claimed. No hosted deployment
  is part of this amended task.
- **Links:** NFR-009–NFR-011, NFR-013/.014, AC-024, AC-037,
  AC-040/.042; AD-011; B-013, B-015, B-016.

### T-120 — Execute five-minute local static load test

- **Depends on:** T-110.
- **Paths:** `load/k6-static.js`, `docs/verification.md`.
- **Deliverables:** k6 scenario against the local Vite production preview,
  restricted to loopback HTTP hosts, with redirects disabled; static HTML and
  same-origin assets only; retained k6 summary. This local target is the
  user-approved 2026-10-27 amendment and is not Cloudflare load evidence.
- **Tests:** Ramp/hold the approved **100 VUs for five minutes**; assert
  `http_req_failed < 0.01` and `http_req_duration p(95) < 500 ms`; verify no
  Open-Meteo request is emitted and reject non-loopback targets.
- **Acceptance:** Both thresholds pass for the full five-minute hold; live
  provider quota consumption is zero. If k6 cannot execute the local scenario,
  T-120 remains incomplete; the amendment does not waive its workload or
  thresholds.
- **Links:** NFR-012, AC-041; B-016.

### T-130 — Final release evidence and implementation handoff

- **Depends on:** T-110, T-120.
- **Paths:** `README.md`, `docs/{verification,provider-contract,release}.md`.
- **Deliverables:** Reproducible setup/build/test/deploy instructions;
  module map; browser/manual-test record; AC evidence index; schema/provider
  maintenance guidance; monthly dependency process; known limitations,
  non-commercial restriction, quotas, attribution, no-SLA statement.
- **Tests:** Clean Node 24.x walkthrough of Section 3.3; evidence-link audit;
  local smoke/routes and static header-policy checks; prohibited-data/network
  inspection. Deployment and live response headers are excluded under the
  user-approved amendment.
- **Acceptance:** Every FR, NFR, BR, AC, B blocker, and review finding has
  pass evidence or an explicit human-approved release exception; no baseline
  is silently changed and no unresolved item is represented as passed.
- **Links:** All baseline requirements and findings.

## 6. Fixture and Edge-Case Minimums

T-020 creates, and later tasks consume, at least:

1. **Geocoding:** empty, one, ambiguous, 20/21 results; missing name/admin/
   country/ID; every coordinate/ID/string/body boundary; malformed envelope;
   network, timeout, abort, 408, 429, other 4xx, 5xx; every `Retry-After`
   form.
2. **Weather:** complete Celsius/Fahrenheit, partial current/forecast,
   absent/invalid timezone, aligned/misaligned arrays, 16/17 entries,
   malformed/impossible/duplicate/conflicting/gapped dates, midnight/DST,
   all WMO mappings, unknown valid and invalid codes, all numeric/body limits,
   HTTP/retry cases.
3. **Storage:** valid v1, mixed valid/invalid v1, corrupt JSON, unsupported
   future version; 256 KiB boundary; invalid unit; duplicates, changed ID,
   device favorite, forbidden fields, precision round trip, prototype-bearing
   and write-failure documents.
4. **Budget:** exact rolling-window expiries, near/at/over both limits,
   concurrent tabs, retries, blocked attempts, clock changes, lock and
   persistence failures, absent BroadcastChannel, and embargo precedence.

Fixtures identify the verified 2026-10-27 contract provenance and contain no
personal or live-user coordinates. Routine tests never call live providers.

## 7. Verification and Traceability Matrix

| Baseline | Tasks and evidence |
|---|---|
| FR-001 / AC-001–002, 025–030 | T-020, T-070–T-100 |
| FR-002 / AC-003–004, 017 | T-040, T-070–T-100 |
| FR-003 / AC-005–006, 018, 029 | T-020, T-030, T-050, T-070–T-100 |
| FR-004 / AC-007–008, 019–020, 027 | T-020, T-030, T-070–T-100 |
| FR-005 / AC-009–012, 016, 031, 036–037 | T-040, T-060–T-100 |
| FR-006 / AC-013–015, 021–023, 032–035 | T-020, T-030, T-050, T-080–T-100 |
| FR-007 / AC-024, 038–044 | T-090–T-130 |
| NFR-001–005 | T-020–T-100 |
| NFR-006–009 | T-020, T-050, T-070, T-090–T-130 |
| NFR-010 | T-100 (INP/feedback), T-110 (LCP/CLS) |
| NFR-011 | T-110 gzip budget |
| NFR-012 | T-120 k6 |
| NFR-013 | T-110/T-130 no-SLA documentation |
| NFR-014–016 | T-020, T-040, T-050, T-090–T-130 |
| BR-001–021 | T-020–T-100, with budget rules in T-060 |
| DR-001–015 | Preserved across T-010–T-130 |
| DR-016 | T-100 executable Event Timing/`web-vitals` Playwright evidence |
| B-001–016 | Resolved in Section 4 and verified by linked tasks |

## 8. Definition of Done

A task is done only when:

1. all dependencies are complete;
2. its deliverables, positive/negative/boundary/cancellation/failure tests,
   and measurable acceptance conditions pass;
3. changed production code meets the 80% line, branch, and function gates
   without excluding substantive modules merely to raise coverage;
4. no secret, unsafe external value, prohibited persistence, telemetry,
   diagnostic export, service worker, weather cache, or unapproved
   infrastructure is introduced;
5. affected traceability and evidence are updated;
6. verification uses actual retained output, not inference; and
7. any necessary departure from the approved baselines stops work and returns
   to the appropriate human approval gate.

Implementation completion is not deployment approval. Release still requires
the security, accessibility, browser, performance, bundle, load, privacy, and
deployed-header evidence assigned above.

## 9. Final Human Implementation-Plan Approval

The finalized dependency order, module map, task scope, verification protocol,
and traceability were **approved by the user on 2026-10-27**. Stage 5 may
implement approved, unblocked tasks in the recorded order. This approval does
not replace later production-code review, code-review finding disposition,
verification, or release approval.

No scaffolding, dependency installation, source implementation, test
implementation, deployment, or other production work may begin before the
human explicitly approves this final plan. Work stops here.
