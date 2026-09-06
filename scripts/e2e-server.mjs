import { spawn } from 'node:child_process';
const env = {
  ...process.env,
  NODE_ENV: 'test',
  ENABLE_TEST_AUTH: 'true',
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    'postgresql://minimarket:minimarket@127.0.0.1:54329/minimarket_e2e',
  APP_ORIGIN: 'http://localhost:4000',
  PORT: '4000',
};
const seed = spawn('node', ['--import', 'tsx', 'apps/api/test/bootstrap.ts'], {
  stdio: 'inherit',
  env,
});
seed.on('exit', (code) => {
  if (code) {
    process.exitCode = code;
    return;
  }
  const server = spawn('node', ['scripts/start.mjs'], { stdio: 'inherit', env });
  server.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
});
