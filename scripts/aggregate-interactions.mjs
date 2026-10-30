import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const source = resolve(process.argv[2] ?? 'test-results/interactions/raw.json');
const target = resolve(process.argv[3] ?? 'test-results/interactions/summary.json');
const runs = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(runs) || runs.length !== 20) {
  throw new Error(`Expected exactly 20 interaction runs, received ${runs?.length ?? 'invalid data'}.`);
}
const inp = runs.map((run) => run.inp);
if (inp.some((value) => !Number.isFinite(value) || value <= 0)) {
  throw new Error('Every run must contain a positive finite INP value.');
}
const sorted = [...inp].sort((left, right) => left - right);
const feedback = runs.flatMap((run) => Object.entries(run.feedback).map(([action, value]) => ({
  run: run.run,
  action,
  value,
})));
if (feedback.some(({ value }) => !Number.isFinite(value) || value < 0)) {
  throw new Error('Every feedback measurement must be finite and non-negative.');
}
const summary = {
  protocol: {
    runs: 20,
    percentile: 'nearest-rank p75 (15th sorted value)',
    cpuSlowdown: 4,
    throughputMbps: 1.6,
    warmupsDiscarded: 0,
  },
  validRuns: runs.length,
  p75InpMs: sorted[Math.ceil(sorted.length * 0.75) - 1],
  maxFeedbackMs: Math.max(...feedback.map(({ value }) => value)),
  inpPass: sorted[14] <= 200,
  feedbackPass: feedback.every(({ value }) => value <= 100),
  feedback,
};
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (!summary.inpPass || !summary.feedbackPass) process.exitCode = 1;
