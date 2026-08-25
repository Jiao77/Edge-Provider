CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  client_key_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  model TEXT NOT NULL,
  status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  streaming INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_provider_created ON usage_events(provider_name, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_model_created ON usage_events(model, created_at);
