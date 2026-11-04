import { spawn } from 'node:child_process';

const children = ['apps/api', 'apps/web'].map((workspace) =>
  spawn('npm', ['run', 'dev', '-w', workspace], { stdio: 'inherit', shell: true }),
);

function stopAll() {
  for (const child of children) child.kill();
}

for (const child of children) child.on('exit', stopAll);
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
