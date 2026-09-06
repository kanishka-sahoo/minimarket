import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['apps/api/test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      ENABLE_TEST_AUTH: 'true',
      APP_ORIGIN: 'http://localhost:4000',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://minimarket:minimarket@127.0.0.1:54329/minimarket_test',
    },
  },
});
