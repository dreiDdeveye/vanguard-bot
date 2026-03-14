-- ═══════════════════════════════════════════════════════════════
-- VANGUARD PREDICTION BOT — Full Supabase Schema
-- Run this in the Supabase SQL Editor to recreate all tables
-- ═══════════════════════════════════════════════════════════════

-- Drop existing tables (order matters for dependencies)
DROP TABLE IF EXISTS chart_prices CASCADE;
DROP TABLE IF EXISTS live_prediction CASCADE;
DROP TABLE IF EXISTS prediction_stats CASCADE;
DROP TABLE IF EXISTS predictions CASCADE;

-- ═══════════════════════════════════════════
-- 1. PREDICTIONS — Historical prediction results
-- One row per 5-minute window per source
-- ═══════════════════════════════════════════
CREATE TABLE predictions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          BIGINT NOT NULL,                    -- Window start timestamp (unix seconds)
  ptb         DOUBLE PRECISION NOT NULL,          -- Price to Beat at window start
  end_price   DOUBLE PRECISION NOT NULL,          -- BTC price at window end
  over        BOOLEAN NOT NULL,                   -- true = correct prediction, false = wrong
  source      TEXT NOT NULL DEFAULT 'vanguard-bot', -- 'vanguard-bot' or 'vanguard'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ts, source)                             -- Prevent duplicate saves per window
);

-- Index for fast lookups by source and time
CREATE INDEX idx_predictions_source_ts ON predictions (source, ts DESC);

-- ═══════════════════════════════════════════
-- 2. LIVE_PREDICTION — Real-time bot prediction (single row, id=1)
-- Upserted continuously by the bot
-- ═══════════════════════════════════════════
CREATE TABLE live_prediction (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Always row 1
  window_start BIGINT,                            -- Current window timestamp
  direction   TEXT NOT NULL DEFAULT 'pending',     -- 'up', 'down', or 'pending'
  confidence  TEXT,                                -- 'HIGH', 'MED', 'LOW'
  conf_pct    DOUBLE PRECISION,                   -- Confidence percentage (0-100)
  ptb         DOUBLE PRECISION,                   -- Current price to beat
  btc_price   DOUBLE PRECISION,                   -- BTC price at prediction time
  bull_score  DOUBLE PRECISION DEFAULT 0,         -- Bull signal total
  bear_score  DOUBLE PRECISION DEFAULT 0,         -- Bear signal total
  signals     TEXT DEFAULT '',                    -- Signal descriptions
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert the default row
INSERT INTO live_prediction (id, direction) VALUES (1, 'pending');

-- ═══════════════════════════════════════════
-- 3. CHART_PRICES — Rolling BTC price history for chart
-- ═══════════════════════════════════════════
CREATE TABLE chart_prices (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          BIGINT NOT NULL,                    -- Timestamp in milliseconds
  price       DOUBLE PRECISION NOT NULL,          -- BTC price
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for time-range queries
CREATE INDEX idx_chart_prices_ts ON chart_prices (ts);

-- ═══════════════════════════════════════════
-- 4. PREDICTION_STATS — Aggregated stats (optional, read-only)
-- ═══════════════════════════════════════════
CREATE TABLE prediction_stats (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  wins        INT DEFAULT 0,
  losses      INT DEFAULT 0,
  total       INT DEFAULT 0,
  win_rate    DOUBLE PRECISION DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO prediction_stats (id) VALUES (1);

-- ═══════════════════════════════════════════
-- ROW LEVEL SECURITY — Allow anon read/write
-- ═══════════════════════════════════════════
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_prediction ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_stats ENABLE ROW LEVEL SECURITY;

-- Anon can read and insert predictions
CREATE POLICY "anon_read_predictions" ON predictions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_predictions" ON predictions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delete_predictions" ON predictions FOR DELETE TO anon USING (true);

-- Anon can read and upsert live_prediction
CREATE POLICY "anon_read_live" ON live_prediction FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_live" ON live_prediction FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_live" ON live_prediction FOR UPDATE TO anon USING (true);

-- Anon can read and insert chart_prices
CREATE POLICY "anon_read_chart" ON chart_prices FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_chart" ON chart_prices FOR INSERT TO anon WITH CHECK (true);

-- Anon can read and update prediction_stats
CREATE POLICY "anon_read_stats" ON prediction_stats FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_stats" ON prediction_stats FOR UPDATE TO anon USING (true);

-- ═══════════════════════════════════════════
-- CLEANUP FUNCTION — Auto-delete old chart prices (>1 hour)
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION cleanup_old_chart_prices()
RETURNS void AS $$
BEGIN
  DELETE FROM chart_prices WHERE ts < (EXTRACT(EPOCH FROM NOW()) * 1000 - 3600000);
END;
$$ LANGUAGE plpgsql;
