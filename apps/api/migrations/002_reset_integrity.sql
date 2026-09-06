ALTER TABLE accounts ADD COLUMN reset_used boolean NOT NULL DEFAULT false;

UPDATE accounts a
SET reset_used = true
WHERE EXISTS (
  SELECT 1
  FROM ledger l
  WHERE l.account_id = a.id AND l.kind = 'reset'
);
