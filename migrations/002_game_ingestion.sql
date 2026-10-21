ALTER TABLE teams ADD COLUMN abbreviation text;

CREATE TABLE games (
  league text NOT NULL CHECK (league IN ('nba', 'nfl', 'wnba')),
  provider_id bigint NOT NULL,
  provider text NOT NULL DEFAULT 'balldontlie' CHECK (provider = 'balldontlie'),
  home_team_id integer NOT NULL,
  away_team_id integer NOT NULL,
  home_score integer CHECK (home_score >= 0),
  away_score integer CHECK (away_score >= 0),
  starts_at timestamptz,
  calendar_date date,
  status text NOT NULL CHECK (status IN ('scheduled','in_progress','final','postponed','canceled','delayed','suspended','abandoned','unknown')),
  original_status text,
  period integer,
  clock text,
  observed_at timestamptz NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league, provider_id),
  FOREIGN KEY (league, home_team_id) REFERENCES teams (league, provider_id),
  FOREIGN KEY (league, away_team_id) REFERENCES teams (league, provider_id),
  CHECK (home_team_id <> away_team_id)
);
CREATE INDEX games_start ON games (league, starts_at);
CREATE INDEX games_calendar_date ON games (league, calendar_date);

CREATE TABLE ingestion_state (
  league text PRIMARY KEY CHECK (league IN ('nba','nfl','wnba')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  game_count integer NOT NULL DEFAULT 0,
  window_start date,
  window_end date
);
INSERT INTO ingestion_state (league) VALUES ('nba'), ('nfl'), ('wnba');

-- Persistent shared request spacing survives worker restarts.
CREATE TABLE provider_throttle (
  provider text PRIMARY KEY,
  next_request_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO provider_throttle (provider) VALUES ('balldontlie');
