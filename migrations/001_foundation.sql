CREATE TABLE teams (
  league text NOT NULL,
  provider_id integer NOT NULL CHECK (provider_id > 0),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (league, provider_id)
);

INSERT INTO teams (league, provider_id, name) VALUES
  ('nba', 10, 'Golden State Warriors'),
  ('nfl', 30, 'San Francisco 49ers'),
  ('wnba', 13, 'Golden State Valkyries');

CREATE TABLE worker_heartbeats (
  worker_name text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  error_code text
);
