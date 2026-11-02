# Weather Application Design Review

## 1. Document Control and Gate Status

| Item | Value |
|---|---|
| SDLC stage | Stage 3 design re-review after B-001 through B-016 and follow-up decisions |
| Review date | 2026-10-27 |
| Review type | Independent requirements and architecture review |
| Requirements baseline | Repository-root `requirements.md`, approved 2026-10-27 |
| Architecture baseline | Repository-root `architecture.md`, approved 2026-10-27 |
| Prior review | Superseded by this re-review |
| Review status | **No open required findings** |
| Stage 3 gate | **Satisfied** |
| Implementation-plan finalization authorized | **Yes** |
| Production implementation authorized | **No; subject to the normal plan approval and implementation gate** |

This is the authoritative repository-root Stage 3 review. It re-evaluates the
current requirements and architecture after incorporation of B-001 through
B-016 and the follow-up numeric, storage, rolling-window, performance, and
diagnostic decisions. No requirements, architecture, implementation plan, or
code was modified by this review.

Concrete source paths/file names and the exact Node.js major resolved under
the approved current-Active-LTS policy are bounded implementation-plan
details. They are not missing business requirements or open design findings.

## 2. Review Method and Evidence Limits

The review compared:

- FR-001 through FR-007, NFR-001 through NFR-016, BR-001 through BR-021,
  AC-001 through AC-044, and their traceability;
- architecture decisions AD-001 through AD-013, component and port
  boundaries, trust boundaries, state and retry policies, persistence,
  deployment, security, diagnostics, and verification architecture;
- all prior required findings DR-001 through DR-009, DR-014, and DR-015;
- recommendation dispositions DR-010 through DR-013; and
- implementation-plan blocker dispositions B-001 through B-016.

The review covered correctness, completeness, security, privacy, provider
validation, storage, request budgets, scalability, reliability,
maintainability, performance, failure handling, traceability, tooling,
Cloudflare Pages deployment, testing architecture, and unnecessary
complexity.

No implementation, dependency manifest, executable tests, provider fixtures,
build output, or deployed Cloudflare Pages site exists in the inspected
evidence. Accordingly, this review verifies design consistency and readiness
for implementation-plan finalization; it does not claim runtime, build,
browser, provider, performance, security-header, or deployment verification.

## 3. Executive Assessment

The requirements and architecture are consistent at the level required to
finalize the implementation plan:

1. The direct browser/Open-Meteo topology, non-commercial boundary, provider
   contracts, CORS evidence, quotas, attribution, and absence of a
   confidential client credential are explicit.
2. Provider, browser, user, URL, and persisted inputs cross typed validation
   boundaries with approved payload, string, array, identifier, coordinate,
   weather-code, humidity, elevation, and temperature bounds.
3. Search and device locations use distinct canonical identity namespaces.
   Device coordinates go directly to weather without an unsupported
   reverse-geocoding assumption.
4. Request ownership, atomic location/unit identity, cancellation,
   component-terminal aggregation, partial publication, stale retention, and
   late-token rejection prevent mixed or misleading weather state.
5. Retry behavior is bounded per attempt and operation; `Retry-After`,
   provider embargoes, manual cooldown, and the shared rolling request budget
   cannot be bypassed by retries.
6. Favorites/preferences and budget counters use separate validated,
   versioned documents. Storage fallback, failed writes, cross-tab updates,
   minimal favorite fields, retention, and prohibited fields are defined.
7. Security headers, CSP, dependency controls, explicit geolocation,
   no-telemetry behavior, local-only diagnostics, privacy notice, and
   diagnostic exclusions are specified.
8. React/TypeScript/Vite/npm, test tools, coverage, quality targets,
   Cloudflare Pages static hosting, routing, and deployed-header verification
   are selected and traceable.
9. No BFF, service worker, weather cache, queue, database, autoscaling layer,
   remote telemetry service, or other unsupported infrastructure has been
   introduced.

No concrete required architecture or requirements change remains. All prior
required findings remain resolved. One non-blocking planning recommendation
is recorded in Section 6; it is not an accepted architecture change and does
not weaken any quality target.

## 4. Required-Finding Regression Verification

### DR-001 — Approval and gate state

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved; no regression**
- **Evidence:** Architecture Sections 1, 17, and 18 consistently identify the
  approved revised baseline and require this Stage 3 re-review. Requirements
  Sections 1, 9.2, and 11 retain approval provenance.
- **Impact:** The revised architecture is not mistaken for implementation
  authorization, and completion of this review provides the documented input
  needed to finalize Stage 4 planning.
