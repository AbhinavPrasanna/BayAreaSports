ALTER TABLE games ADD COLUMN line_score jsonb CHECK (line_score IS NULL OR jsonb_typeof(line_score)='object');

CREATE TABLE player_stats_access (
  league text PRIMARY KEY CHECK (league IN ('nba','nfl','wnba')),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO player_stats_access(league) VALUES ('nba'),('nfl'),('wnba');

CREATE TABLE game_player_stats (
  league text NOT NULL,
  provider_id bigint NOT NULL,
  payload jsonb CHECK (payload IS NULL OR jsonb_typeof(payload)='array'),
  checked_at timestamptz,
  last_attempt_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  PRIMARY KEY(league,provider_id),
  FOREIGN KEY(league,provider_id) REFERENCES games(league,provider_id)
);
CREATE TABLE player_stats_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  next_check_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO player_stats_gate(singleton) VALUES(true);
