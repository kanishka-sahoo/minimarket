import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DOLLAR } from '@minimarket/shared';
import { pool } from './db.ts';
import { migrate } from './migrate.ts';
import { createAccount, createMarket, allocateBot, quoteBot } from './exchange.ts';
export async function seed() {
  await migrate();
  const owner = await createAccount('system:seed', 'seed@example.invalid', 'MiniMarket Demo', true);
  const fixtures = [
    {
      title: 'Will the Aurora mission reach the moon before December?',
      category: 'Science' as const,
      outcomes: ['Yes', 'No'],
      probabilities: [6400, 3600],
    },
    {
      title: 'Which city will host the next World Design Festival?',
      category: 'Culture' as const,
      outcomes: ['Copenhagen', 'Kyoto', 'Lisbon', 'Other'],
      probabilities: [4000, 3000, 2000, 1000],
    },
    {
      title: 'Will Atlas Robotics run a sub-4-hour marathon?',
      category: 'Technology' as const,
      outcomes: ['Yes', 'No'],
      probabilities: [3800, 6200],
    },
    {
      title: 'Will Northstar FC win the championship final?',
      category: 'Sports' as const,
      outcomes: ['Yes', 'No'],
      probabilities: [7200, 2800],
    },
    {
      title: 'Which energy source will power Harbor Island first?',
      category: 'World' as const,
      outcomes: ['Solar', 'Wind', 'Tidal'],
      probabilities: [4500, 3500, 2000],
    },
    {
      title: 'Will the fictional Acorn Index finish above 5,000?',
      category: 'Finance' as const,
      outcomes: ['Yes', 'No'],
      probabilities: [5300, 4700],
    },
  ];
  for (const f of fixtures) {
    let id = (
      await pool.query('SELECT id FROM markets WHERE creator_id=$1 AND title=$2', [
        owner.id,
        f.title,
      ])
    ).rows[0]?.id;
    if (!id) {
      ({ id } = await createMarket(
        owner.id,
        randomUUID(),
        {
          title: f.title,
          category: f.category,
          outcomes: f.outcomes,
          kind: f.outcomes.length === 2 ? 'binary' : 'multi',
          closesAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
          source: 'https://example.com/minimarket-fictional-demo',
          criteria:
            'This is an explicitly fictional demonstration market. No real-world event determines its outcome. A MiniMarket administrator will publish a demo outcome here after closing; canceled demonstrations receive equal outcome payouts.',
        },
        true,
      ));
    }
    if (!(await pool.query('SELECT 1 FROM bots WHERE market_id=$1', [id])).rowCount)
      await allocateBot(owner.id, randomUUID(), {
        marketId: id,
        budget: 1000 * DOLLAR,
        probabilities: f.probabilities,
        spread: 4,
        size: 10,
      });
    await quoteBot(id);
  }
  // The seed owner is not a login identity. Only configured Google administrators can administer the live app.
  return fixtures.length;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Seeded ${await seed()} fictional markets`);
  await pool.end();
}