- **Recommendation:** Update downstream plan metadata through its own
  approval process. Do not represent this gate as production implementation
  approval.

### DR-002 — Runtime, provider, credentials, and direct integration

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved at design-document level; no regression**
- **Evidence:** Requirements Sections 2, 3, and 5 and architecture Sections
  3, 4.1, 12, 13, and 16 define the browser SPA, exact Open-Meteo endpoints
  and requested fields, dated CORS evidence, no confidential key,
  non-commercial use, free-tier quotas, no provider SLA, and attribution.
- **Impact:** The implementation plan cannot infer a BFF, expose a paid
  credential, omit attribution, or claim unsupported provider availability.
- **Recommendation:** Retain contract evidence and execute the required
  deterministic compatibility fixtures before adapter completion.

### DR-003 — Location identity and entry paths

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved; no regression**
- **Evidence:** FR-001, FR-006, BR-009, AC-022/AC-023, and architecture
  Sections 6.1, 6.3, 7.1, 7.2, and 11 define namespaced search/device
  identities, ID-less search rejection, identity-specific coordinate
  precision, changed-ID migration, and no reverse-geocoding responsibility.
- **Impact:** Search and device favorites are valid, stable, distinguishable,
  and do not depend on fabricated display identity.
- **Recommendation:** Preserve the identity namespace and coordinate-source
  distinctions in plan schemas and tests.

### DR-004 — Temperature units and numeric display

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved; no regression**
- **Evidence:** FR-003, BR-007/BR-008/BR-015, AC-005/AC-006/AC-018, and
  architecture Sections 6, 8, and 10 define Celsius default, Celsius and
  Fahrenheit only, persistence, refetch on change, atomic request identity,
  validated ranges, and half-away-from-zero whole-degree display.
- **Impact:** Old numeric values cannot be relabelled under a new unit, and
  boundary behavior is deterministic.
- **Recommendation:** Include positive and negative tie and non-tie fixtures.

### DR-005 — Forecast-day and duplicate semantics

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved; no regression**
- **Evidence:** FR-004, BR-005/BR-006/BR-014, AC-007/AC-008/AC-019/AC-020,
  and architecture Section 10 require the validated location timezone,
  exclude local today, select only the immediately following three calendar
  dates, validate/sort records, collapse identical duplicates, reject all
  conflicting duplicates for a date, and prohibit timezone fallback.
- **Impact:** Forecasts remain deterministic across missing dates, malformed
  records, midnight, and daylight-saving transitions.
- **Recommendation:** Preserve strict-date, timezone, missing-day, and
  duplicate-conflict fixtures.

### DR-006 — Timeout, retry, embargo, and request budget

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved at architecture level; no regression**
- **Evidence:** FR-005, BR-012/BR-021, AC-009 through AC-012 and AC-036, and
  architecture Sections 9.1 through 9.4 define a 10-second per-attempt
  timeout, at most one automatic retry, transient classes, 250–1,000 ms
  jitter, `Retry-After` precedence, a 10-second active wait cap, full embargo
  retention, one-second manual cooldown, and rolling 60-minute/24-hour limits
  of 100/500 dispatched attempts.
- **Impact:** Retry storms and cross-tab budget races are bounded. Retries
  consume reservations, blocked attempts do not, and uncertain coordination
  fails closed.
- **Recommendation:** Plan fake-clock and real-browser race tests for exact
  window boundaries, clock changes, Web Locks, persistence confirmation,
  lock cancellation, absent `BroadcastChannel`, retries, and embargo scope.

### DR-007 — Persistence and storage failure

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved; no regression**
- **Evidence:** FR-006, NFR-007/NFR-015, AC-021/AC-032 through AC-035, and
  architecture Sections 6 and 11 define schema v1, a 256 KiB UTF-8 JSON cap,
  200-character stored strings, no inferred legacy migration, per-entry
  isolation, minimal fields, clear-all preserving unit, session-memory
  fallback, honest failed writes, and latest-delivered-valid-document wins.
- **Impact:** Corrupt, future, oversized, partial, unavailable, and concurrent
  storage states cannot be silently accepted or falsely reported as durable.
- **Recommendation:** Keep favorites/preferences and request-budget keys,
  schemas, validation, and failure messages separate.

### DR-008 — Explicit device location and privacy

- **Severity:** Medium
- **Classification:** Required change
- **Status:** **Resolved; no regression**
- **Evidence:** FR-002, FR-007.11, BR-004, AC-003/AC-004/AC-017/AC-042, and
  architecture Sections 7.2 and 12 prohibit startup geolocation, require
  explicit action and browser permission, bound the request, reject late
  callbacks, prohibit permission-state persistence, and require disclosure
  that coordinates are sent to Open-Meteo.
