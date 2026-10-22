ALTER TABLE games ADD COLUMN season integer;
ALTER TABLE games ADD COLUMN record_phase text CHECK (record_phase IN ('regular','playoffs'));
CREATE TABLE record_sync (
  league text NOT NULL CHECK (league IN ('nba','nfl','wnba')),
  season integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('regular','playoffs')),
  generation integer NOT NULL DEFAULT 1,
  published_generation integer,
  cursor bigint,
  seen_cursors jsonb NOT NULL DEFAULT '[]',
  page_count integer NOT NULL DEFAULT 0,
  end_date date,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  PRIMARY KEY (league,season,phase)
);
CREATE TABLE record_games (
  league text NOT NULL,
  season integer NOT NULL,
  phase text NOT NULL,
  generation integer NOT NULL,
  provider_id bigint NOT NULL,
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league,season,phase,generation,provider_id),
  FOREIGN KEY (league,season,phase) REFERENCES record_sync(league,season,phase)
);
CREATE TABLE record_poll_gate (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), next_check_at timestamptz NOT NULL DEFAULT now());
INSERT INTO record_poll_gate DEFAULT VALUES;
