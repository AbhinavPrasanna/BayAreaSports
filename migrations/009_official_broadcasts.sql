CREATE TABLE official_broadcasts (
  league text NOT NULL CHECK (league='nba'),
  provider_id bigint NOT NULL,
  nba_game_id text NOT NULL CHECK (nba_game_id ~ '^[0-9]{10}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (league,provider_id),
  FOREIGN KEY (league,provider_id) REFERENCES games(league,provider_id)
);
CREATE TABLE broadcast_sync_state (
  source text PRIMARY KEY CHECK (source='nba-warriors'),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0
);
INSERT INTO broadcast_sync_state(source) VALUES ('nba-warriors');
