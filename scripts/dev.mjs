import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const children = [
  spawn('node', ['--import', 'tsx', '--watch', 'apps/api/src/server.ts'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3000'], {
    cwd: 'apps/web',
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '3000',
      API_INTERNAL_URL: `http://127.0.0.1:${process.env.PORT ?? 4000}`,
    },
  }),
];
// Resolve Vite through the workspace package rather than a root dependency.
for (const child of children)
  child.on('exit', (code) => {
    for (const other of children) if (other !== child) other.kill();
    process.exitCode = code ?? 0;
  });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => children.forEach((c) => c.kill(signal)));
