import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
if (process.env.VERCEL === '1' && process.env.SEED_DEMO === 'true')
  throw new Error('Run the demo seed once before deploying; SEED_DEMO must be false on Vercel.');
if (process.env.SEED_DEMO === 'true')
  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['--import', 'tsx', 'apps/api/src/seed.ts'], {
      stdio: 'inherit',
      env: process.env,
    });
    seed.on('error', reject);
    seed.on('exit', (code) => (code ? reject(new Error('Demo seed failed')) : resolve()));
  });
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
function launch(args, env = process.env) {
  const child = spawn('node', args, { stdio: 'inherit', env });
  children.push(child);
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
launch(['apps/web/.output/server/index.mjs'], {
  ...process.env,
  PORT: '3000',
  HOST: '127.0.0.1',
  API_INTERNAL_URL: `http://127.0.0.1:${process.env.PORT ?? 4000}`,
});
// Do not expose the public API/proxy until the SSR server can accept connections.
const deadline = Date.now() + 30_000;
while (!stopping) {
  const ready = await new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: 3000 });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
  if (ready) {
    launch(['--import', 'tsx', 'apps/api/src/server.ts']);
    break;
  }
  if (Date.now() >= deadline) {
    console.error('SSR server did not become ready within 30 seconds');
    stop(1);
    break;
  }
  await delay(100);
}
