import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve('dist');
const headersText = await readFile(resolve(root, '_headers'), 'utf8');
const redirectsText = await readFile(resolve(root, '_redirects'), 'utf8');
const requiredHeaders = {
  'content-security-policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com; manifest-src 'self'; form-action 'self'; upgrade-insecure-requests",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(self)',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
};
const parsedHeaders = {};
for (const line of headersText.split(/\r?\n/)) {
  const match = /^\s{2}([^:]+):\s*(.+)$/.exec(line);
  if (match) parsedHeaders[match[1].toLowerCase()] = match[2].trim();
}
const failures = [];
if (!headersText.startsWith('/*')) failures.push('_headers has no /* rule.');
for (const [name, expected] of Object.entries(requiredHeaders)) {
  if (parsedHeaders[name] !== expected) {
    failures.push(`Header ${name} is missing or differs from the approved value.`);
  }
}
if (redirectsText.trim() !== '/* /index.html 200') {
  failures.push('_redirects does not define the approved SPA fallback.');
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = resolve(directory, entry.name);
    files.push(
      ...(entry.isDirectory() ? await filesUnder(location) : [location]),
    );
  }
  return files;
}
const files = await filesUnder(root);
const relativeFiles = files.map((file) => relative(root, file).replaceAll('\\', '/'));
const forbiddenFile = relativeFiles.find((file) =>
  /(^|\/)(service-worker|sw)\.(js|mjs|ts)$|\.map$/i.test(file),
);
if (forbiddenFile) failures.push(`Forbidden production artifact: ${forbiddenFile}`);

const textFiles = files.filter((file) => /\.(?:html|js|css|json|txt)$/i.test(file));
const forbiddenContent = [
  ['service worker registration', /navigator\.serviceWorker|serviceWorker\.register/],
  ['telemetry destination', /google-analytics|googletagmanager|segment\.io|sentry\.io|mixpanel/i],
  ['embedded private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['likely embedded provider secret', /(?:api[_-]?key|client[_-]?secret)\s*[:=]\s*["'][^"']{8,}/i],
];
for (const file of textFiles) {
  const contents = await readFile(file, 'utf8');
  for (const [label, pattern] of forbiddenContent) {
    if (pattern.test(contents)) {
      failures.push(`${label} found in ${relative(root, file)}.`);
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  target: 'Cloudflare Pages static dist',
  files: relativeFiles.sort(),
  headers: parsedHeaders,
  spaFallback: redirectsText.trim(),
  checks: {
    requiredHeaders: failures.every((item) => !item.startsWith('Header')),
    approvedConnectHosts:
      parsedHeaders['content-security-policy'] ===
      requiredHeaders['content-security-policy'],
    spaFallback: redirectsText.trim() === '/* /index.html 200',
    noServiceWorkerCacheTelemetryOrSecrets: !failures.some((item) =>
      /Forbidden|service worker|telemetry|private key|secret/.test(item),
    ),
  },
  failures,
  pass: failures.length === 0,
};
await mkdir(resolve('test-results/deployment'), { recursive: true });
await writeFile(
  resolve('test-results/deployment/static-output.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
