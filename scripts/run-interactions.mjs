import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const needsCommandShell =
      process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
    const executable = needsCommandShell ? process.env.ComSpec : command;
    const executableArgs = needsCommandShell
      ? ['/d', '/s', '/c', [command, ...args].join(' ')]
      : args;
    const child = spawn(executable, executableArgs, {
      env: environment,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

await run(npm, ['run', 'build']);
await run(
  npx,
  ['playwright', 'test', 'tests/performance', '--grep', '@interaction', '--project=chromium'],
  { ...process.env, INTERACTION_BUILD: '1' },
);
await run(process.execPath, ['scripts/aggregate-interactions.mjs']);
