import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const assetsDirectory = path.resolve('dist/assets');
const manifestPath = path.resolve('dist/.vite/manifest.json');
const maximumBytes = 250 * 1024;

if (!fs.existsSync(assetsDirectory) || !fs.existsSync(manifestPath)) {
  console.error('Build output is missing. Run npm run build first.');
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = Object.values(manifest).find((item) => item.isEntry);
  if (!entry) throw new Error('Vite manifest has no application entry.');
  const initialFiles = new Set();
  const addInitialChunk = (chunk) => {
    if (!chunk || initialFiles.has(chunk.file)) return;
    if (chunk.file.endsWith('.js')) initialFiles.add(chunk.file);
    for (const importedKey of chunk.imports ?? []) {
      addInitialChunk(manifest[importedKey]);
    }
  };
  addInitialChunk(entry);
  const javascriptFiles = [...initialFiles].sort();
  const files = javascriptFiles.map((file) => {
    const contents = fs.readFileSync(path.resolve('dist', file));
    return {
      file,
      uncompressedBytes: contents.byteLength,
      gzipBytes: gzipSync(contents).byteLength,
    };
  });
  const compressedBytes = files.reduce((total, file) => {
    return total + file.gzipBytes;
  }, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    budget: {
      scope: 'initial Vite entry and its static JavaScript imports',
      compression: 'node:zlib gzipSync defaults',
      maximumBytes,
    },
    files,
    compressedBytes,
    pass: compressedBytes <= maximumBytes,
  };
  mkdirSync(path.resolve('test-results/build'), { recursive: true });
  writeFileSync(
    path.resolve('test-results/build/bundle.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (compressedBytes > maximumBytes) {
    console.error(
      `Initial JavaScript is ${compressedBytes} bytes gzip, exceeding ${maximumBytes} bytes.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Initial JavaScript is ${compressedBytes} bytes gzip (limit ${maximumBytes}).`,
    );
  }
}
