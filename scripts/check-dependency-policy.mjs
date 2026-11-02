import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const approvedDirectProduction = new Set(['react', 'react-dom']);
const failures = [];
for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
  if (!approvedDirectProduction.has(name)) {
    failures.push(`Unapproved direct production dependency: ${name}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    failures.push(`Production dependency ${name} is not pinned exactly.`);
  }
}
for (const name of approvedDirectProduction) {
  if (!manifest.dependencies?.[name]) {
    failures.push(`Approved production dependency is missing: ${name}`);
  }
}
for (const [location, entry] of Object.entries(lock.packages ?? {})) {
  if (!location || entry.dev || entry.devOptional) continue;
  if (entry.hasInstallScript) {
    failures.push(`Production package has a lifecycle install script: ${location}`);
  }
  if (entry.resolved && !entry.resolved.startsWith('https://registry.npmjs.org/')) {
    failures.push(`Production package is not resolved from the npm registry: ${location}`);
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  policy: {
    approvedDirectProductionDependencies: [...approvedDirectProduction].sort(),
    exactVersionsRequired: true,
    productionInstallScriptsAllowed: false,
    registry: 'https://registry.npmjs.org/',
  },
  directProductionDependencies: manifest.dependencies,
  failures,
  pass: failures.length === 0,
};
await mkdir(resolve('test-results/security'), { recursive: true });
await writeFile(
  resolve('test-results/security/dependency-policy.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
