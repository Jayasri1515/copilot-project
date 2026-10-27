import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceDirectory = resolve(process.argv[2] ?? '.lighthouseci');
const target = resolve(
  process.argv[3] ?? 'test-results/lighthouse/summary.json',
);
const names = await readdir(sourceDirectory);
const reports = [];

// LHCI writes a collected <url>.report.json and a second lhr-*.json copy
// for each run. Aggregate the canonical collected reports only; including both
// would silently double the sample and violate the 20-run protocol.
for (const name of names
  .filter((name) => name.endsWith('.report.json'))
  .sort()) {
  const value = JSON.parse(
    await readFile(resolve(sourceDirectory, name), 'utf8'),
  );
  if (value?.lighthouseVersion && value?.audits) {
    reports.push({ name, value });
  }
}

if (reports.length !== 20) {
  throw new Error(
    `Expected exactly 20 raw Lighthouse reports, received ${reports.length}.`,
  );
}

const metrics = (auditId) =>
  reports.map(({ name, value }) => {
    const numericValue = value.audits[auditId]?.numericValue;
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      throw new Error(`${name} has no valid ${auditId} numeric value.`);
    }
    return { report: name, value: numericValue };
  });
const percentile = (values) =>
  [...values].sort((left, right) => left.value - right.value)[
    Math.ceil(values.length * 0.75) - 1
  ].value;

for (const { name, value } of reports) {
  const settings = value.configSettings;
  if (
    settings?.formFactor !== 'mobile' ||
    settings?.throttlingMethod !== 'simulate' ||
    settings?.throttling?.cpuSlowdownMultiplier !== 4 ||
    settings?.throttling?.downloadThroughputKbps !== 1600 ||
    settings?.disableStorageReset === true
  ) {
    throw new Error(`${name} does not contain the approved cold mobile profile.`);
  }
}

const lcp = metrics('largest-contentful-paint');
const cls = metrics('cumulative-layout-shift');
const p75LcpMs = percentile(lcp);
const p75Cls = percentile(cls);
const summary = {
  generatedAt: new Date().toISOString(),
  protocol: {
    runs: 20,
    percentile: 'nearest-rank p75 (15th sorted value)',
    formFactor: 'mobile',
    cpuSlowdownMultiplier: 4,
    downloadThroughputKbps: 1600,
    storageReset: true,
    warmupsDiscarded: 0,
    server: 'Vite production preview of dist',
  },
  validRuns: reports.length,
  p75LcpMs,
  p75Cls,
  thresholds: { maximumLcpMs: 2500, maximumCls: 0.1 },
  lcpPass: p75LcpMs <= 2500,
  clsPass: p75Cls <= 0.1,
  // Lighthouse navigation data is deliberately not represented as INP
  // evidence. T-100 owns the interaction evidence.
  inpEvidence: 'not measured by T-110; see test-results/interactions',
  lcp,
  cls,
};
await mkdir(resolve(target, '..'), { recursive: true });
await writeFile(target, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (!summary.lcpPass || !summary.clsPass) process.exitCode = 1;
