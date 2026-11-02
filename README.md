# Weather Browser SPA

A static, online-only weather SPA using browser-side Open-Meteo geocoding and
forecast APIs. The approved scope is non-commercial Open-Meteo free API use;
the application requires no confidential provider key. See
[`requirements.md`](requirements.md) and [`architecture.md`](architecture.md)
for the approved product and system boundary.

## Local setup

- Use Node.js 24.x and npm 11.x.
- Install from the committed lockfile with `npm ci`.
- Start the development server with `npm run dev`.
- Build with `npm run build`; preview the production build with `npm run preview`.

## Verification

- `npm run check` ? TypeScript and dependency-boundary checks.
- `npm run test:coverage` ? unit/component tests with 80% line, branch, and
  function coverage gates.
- `npm run verify` ? checks, coverage, production build, bundle, browser E2E,
  and automated accessibility suites.
- `npm run test:performance:interactions` ? 20-run local interaction evidence.
- `npm run test:performance:lighthouse` ? 20-run cold mobile Lighthouse evidence.
- `npm run test:deployment` ? static Pages output and local production routing;
  it does not contact a deployed site or test live response headers.
- `npm run test:dependencies` ? direct-production dependency policy.
- `npm audit --omit=dev --audit-level=high` ? production dependency audit.

See [`docs/verification.md`](docs/verification.md) for deployed/manual gates,
load-test requirements, retained evidence, and known limitations.
