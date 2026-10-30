import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const useCommandShell =
      process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
    const child = spawn(
      useCommandShell ? process.env.ComSpec : command,
      useCommandShell
        ? ['/d', '/s', '/c', [command, ...args].join(' ')]
        : args,
      { stdio: 'inherit', shell: false },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

await rm('.lighthouseci', { force: true, recursive: true });
await rm('test-results/lighthouse', { force: true, recursive: true });
await run(npm, ['run', 'build']);
await run(npx, ['lhci', 'autorun']);
await run(process.execPath, ['scripts/aggregate-lighthouse.mjs']);