- **Impact:** Location access is user-initiated, recoverable, and transparent.
- **Recommendation:** Preserve denial, unavailable, timeout, cancellation,
  late-callback, and no-startup-invocation tests.

### DR-009 — Partial completion and atomic publication

- **Severity:** Medium
- **Classification:** Required change
- **Status:** **Resolved at architecture level; no regression**
- **Evidence:** BR-013 and architecture Sections 8.1 through 8.3 define an
  immutable token/location/unit request identity, independently terminal
  component states, bounded aggregation, atomic snapshots, same-token retry
  supersession, stale-token rejection, and stale prior-data handling.
- **Impact:** Current and forecast data cannot mix across location or unit,
  and one component cannot leave publication indefinitely loading.
- **Recommendation:** Cover every current/forecast terminal-state pairing,
  partial validation, refresh failure, retry, cancellation, and late result.

### DR-014 — Requirements approval metadata

- **Severity:** High
- **Classification:** Required change
- **Status:** **Resolved; no regression**
- **Evidence:** Requirements Sections 1 and 11 and architecture Sections 1
  and 18 identify the approved 2026-10-27 baselines and their separate gates.
- **Impact:** Decision provenance is preserved.
- **Recommendation:** Preserve it when finalizing the implementation plan.

### DR-015 — Complete NFR traceability

- **Severity:** Medium
- **Classification:** Required documentation change
- **Status:** **Resolved; no regression**
- **Evidence:** Architecture Section 16.1 maps all NFR-001 through NFR-016,
  including provider terms, accessibility, Web Vitals, bundle size, static
  load, no SLA, diagnostics, retention, and contract compatibility.
- **Impact:** Planning and release verification cannot silently omit the
  expanded quality baseline.
- **Recommendation:** Carry every NFR and AC into the plan's coverage matrix.

## 5. B-001 Through B-016 Disposition Verification

| Blocker | Review result |
|---|---|
| B-001 | Closed by AD-010: TypeScript, React, Vite, npm, ES modules, inward layer dependencies, and current Active Node.js LTS policy. Exact paths and resolved Node major remain bounded plan details. |
| B-002 | Closed by architecture Section 15: Vitest, React Testing Library, MSW, Playwright, and at least 80% line/branch/function coverage. |
| B-003 | Closed by NFR-004/NFR-007/NFR-016 and architecture Section 6.2: payload, storage, string, collection, identifier, and numeric bounds plus incompatible-contract rejection. |
| B-004 | Closed by requirements Section 7.1 and architecture Section 6.2: complete documented WMO mapping, unknown fallback, and local SVG assets. |
| B-005 | Closed by FR-001 and architecture Section 7.1: missing region/country remains selectable; missing name, ID, or valid coordinates does not. |
| B-006 | Closed by FR-003/FR-004 and architecture Section 10: half-away-from-zero rounding and conflicting-date rejection. |
| B-007 | Closed by FR-006 and AD-009: schema v1, no initial legacy migrator, and required fixture families. |
| B-008 | Closed: clear-all preserves the unit preference. |
| B-009 | Closed: session fallback, persistent warning, last-confirmed durable authority, and storage-event latest-valid-document behavior are defined. |
| B-010 | Closed: successful application retrieval time is displayed in the validated location timezone and is not provider observation time. |
| B-011 | Closed: WCAG 2.2 AA, keyboard/screen-reader behavior, latest two browser majors, 320–1440+ widths, English UI, and locale-aware formatting are defined. |
| B-012 | Closed: notice, favorite retention, no telemetry, session-memory-only diagnostics, prohibited diagnostic data, and no export are defined. |
| B-013 | Closed: strict CSP, security headers, lockfile, `npm ci`, audit/dependency review, monthly updates, and release-blocking vulnerability policy are defined. |
| B-014 | Closed: online-only/no service worker/no weather cache and a fail-closed, cross-tab, rolling-window budget are defined. |
| B-015 | Closed by AD-011: Cloudflare Pages static output, committed SPA fallback/routing, committed `_headers`, and deployed-site verification. |
| B-016 | Closed by NFR-010 through NFR-013 and architecture Sections 13 and 15: measurable Web Vitals, feedback, bundle, static-load, and no-SLA targets. |

## 6. New Review Observation

### DR-016 — Bind each performance metric to an executable measurement mode

