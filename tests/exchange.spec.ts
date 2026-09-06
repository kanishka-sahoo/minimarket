import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(page: Page, name: string, admin = false) {
  const response = await page.request.post('/api/test/login', {
    headers: { Origin: 'http://localhost:4000' },
    data: { name, admin },
  });
  expect(response.ok()).toBeTruthy();
}
test('discovery, search, categories and mobile layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What happens next?' })).toBeVisible();
  await expect(page.locator('.market-card')).toHaveCount(6);
  await page.screenshot({ path: 'test-results/desktop-discovery.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Science', exact: true }).click();
  await expect(page.locator('.market-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'All markets', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search markets' }).fill('Aurora');
  await expect(page.locator('.market-card')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.market-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-discovery.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('signed-in visitor buys, sells, mints, redeems, cancels and sees portfolio', async ({
  page,
}) => {
  await login(page, 'Trader-' + randomUUID().slice(0, 8));
  await page.goto('/');
  await page.locator('.market-card').filter({ hasText: 'Aurora' }).click();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-market.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Preview trade', exact: true })).toBeEnabled();
  await page.getByLabel('Number of shares', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Preview trade', exact: true }).click();
  await expect(page.getByText('Review your trade', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm trade', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 shares filled' })).toBeVisible();
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByRole('button', { name: 'Preview trade', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm trade', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 shares filled' })).toBeVisible();
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Mint $1.00', exact: true }).click();
  await expect(page.getByText('Complete sets updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Redeem $1.00', exact: true }).click();
  await expect(page.getByText('Complete sets updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByLabel('Order type').selectOption('limit');
  await page.getByLabel('Limit price · cents').fill('1');
  await page.getByRole('button', { name: 'Place buy order' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 resting' })).toBeVisible();
  await page.getByRole('link', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('button', { name: /Open orders/ }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No orders here' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset used', exact: true })).toBeDisabled();
});
test('user creates market, admin funds and settles, ledger updates', async ({ page }) => {
  const title = 'Will the browser test complete ' + randomUUID().slice(0, 8) + '?';
  await login(page, 'Creator-' + randomUUID().slice(0, 8));
  await page.goto('/create');
  await page.getByLabel('Your question').fill(title);
  await page.getByLabel('Trading closes · your local time').fill('2029-01-01T12:00');
  await page
    .getByLabel('Resolution criteria')
    .fill(
      'This fictional market resolves Yes when the browser test reaches its final assertion. The administrator will record the test result.',
    );
  await page.getByLabel('Evidence source URL').fill('https://example.com/browser-test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish market' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const id = page.url().split('/').at(-1)!;
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Mint $1.00', exact: true }).click();
  await expect(page.getByText('Complete sets updated.')).toBeVisible();
  await login(page, 'Admin-' + randomUUID().slice(0, 8), true);
  await page.goto('/admin');
  await page.getByLabel('Select a market').selectOption(id);
  await page.getByRole('button', { name: 'Allocate bot funds' }).click();
  await expect(page.getByText('This market already has a finite bot allocation.')).toBeVisible();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Halt trading', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Halt trading', exact: true })).toBeDisabled();
  await page
    .getByLabel('Evidence reference and explanation')
    .fill('https://example.com/browser-test — test completed successfully.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm final payout' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'This market is settled.' }),
  ).toBeVisible();
  await page.goto('/leaderboard');
  await expect(page.getByRole('table')).toBeVisible();
});
test('websocket reconnects after a network interruption', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('.market-card').first().click();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'commit' }).catch(() => {});
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('discovery pages reach older markets and searching resets the page', async ({ page }) => {
  const { createRequire } = await import('node:module');
  const { Pool } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
  const db = new Pool({
    connectionString:
      process.env.E2E_DATABASE_URL ??
      'postgresql://minimarket:minimarket@127.0.0.1:54329/minimarket_e2e',
  });
  try {
    const name = (await db.query('SELECT current_database() AS name')).rows[0].name;
    if (!name.endsWith('_e2e')) throw new Error('Browser fixtures require an _e2e database');
    await db.query(`INSERT INTO markets(id,creator_id,title,category,criteria,source,closes_at,kind)
      SELECT gen_random_uuid(),(SELECT id FROM accounts LIMIT 1),'Pagination browser fixture ' || n,'Science','Fictional pagination test criteria','https://example.com',now()+interval '1 day','binary' FROM generate_series(1,25) n`);
    await page.goto('/');
    const pagination = page.getByRole('navigation', { name: 'Markets pagination' });
    await expect(page.locator('.market-card')).toHaveCount(24);
    await pagination.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Markets page', exact: true })).toHaveValue(
      '2',
    );
    await page
      .getByRole('textbox', { name: 'Search markets' })
      .fill('Pagination browser fixture 25');
    await expect(page.locator('.market-card')).toHaveCount(1);
    await expect(page.getByRole('spinbutton', { name: 'Markets page', exact: true })).toHaveValue(
      '1',
    );
    await expect(pagination.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await db.query("DELETE FROM markets WHERE title LIKE 'Pagination browser fixture %'");
    await db.end();
  }
});
