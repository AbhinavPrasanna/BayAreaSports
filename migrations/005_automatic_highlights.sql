CREATE TABLE youtube_highlights (
  league text NOT NULL,
  provider_id bigint NOT NULL,
  video_id text NOT NULL UNIQUE CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (league, provider_id),
  FOREIGN KEY (league, provider_id) REFERENCES games(league, provider_id) ON DELETE CASCADE
);
CREATE INDEX youtube_highlights_expiry ON youtube_highlights (expires_at);

CREATE TABLE youtube_discovery_state (
  league text PRIMARY KEY CHECK (league IN ('nba','nfl','wnba')),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  channel jsonb,
  channel_verified_at timestamptz,
  quota_day date,
  requests_today integer NOT NULL DEFAULT 0 CHECK (requests_today >= 0)
);
INSERT INTO youtube_discovery_state (league) VALUES ('nba'), ('nfl'), ('wnba');