- **Severity:** Low
- **Classification:** Recommendation; implementation-plan detail
- **Status:** **Open for plan finalization; non-blocking**
- **Evidence:** NFR-010 fixes the profile, run count, percentile, and LCP/INP/
  CLS thresholds. Architecture Sections 13 and 15 require 20 cold Lighthouse
  CI samples and “Lighthouse/Web Vitals-compatible performance evidence.”
  INP requires an interaction workload, while cold navigation evidence alone
  is sufficient for LCP/CLS but does not exercise INP.
- **Impact:** If the plan treats every cold navigation run as independently
  proving INP, it could report a target without a representative interaction
  sample. The approved metric and threshold themselves are not ambiguous.
- **Recommendation:** In the implementation plan, bind LCP/CLS to the
  specified cold mobile-profile runs and bind INP and the 100 ms feedback
  target to a deterministic scripted representative interaction flow using
  Lighthouse timespan/user-flow or another Web-Vitals-compatible browser
  measurement. Define p75 aggregation, warm-up/exclusion rules, and retained
  CI evidence. This does not require changing the approved architecture or
  quality target unless the chosen tool cannot produce the required evidence.

This recommendation is not an accepted decision on a specific measurement
script or tool mode. Those details remain subject to implementation-plan
review.

## 7. Cross-Cutting Assessment

| Review area | Assessment |
|---|---|
| Correctness | Search, location, identity, unit, forecast, retry, partial publication, persistence, and stale-state rules are mutually consistent. |
| Completeness | User flows, quality targets, provider boundaries, storage, budgets, deployment, diagnostics, and failure paths are specified sufficiently for planning. |
| Security | Untrusted input validation, strict CSP, structured URL construction, text rendering, local assets, headers, dependency controls, and no confidential client secret are defined. |
| Privacy | Geolocation is explicit; disclosure is required; persistence is minimal; no telemetry is sent; diagnostics are ephemeral, local, non-exportable, and exclude prohibited data. |
| Provider validation | Exact endpoints/fields, size and range limits, required-field/type rejection, unknown-extra-field behavior, WMO mapping, CORS evidence, and fixtures are specified. |
| Storage | Separate versioned documents, schema-v1 validation, size limits, precision, retention, fallback, write confirmation, and cross-tab behavior are covered. |
| Request budgets | Every attempt reserves before dispatch under a Web Lock; rolling 60-minute/24-hour limits, retries, fail-closed behavior, and provider embargo precedence are defined. |
| Scalability | Static assets use Cloudflare Pages; provider use is bounded to 100/hour and 500/day per browser profile; commercial or materially different scale requires a new decision. |
| Reliability | Timeouts, abort/late-result handling, one retry, aggregation, stale retention, storage fallback, and no-provider-SLA messaging are explicit. |
| Maintainability | Ports/adapters, typed provider-neutral results, inward dependencies, a composition root, fixtures, and lockfile/tooling controls provide stable boundaries. |
| Performance | LCP, INP, CLS, feedback, gzip bundle, and static-load targets are measurable; DR-016 asks the plan to bind metrics to executable modes. |
| Failure handling | Empty/not-found/ambiguous input, validation, network, HTTP, rate limit, timeout, offline, geolocation, partial weather, storage, budget, and cancellation paths are covered. |
| Traceability | All FRs, NFRs, prior findings, and B-001 through B-016 have current architecture coverage. |
| Cloudflare Pages | Static output, SPA fallback, `_headers`, HTTPS, CSP/header checks, load testing, privacy, attribution, and no-service-worker checks are release-gated. |
| Testing architecture | Unit, component, contract, E2E, accessibility, browser, fake-clock, cross-tab, performance, load, security-header, privacy, and deployment checks are identified. |
| Unnecessary complexity | No unsupported server, cache, queue, database, remote observability, or autoscaling subsystem is present. Web Locks is justified by the mandatory cross-tab hard budget. |

## 8. Stage 3 Decision

The **Stage 3 design-review gate is satisfied**.

- No required finding is open.
- No prior required finding regressed.
- DR-010 is now addressed by approved measurable targets.
- DR-011 remains adopted.
- DR-012 remains deferred/not applicable while no BFF exists.
- DR-013 remains adopted.
- DR-016 is a non-blocking implementation-plan recommendation and is not an
  unresolved architecture decision.

**Implementation-plan finalization is authorized as the next action.**
Finalization should update the stale blocker and baseline metadata in the
existing `impl-plan.md`, record concrete source paths and the Node.js major
resolved by the Active-LTS policy, and bind verification tasks to the approved
acceptance criteria without changing architecture silently.

Production implementation remains unauthorized until the finalized plan
passes its required human approval gate. Any plan choice that changes the
approved requirements, architecture, security posture, provider topology,
storage semantics, request budget, quality target, or deployment model must
return for human approval.
