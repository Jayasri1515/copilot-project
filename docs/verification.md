# Verification guide

The project requires Node.js 24.x and npm 11.x. Install only from the
committed lockfile:

```sh
npm ci
```

## Local automated checks

- `npm run check` ? TypeScript project checks and inward import-boundary test.
- `npm test` ? Vitest unit, component, adapter, integration, and failure-case
  tests. Tests use committed local fixtures/MSW; routine tests do not call the
  live Open-Meteo provider.
- `npm run test:coverage` ? same suite with the 80% line, branch, and function
  thresholds.
- `npm run build` and `npm run test:bundle` ? production output and initial
  gzip JavaScript budget.
- `npm run test:e2e` / `npm run test:a11y` ? Playwright browser suites; install
  local browser binaries with `npx playwright install` as needed.
- `npm run test:performance:interactions` ? 20 isolated local production
  interactions, Event Timing/web-vitals INP and visible feedback aggregation.
- `npm run test:performance:lighthouse` ? 20 cold mobile Lighthouse runs;
  per-run assertions are disabled so `scripts/aggregate-lighthouse.mjs` can
  enforce approved nearest-rank p75 LCP/CLS thresholds across the 20 collected
  reports. `test-results/lighthouse/summary.json` is the aggregate evidence.
- `npm run test:deployment` ? static Cloudflare Pages artifact/header policy
  and local Vite production-preview root/deep-link routes. Vite preview does
  not apply Cloudflare response headers; this is not a deployed check.
- `npm run test:dependencies` ? direct-production allowlist and lockfile policy.
- `npm audit --omit=dev --audit-level=high` ? production dependency audit.
  Also review the full `npm audit --audit-level=high` result; tooling findings
  still matter to the maintenance/release decision.
- `npm run verify` ? type/boundary checks, coverage, build, bundle, all E2E
  projects, and automated accessibility suite.

## User-approved local-only verification scope

The user approved a 2026-10-27 amendment to T-110 and T-120 in
[`impl-plan.md`](../impl-plan.md): do not deploy, and use local production
preview checks instead. This approval does not authorize or claim Cloudflare
deployment, hosted smoke tests, or live response-header verification.

For T-110, run `npm run test:deployment` to validate the production artifact,
the committed `_headers`/`_redirects` policy, and local Vite root/deep-link
routes. Vite preview does not apply the Cloudflare `_headers` file, so these
checks do not prove actual response headers.

The current `load/k6-static.js` is intentionally restricted to HTTP loopback
IP addresses (`127.0.0.1` or `[::1]`) and does not follow redirects, so
it **cannot** target a Cloudflare Pages host. Its local-only invocation, after
the production preview is running, is:

```sh
k6 run -e BASE_URL=http://127.0.0.1:3000 load/k6-static.js
```

It requests only the local HTML and same-origin `/assets/` files, never
executes app JavaScript or contacts the provider, targets 100 virtual users
for a five-minute hold, and enforces fewer than 1% failed HTTP requests and
p95 below 500 ms. It rejects non-loopback HTTP targets and does not follow
redirects. k6 must be installed separately; it is not an npm dependency. The
load run is still required by amended T-120; if k6 is unavailable, the task
remains incomplete. Do not deploy as part of verification.

Manual screen-reader/WCAG 2.2 AA and actual Safari compatibility checks remain
required. Automated axe checks do not replace these human checks. Record
manual results and local verification evidence in
[`release.md`](release.md) for the current gate status.

The SPA is static and online-only. It has no server/BFF, service worker,
weather cache, confidential secret, telemetry destination, or provider call at
application startup.
