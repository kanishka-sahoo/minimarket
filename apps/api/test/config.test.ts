import { expect, test } from 'vitest';
import { resolveOrigin } from '../src/config.ts';

test('explicit canonical origin wins over platform-generated URLs', () => {
  expect(
    resolveOrigin({ APP_ORIGIN: 'https://markets.example.com/', VERCEL_URL: 'preview.vercel.app' }),
  ).toBe('https://markets.example.com');
});
test('Vercel preview has an exact HTTPS origin without trusting arbitrary hosts', () => {
  expect(resolveOrigin({ VERCEL_URL: 'minimarket-branch-team.vercel.app' })).toBe(
    'https://minimarket-branch-team.vercel.app',
  );
});
test('Render and local development retain their origins', () => {
  expect(resolveOrigin({ RENDER_EXTERNAL_URL: 'https://minimarket.onrender.com' })).toBe(
    'https://minimarket.onrender.com',
  );
  expect(resolveOrigin({})).toBe('http://localhost:4000');
});
test('canonical origins cannot contain paths, credentials, or unsafe schemes', () => {
  for (const value of [
    'https://example.com/path',
    'https://user:pass@example.com',
    'javascript:alert(1)',
    'https://example.com?redirect=evil',
  ])
    expect(() => resolveOrigin({ APP_ORIGIN: value })).toThrow();
});
