import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const child = spawn(
  process.execPath,
  [
    resolve('node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], shell: false },
);
const serverExited = new Promise((resolveExit) => child.once('exit', resolveExit));
let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

async function waitUntilReady() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4173/');
      if (response.ok) return;
    } catch {
      // The production preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production preview did not become ready.\n${output}`);
}

try {
  await waitUntilReady();
  const probes = [];
  for (const pathname of ['/', '/weather/deep-link']) {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:4173${pathname}`);
    const body = await response.text();
    probes.push({
      pathname,
      status: response.status,
      contentType: response.headers.get('content-type'),
      responseMs: performance.now() - started,
      hasApplicationRoot: body.includes('<div id="root"></div>'),
    });
  }
  const pass = probes.every(
    (probe) =>
      probe.status === 200 &&
      probe.contentType?.includes('text/html') &&
      probe.hasApplicationRoot,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    server: 'Vite production preview',
    note: 'Cloudflare _headers are verified statically; Vite preview does not apply them.',
    probes,
    pass,
  };
  await mkdir(resolve('test-results/deployment'), { recursive: true });
  await writeFile(
    resolve('test-results/deployment/local-production.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exitCode = 1;
} finally {
  child.kill();
  await serverExited;
}
