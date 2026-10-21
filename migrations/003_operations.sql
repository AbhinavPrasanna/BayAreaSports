CREATE TABLE operational_checks (
  name text PRIMARY KEY,
  succeeded_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
