ALTER TABLE usage_events ADD COLUMN first_token_ms INTEGER;
ALTER TABLE usage_events ADD COLUMN duration_ms INTEGER;
ALTER TABLE usage_events ADD COLUMN output_tps REAL;
ALTER TABLE usage_events ADD COLUMN usage_source TEXT NOT NULL DEFAULT 'unavailable';
ALTER TABLE usage_events ADD COLUMN completed INTEGER NOT NULL DEFAULT 1;

UPDATE usage_events
SET usage_source = CASE WHEN total_tokens IS NULL THEN 'unavailable' ELSE 'exact' END,
    duration_ms = latency_ms;
