-- Newsletter signups
CREATE TABLE IF NOT EXISTS newsletter_signups (
  email TEXT PRIMARY KEY,
  handle TEXT,
  source_scan_id TEXT,
  created_at INTEGER NOT NULL
);

-- Per-IP rate limit counters (day-bucketed)
CREATE TABLE IF NOT EXISTS rate_limits_ip (
  ip TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);

-- Global daily counter (circuit breaker)
CREATE TABLE IF NOT EXISTS rate_limits_global (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- Reports for the "this isn't my repo" link
CREATE TABLE IF NOT EXISTS reports (
  scan_id TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  reason TEXT,
  ip TEXT,
  PRIMARY KEY (scan_id, reported_at)
);

-- Index for "is this scan hidden?" lookups
CREATE INDEX IF NOT EXISTS idx_reports_scan_id ON reports(scan_id);
