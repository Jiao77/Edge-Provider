CREATE TABLE IF NOT EXISTS client_rate_windows (
  client_key_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_key_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_client_rate_windows_start
  ON client_rate_windows(window_start);
