CREATE TABLE team_player_status (
  league text NOT NULL,
  team_id integer NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  payload jsonb CHECK(payload IS NULL OR jsonb_typeof(payload)='array'),
  checked_at timestamptz,
  last_attempt_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  PRIMARY KEY(league,team_id),
  FOREIGN KEY(league,team_id) REFERENCES teams(league,provider_id)
);
INSERT INTO team_player_status(league,team_id) SELECT league,provider_id FROM teams WHERE enabled;
CREATE TABLE player_status_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  next_check_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO player_status_gate(singleton) VALUES(true);
