import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const checker = path.join(repositoryRoot, 'scripts/check-import-boundaries.mjs');

function runChecker(root?: string) {
  return execFileSync(
    process.execPath,
    root ? [checker, '--root', root] : [checker],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

describe('architecture import boundaries', () => {
  it('accepts the production dependency direction', () => {
    expect(runChecker()).toContain('Import boundaries passed');
  });

  it('rejects an application import from an adapter', () => {
    const fixtureRoot = path.join(
      repositoryRoot,
      'tests/fixtures/import-boundaries/negative/src',
    );

    expect(() => runChecker(fixtureRoot)).toThrow(
      /application must not import adapters/,
    );
  });
});
