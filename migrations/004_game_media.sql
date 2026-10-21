CREATE TABLE game_media (
  league text NOT NULL,
  provider_id bigint NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league, provider_id),
  FOREIGN KEY (league, provider_id) REFERENCES games (league, provider_id) ON DELETE CASCADE
);
