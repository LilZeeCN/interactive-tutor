import { spawn } from 'child_process';
import { join } from 'path';

const binExt = process.platform === 'win32' ? '.cmd' : '';
const tsx = join('node_modules', '.bin', `tsx${binExt}`);
const vite = join('node_modules', '.bin', `vite${binExt}`);

const children = [
  spawn(tsx, ['watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(vite, ['--port=3000', '--host=0.0.0.0'], { stdio: 'inherit' }),
];

let shuttingDown = false;

function stopChildren(signal = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill(signal);
    }
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChildren(signal);

  setTimeout(() => {
    stopChildren('SIGKILL');
  }, 5000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      shuttingDown = true;
      stopChildren('SIGTERM');
      process.exitCode = code ?? (signal ? 1 : 0);
    }
  });
}
